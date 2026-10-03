const { getDatabase } = require('../db/database');

function createWebConversationStore({ db = getDatabase() } = {}) {

    function serialize(conversation) {
        return {
            id: conversation.id,
            name: conversation.title || conversation.name || null,
            source: 'web',
            hasMessages: !!conversation.has_messages,
        };
    }

    function ensureConversation(workspaceId, convId, name) {
        const existing = db.query(`
            SELECT c.*, EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = c.id) AS has_messages
            FROM conversations c WHERE c.id = ?
        `).get(convId);
        if (existing) return existing;
        const count = db.query('SELECT COUNT(*) AS count FROM conversations WHERE workspace_id = ?').get(workspaceId).count;
        const now = Date.now();
        db.query(`
            INSERT INTO conversations (id, workspace_id, title, source, status, created_at, updated_at)
            VALUES (?, ?, ?, 'web', 'active', ?, ?)
        `).run(convId, workspaceId, name || `Chat ${Number(count) + 1}`, now, now);
        return db.query('SELECT *, 0 AS has_messages FROM conversations WHERE id = ?').get(convId);
    }

    // Creation is idempotent while an unused chat exists. This prevents repeated
    // clicks (or multiple browser windows) from producing stacks of empty chats.
    function createConversation(workspaceId) {
        const empty = db.query(`
            SELECT c.*, 0 AS has_messages FROM conversations c
            WHERE c.workspace_id = ? AND c.source = 'web'
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
            ORDER BY c.created_at LIMIT 1
        `).get(workspaceId);
        if (empty) return { conversation: serialize(empty), reused: true };
        const convId = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const conversation = ensureConversation(workspaceId, convId);
        return { conversation: serialize(conversation), reused: false };
    }

    function listConversations(workspaceId) {
        return db.query(`
            SELECT c.*, EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = c.id) AS has_messages
            FROM conversations c WHERE c.workspace_id = ? ORDER BY c.created_at
        `).all(workspaceId).map(serialize);
    }

    function getHistory(workspaceId, convId) {
        const conversation = db.query('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?').get(convId, workspaceId);
        if (!conversation) return null;
        return db.query(`
            SELECT message_id AS msgId, role, content, kind, title
            FROM messages WHERE conversation_id = ? ORDER BY id
        `).all(convId).map((message) => {
            const clean = { ...message };
            if (clean.role == null) delete clean.role;
            if (clean.kind == null) delete clean.kind;
            if (clean.title == null) delete clean.title;
            return clean;
        });
    }

    function recordFrame(frame) {
        if (!frame.workspaceId || !frame.convId) return;
        if (frame.type !== 'message.create' && frame.type !== 'message.update') return;
        ensureConversation(frame.workspaceId, frame.convId);
        const now = Date.now();
        db.query(`
            INSERT INTO messages (conversation_id, message_id, role, kind, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id, message_id) DO UPDATE SET
                role = COALESCE(excluded.role, messages.role),
                kind = COALESCE(excluded.kind, messages.kind),
                title = COALESCE(excluded.title, messages.title),
                content = excluded.content,
                updated_at = excluded.updated_at
        `).run(frame.convId, frame.msgId, frame.role || null, frame.kind || null, frame.title || null, frame.content || '', now, now);
        db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, frame.convId);
    }

    function clearHistory(workspaceId, convId) {
        const conversation = db.query('SELECT id FROM conversations WHERE id = ? AND workspace_id = ?').get(convId, workspaceId);
        if (conversation) db.query('DELETE FROM messages WHERE conversation_id = ?').run(convId);
    }

    return {
        createConversation,
        ensureConversation,
        listConversations,
        getHistory,
        recordFrame,
        clearHistory,
        flush() {},
    };
}

module.exports = {
    createWebConversationStore,
};
