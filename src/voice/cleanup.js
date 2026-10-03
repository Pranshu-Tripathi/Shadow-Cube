const CLEANUP_TIMEOUT_MS = 20 * 1000;
const WARMUP_TIMEOUT_MS = 120 * 1000;

// The model is only allowed to nudge the transcript. If it comes back wildly
// longer or shorter it has started answering the prompt instead of fixing it.
const MIN_LENGTH_RATIO = 0.5;
const MAX_LENGTH_RATIO = 2.0;

// Small models follow a worked example far more reliably than a list of rules,
// and the trailing "Corrected:" cue stops them from prefacing the answer with chat.
function buildPrompt(text, terms) {
    const glossary = terms.length ? `Glossary (prefer these spellings): ${terms.join(', ')}\n\n` : '';
    return `Proof-read a voice transcript that was dictated to a coding assistant.

Do: delete every filler word (um, uh, er, so, like, you know, I mean, basically, actually) wherever it appears, including at the start; fix misheard technical terms using the glossary, joining words the glossary spells as one; fix homophones; add sentence punctuation and capitalisation.
Do not: answer, explain, summarise or comment on the transcript; add or drop any instruction the speaker gave; reword anything beyond the fixes above.

Output the corrected transcript and nothing else.

Transcript: um so can you like add a work tree for the get hub repo you know
Corrected: Can you add a worktree for the GitHub repo?

Transcript: UM, deploy the name space and then, you know, check the pods
Corrected: Deploy the namespace and then check the pods.

${glossary}Transcript: ${text}
Corrected:`;
}

function stripModelArtifacts(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .replace(/^(corrected|cleaned|fixed)( text| transcript)?\s*:\s*/i, '')
        .trim()
        .replace(/^["'“](.*)["'”]$/s, '$1')
        .trim();
}

const { createOllamaClient } = require('../local/ollamaClient');

function createCleanup({ config, ollamaClient = createOllamaClient({ host: config.OLLAMA_HOST }) }) {
    const model = config.VOICE_CLEANUP_MODEL;
    const keepAlive = config.VOICE_CLEANUP_KEEP_ALIVE;
    const enabled = Boolean(model);

    const generate = (prompt, timeoutMs) => ollamaClient.generate({ model, prompt, timeoutMs, keepAlive, temperature: 0, think: false });

    // Cold-loading a model costs far more than the edit itself, so pull it into
    // memory at boot rather than making the first voice note wait for it.
    async function warm() {
        if (!enabled) return;
        try {
            const started = Date.now();
            await generate('', WARMUP_TIMEOUT_MS);
            console.log(`[DEBUG] voice cleanup model ${model} warm (${Date.now() - started}ms)`);
        } catch (e) {
            console.error(`[DEBUG] could not warm ${model}:`, e.message);
        }
    }

    async function clean(text, terms = []) {
        if (!enabled || !text) return { text, cleaned: false };

        try {
            const raw = await generate(buildPrompt(text, terms), CLEANUP_TIMEOUT_MS);
            const candidate = stripModelArtifacts(raw);
            if (!candidate) throw new Error('ollama returned an empty response');

            const ratio = candidate.length / text.length;
            if (ratio < MIN_LENGTH_RATIO || ratio > MAX_LENGTH_RATIO) {
                console.log(`[DEBUG] voice cleanup rejected (length ratio ${ratio.toFixed(2)}), keeping raw transcript`);
                return { text, cleaned: false };
            }

            return { text: candidate, cleaned: candidate !== text };
        } catch (e) {
            // Cleanup is a nicety — never let it block or fail a voice message.
            console.error('[DEBUG] voice cleanup failed, keeping raw transcript:', e.message);
            return { text, cleaned: false };
        }
    }

    return {
        enabled,
        model,
        warm,
        clean,
    };
}

module.exports = {
    createCleanup,
    stripModelArtifacts,
};
