function match(cleanPrompt) {
    return /^!destroy$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (!context.worktrees.getProjectConfig(channelId)) {
        return message.reply('**No project set for this channel.** Run `!project -name <name> -path <path>` first.');
    }

    const { branch } = context.worktrees.getWorktreeInfo(channelName, channelId);
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
    const removed = context.worktrees.removeWorktree(channelName, channelId);
    status.push(removed ? 'Worktree removed.' : 'Failed to remove worktree.');

    if (context.worktrees.fetchRemoteBranch(branch, channelId)) {
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
