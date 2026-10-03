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
const { createTranscriber } = require('./voice/transcriber');
const { createVocabulary } = require('./voice/vocabulary');
const { createCleanup } = require('./voice/cleanup');
const { createQuestionCoordinator } = require('./interactions/questionCoordinator');

function createBot() {
    // Discord is optional: the local web interface (port 8200) is the home base and
    // runs with or without a token. Without one, we simply never log the client in.
    const discordEnabled = !!config.DISCORD_TOKEN;
    if (!discordEnabled) {
        console.warn('[DEBUG] No DISCORD_TOKEN set — running web-only (Discord disabled).');
    }

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
        partials: [Partials.Channel]
    });

    const activeProcesses = new Map();
    const questionCoordinator = createQuestionCoordinator({ writeStdin: claudeStdio.writeStdin });
    const worktrees = createWorktreeService({ config, channelStore });
    const github = createGithubClient({ token: config.GITHUB_PAT });
    const rulesRepo = createRulesRepoService({ github, channelStore, worktrees, memory });
    const questionFlow = createQuestionFlow({
        activeProcesses,
        writeStdin: claudeStdio.writeStdin,
        coordinator: questionCoordinator,
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
        questionCoordinator,
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

    // Voice primitives are shared between Discord voice notes and the web voice mode
    // so the whisper model is warmed and used once, not per-transport.
    const transcriber = createTranscriber({ config });
    const vocabulary = createVocabulary({ config });
    const cleanup = createCleanup({ config });

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
        transcriber,
        vocabulary,
        cleanup,
    };
    const commandRegistry = createCommandRegistry(context);

    client.on(Events.ClientReady, () => {
        console.log('--------------------------------------------------');
        console.log(`[DEBUG] SHADOW CUBE V4.0 (PROVIDERS: CLAUDE, CODEx) + MEMORY ENABLED`);
        console.log(`[DEBUG] PROJECT_DIR: ${config.PROJECT_DIR}`);
        console.log(`[DEBUG] WORKTREES_ROOT: ${config.WORKTREES_ROOT}`);
        commandRegistry.voice.start();
        console.log('--------------------------------------------------');
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        const customId = interaction.customId || '';
        if (customId.startsWith('cxa:')) return handleCodexApproval(interaction);
        if (customId.startsWith('vt:')) return commandRegistry.voice.handleInteraction(interaction);
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
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
        if (!discordEnabled) return Promise.resolve();
        return client.login(config.DISCORD_TOKEN);
    }

    return {
        client,
        context,
        discordEnabled,
        start,
        shutdown,
    };
}

module.exports = {
    createBot,
};
