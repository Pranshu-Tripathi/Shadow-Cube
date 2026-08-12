const { APPROVAL_POLICY, SANDBOX_MODE } = require('./constants');

function createCodexRunner({ state, appServer, renderer, sessionStore }) {
    async function runCodex(prompt, targetChannel, deps) {
        const discordThreadId = targetChannel.id;
        const channelName = deps.getParentChannelName(targetChannel);
        const channelId = deps.getParentChannelId(targetChannel);
        const baseBranch = deps.getBaseBranch(channelId);
        const activeCwd = deps.ensureWorktree(channelName, baseBranch, channelId);

        let systemPrompt = `The base branch for this worktree is \`${baseBranch}\`. Use \`${baseBranch}\` as the target for PRs, diffs, and comparisons — not \`main\` or \`master\` unless they match.`;
        const channelRule = deps.loadChannelConfig()[channelId]?.systemPrompt;
        if (channelRule) systemPrompt += `\n\n${channelRule}`;
        const memory = deps.readWorktreeMemory(activeCwd);
        if (memory) {
            systemPrompt += `\n\n# Learned memory — past corrections, do not repeat these mistakes\n${memory}`;
        }

        try {
            await appServer.ensureManager();
        } catch (e) {
            await targetChannel
                .send(`❌ Failed to launch \`codex app-server\`: ${e.message}. Is the Codex CLI installed and in PATH?`)
                .catch(() => {});
            return;
        }

        let codexThreadId = sessionStore.getCodexSession(discordThreadId);
        try {
            if (codexThreadId && state.openThreads.has(codexThreadId)) {
                // Already live in this process; just start another turn below.
            } else if (codexThreadId) {
                const result = await appServer.rpc('thread/resume', {
                    threadId: codexThreadId,
                    approvalPolicy: APPROVAL_POLICY,
                    sandbox: SANDBOX_MODE,
                });
                codexThreadId = result?.thread?.id || codexThreadId;
                state.openThreads.add(codexThreadId);
            } else {
                const result = await appServer.rpc('thread/start', {
                    cwd: activeCwd,
                    approvalPolicy: APPROVAL_POLICY,
                    sandbox: SANDBOX_MODE,
                    developerInstructions: systemPrompt,
                });
                codexThreadId = result.thread.id;
                state.openThreads.add(codexThreadId);
                sessionStore.setCodexSession(discordThreadId, codexThreadId, channelName);
            }
        } catch (e) {
            await targetChannel.send(`❌ Codex couldn't start a session: ${e.message}`).catch(() => {});
            return;
        }

        state.channelByThread.set(codexThreadId, targetChannel);
        renderer.startThread(codexThreadId, targetChannel);

        console.log(`[DEBUG] [Thread: ${discordThreadId}] CODEX turn/start (codexThread: ${codexThreadId})`);
        try {
            await appServer.rpc('turn/start', { threadId: codexThreadId, input: [{ type: 'text', text: prompt }] });
        } catch (e) {
            await targetChannel.send(`❌ Codex error: ${e.message}`).catch(() => {});
        }
    }

    return {
        runCodex,
    };
}

module.exports = {
    createCodexRunner,
};
