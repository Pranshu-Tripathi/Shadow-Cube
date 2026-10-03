const { describe, expect, test } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWebConversationStore } = require('../src/stores/webConversationStore');
const { createWebHub } = require('../src/web/webHub');

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cube-web-store-'));
    const filePath = path.join(dir, 'conversations.json');
    return { dir, filePath, store: createWebConversationStore({ filePath }) };
}

describe('web conversation persistence', () => {
    test('reuses the one empty chat instead of creating duplicates', () => {
        const { dir, store } = tempStore();
        try {
            const first = store.createConversation('workspace');
            const second = store.createConversation('workspace');
            expect(second.reused).toBe(true);
            expect(second.conversation.id).toBe(first.conversation.id);
            expect(store.listConversations('workspace')).toHaveLength(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('persists chat history and streaming updates across relaunches', () => {
        const { dir, filePath, store } = tempStore();
        try {
            const { conversation } = store.createConversation('workspace');
            const hub = createWebHub({ conversationStore: store });
            hub.broadcast({
                type: 'message.create', workspaceId: 'workspace', convId: conversation.id,
                msgId: 'message-1', role: 'agent', content: 'working', kind: 'text',
            });
            hub.broadcast({
                type: 'message.update', workspaceId: 'workspace', convId: conversation.id,
                msgId: 'message-1', content: 'finished',
            });
            store.flush();

            const relaunched = createWebConversationStore({ filePath });
            expect(relaunched.listConversations('workspace')[0].hasMessages).toBe(true);
            expect(relaunched.getHistory('workspace', conversation.id)).toEqual([{
                msgId: 'message-1', role: 'agent', content: 'finished', kind: 'text',
            }]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('allows a new chat after the current chat has a message', () => {
        const { dir, store } = tempStore();
        try {
            const first = store.createConversation('workspace').conversation;
            store.recordFrame({
                type: 'message.create', workspaceId: 'workspace', convId: first.id,
                msgId: 'message-1', role: 'user', content: 'hello',
            });
            const second = store.createConversation('workspace');
            expect(second.reused).toBe(false);
            expect(second.conversation.id).not.toBe(first.id);
            expect(store.listConversations('workspace')).toHaveLength(2);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
