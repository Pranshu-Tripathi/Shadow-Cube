const { createTranscriber } = require('./transcriber');
const { createVocabulary } = require('./vocabulary');
const { createCleanup } = require('./cleanup');
const { createVoiceFlow } = require('./voiceFlow');

function createVoice({ config, channelHelpers, worktrees, formatting, dispatch, transcriber, vocabulary, cleanup }) {
    return createVoiceFlow({
        config,
        channelHelpers,
        worktrees,
        formatting,
        dispatch,
        // Reuse shared instances when provided (so the model is warmed once), else build.
        transcriber: transcriber || createTranscriber({ config }),
        vocabulary: vocabulary || createVocabulary({ config }),
        cleanup: cleanup || createCleanup({ config }),
    });
}

module.exports = {
    createVoice,
};
