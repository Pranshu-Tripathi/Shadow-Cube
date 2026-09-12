function match(cleanPrompt) {
    const baseMatch = cleanPrompt.match(/^!base\s+(.+)$/i);
    return baseMatch ? { branch: baseMatch[1].trim() } : null;
}

async function execute({ message, match: commandMatch, context }) {
    const branch = commandMatch.branch;
    const channelId = context.channelHelpers.getParentChannelId(message.channel);
    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const config = context.channelStore.loadChannelConfig();
    const oldBase = config[channelId]?.baseBranch;

    context.channelStore.updateChannel(channelId, { baseBranch: branch });

    let rebaseMsg = '';
    if (oldBase && oldBase !== branch && context.worktrees.getProjectConfig(channelId)) {
        rebaseMsg = context.worktrees.rebaseExistingWorktree(channelName, branch, channelId);
    }

    return message.reply(`**Base branch set to \`${branch}\` for this channel.**${rebaseMsg}`);
}

module.exports = {
    match,
    execute,
};
