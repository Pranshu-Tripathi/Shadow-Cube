const fs = require('fs');
const { spawn } = require('child_process');

const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;

// Whisper emits these when handed silence or noise. They are never a real prompt.
const HALLUCINATION_PATTERNS = [
    /^\[?blank_?audio\]?$/i,
    /^\[.*\]$/,
    /^\(.*\)$/,
    /^(thank you|thanks|thanks for watching|you|bye|okay|ok|oh|hmm|mm|so|uh|um)[.!?]*$/i,
    /subtitles? (by|provided)/i,
    /amara\.org/i,
];

function looksHallucinated(text) {
    return HALLUCINATION_PATTERNS.some(pattern => pattern.test(text));
}

function createTranscriber({ config }) {
    function checkAvailability() {
        const problems = [];
        if (!fs.existsSync(config.WHISPER_MODEL)) {
            problems.push(`whisper model not found at ${config.WHISPER_MODEL} (set WHISPER_MODEL, or see README)`);
        }
        return problems;
    }

    function run(wavPath, prompt) {
        return new Promise((resolve, reject) => {
            const args = [
                '-m', config.WHISPER_MODEL,
                '-f', wavPath,
                '-l', config.WHISPER_LANGUAGE,
                '-nt',   // no timestamps
                '-np',   // no progress prints
                '-sns',  // suppress non-speech tokens
            ];
            if (prompt) args.push('--prompt', prompt);

            const child = spawn(config.WHISPER_BIN, args);
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('transcription timed out'));
            }, TRANSCRIBE_TIMEOUT_MS);

            child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            child.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`${config.WHISPER_BIN} failed to start: ${err.message}`));
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    return reject(new Error(`${config.WHISPER_BIN} exited ${code}: ${stderr.trim().slice(0, 300)}`));
                }
                resolve(stdout);
            });
        });
    }

    // whisper-cli prints one line per segment; join them back into a single prompt.
    function normalise(stdout) {
        return stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async function transcribe(wavPath, { prompt } = {}) {
        const text = normalise(await run(wavPath, prompt));
        if (text.length < 2 || looksHallucinated(text)) return '';
        return text;
    }

    return {
        checkAvailability,
        transcribe,
    };
}

module.exports = {
    createTranscriber,
    looksHallucinated,
};
