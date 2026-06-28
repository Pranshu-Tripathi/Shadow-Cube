function match(cleanPrompt) {
    return /^!destroy$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const { branch } = context.worktrees.getWorktreeInfo(channelName);
    const threadId = message.channel.isThread() ? message.channel.id : null;

    if (threadId) {
        context.sessionStore.clearSession(threadId);
        context.clearCodexSession(threadId);
        if (context.activeProcesses.has(threadId)) {
            context.activeProcesses.get(threadId).kill();
            context.activeProcesses.delete(threadId);
        }
    }

    const status = [];
    const removed = context.worktrees.removeWorktree(channelName);
    status.push(removed ? 'Worktree removed.' : 'Failed to remove worktree.');

    if (context.worktrees.fetchRemoteBranch(branch)) {
        status.push(`Fetched \`${branch}\` in main repository.`);
    } else {
        status.push(`Branch \`${branch}\` not found on remote.`);
    }

    return message.reply(`**Destroyed channel worktree.**\n${status.join('\n')}`);
}

module.exports = {
    match,
    execute,
};
