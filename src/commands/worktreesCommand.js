function match(cleanPrompt) {
    return /^!worktrees?$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (!context.worktrees.getProjectConfig(channelId)) {
        return message.reply('**No project set for this channel.** Run `!project -name <name> -path <path>` first.');
    }

    try {
        const worktreeLines = context.worktrees.listActiveWorktrees(channelId);
        if (worktreeLines.length === 0) {
            return message.reply('**No active worktrees.**');
        }
        const formatted = worktreeLines.map(l => `\`${l}\``).join('\n');
        return message.reply(`**Active worktrees:**\n${formatted}`);
    } catch (e) {
        return message.reply(`**Failed to list worktrees:** ${e.message}`);
    }
}

module.exports = {
    match,
    execute,
};
