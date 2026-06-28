function match(cleanPrompt) {
    const deployMatch = cleanPrompt.match(/^!deploy\s*(.*)$/i);
    return deployMatch ? { message: deployMatch[1].trim() } : null;
}

async function execute({ message, match: commandMatch, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);

    try {
        const result = context.worktrees.deployWorktree(channelName, commandMatch.message);
        if (result.missing) {
            return message.reply(`**No worktree found for this channel.** Send a message first to create one.`);
        }
        if (result.empty) {
            return message.reply(`**Nothing to deploy.** No uncommitted changes on \`${result.branch}\`.`);
        }
        return message.reply(`**Deployed to \`${result.branch}\`** (\`${result.hash}\`)\n${result.changedFiles} file(s) changed\nMessage: *${result.commitMsg}*`);
    } catch (e) {
        return message.reply(`**Deploy failed:** ${e.message}`);
    }
}

module.exports = {
    match,
    execute,
};
