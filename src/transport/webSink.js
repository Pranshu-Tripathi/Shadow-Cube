// WebSink is the browser-facing counterpart to DiscordSink. The agent runners call
// send()/edit() exactly as they do for Discord; here those become WebSocket frames
// broadcast through the hub. A conversation (convId) is the web equivalent of a
// Discord thread; the workspace (parentId) is the equivalent of a channel.

// Runner payloads are either a plain string or a { content, components } object
// (the components form is used by the Discord question/approval flows). For the web
// we only need the text — interactive questions travel through askQuestion() below.
function contentOf(payload) {
    if (payload == null) return '';
    if (typeof payload === 'string') return payload;
    if (typeof payload.content === 'string') return payload.content;
    return '';
}

// Classify the already-formatted content so the browser can render it richly
// (collapsible tool calls, dimmed thinking, markdown text) instead of re-parsing
// Discord markup. The runners produce stable prefixes we key off here.
const TOOL_PREFIXES = ['Edit', 'Write', 'Read', 'Bash', 'Glob', 'Grep', 'Tool'];
function classify(content) {
    const trimmed = (content || '').trimStart();
    if (/^\*\*Thinking/.test(trimmed)) return { kind: 'thinking', title: 'Thinking' };
    if (/^\*Cost:/.test(trimmed)) return { kind: 'cost' };
    const m = trimmed.match(/^\*\*([A-Za-z]+):\*\*[ \t]*([^\n]*)/);
    if (m && TOOL_PREFIXES.includes(m[1])) {
        let title = m[1];
        const inlineArg = m[2].replace(/`/g, '').trim();
        if (inlineArg) title += ': ' + inlineArg;
        else {
            // No inline arg (e.g. Bash) — use the first line of the code block.
            const code = content.match(/```[a-z]*\n([^\n]+)/);
            if (code) title += ': ' + code[1].slice(0, 80);
        }
        return { kind: 'tool', title };
    }
    return { kind: 'text' };
}

function createWebSink({ hub, workspaceId, workspaceName, convId, questionCoordinator }) {
    // Returns a Promise (like discord.js's channel.send) so the runners can both
    // `await send()` for a handle and `send().catch()` fire-and-forget. The resolved
    // handle exposes .edit() for live updates.
    function send(payload) {
        const msgId = hub.nextMsgId();
        const content = contentOf(payload);
        const meta = classify(content);
        hub.broadcast({ type: 'message.create', workspaceId, convId, msgId, content, ...meta });

        return Promise.resolve({
            id: msgId,
            edit(next) {
                hub.broadcast({
                    type: 'message.update',
                    workspaceId,
                    convId,
                    msgId,
                    content: contentOf(next),
                });
                return Promise.resolve();
            },
        });
    }

    // Claude's AskUserQuestion, rendered as an interactive frame the browser answers
    // via POST .../answer. We keep the raw child + requestId so that endpoint can
    // write the control_response back into the agent's stdin.
    function askQuestion(child, requestId, toolUseId, input) {
        const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
        const questions = rawQuestions.map((q) => ({
            question: q.question || '',
            header: q.header || '',
            multiSelect: !!q.multiSelect,
            options: Array.isArray(q.options) ? q.options : [],
        }));

        if (questionCoordinator) {
            questionCoordinator.create({ conversationId: convId, child, requestId, toolUseId, input });
        } else {
            hub.pendingQuestions.set(convId, { child, requestId, toolUseId, originalInput: input, questions, answers: {} });
        }

        hub.broadcast({
            type: 'question',
            workspaceId,
            convId,
            msgId: hub.nextMsgId(),
            questions,
        });
    }

    // Codex approvals cannot use Discord component buttons in the browser. Publish a
    // native web frame and keep a resolver for the REST approval endpoint instead.
    function requestApproval(token, content, options, resolve) {
        hub.pendingApprovals.set(convId, { token, options, resolve });
        hub.broadcast({
            type: 'approval',
            workspaceId,
            convId,
            msgId: hub.nextMsgId(),
            token,
            content,
            options,
        });
        return Promise.resolve();
    }

    return {
        __sinkKind: 'web',
        id: convId,
        parentId: workspaceId,
        parentName: workspaceName,
        isThread: () => true,
        send,
        askQuestion,
        requestApproval,
    };
}

module.exports = {
    createWebSink,
};
