const { getDatabase, upsertWorkspace } = require('../db/database');

function emptyChannels() {
    return {};
}

function loadChannelConfig() {
    const rows = getDatabase().query('SELECT id, project_id, config_json FROM workspaces ORDER BY created_at, id').all();
    const channels = {};
    for (const row of rows) {
        try { channels[row.id] = JSON.parse(row.config_json); } catch { channels[row.id] = {}; }
        channels[row.id].projectId = row.project_id || 'global';
    }
    return channels;
}

function saveChannelConfig(config) {
    const db = getDatabase();
    db.transaction(() => {
        const ids = new Set(Object.keys(config));
        for (const row of db.query('SELECT id FROM workspaces').all()) {
            if (!ids.has(row.id)) db.query('DELETE FROM workspaces WHERE id = ?').run(row.id);
        }
        for (const [id, cfg] of Object.entries(config)) upsertWorkspace(db, id, cfg || {});
    })();
}

function updateChannel(channelId, patch) {
    const config = loadChannelConfig();
    config[channelId] = { ...(config[channelId] || {}), ...patch };
    upsertWorkspace(getDatabase(), channelId, config[channelId]);
    return config[channelId];
}

function removeChannelField(channelId, field) {
    const config = loadChannelConfig();
    if (config[channelId]) {
        delete config[channelId][field];
        upsertWorkspace(getDatabase(), channelId, config[channelId]);
    }
}

module.exports = {
    loadChannelConfig,
    saveChannelConfig,
    updateChannel,
    removeChannelField,
};
