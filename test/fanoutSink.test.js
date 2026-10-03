const { describe, expect, test } = require('bun:test');
const { createFanoutSink } = require('../src/transport/fanoutSink');

function recordingSink(kind, sent) {
    return {
        __sinkKind: kind,
        id: kind,
        parentId: 'workspace',
        parentName: 'Workspace',
        isThread: () => true,
        async send(payload) {
            const record = { payload, edits: [] };
            sent.push(record);
            return { id: `${kind}-${sent.length}`, edit: async (next) => record.edits.push(next) };
        },
    };
}

describe('dynamic fanout sink', () => {
    test('starts and stops mirroring without recreating the agent sink', async () => {
        const primaryMessages = [];
        const mirrorMessages = [];
        const primary = recordingSink('web', primaryMessages);
        const mirror = recordingSink('discord', mirrorMessages);
        let broadcasting = false;
        const sink = createFanoutSink({
            primary,
            getMirrors: () => broadcasting ? [mirror] : [],
        });

        await sink.send('web only');
        broadcasting = true;
        const mirrored = await sink.send('both');
        await mirrored.edit('both updated');
        broadcasting = false;
        await sink.send('web only again');

        expect(primaryMessages.map((message) => message.payload)).toEqual(['web only', 'both', 'web only again']);
        expect(mirrorMessages.map((message) => message.payload)).toEqual(['both']);
        expect(mirrorMessages[0].edits).toEqual(['both updated']);
    });
});
