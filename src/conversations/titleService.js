const { getDatabase } = require('../db/database');

function cleanTitle(raw) {
    return String(raw || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```[\w-]*\s*/i, '')
        .replace(/```$/i, '')
        .replace(/^(title|thread title)\s*:\s*/i, '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .replace(/^['"`“”]+|['"`“”]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function fallbackTitle(prompt) {
    const cleaned = String(prompt || '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[`*_#>\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const words = cleaned.split(' ').filter(Boolean).slice(0, 7).join(' ');
    return (words || 'New conversation').slice(0, 80);
}

function createTitleService({ db = getDatabase(), ollamaClient, config }) {
    const inFlight = new Map();

    async function generate(prompt) {
        const fallback = fallbackTitle(prompt);
        if (!config.TITLE_MODEL || !ollamaClient) return fallback;
        try {
            const raw = await ollamaClient.generate({
                model: config.TITLE_MODEL,
                prompt: `Create a concise title of 3 to 7 words for this coding-assistant conversation. Preserve important project or ticket names. Do not answer the request. Output only the title.\n\nRequest: ${String(prompt).slice(0, 4000)}\n\nTitle:`,
                timeoutMs: config.TITLE_TIMEOUT_MS,
                keepAlive: config.VOICE_CLEANUP_KEEP_ALIVE,
                temperature: 0,
                think: false,
            });
            return cleanTitle(raw) || fallback;
        } catch (error) {
            console.error('[DEBUG] title generation failed, using prompt fallback:', error.message);
            return fallback;
        }
    }

    function current(conversationId) {
        return db.query('SELECT title FROM conversations WHERE id = ?').get(conversationId)?.title || null;
    }

    async function ensure({ workspaceId, conversationId, prompt, source = 'web', rename, onUpdate }) {
        const existing = current(conversationId);
        if (existing && !/^Chat \d+$/i.test(existing)) return existing;
        if (inFlight.has(conversationId)) return inFlight.get(conversationId);

        const task = (async () => {
            const now = Date.now();
            db.query(`
                INSERT OR IGNORE INTO conversations
                    (id, workspace_id, title, source, status, created_at, updated_at)
                VALUES (?, ?, NULL, ?, 'active', ?, ?)
            `).run(conversationId, workspaceId, source, now, now);
            const title = await generate(prompt);
            db.query('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), conversationId);
            if (rename) await Promise.resolve(rename(title)).catch((error) => console.error('[DEBUG] Discord thread rename failed:', error.message));
            if (onUpdate) onUpdate(title);
            return title;
        })().finally(() => inFlight.delete(conversationId));
        inFlight.set(conversationId, task);
        return task;
    }

    return { cleanTitle, fallbackTitle, generate, current, ensure };
}

module.exports = { createTitleService, cleanTitle, fallbackTitle };
