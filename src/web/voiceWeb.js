// Web voice mode — the browser records audio and posts it here; we run the exact
// same local pipeline as Discord voice notes (ffmpeg → whisper.cpp → optional ollama
// cleanup) and hand back text. Transcription is serialized because whisper is
// GPU-bound: two clips at once just makes both slower.

const path = require('path');
const audio = require('../voice/audio');

function createWebVoice({ config, transcriber, vocabulary, cleanup, worktrees, channelStore }) {
    let queue = Promise.resolve();
    function enqueue(task) {
        const run = queue.then(task, task);
        queue = run.catch(() => {});
        return run;
    }

    function available() {
        return transcriber.checkAvailability();
    }

    async function transcribeBuffer(buffer, { ext = 'webm', workspaceId } = {}) {
        const problems = transcriber.checkAvailability();
        if (problems.length) {
            const err = new Error(problems[0]);
            err.unavailable = true;
            throw err;
        }

        const tmpDir = audio.createTempDir();
        try {
            const sourcePath = path.join(tmpDir, `input.${ext.replace(/[^a-z0-9]/gi, '') || 'webm'}`);
            const wavPath = path.join(tmpDir, 'input.wav');
            await Bun.write(sourcePath, buffer);
            await audio.toWav(config.FFMPEG_BIN, sourcePath, wavPath);

            let projectName;
            let channelName;
            if (workspaceId) {
                const project = worktrees.getProjectConfig(workspaceId);
                projectName = project?.projectName;
                const cfg = channelStore.loadChannelConfig()[workspaceId];
                channelName = cfg?.name;
            }
            const terms = vocabulary.buildTerms({ channelName, projectName });

            const raw = await transcriber.transcribe(wavPath, { prompt: vocabulary.buildWhisperPrompt(terms) });
            if (!raw) return { text: '', cleaned: false };

            const result = await cleanup.clean(raw, terms);
            return result;
        } finally {
            audio.cleanupTempDir(tmpDir);
        }
    }

    function transcribe(buffer, opts) {
        return enqueue(() => transcribeBuffer(buffer, opts));
    }

    return { available, transcribe };
}

module.exports = {
    createWebVoice,
};
