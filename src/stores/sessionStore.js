const fs = require('fs');
const { getDatabase } = require('../db/database');

function emptySessions() {
    return { threads: {} };
}

function loadSessionsConfig() {
    const threads = {};
    for (const row of getDatabase().query("SELECT conversation_id, session_id, channel_name FROM provider_sessions WHERE provider = 'claude'").all()) {
        threads[row.conversation_id] = { 'claude session id': row.session_id, channel: row.channel_name };
    }
    return { threads };
}

function saveSessionsConfig(config) {
    const db = getDatabase();
    db.transaction(() => {
        db.query("DELETE FROM provider_sessions WHERE provider = 'claude'").run();
        for (const [threadId, entry] of Object.entries(config.threads || {})) {
            if (entry['claude session id']) setSessionId(threadId, entry['claude session id'], entry.channel);
        }
    })();
}

function getSessionId(threadId) {
    return getDatabase().query("SELECT session_id FROM provider_sessions WHERE conversation_id = ? AND provider = 'claude'")
        .get(threadId)?.session_id || '';
}

function setSessionId(threadId, sessionId, channelName) {
    getDatabase().query(`
        INSERT INTO provider_sessions (conversation_id, provider, session_id, channel_name, updated_at)
        VALUES (?, 'claude', ?, ?, ?)
        ON CONFLICT(conversation_id, provider) DO UPDATE SET
            session_id = excluded.session_id,
            channel_name = excluded.channel_name,
            updated_at = excluded.updated_at
    `).run(threadId, sessionId, channelName || null, Date.now());
}

function clearSession(threadId) {
    getDatabase().query("DELETE FROM provider_sessions WHERE conversation_id = ? AND provider = 'claude'").run(threadId);
}

function getLatestSessionId(sessionIndexPath) {
    try {
        if (!fs.existsSync(sessionIndexPath)) return null;
        const data = JSON.parse(fs.readFileSync(sessionIndexPath, 'utf8'));
        if (!data.entries || data.entries.length === 0) return null;
        const sorted = data.entries.sort((a, b) => b.fileMtime - a.fileMtime);
        return sorted[0].sessionId;
    } catch (e) {
        console.error("[DEBUG] Failed to read session index:", e.message);
        return null;
    }
}

module.exports = {
    loadSessionsConfig,
    saveSessionsConfig,
    getSessionId,
    setSessionId,
    clearSession,
    getLatestSessionId,
};
