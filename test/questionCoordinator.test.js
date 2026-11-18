const { describe, expect, test } = require('bun:test');
const { createQuestionCoordinator } = require('../src/interactions/questionCoordinator');

describe('cross-surface question coordinator', () => {
    test('resolves a web question through its Discord thread alias exactly once', () => {
        const writes = [];
        const coordinator = createQuestionCoordinator({
            writeStdin: (_child, payload) => { writes.push(payload); return true; },
        });
        coordinator.create({
            conversationId: 'web-conversation',
            child: {},
            requestId: 'request-1',
            toolUseId: 'tool-1',
            input: { questions: [{ question: 'Continue?', options: [{ label: 'Yes' }] }] },
        });
        coordinator.addAlias('web-conversation', 'discord-thread');

        expect(coordinator.resolve('discord-thread', { 'Continue?': 'Yes' })).toEqual({ ok: true });
        expect(coordinator.resolve('web-conversation', { 'Continue?': 'No' })).toEqual({ error: 'no pending question' });
        expect(writes).toHaveLength(1);
        expect(writes[0].response.response.updatedInput.answers).toEqual({ 'Continue?': 'Yes' });
    });

    test('notifies every surface when an answer resolves', () => {
        const events = [];
        const coordinator = createQuestionCoordinator({ writeStdin: () => true });
        coordinator.subscribe((event) => events.push(event.type));
        coordinator.create({ conversationId: 'conversation', child: {}, requestId: 'r', input: { questions: [] } });
        coordinator.resolve('conversation', {});
        expect(events).toEqual(['created', 'resolved']);
    });
});
