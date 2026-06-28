function createAgentRouter({
    config,
    channelStore,
    channelHelpers,
    worktrees,
    memory,
    formatting,
    claudeRunner,
    runCodex,
}) {
    function getProvider(channelId) {
        const channelConfig = channelStore.loadChannelConfig();
        return channelConfig[channelId]?.provider || 'claude';
    }

    const codexDeps = {
        splitForDiscord: formatting.splitForDiscord,
        prettifyCodeBlocks: formatting.prettifyCodeBlocks,
        detectLanguage: formatting.detectLanguage,
        ensureWorktree: worktrees.ensureWorktree,
        getParentChannelName: channelHelpers.getParentChannelName,
        getParentChannelId: channelHelpers.getParentChannelId,
        getBaseBranch: worktrees.getBaseBranch,
        loadChannelConfig: channelStore.loadChannelConfig,
        readWorktreeMemory: memory.readWorktreeMemory,
        PROJECT_DIR: config.PROJECT_DIR,
    };

    function runAgent(prompt, targetChannel) {
        const channelId = channelHelpers.getParentChannelId(targetChannel);
        if (getProvider(channelId) === 'codex') {
            return runCodex(prompt, targetChannel, codexDeps);
        }
        return claudeRunner.runClaude(prompt, targetChannel);
    }

    return {
        getProvider,
        runAgent,
    };
}

module.exports = {
    createAgentRouter,
};
