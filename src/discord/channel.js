function getParentChannelName(channel) {
    if (channel.isThread() && channel.parent) {
        return channel.parent.name;
    }
    return channel.name;
}

function getParentChannelId(channel) {
    if (channel.isThread() && channel.parentId) {
        return channel.parentId;
    }
    return channel.id;
}

module.exports = {
    getParentChannelName,
    getParentChannelId,
};
