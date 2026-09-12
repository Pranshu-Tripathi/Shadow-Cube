const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const config = require('./config');
const channelStore = require('./stores/channelStore');
const sessionStore = require('./stores/sessionStore');
const formatting = require('./discord/formatting');
const channelHelpers = require('./discord/channel');
const memory = require('./memory/memoryService');
const claudeStdio = require('./providers/claude/claudeStdio');
const { createQuestionFlow } = require('./discord/questionFlow');
const { createWorktreeService } = require('./git/worktreeService');
const { createGithubClient } = require('./github/githubClient');
const { createRulesRepoService } = require('./github/rulesRepoService');
const { createClaudeRunner } = require('./providers/claude/claudeRunner');
const { createAgentRouter } = require('./providers/agentRouter');
const { createCommandRegistry } = require('./commands/registry');
const { runCodex, clearCodexSession, handleCodexApproval } = require('./providers/codex');

function createBot() {
    if (!config.DISCORD_TOKEN) {
        console.error('DISCORD_TOKEN is required. Set it in your .env file.');
        process.exit(1);
    }

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
        partials: [Partials.Channel]
    });

    const activeProcesses = new Map();
    const worktrees = createWorktreeService({ config, channelStore });
    const github = createGithubClient({ token: config.GITHUB_PAT });
    const rulesRepo = createRulesRepoService({ github, channelStore, worktrees, memory });
    const questionFlow = createQuestionFlow({
        activeProcesses,
        writeStdin: claudeStdio.writeStdin,
    });
    const claudeRunner = createClaudeRunner({
        config,
        activeProcesses,
        sessionStore,
        channelStore,
        worktrees,
        memory,
        formatting,
        channelHelpers,
        questionFlow,
    });
    const agentRouter = createAgentRouter({
        config,
        channelStore,
        channelHelpers,
        worktrees,
        memory,
        formatting,
        claudeRunner,
        runCodex,
    });

    const context = {
        config,
        client,
        activeProcesses,
        channelStore,
        sessionStore,
        formatting,
        channelHelpers,
        memory,
        claudeStdio,
        worktrees,
        rulesRepo,
        questionFlow,
        agentRouter,
        clearCodexSession,
    };
    const commandRegistry = createCommandRegistry(context);

    client.on(Events.ClientReady, () => {
        console.log('--------------------------------------------------');
        console.log(`[DEBUG] SHADOW CUBE V4.0 (PROVIDERS: CLAUDE, CODEx) + MEMORY ENABLED`);
        console.log(`[DEBUG] PROJECT_DIR: ${config.PROJECT_DIR}`);
        console.log(`[DEBUG] WORKTREES_ROOT: ${config.WORKTREES_ROOT}`);
        console.log('--------------------------------------------------');
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
        const customId = interaction.customId || '';
        if (customId.startsWith('cxa:')) return handleCodexApproval(interaction);
        await questionFlow.handleInteraction(interaction);
    });

    client.on(Events.MessageCreate, async (message) => {
        await commandRegistry.handleMessage(message);
    });

    function shutdown(signal) {
        console.log(`\n[DEBUG] Received ${signal}. Shutting down...`);

        for (const [threadId, child] of activeProcesses) {
            console.log(`[DEBUG] Killing Claude process for thread ${threadId} (pid: ${child.pid})`);
            child.kill('SIGTERM');
        }
        activeProcesses.clear();

        client.destroy();

        console.log('[DEBUG] Shutdown complete.');
        process.exit(0);
    }

    function start() {
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        return client.login(config.DISCORD_TOKEN);
    }

    return {
        client,
        context,
        start,
        shutdown,
    };
}

module.exports = {
    createBot,
};
