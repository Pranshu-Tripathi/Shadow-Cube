function match(cleanPrompt) {
    const clearMatch = cleanPrompt.match(/^!clear\s*(--worktree|-w)?$/i);
    return clearMatch ? { withWorktree: !!clearMatch[1] } : null;
}

async function execute({ message, match: commandMatch, context }) {
    const threadId = message.channel.isThread() ? message.channel.id : null;

    if (threadId) {
        context.sessionStore.clearSession(threadId);
        context.clearCodexSession(threadId);
        if (context.activeProcesses.has(threadId)) {
            context.activeProcesses.get(threadId).kill();
            context.activeProcesses.delete(threadId);
        }
        await context.questionFlow.clearForThread(threadId, 'Session cleared.').catch(() => {});
    }

    let extra = '';
    if (commandMatch.withWorktree) {
        const channelName = context.channelHelpers.getParentChannelName(message.channel);
        const removed = context.worktrees.removeWorktree(channelName);
        extra = removed ? ' Worktree removed.' : ' Failed to remove worktree.';
    }

    return message.reply(`**Session cleared & process killed.${extra}** Next message will start fresh.`);
}

module.exports = {
    match,
    execute,
};
