function match(cleanPrompt) {
    if (/^!rule\s+(--wipe|-w)$/i.test(cleanPrompt)) return { kind: 'wipe' };
    if (/^!rule\s+(--view|-v)$/i.test(cleanPrompt)) return { kind: 'view' };

    const urlMatch = cleanPrompt.match(/^!rule\s+(?:--url|-url)\s+(.+)$/i);
    if (urlMatch) return { kind: 'url', url: urlMatch[1].trim() };

    if (/^!rule$/i.test(cleanPrompt)) return { kind: 'attachment' };
    return null;
}

async function execute({ message, match: commandMatch, context }) {
    const channelId = context.channelHelpers.getParentChannelId(message.channel);

    if (commandMatch.kind === 'wipe') {
        context.channelStore.removeChannelField(channelId, 'systemPrompt');
        return message.reply('**System prompt rule cleared for this channel.**');
    }

    if (commandMatch.kind === 'view') {
        const config = context.channelStore.loadChannelConfig();
        const rule = config[channelId]?.systemPrompt;
        if (rule) {
            const chunks = context.formatting.splitForDiscord(`**Current rule for this channel:**\n\`\`\`md\n${rule}\n\`\`\``);
            for (const chunk of chunks) {
                await message.reply(chunk);
            }
        } else {
            await message.reply('**No rule set for this channel.** Attach a `.md` file with `!rule` to set one.');
        }
        return;
    }

    if (commandMatch.kind === 'url') {
        let url = commandMatch.url;
        const ghBlobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
        if (ghBlobMatch) {
            url = `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}`;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                return message.reply(`**Failed to fetch URL:** ${response.status} ${response.statusText}`);
            }
            const ruleContent = await response.text();

            context.channelStore.updateChannel(channelId, { systemPrompt: ruleContent });

            const preview = ruleContent.length > 500 ? ruleContent.slice(0, 500) + '\n...' : ruleContent;
            return message.reply(`**System prompt rule set from URL.**\n\`\`\`md\n${preview}\n\`\`\``);
        } catch (e) {
            return message.reply(`**Failed to fetch URL:** ${e.message}`);
        }
    }

    if (!message.attachments.size) {
        return message.reply('**Attach a `.md` file with `!rule` to set a system prompt rule.**\nUse `!rule -url <link>` to fetch from a URL, `!rule -v` to view, or `!rule -w` to clear.');
    }

    const attachment = message.attachments.first();

    if (!attachment.name.endsWith('.md')) {
        return message.reply('**Please attach a `.md` file.** Only Markdown files are supported for rules.');
    }

    try {
        const response = await fetch(attachment.url);
        const ruleContent = await response.text();

        context.channelStore.updateChannel(channelId, { systemPrompt: ruleContent });

        const preview = ruleContent.length > 500 ? ruleContent.slice(0, 500) + '\n...' : ruleContent;
        return message.reply(`**System prompt rule set for this channel.**\n\`\`\`md\n${preview}\n\`\`\``);
    } catch (e) {
        return message.reply(`**Failed to download attachment:** ${e.message}`);
    }
}

module.exports = {
    match,
    execute,
};
