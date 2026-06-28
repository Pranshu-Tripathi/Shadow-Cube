const { EDIT_INTERVAL, MAX_MSG_LEN } = require('./constants');

function createCodexRenderer({ state, formatting, formatter, bumpDesktopRecency }) {
    function freshState(channel) {
        return {
            channel,
            agentMsg: null,
            agentBuf: '',
            agentTimer: null,
            lastUsage: null,
            hasOutput: false,
            chain: Promise.resolve(),
        };
    }

    function startThread(codexThreadId, channel) {
        state.renderStates.set(codexThreadId, freshState(channel));
    }

    function enqueue(renderState, fn) {
        renderState.chain = renderState.chain.then(fn).catch((e) => console.error('[DEBUG] codex render error:', e.message));
    }

    async function rawSend(renderState, content) {
        if (!content || !content.trim()) return;
        const chunks = formatting.splitForDiscord(content);
        for (const chunk of chunks) {
            await renderState.channel.send(chunk).catch((e) => console.error('[DEBUG] codex send failed:', e.message));
        }
        renderState.hasOutput = true;
    }

    async function flushAgent(renderState, final) {
        const text = renderState.agentBuf;
        if (!text.trim()) {
            if (final) {
                renderState.agentMsg = null;
                renderState.agentBuf = '';
            }
            return;
        }
        renderState.hasOutput = true;
        const content = formatting.prettifyCodeBlocks(text.trim());
        const chunks = formatting.splitForDiscord(content);
        try {
            if (!renderState.agentMsg) {
                renderState.agentMsg = await renderState.channel.send(chunks[0]);
                for (let i = 1; i < chunks.length; i++) await renderState.channel.send(chunks[i]);
            } else if (final) {
                await renderState.agentMsg.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) await renderState.channel.send(chunks[i]);
            } else {
                let preview = content;
                if (preview.length > MAX_MSG_LEN) {
                    preview = content.slice(0, MAX_MSG_LEN - 10) + '\n...';
                    const openTicks = (preview.match(/```/g) || []).length;
                    if (openTicks % 2 !== 0) preview += '\n```';
                }
                await renderState.agentMsg.edit(preview);
            }
        } catch (e) {
            console.error('[DEBUG] codex flushAgent failed:', e.message);
        }
        if (final) {
            renderState.agentMsg = null;
            renderState.agentBuf = '';
        }
    }

    function handleNotification(method, params) {
        const threadId = params.threadId;
        const renderState = threadId ? state.renderStates.get(threadId) : null;

        switch (method) {
            case 'item/agentMessage/delta': {
                if (!renderState || typeof params.delta !== 'string') return;
                renderState.agentBuf += params.delta;
                clearTimeout(renderState.agentTimer);
                renderState.agentTimer = setTimeout(() => enqueue(renderState, () => flushAgent(renderState, false)), EDIT_INTERVAL);
                return;
            }
            case 'item/started': {
                const item = params.item;
                if (item?.type === 'fileChange' && Array.isArray(item.changes)) {
                    state.pendingPatches.set(item.id, item.changes);
                }
                return;
            }
            case 'item/fileChange/patchUpdated': {
                if (params.itemId && Array.isArray(params.changes)) state.pendingPatches.set(params.itemId, params.changes);
                return;
            }
            case 'item/completed': {
                if (!renderState) return;
                const item = params.item || {};
                if (item.type === 'agentMessage') {
                    clearTimeout(renderState.agentTimer);
                    if (typeof item.text === 'string') renderState.agentBuf = item.text;
                    enqueue(renderState, () => flushAgent(renderState, true));
                } else if (item.type === 'reasoning') {
                    const body = formatter.formatReasoning(item);
                    if (body) enqueue(renderState, () => rawSend(renderState, body));
                } else if (item.type === 'commandExecution') {
                    enqueue(renderState, () => rawSend(renderState, formatter.formatCommandExecution(item)));
                } else if (item.type === 'fileChange') {
                    enqueue(renderState, () => rawSend(renderState, formatter.formatFileChanges(item)));
                    state.pendingPatches.delete(item.id);
                }
                return;
            }
            case 'thread/tokenUsage/updated': {
                if (renderState && params.tokenUsage) renderState.lastUsage = params.tokenUsage.total || params.tokenUsage.last || null;
                return;
            }
            case 'turn/completed': {
                bumpDesktopRecency(threadId);
                if (!renderState) return;
                clearTimeout(renderState.agentTimer);
                enqueue(renderState, async () => {
                    await flushAgent(renderState, true);
                    const usage = renderState.lastUsage;
                    if (usage) {
                        await rawSend(renderState, formatter.formatUsage(usage));
                    }
                    if (!renderState.hasOutput) await renderState.channel.send('*(No output received)*').catch(() => {});
                    renderState.hasOutput = false;
                    renderState.lastUsage = null;
                });
                return;
            }
            case 'error': {
                if (!renderState) return;
                enqueue(renderState, () => rawSend(renderState, formatter.formatError(params)));
                return;
            }
            default:
                return;
        }
    }

    return {
        startThread,
        handleNotification,
    };
}

module.exports = {
    createCodexRenderer,
};
