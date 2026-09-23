const fs = require('fs');

// Whisper caps the initial prompt at n_text_ctx/2 tokens. Stay well under it —
// a bloated glossary also starts steering the transcript rather than just spelling it.
const MAX_PROMPT_CHARS = 800;

function createVocabulary({ config }) {
    // Re-read on every use so edits to vocabulary.txt take effect without a restart.
    function loadFileTerms() {
        try {
            const raw = fs.readFileSync(config.VOCABULARY_PATH, 'utf8');
            return raw
                .split('\n')
                .map(line => line.replace(/#.*$/, '').trim())
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    function buildTerms({ channelName, projectName } = {}) {
        const terms = [...loadFileTerms()];
        if (projectName) terms.push(projectName);
        if (channelName) terms.push(channelName.replace(/-/g, ' '), channelName);

        const seen = new Set();
        return terms.filter((term) => {
            const key = term.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function buildWhisperPrompt(terms) {
        if (terms.length === 0) return '';
        let prompt = `Glossary: ${terms.join(', ')}.`;
        if (prompt.length > MAX_PROMPT_CHARS) {
            prompt = `${prompt.slice(0, MAX_PROMPT_CHARS).replace(/,[^,]*$/, '')}.`;
        }
        return prompt;
    }

    return {
        buildTerms,
        buildWhisperPrompt,
    };
}

module.exports = {
    createVocabulary,
};
