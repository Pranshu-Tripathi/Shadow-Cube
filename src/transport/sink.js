// A Sink is the minimal surface the agent runners need from a "place to talk":
// an id, a parent (channel/workspace) id + name, and a send() that returns a
// message handle with .edit(). Discord channels already satisfy this; the web
// notebook provides its own implementation. Keeping the runners sink-shaped is
// what lets the same engine drive both Discord and the local web interface.
//
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function approvalRows(token, options) {
    const styles = {
        primary: ButtonStyle.Success,
        danger: ButtonStyle.Danger,
        default: ButtonStyle.Secondary,
    };
    const buttons = options.slice(0, 5).map((option) => new ButtonBuilder()
        .setCustomId(`cxa:${token}:${option.decision}`)
        .setLabel(String(option.label || option.decision).slice(0, 80))
        .setStyle(styles[option.tone] || ButtonStyle.Secondary));
    return [new ActionRowBuilder().addComponents(buttons)];
}

// DiscordSink is a thin, transparent wrapper: send() delegates straight to the
// discord.js channel (so component payloads, edits, threads all keep working)
// and the parent fields mirror the old channelHelpers logic.

function createDiscordSink(channel) {
    if (!channel) throw new Error('createDiscordSink requires a discord channel');
    // Already wrapped — don't double-wrap (callers may be defensive).
    if (channel.__sinkKind) return channel;

    const isThread = typeof channel.isThread === 'function' && channel.isThread();

    async function requestApproval(token, content, options) {
        const rawContent = String(content || 'Approval required.');
        const discordContent = rawContent.length <= 2000 ? rawContent : `${rawContent.slice(0, 1999)}…`;
        const message = await channel.send({ content: discordContent, components: approvalRows(token, options) });
        let settled = false;
        return {
            resolve(decision, { skipMessageId } = {}) {
                if (settled) return Promise.resolve();
                settled = true;
                if (skipMessageId && message.id === skipMessageId) return Promise.resolve();
                const selected = options.find((option) => option.decision === decision);
                const label = selected?.label || decision;
                const suffix = `\n\n✅ **${label}**`;
                const settledContent = `${message.content || discordContent}`.slice(0, 2000 - suffix.length) + suffix;
                return message.edit({
                    content: settledContent,
                    components: [],
                });
            },
        };
    }

    return {
        __sinkKind: 'discord',
        id: channel.id,
        parentId: isThread && channel.parentId ? channel.parentId : channel.id,
        parentName: isThread && channel.parent ? channel.parent.name : channel.name,
        isThread: () => (typeof channel.isThread === 'function' ? channel.isThread() : false),
        send: (payload) => channel.send(payload),
        requestApproval,
        // Escape hatch for the rare Discord-only path (e.g. voice cards).
        raw: channel,
    };
}

function isSink(obj) {
    return !!(obj && obj.__sinkKind);
}

module.exports = {
    createDiscordSink,
    isSink,
};
