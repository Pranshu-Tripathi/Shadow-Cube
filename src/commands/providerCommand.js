function match(cleanPrompt) {
    const providerMatch = cleanPrompt.match(/^!provider\s+(claude|codex)$/i);
    if (providerMatch) return { kind: 'set', provider: providerMatch[1].toLowerCase() };
    if (/^!provider$/i.test(cleanPrompt)) return { kind: 'view' };
    return null;
}

async function execute({ message, match: commandMatch, context }) {
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (commandMatch.kind === 'set') {
        context.channelStore.updateChannel(channelId, { provider: commandMatch.provider });
        return message.reply(`**Provider set to \`${commandMatch.provider}\`** for this channel. It applies from the next message.`);
    }

    const current = context.agentRouter.getProvider(channelId);
    return message.reply([
        `**Current provider:** \`${current}\``,
        '',
        '**Usage:**',
        '`!provider claude` — use Claude Code (default, full streaming + approvals)',
        '`!provider codex` — use Codex (`codex` CLI must be installed & authed)',
    ].join('\n'));
}

module.exports = {
    match,
    execute,
};
