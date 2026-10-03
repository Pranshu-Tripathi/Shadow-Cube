const { describe, expect, test } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateDatabase, importLegacyState } = require('../src/db/database');

describe('legacy JSON to SQLite migration', () => {
    test('copies state once without modifying legacy files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cube-migration-'));
        const channelsPath = path.join(dir, 'channels.json');
        const conversationsPath = path.join(dir, 'web-conversations.json');
        const channels = JSON.stringify({ alpha: { name: 'Alpha', projectName: 'Existing Name', projectDir: '/repo' } }, null, 2);
        const conversations = JSON.stringify({ workspaces: { alpha: { order: ['c1'], conversations: { c1: { id: 'c1', name: 'Chat 1', createdAt: 1, messages: [{ msgId: 'm1', role: 'user', content: 'hello' }] } } } } }, null, 2);
        fs.writeFileSync(channelsPath, channels);
        fs.writeFileSync(conversationsPath, conversations);
        const db = createStateDatabase({ dbPath: path.join(dir, 'state.sqlite'), importLegacy: false });
        const legacy = { channelsPath, webConversationsPath: conversationsPath };

        importLegacyState(db, legacy);
        importLegacyState(db, legacy);

        expect(db.query('SELECT project_name FROM workspaces WHERE id = ?').get('alpha').project_name).toBe('Existing Name');
        expect(db.query('SELECT COUNT(*) AS count FROM messages').get().count).toBe(1);
        expect(fs.readFileSync(channelsPath, 'utf8')).toBe(channels);
        expect(fs.readFileSync(conversationsPath, 'utf8')).toBe(conversations);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
