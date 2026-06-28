const { CHANNEL_CONFIG_PATH } = require('../config');
const { loadJson, saveJson } = require('./jsonStore');

function emptyChannels() {
    return {};
}

function loadChannelConfig() {
    return loadJson(CHANNEL_CONFIG_PATH, emptyChannels);
}

function saveChannelConfig(config) {
    saveJson(CHANNEL_CONFIG_PATH, config);
}

function updateChannel(channelId, patch) {
    const config = loadChannelConfig();
    config[channelId] = { ...(config[channelId] || {}), ...patch };
    saveChannelConfig(config);
    return config[channelId];
}

function removeChannelField(channelId, field) {
    const config = loadChannelConfig();
    if (config[channelId]) {
        delete config[channelId][field];
        saveChannelConfig(config);
    }
}

module.exports = {
    loadChannelConfig,
    saveChannelConfig,
    updateChannel,
    removeChannelField,
};
