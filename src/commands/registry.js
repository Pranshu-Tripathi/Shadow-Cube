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
    function dispatchTranscript(message, transcript) {
        return agentMessageHandler.execute({ message, cleanPrompt: transcript, context });
    }

    const voice = createVoice({
        config: context.config,
        channelHelpers: context.channelHelpers,
        worktrees: context.worktrees,
        formatting: context.formatting,
        dispatch: dispatchTranscript,
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
