const { describe, expect, test } = require('bun:test');
const { createStateDatabase } = require('../src/db/database');
const { createTitleService, cleanTitle, fallbackTitle } = require('../src/conversations/titleService');

const config = { TITLE_MODEL: 'local', TITLE_TIMEOUT_MS: 100, VOICE_CLEANUP_KEEP_ALIVE: '1m' };

describe('local conversation titles', () => {
    test('cleans model output and has a deterministic fallback', () => {
        expect(cleanTitle('Title: "Fix Discord Questions"\n')).toBe('Fix Discord Questions');
        expect(fallbackTitle('Please fix the Discord question bridge and add tests now')).toBe('Please fix the Discord question bridge and');
    });

    test('persists and publishes a generated title once', async () => {
        const db = createStateDatabase({ dbPath: ':memory:', importLegacy: false });
        let calls = 0;
        const service = createTitleService({
            db,
            config,
            ollamaClient: { generate: async () => { calls += 1; return 'Fix Discord Questions'; } },
        });
        const updates = [];
        await service.ensure({ workspaceId: 'workspace', conversationId: 'conversation', prompt: 'fix it', onUpdate: (title) => updates.push(title) });
        await service.ensure({ workspaceId: 'workspace', conversationId: 'conversation', prompt: 'different' });
        expect(service.current('conversation')).toBe('Fix Discord Questions');
        expect(updates).toEqual(['Fix Discord Questions']);
        expect(calls).toBe(1);
    });

    test('falls back when Ollama is unavailable', async () => {
        const db = createStateDatabase({ dbPath: ':memory:', importLegacy: false });
        const service = createTitleService({ db, config, ollamaClient: { generate: async () => { throw new Error('offline'); } } });
        expect(await service.ensure({ workspaceId: 'w', conversationId: 'c', prompt: 'Build the settings screen' })).toBe('Build the settings screen');
    });
});
