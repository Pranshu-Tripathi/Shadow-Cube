// These accept either a raw discord.js channel or a Sink (see src/transport/sink.js).
// A Sink already carries its resolved parent id/name, so prefer those when present.
function getParentChannelName(channel) {
    if (channel && channel.__sinkKind) return channel.parentName;
    if (channel.isThread() && channel.parent) {
        return channel.parent.name;
    }
    return channel.name;
}

function getParentChannelId(channel) {
    if (channel && channel.__sinkKind) return channel.parentId;
    if (channel.isThread() && channel.parentId) {
        return channel.parentId;
    }
    return channel.id;
}

module.exports = {
    getParentChannelName,
    getParentChannelId,
};
