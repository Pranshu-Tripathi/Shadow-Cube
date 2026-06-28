const providerCommand = require('./providerCommand');
const baseCommand = require('./baseCommand');
const worktreesCommand = require('./worktreesCommand');
const deployCommand = require('./deployCommand');
const pushCommand = require('./pushCommand');
const ruleCommand = require('./ruleCommand');
const repoCommand = require('./repoCommand');
const memoryCommand = require('./memoryCommand');
const clearCommand = require('./clearCommand');
const destroyCommand = require('./destroyCommand');
const agentMessageHandler = require('./agentMessageHandler');

function createCommandRegistry(context) {
    const commands = [
        providerCommand,
        baseCommand,
        worktreesCommand,
        deployCommand,
        pushCommand,
        ruleCommand,
        repoCommand,
        memoryCommand,
        clearCommand,
        destroyCommand,
    ];

    async function handleMessage(message) {
        if (message.author.bot) return;

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
    };
}

module.exports = {
    createCommandRegistry,
};
