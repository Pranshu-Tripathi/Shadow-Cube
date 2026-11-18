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
    };

    // `provider` overrides the channel default — the web notebook uses this to make
    // the provider a per-conversation (thread) choice rather than a per-worktree one.
    function runAgent(prompt, targetChannel, { provider } = {}) {
        const channelId = channelHelpers.getParentChannelId(targetChannel);
        if (!worktrees.getProjectConfig(channelId)) {
            return targetChannel
                .send('**No project set for this channel.** Run `!project -name <name> -path <path>` first.')
                .catch(() => {});
        }
        const effectiveProvider = provider || getProvider(channelId);
        if (effectiveProvider === 'codex') {
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
