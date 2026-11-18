const providerCommand = require('./providerCommand');
const baseCommand = require('./baseCommand');
const worktreesCommand = require('./worktreesCommand');
const deployCommand = require('./deployCommand');
const pushCommand = require('./pushCommand');
const ruleCommand = require('./ruleCommand');
const repoCommand = require('./repoCommand');
const projectCommand = require('./projectCommand');
const memoryCommand = require('./memoryCommand');
const clearCommand = require('./clearCommand');
const destroyCommand = require('./destroyCommand');
const agentMessageHandler = require('./agentMessageHandler');
const { createVoice } = require('../voice');

function createCommandRegistry(context) {
    const commands = [
        providerCommand,
        baseCommand,
        worktreesCommand,
        deployCommand,
        pushCommand,
        ruleCommand,
        repoCommand,
        projectCommand,
        memoryCommand,
        clearCommand,
        destroyCommand,
    ];

    // Approved transcripts skip the command loop on purpose — a misheard `!destroy`
    // is not a risk worth taking. Voice reaches the agent, never the commands.
    function dispatchTranscript(message, transcript, thread) {
        return agentMessageHandler.execute({ message, cleanPrompt: transcript, context, thread });
    }

    const voice = createVoice({
        config: context.config,
        channelHelpers: context.channelHelpers,
        worktrees: context.worktrees,
        formatting: context.formatting,
        dispatch: dispatchTranscript,
        transcriber: context.transcriber,
        vocabulary: context.vocabulary,
        cleanup: context.cleanup,
    });

    async function handleMessage(message) {
        if (message.author.bot) return;

        if (voice.isAudioMessage(message)) {
            return voice.handle(message);
        }

        const cleanPrompt = context.formatting.stripDiscordTags(message.content);
        for (const command of commands) {
            const commandMatch = command.match(cleanPrompt, message, context);
            if (commandMatch) {
                return command.execute({ message, cleanPrompt, match: commandMatch, context });
            }
        }

        // Messages typed into a web-created mirror thread are routed back to that
        // web conversation (bidirectional broadcast) instead of the default handler.
        if (context.webBridge && await context.webBridge.handleInbound(message, cleanPrompt)) {
            return;
        }

        return agentMessageHandler.execute({ message, cleanPrompt, context });
    }

    return {
        handleMessage,
        voice,
    };
}

module.exports = {
    createCommandRegistry,
};
