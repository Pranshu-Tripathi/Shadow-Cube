// A Sink is the minimal surface the agent runners need from a "place to talk":
// an id, a parent (channel/workspace) id + name, and a send() that returns a
// message handle with .edit(). Discord channels already satisfy this; the web
// notebook provides its own implementation. Keeping the runners sink-shaped is
// what lets the same engine drive both Discord and the local web interface.
//
// DiscordSink is a thin, transparent wrapper: send() delegates straight to the
// discord.js channel (so component payloads, edits, threads all keep working)
// and the parent fields mirror the old channelHelpers logic.

function createDiscordSink(channel) {
    if (!channel) throw new Error('createDiscordSink requires a discord channel');
    // Already wrapped — don't double-wrap (callers may be defensive).
    if (channel.__sinkKind) return channel;

    const isThread = typeof channel.isThread === 'function' && channel.isThread();

    return {
        __sinkKind: 'discord',
        id: channel.id,
        parentId: isThread && channel.parentId ? channel.parentId : channel.id,
        parentName: isThread && channel.parent ? channel.parent.name : channel.name,
        isThread: () => (typeof channel.isThread === 'function' ? channel.isThread() : false),
        send: (payload) => channel.send(payload),
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
