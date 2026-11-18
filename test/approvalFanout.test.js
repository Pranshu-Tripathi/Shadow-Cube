const { describe, expect, test } = require('bun:test');
const { createApprovalFlow } = require('../src/providers/codex/approvalFlow');
const { createDiscordSink } = require('../src/transport/sink');
const { createFanoutSink } = require('../src/transport/fanoutSink');
const { createWebSink } = require('../src/transport/webSink');

const options = [
    { decision: 'accept', label: 'Approve', tone: 'primary' },
    { decision: 'decline', label: 'Deny', tone: 'default' },
];

describe('Codex approval fan-out', () => {
    test('renders Discord approval buttons and can settle them remotely', async () => {
        const sent = [];
        const edits = [];
        const channel = {
            id: 'discord-thread',
            name: 'thread',
            isThread: () => true,
            parentId: 'workspace',
            parent: { name: 'workspace' },
            async send(payload) {
                payload.components.forEach((row) => row.toJSON());
                sent.push(payload);
                return {
                    id: 'approval-message',
                    content: payload.content,
                    edit: async (next) => edits.push(next),
                };
            },
        };
        const sink = createDiscordSink(channel);
        const handle = await sink.requestApproval('token', 'Run command?', options, () => true);

        expect(sent).toHaveLength(1);
        const buttons = sent[0].components[0].toJSON().components;
        expect(buttons.map((button) => button.custom_id)).toEqual(['cxa:token:accept', 'cxa:token:decline']);

        await handle.resolve('accept');
        expect(edits).toEqual([{ content: 'Run command?\n\n✅ **Approve**', components: [] }]);
    });

    test('clears the browser approval when another surface resolves it', async () => {
        const frames = [];
        const hub = {
            pendingApprovals: new Map(),
            nextMsgId: () => 'message',
            broadcast: (frame) => frames.push(frame),
        };
        const sink = createWebSink({ hub, workspaceId: 'workspace', workspaceName: 'Workspace', convId: 'conversation' });
        const handle = await sink.requestApproval('token', 'Run command?', options, () => true);

        expect(hub.pendingApprovals.has('conversation')).toBe(true);
        await handle.resolve('accept');
        expect(hub.pendingApprovals.has('conversation')).toBe(false);
        expect(frames.at(-1)).toMatchObject({
            type: 'approval.resolved',
            workspaceId: 'workspace',
            convId: 'conversation',
            token: 'token',
            decision: 'accept',
        });
    });

    test('responds to Codex once and settles every approval surface', async () => {
        const presented = [];
        const settled = [];
        const approvalSink = (kind) => ({
            __sinkKind: kind,
            id: kind,
            parentId: 'workspace',
            parentName: 'Workspace',
            isThread: () => true,
            send: async () => ({ id: kind, edit: async () => {} }),
            requestApproval: async (token, _content, _options, resolve) => {
                presented.push({ kind, token, resolve });
                return { resolve: async (decision) => settled.push(`${kind}:${decision}`) };
            },
        });
        const channel = createFanoutSink({ primary: approvalSink('web'), mirrors: [approvalSink('discord')] });
        const responses = [];
        const state = {
            approvalCounter: 0,
            pendingApprovals: new Map(),
            pendingPatches: new Map(),
            channelByThread: new Map([['codex-thread', channel]]),
        };
        const flow = createApprovalFlow({
            state,
            appServer: {
                respond: (id, result) => responses.push({ id, result }),
                respondError: () => {},
            },
            formatter: {
                formatCommandApproval: () => 'Run command?',
                formatFileChangeApproval: () => 'Apply changes?',
            },
        });

        await flow.handleServerRequest('request-1', 'item/commandExecution/requestApproval', { threadId: 'codex-thread' });
        expect(presented.map(({ kind }) => kind)).toEqual(['web', 'discord']);
        expect(state.pendingApprovals.has('0')).toBe(true);

        expect(presented[0].resolve('accept')).toBe(true);
        await Promise.resolve();
        expect(responses).toEqual([{ id: 'request-1', result: { decision: 'accept' } }]);
        expect(settled).toEqual(['web:accept', 'discord:accept']);
        expect(state.pendingApprovals.size).toBe(0);
        expect(presented[1].resolve('decline')).toBe(false);
        expect(responses).toHaveLength(1);
    });

    test('a Discord button resolves Codex and clears the matching web approval', async () => {
        const frames = [];
        const hub = {
            pendingApprovals: new Map(),
            nextMsgId: () => 'web-message',
            broadcast: (frame) => frames.push(frame),
        };
        const web = createWebSink({ hub, workspaceId: 'workspace', workspaceName: 'Workspace', convId: 'conversation' });
        const discordMessages = [];
        const discordEdits = [];
        const discord = createDiscordSink({
            id: 'discord-thread',
            name: 'thread',
            isThread: () => true,
            parentId: 'workspace',
            parent: { name: 'workspace' },
            async send(payload) {
                discordMessages.push(payload);
                return {
                    id: 'discord-approval',
                    content: payload.content,
                    edit: async (next) => discordEdits.push(next),
                };
            },
        });
        const channel = createFanoutSink({ primary: web, mirrors: [discord] });
        const responses = [];
        const state = {
            approvalCounter: 0,
            pendingApprovals: new Map(),
            pendingPatches: new Map(),
            channelByThread: new Map([['codex-thread', channel]]),
        };
        const flow = createApprovalFlow({
            state,
            appServer: {
                respond: (id, result) => responses.push({ id, result }),
                respondError: () => {},
            },
            formatter: {
                formatCommandApproval: () => 'Run command?',
                formatFileChangeApproval: () => 'Apply changes?',
            },
        });

        await flow.handleServerRequest('request-1', 'item/commandExecution/requestApproval', { threadId: 'codex-thread' });
        expect(hub.pendingApprovals.has('conversation')).toBe(true);
        expect(discordMessages).toHaveLength(1);

        const updates = [];
        await flow.handleCodexApproval({
            customId: 'cxa:0:accept',
            message: { id: 'discord-approval', content: 'Run command?' },
            update: async (payload) => updates.push(payload),
            reply: async () => {},
        });
        await Promise.resolve();

        expect(responses).toEqual([{ id: 'request-1', result: { decision: 'accept' } }]);
        expect(updates).toEqual([{ content: 'Run command?\n\n✅ **Approve**', components: [] }]);
        expect(discordEdits).toHaveLength(0);
        expect(hub.pendingApprovals.has('conversation')).toBe(false);
        expect(frames.at(-1)).toMatchObject({ type: 'approval.resolved', decision: 'accept' });
    });
});
