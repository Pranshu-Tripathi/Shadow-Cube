function match(cleanPrompt) {
    return /^!push$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);

    try {
        const result = context.worktrees.pushWorktree(channelName);
        if (result.missing) {
            return message.reply(`**No worktree found for this channel.** Send a message first to create one.`);
        }
        return message.reply(`**Pushed \`${result.branch}\` to remote.**`);
    } catch (e) {
        return message.reply(`**Push failed:** ${e.message}`);
    }
}

module.exports = {
    match,
    execute,
};
