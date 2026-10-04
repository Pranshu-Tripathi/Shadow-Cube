const { describe, expect, test } = require('bun:test');
const { createQuestionFlow } = require('../src/discord/questionFlow');

function createFlow() {
    return createQuestionFlow({
        activeProcesses: new Map(),
        writeStdin: () => true,
    });
}

describe('Discord AskUserQuestion rendering', () => {
    test('keeps long web-originated questions within Discord payload limits', async () => {
        const sent = [];
        const channel = {
            id: 'discord-thread',
            async send(payload) {
                payload.components.forEach((row) => row.toJSON());
                sent.push(payload);
                return { content: payload.content, edit: async () => {} };
            },
        };
        const flow = createFlow();

        await flow.handleAskUserQuestion(channel, {}, 'request', 'tool', {
            questions: [{
                question: `Choose how to proceed: ${'very-long-command '.repeat(300)}`,
                options: Array.from({ length: 30 }, (_, index) => ({
                    label: `Option ${index + 1}`,
                    description: 'A detailed description '.repeat(20),
                })),
                multiSelect: true,
            }],
        }, { conversationId: 'web-conversation' });

        expect(sent).toHaveLength(1);
        expect(sent[0].content.length).toBeLessThanOrEqual(2000);
        const select = sent[0].components[0].toJSON().components[0];
        expect(select.options).toHaveLength(25);
        expect(select.max_values).toBe(25);
    });

    test('falls back to a custom-answer button for an empty multi-select', async () => {
        const sent = [];
        const channel = {
            id: 'discord-thread',
            async send(payload) {
                payload.components.forEach((row) => row.toJSON());
                sent.push(payload);
                return { content: payload.content, edit: async () => {} };
            },
        };
        const flow = createFlow();

        await flow.handleAskUserQuestion(channel, {}, 'request', 'tool', {
            questions: [{ question: 'What should I do?', options: [], multiSelect: true }],
        });

        expect(sent).toHaveLength(1);
        const components = sent[0].components[0].toJSON().components;
        expect(components).toHaveLength(1);
        expect(components[0].label).toBe('Custom');
    });
});
