function match(cleanPrompt) {
    const clearMatch = cleanPrompt.match(/^!clear\s*(--worktree|-w)?$/i);
    return clearMatch ? { withWorktree: !!clearMatch[1] } : null;
}

async function execute({ message, match: commandMatch, context }) {
    const threadId = message.channel.isThread() ? message.channel.id : null;
    const workspaceName = context.channelHelpers.getParentChannelName(message.channel);
    const workspaceId = context.channelHelpers.getParentChannelId(message.channel);
    let extra = '';
    if (commandMatch.withWorktree) {
        const result = context.workspaceLifecycle.removeWorktree({
            workspaceId,
            workspaceName,
            conversationId: threadId,
            allowDirty: true,
        });
        extra = result.removed ? ' Worktree removed.' : result.reason === 'no-project'
            ? ' No project set, so no worktree to remove.'
            : ' Worktree was already absent or could not be removed.';
    } else {
        context.workspaceLifecycle.resetSession(threadId);
    }

    return message.reply(`**Session cleared & process killed.${extra}** Next message will start fresh.`);
}

module.exports = {
    match,
    execute,
};
