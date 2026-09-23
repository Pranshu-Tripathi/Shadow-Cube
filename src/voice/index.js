const { createTranscriber } = require('./transcriber');
const { createVocabulary } = require('./vocabulary');
const { createCleanup } = require('./cleanup');
const { createVoiceFlow } = require('./voiceFlow');

function createVoice({ config, channelHelpers, worktrees, formatting, dispatch }) {
    return createVoiceFlow({
        config,
        channelHelpers,
        worktrees,
        formatting,
        dispatch,
        transcriber: createTranscriber({ config }),
        vocabulary: createVocabulary({ config }),
        cleanup: createCleanup({ config }),
    });
}

module.exports = {
    createVoice,
};
