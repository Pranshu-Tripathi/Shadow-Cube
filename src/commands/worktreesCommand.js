function match(cleanPrompt) {
    return /^!worktrees?$/i.test(cleanPrompt) ? {} : null;
}

async function execute({ message, context }) {
    try {
        const worktreeLines = context.worktrees.listActiveWorktrees();
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
