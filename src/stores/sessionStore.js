const { SESSIONS_CONFIG_PATH } = require('../config');
const { loadJson, saveJson } = require('./jsonStore');
const fs = require('fs');

function emptySessions() {
    return { threads: {} };
}

function loadSessionsConfig() {
    return loadJson(SESSIONS_CONFIG_PATH, emptySessions);
}

function saveSessionsConfig(config) {
    saveJson(SESSIONS_CONFIG_PATH, config);
}

function getSessionId(threadId) {
    const config = loadSessionsConfig();
    const entry = config.threads[threadId];
    return entry ? entry['claude session id'] : '';
}

function setSessionId(threadId, sessionId, channelName) {
    const config = loadSessionsConfig();
    config.threads[threadId] = {
        'claude session id': sessionId,
        'channel': channelName
    };
    saveSessionsConfig(config);
}

function clearSession(threadId) {
    const config = loadSessionsConfig();
    delete config.threads[threadId];
    saveSessionsConfig(config);
}

function getLatestSessionId(sessionIndexPath) {
    try {
        if (!fs.existsSync(sessionIndexPath)) return null;
        const data = JSON.parse(fs.readFileSync(sessionIndexPath, 'utf8'));
        if (!data.entries || data.entries.length === 0) return null;
        const sorted = data.entries.sort((a, b) => b.fileMtime - a.fileMtime);
        return sorted[0].sessionId;
    } catch (e) {
        console.error("[DEBUG] Failed to read session index:", e.message);
        return null;
    }
}

module.exports = {
    loadSessionsConfig,
    saveSessionsConfig,
    getSessionId,
    setSessionId,
    clearSession,
    getLatestSessionId,
};
