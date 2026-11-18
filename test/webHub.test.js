const { describe, expect, test } = require('bun:test');
const { createWebHub } = require('../src/web/webHub');

describe('web hub pending interaction snapshot', () => {
    test('tracks pending questions and approvals for fresh browser sessions', () => {
        const hub = createWebHub();

        hub.broadcast({ type: 'question', workspaceId: 'workspace-1', convId: 'conversation-1' });
        hub.broadcast({ type: 'approval', workspaceId: 'workspace-1', convId: 'conversation-1' });
        expect(hub.listPendingInteractions()).toEqual([{
            convId: 'conversation-1',
            workspaceId: 'workspace-1',
            kinds: ['question', 'approval'],
        }]);

        hub.broadcast({ type: 'question.resolved', convId: 'conversation-1' });
        expect(hub.listPendingInteractions()[0].kinds).toEqual(['approval']);

        hub.broadcast({ type: 'approval.resolved', convId: 'conversation-1' });
        expect(hub.listPendingInteractions()).toEqual([]);
    });

    test('clears the navigation snapshot with conversation state', () => {
        const hub = createWebHub();
        hub.broadcast({ type: 'approval', workspaceId: 'workspace-1', convId: 'conversation-1' });

        hub.clearConversation('conversation-1');

        expect(hub.listPendingInteractions()).toEqual([]);
    });
});
