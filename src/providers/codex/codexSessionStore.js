const fs = require('fs');
const path = require('path');
const config = require('../../config');

const CODEX_SESSIONS_PATH = path.join(config.SESSIONS_DIR, 'codex-config.json');

function createCodexSessionStore({ state }) {
    function loadCodexSessions() {
        try {
            if (!fs.existsSync(CODEX_SESSIONS_PATH)) return { threads: {} };
            return JSON.parse(fs.readFileSync(CODEX_SESSIONS_PATH, 'utf8'));
        } catch {
            return { threads: {} };
        }
    }

    function saveCodexSessions(sessionsConfig) {
        if (!fs.existsSync(config.SESSIONS_DIR)) fs.mkdirSync(config.SESSIONS_DIR, { recursive: true });
        fs.writeFileSync(CODEX_SESSIONS_PATH, JSON.stringify(sessionsConfig, null, 2));
    }

    function getCodexSession(threadId) {
        const sessionsConfig = loadCodexSessions();
        const entry = sessionsConfig.threads[threadId];
        return entry ? entry['codex session id'] : '';
    }

    function setCodexSession(threadId, sessionId, channelName) {
        const sessionsConfig = loadCodexSessions();
        sessionsConfig.threads[threadId] = {
            'codex session id': sessionId,
            'channel': channelName,
        };
        saveCodexSessions(sessionsConfig);
    }

    function clearCodexSession(threadId) {
        const sessionsConfig = loadCodexSessions();
        delete sessionsConfig.threads[threadId];
        saveCodexSessions(sessionsConfig);

        const codexThreadId = [...state.channelByThread.entries()].find(([, ch]) => ch?.id === threadId)?.[0];
        if (codexThreadId) {
            state.openThreads.delete(codexThreadId);
            state.channelByThread.delete(codexThreadId);
            state.renderStates.delete(codexThreadId);
        }
    }

    return {
        loadCodexSessions,
        saveCodexSessions,
        getCodexSession,
        setCodexSession,
        clearCodexSession,
    };
}

module.exports = {
    createCodexSessionStore,
};
