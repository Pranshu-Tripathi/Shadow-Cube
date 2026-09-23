// Local web interface for the Shadow Cube — the home base that makes Discord
// optional (see issue #23). Runs in the same process as the bot and shares its
// `context` (stores, worktree/memory services, agentRouter), so the web notebook
// and Discord drive the exact same engine.

const path = require('path');
const { createWebHub } = require('./webHub');
const { createWebBridge } = require('./bridge');
const { createWebVoice } = require('./voiceWeb');

const INDEX_HTML = path.join(__dirname, 'index.html');

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
        ...init,
    });
}

function badRequest(message) {
    return json({ error: message }, { status: 400 });
}

function notFound(message = 'not found') {
    return json({ error: message }, { status: 404 });
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

// A "workspace" is one track of work — the web-side name for a channel entry.
// For Discord-originated workspaces we fall back to the live channel name (so the
// sidebar shows readable names, not raw numeric ids) and finally to the id.
function serializeWorkspace(id, cfg, client) {
    let name = cfg.name;
    if (!name && client) {
        const ch = client.channels?.cache?.get(id);
        if (ch && ch.name) name = ch.name;
    }
    return {
        id,
        name: name || id,
        projectName: cfg.projectName || null,
        projectDir: cfg.projectDir || null,
        provider: cfg.provider || 'claude',
        baseBranch: cfg.baseBranch || null,
        broadcastDiscord: !!cfg.broadcastDiscord,
        discordChannelId: cfg.discordChannelId || null,
        isWeb: id.startsWith('web:'),
    };
}

function listWorkspaces(context) {
    const channels = context.channelStore.loadChannelConfig();
    return Object.entries(channels).map(([id, cfg]) => serializeWorkspace(id, cfg, context.client));
}

function startWebServer(context, { port } = {}) {
    const config = context.config;
    const listenPort = port || config.WEB_PORT;
    const hub = createWebHub();
    const bridge = createWebBridge(context, hub);
    const webVoice = createWebVoice(context);
    // Expose the bridge so the Discord message path (agentMessageHandler / registry)
    // can mirror Discord conversations onto the web and route inbound mirror messages.
    context.webBridge = bridge;

    const { channelStore, worktrees, memory, activeProcesses, claudeStdio, sessionStore, client } = context;

    function getWorkspace(id) {
        const channels = channelStore.loadChannelConfig();
        return channels[id] ? serializeWorkspace(id, channels[id], client) : null;
    }

    // Resolve an AskUserQuestion the browser answered, writing the control_response
    // back into the agent's stdin (same shape questionFlow uses for Discord).
    function answerQuestion(convId, answers) {
        const pending = hub.pendingQuestions.get(convId);
        if (!pending) return { error: 'no pending question' };
        hub.pendingQuestions.delete(convId);

        const ok = claudeStdio.writeStdin(pending.child, {
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: pending.requestId,
                response: {
                    behavior: 'allow',
                    updatedInput: {
                        questions: pending.originalInput.questions,
                        answers: answers || {},
                    },
                },
            },
        });
        return ok ? { ok: true } : { error: 'agent stdin closed' };
    }

    function clearConversation(convId) {
        const child = activeProcesses.get(convId);
        if (child) {
            try { child.kill('SIGTERM'); } catch {}
            activeProcesses.delete(convId);
        }
        sessionStore.clearSession(convId);
        hub.clearConversation(convId);
        return { ok: true };
    }

    const server = Bun.serve({
        port: listenPort,
        hostname: '127.0.0.1',
        async fetch(req, srv) {
            const url = new URL(req.url);
            const path = url.pathname;

            // WebSocket upgrade for live streaming.
            if (path === '/ws') {
                if (srv.upgrade(req)) return undefined;
                return badRequest('websocket upgrade failed');
            }

            if (path === '/api/health') {
                return json({
                    ok: true,
                    discord: !!config.DISCORD_TOKEN,
                    port: listenPort,
                    voice: webVoice.available().length === 0,
                });
            }

            // --- Workspaces collection ---
            if (path === '/api/workspaces') {
                if (req.method === 'GET') return json({ workspaces: listWorkspaces(context) });
                if (req.method === 'POST') {
                    const body = await req.json().catch(() => ({}));
                    if (!body.projectName || !body.projectDir) {
                        return badRequest('projectName and projectDir are required');
                    }
                    const name = body.name || body.projectName;
                    const id = `web:${slugify(name)}-${Date.now().toString(36)}`;
                    const patch = {
                        name,
                        projectName: body.projectName,
                        projectDir: body.projectDir,
                        provider: body.provider || 'claude',
                    };
                    if (body.baseBranch) patch.baseBranch = body.baseBranch;
                    channelStore.updateChannel(id, patch);
                    return json({ workspace: getWorkspace(id) }, { status: 201 });
                }
                return badRequest('method not allowed');
            }

            // --- Single workspace + sub-resources ---
            const wsMatch = path.match(/^\/api\/workspaces\/([^/]+)(\/.*)?$/);
            if (wsMatch) {
                const workspaceId = decodeURIComponent(wsMatch[1]);
                const sub = wsMatch[2] || '';
                const ws = getWorkspace(workspaceId);
                if (!ws) return notFound('unknown workspace');

                if (sub === '' || sub === '/') {
                    if (req.method === 'GET') return json({ workspace: ws });
                    if (req.method === 'PATCH') {
                        const body = await req.json().catch(() => ({}));
                        const patch = {};
                        for (const key of ['name', 'projectName', 'projectDir', 'provider', 'baseBranch']) {
                            if (body[key] != null) patch[key] = body[key];
                        }
                        if (typeof body.broadcastDiscord === 'boolean') {
                            patch.broadcastDiscord = body.broadcastDiscord;
                            // Turning broadcast on provisions a Discord channel named after the workspace.
                            if (body.broadcastDiscord) {
                                try {
                                    await bridge.ensureMirrorChannel(workspaceId);
                                } catch (e) {
                                    return badRequest(`Could not set up Discord channel: ${e.message}`);
                                }
                            }
                        }
                        channelStore.updateChannel(workspaceId, patch);
                        return json({ workspace: getWorkspace(workspaceId) });
                    }
                    if (req.method === 'DELETE') {
                        const channels = channelStore.loadChannelConfig();
                        delete channels[workspaceId];
                        channelStore.saveChannelConfig(channels);
                        return json({ ok: true });
                    }
                }

                // Memory panel
                if (sub === '/memory') {
                    if (!ws.projectDir) return badRequest('workspace has no project');
                    const wt = worktrees.getWorktreeInfo(ws.name, workspaceId).worktreePath;
                    if (req.method === 'GET') {
                        const files = memory.listMemoryFiles(wt).map((f) => ({
                            name: f,
                            content: memory.readMemoryFile(wt, f),
                        }));
                        return json({ memory: files });
                    }
                    if (req.method === 'POST') {
                        const body = await req.json().catch(() => ({}));
                        if (!body.text) return badRequest('text is required');
                        const name = memory.writeMemoryFile(wt, body.text);
                        return json({ ok: true, name });
                    }
                    if (req.method === 'DELETE') {
                        memory.wipeMemory(wt);
                        return json({ ok: true });
                    }
                }

                // Voice: browser posts an audio clip, we return the transcript.
                if (sub === '/transcribe' && req.method === 'POST') {
                    const ext = url.searchParams.get('ext') || 'webm';
                    const buffer = Buffer.from(await req.arrayBuffer());
                    if (!buffer.length) return badRequest('empty audio');
                    try {
                        const result = await webVoice.transcribe(buffer, { ext, workspaceId });
                        return json(result);
                    } catch (e) {
                        return json({ error: e.message, unavailable: !!e.unavailable }, { status: e.unavailable ? 503 : 500 });
                    }
                }

                // List conversations (web-created + live Discord threads).
                if (sub === '/conversations' && req.method === 'GET') {
                    const conversations = await bridge.listConversations(workspaceId);
                    return json({ conversations });
                }

                // Discord message history for a conversation that started on Discord.
                const histMatch = sub.match(/^\/conversations\/([^/]+)\/history$/);
                if (histMatch && req.method === 'GET') {
                    const convId = decodeURIComponent(histMatch[1]);
                    const messages = await bridge.fetchHistory(convId);
                    return json({ messages });
                }

                // Conversation actions: /conversations/:cid/(prompt|answer|clear)
                const convMatch = sub.match(/^\/conversations\/([^/]+)\/(prompt|answer|clear)$/);
                if (convMatch && req.method === 'POST') {
                    const convId = decodeURIComponent(convMatch[1]);
                    const action = convMatch[2];
                    const body = await req.json().catch(() => ({}));

                    if (action === 'prompt') {
                        if (!body.prompt) return badRequest('prompt is required');
                        const result = await bridge.dispatch(workspaceId, convId, body.prompt, { provider: body.provider });
                        return result.error ? badRequest(result.error) : json(result);
                    }
                    if (action === 'answer') {
                        const result = answerQuestion(convId, body.answers);
                        return result.error ? badRequest(result.error) : json(result);
                    }
                    if (action === 'clear') {
                        return json(clearConversation(convId));
                    }
                }

                return notFound();
            }

            // Notebook UI (single self-contained file, no build step).
            if (path === '/' || path === '/index.html') {
                return new Response(Bun.file(INDEX_HTML), { headers: { 'content-type': 'text/html; charset=utf-8' } });
            }
            return notFound();
        },
        websocket: {
            open(ws) {
                hub.addClient(ws);
                ws.send(JSON.stringify({ type: 'hello' }));
            },
            message(ws, raw) {
                let msg;
                try { msg = JSON.parse(raw); } catch { return; }
                // Client asks to replay a conversation's backlog on (re)connect.
                if (msg.type === 'subscribe' && msg.convId) {
                    hub.replay(ws, msg.convId);
                }
            },
            close(ws) {
                hub.removeClient(ws);
            },
        },
        error(err) {
            console.error('[DEBUG] web server error:', err);
            return json({ error: err.message }, { status: 500 });
        },
    });

    console.log(`[DEBUG] WEB INTERFACE listening on http://127.0.0.1:${listenPort}`);

    const voiceProblems = webVoice.available();
    if (voiceProblems.length) {
        console.warn(`[DEBUG] web voice unavailable: ${voiceProblems[0]}`);
    } else {
        // Warm the cleanup model so the first dictation doesn't pay the load cost.
        context.cleanup.warm();
        console.log('[DEBUG] WEB VOICE enabled (push-to-talk + call mode)');
    }

    return { server, hub };
}

module.exports = {
    startWebServer,
};
