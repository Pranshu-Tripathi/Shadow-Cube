function match(cleanPrompt) {
    return /^!destroy$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (!context.worktrees.getProjectConfig(channelId)) {
        return message.reply('**No project set for this channel.** Run `!project -name <name> -path <path>` first.');
    }

    const threadId = message.channel.isThread() ? message.channel.id : null;
    const result = context.workspaceLifecycle.destroy({
        workspaceId: channelId,
        workspaceName: channelName,
        conversationId: threadId,
        allowDirty: true,
    });
    const branch = result.preview?.branch;
    const status = [result.removed ? 'Worktree removed.' : 'Worktree was already absent or could not be removed.'];
    status.push(result.fetchedRemote ? `Fetched \`${branch}\` in main repository.` : `Branch \`${branch}\` not found on remote.`);

    return message.reply(`**Destroyed channel worktree.**\n${status.join('\n')}`);
}

module.exports = {
    match,
    execute,
};
