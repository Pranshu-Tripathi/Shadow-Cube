const { WEB_CONVERSATIONS_PATH } = require('../config');
const { loadJson, saveJson } = require('./jsonStore');

function emptyData() {
    return { workspaces: {} };
}

function createWebConversationStore({ filePath = WEB_CONVERSATIONS_PATH } = {}) {
    const data = loadJson(filePath, emptyData);
    if (!data.workspaces || typeof data.workspaces !== 'object') data.workspaces = {};
    let saveTimer = null;

    function saveNow() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        saveJson(filePath, data);
    }

    function saveSoon() {
        if (saveTimer) return;
        saveTimer = setTimeout(saveNow, 75);
    }

    function workspace(workspaceId) {
        if (!data.workspaces[workspaceId]) {
            data.workspaces[workspaceId] = { order: [], conversations: {} };
        }
        const ws = data.workspaces[workspaceId];
        if (!Array.isArray(ws.order)) ws.order = [];
        if (!ws.conversations || typeof ws.conversations !== 'object') ws.conversations = {};
        return ws;
    }

    function serialize(conversation) {
        return {
            id: conversation.id,
            name: conversation.name || null,
            source: 'web',
            hasMessages: conversation.messages.length > 0,
        };
    }

    function ensureConversation(workspaceId, convId, name) {
        const ws = workspace(workspaceId);
        if (!ws.conversations[convId]) {
            ws.conversations[convId] = {
                id: convId,
                name: name || `Chat ${ws.order.length + 1}`,
                createdAt: Date.now(),
                messages: [],
            };
            ws.order.push(convId);
        }
        return ws.conversations[convId];
    }

    // Creation is idempotent while an unused chat exists. This prevents repeated
    // clicks (or multiple browser windows) from producing stacks of empty chats.
    function createConversation(workspaceId) {
        const ws = workspace(workspaceId);
        const empty = ws.order.map((id) => ws.conversations[id]).find((conv) => conv && conv.messages.length === 0);
        if (empty) return { conversation: serialize(empty), reused: true };
        const convId = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const conversation = ensureConversation(workspaceId, convId);
        saveNow();
        return { conversation: serialize(conversation), reused: false };
    }

    function listConversations(workspaceId) {
        const ws = workspace(workspaceId);
        return ws.order.map((id) => ws.conversations[id]).filter(Boolean).map(serialize);
    }

    function getHistory(workspaceId, convId) {
        const conversation = workspace(workspaceId).conversations[convId];
        return conversation ? conversation.messages.map((message) => ({ ...message })) : null;
    }

    function recordFrame(frame) {
        if (!frame.workspaceId || !frame.convId) return;
        if (frame.type !== 'message.create' && frame.type !== 'message.update') return;
        const conversation = ensureConversation(frame.workspaceId, frame.convId);
        const existing = conversation.messages.find((message) => message.msgId === frame.msgId);
        if (existing) {
            existing.content = frame.content;
            if (frame.kind) existing.kind = frame.kind;
            if (frame.title) existing.title = frame.title;
            saveSoon();
            return;
        }
        conversation.messages.push({
            msgId: frame.msgId,
            role: frame.role,
            content: frame.content || '',
            kind: frame.kind,
            title: frame.title,
        });
        saveNow();
    }

    function clearHistory(workspaceId, convId) {
        const conversation = workspace(workspaceId).conversations[convId];
        if (!conversation) return;
        conversation.messages = [];
        saveNow();
    }

    return {
        createConversation,
        ensureConversation,
        listConversations,
        getHistory,
        recordFrame,
        clearHistory,
        flush: saveNow,
    };
}

module.exports = {
    createWebConversationStore,
};
