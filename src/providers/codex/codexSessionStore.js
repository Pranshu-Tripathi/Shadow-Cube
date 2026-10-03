const { getDatabase } = require('../../db/database');

function createCodexSessionStore({ state }) {
    function loadCodexSessions() {
        const threads = {};
        for (const row of getDatabase().query("SELECT conversation_id, session_id, channel_name FROM provider_sessions WHERE provider = 'codex'").all()) {
            threads[row.conversation_id] = { 'codex session id': row.session_id, channel: row.channel_name };
        }
        return { threads };
    }

    function saveCodexSessions(sessionsConfig) {
        const db = getDatabase();
        db.transaction(() => {
            db.query("DELETE FROM provider_sessions WHERE provider = 'codex'").run();
            for (const [threadId, entry] of Object.entries(sessionsConfig.threads || {})) {
                if (entry['codex session id']) setCodexSession(threadId, entry['codex session id'], entry.channel);
            }
        })();
    }

    function getCodexSession(threadId) {
        return getDatabase().query("SELECT session_id FROM provider_sessions WHERE conversation_id = ? AND provider = 'codex'")
            .get(threadId)?.session_id || '';
    }

    function setCodexSession(threadId, sessionId, channelName) {
        getDatabase().query(`
            INSERT INTO provider_sessions (conversation_id, provider, session_id, channel_name, updated_at)
            VALUES (?, 'codex', ?, ?, ?)
            ON CONFLICT(conversation_id, provider) DO UPDATE SET
                session_id = excluded.session_id,
                channel_name = excluded.channel_name,
                updated_at = excluded.updated_at
        `).run(threadId, sessionId, channelName || null, Date.now());
    }

    function clearCodexSession(threadId) {
        getDatabase().query("DELETE FROM provider_sessions WHERE conversation_id = ? AND provider = 'codex'").run(threadId);

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
