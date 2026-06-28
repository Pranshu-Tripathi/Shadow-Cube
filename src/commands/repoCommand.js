const { normalizeRepoSlug } = require('../github/githubClient');

function match(cleanPrompt) {
    const configMatch = cleanPrompt.match(/^!repo\s+(?:--config|-config)\s+(\S+)$/i);
    if (configMatch) return { kind: 'config', repoInput: configMatch[1] };

    if (/^!repo\s+(?:--view|-view)$/i.test(cleanPrompt)) return { kind: 'view' };

    if (/^!repo\b/i.test(cleanPrompt)) {
        return {
            kind: 'pull',
            wantPrompt: /(?:^|\s)(?:--prompt|-prompt)(?:\s|$)/i.test(cleanPrompt),
            wantSkill: /(?:^|\s)(?:--skill|-skill)(?:\s|$)/i.test(cleanPrompt),
            pathMatch: cleanPrompt.match(/(?:--path|-path)\s+(\S+)/i),
        };
    }

    return null;
}

async function execute({ message, match: commandMatch, context }) {
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (commandMatch.kind === 'config') {
        const repo = normalizeRepoSlug(commandMatch.repoInput);
        if (!repo) {
            return message.reply('**Invalid repo.** Use `owner/repo` or a GitHub URL.');
        }
        context.channelStore.updateChannel(channelId, { rulesRepo: repo });
        const warn = context.config.GITHUB_PAT ? '' : '\n⚠️ `GITHUB_PAT` is not set — private repos will fail.';
        return message.reply(`**Rules repo set to \`${repo}\` for this channel.**${warn}`);
    }

    if (commandMatch.kind === 'view') {
        const repo = context.channelStore.loadChannelConfig()[channelId]?.rulesRepo;
        return message.reply(repo
            ? `**Rules repo for this channel:** \`${repo}\``
            : '**No rules repo set.** Use `!repo -config owner/repo`.');
    }

    if (!commandMatch.wantPrompt && !commandMatch.wantSkill) {
        return message.reply([
            '**Usage:**',
            '`!repo -config owner/repo` — set the repo for this channel',
            '`!repo -prompt -skill -path <dir>` — pull from the repo (`-path` is repo-root-relative)',
            '`-prompt` sets the system prompt from `<dir>/system.md`.',
            '`-skill` pulls `<dir>/skills/**` into the worktree (`.skills/`, mirrored to `.claude/skills/`).',
            '`!repo -view` — show the configured repo.',
        ].join('\n'));
    }

    const repo = context.channelStore.loadChannelConfig()[channelId]?.rulesRepo;
    if (!repo) {
        return message.reply('**No rules repo set.** Use `!repo -config owner/repo` first.');
    }

    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const relPath = (commandMatch.pathMatch ? commandMatch.pathMatch[1] : '').replace(/^\/+|\/+$/g, '');

    try {
        const result = await context.rulesRepo.pull({
            channelId,
            channelName,
            repo,
            relPath,
            wantPrompt: commandMatch.wantPrompt,
            wantSkill: commandMatch.wantSkill,
        });

        return message.reply(`**Repo pull from \`${repo}\` (ref \`${result.ref}\`):**\n${result.results.join('\n')}`);
    } catch (e) {
        return message.reply(`**Failed to pull from \`${repo}\`:** ${e.message}`);
    }
}

module.exports = {
    match,
    execute,
};
