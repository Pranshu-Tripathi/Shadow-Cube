// Local web interface for the Shadow Cube — the home base that makes Discord
// optional (see issue #23). Runs in the same process as the bot and shares its
// `context` (stores, worktree/memory services, agentRouter), so the web notebook
// and Discord drive the exact same engine.

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { createWebHub } = require('./webHub');
const { createWebBridge } = require('./bridge');
const { createWebVoice } = require('./voiceWeb');
const { createWebConversationStore } = require('../stores/webConversationStore');
const { normalizeRepoSlug } = require('../github/githubClient');

// Expand ~ and resolve to an absolute path (mirrors the Discord !project command).
function resolvePath(input) {
    let resolved = input;
    if (resolved === '~') resolved = os.homedir();
    else if (resolved.startsWith('~/')) resolved = path.join(os.homedir(), resolved.slice(2));
    return path.resolve(resolved);
}

function isGitRepo(dir) {
    try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

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
        projectId: cfg.projectId || null,
        provider: cfg.provider || 'claude',
        baseBranch: cfg.baseBranch || null,
        broadcastDiscord: !!cfg.broadcastDiscord,
        discordChannelId: cfg.discordChannelId || null,
        rulesRepo: cfg.rulesRepo || null,
        rulesPath: cfg.rulesPath || null,
        hasSystemPrompt: !!cfg.systemPrompt,
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
    const conversationStore = createWebConversationStore();
    const hub = createWebHub({ conversationStore });
    const bridge = createWebBridge(context, hub, conversationStore);
    const webVoice = createWebVoice(context);
    // Expose the bridge so the Discord message path (agentMessageHandler / registry)
    // can mirror Discord conversations onto the web and route inbound mirror messages.
    context.webBridge = bridge;

    const { channelStore, projectStore, bootstrap, worktrees, memory, activeProcesses, claudeStdio, sessionStore, client, workspaceLifecycle } = context;

    function getWorkspace(id) {
        const channels = channelStore.loadChannelConfig();
        return channels[id] ? serializeWorkspace(id, channels[id], client) : null;
    }

    // Resolve an AskUserQuestion the browser answered, writing the control_response
    // back into the agent's stdin (same shape questionFlow uses for Discord).
    function answerQuestion(convId, answers) {
        if (context.questionCoordinator) {
            return context.questionCoordinator.resolve(convId, answers || {});
        }
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

    context.questionCoordinator?.subscribe(({ type, record, answers, summary }) => {
        if (type !== 'resolved' && type !== 'cleared') return;
        hub.broadcast({
            type: 'question.resolved',
            convId: record.conversationId,
            answers: answers || null,
            summary: summary || null,
        });
    });

    function answerApproval(convId, decision) {
        const pending = hub.pendingApprovals.get(convId);
        if (!pending) return { error: 'no pending approval' };
        if (!pending.options.some((option) => option.decision === decision)) return { error: 'invalid approval decision' };
        hub.pendingApprovals.delete(convId);
        const accepted = pending.resolve(decision);
        if (!accepted) return { error: 'approval is no longer active' };
        hub.broadcast({ type: 'approval.resolved', convId, token: pending.token, decision });
        return { ok: true };
    }

    function clearConversation(workspaceId, convId) {
        const result = workspaceLifecycle.resetSession(convId);
        hub.clearConversation(convId);
        return { ok: true, ...result };
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

            if (path === '/api/projects' && req.method === 'GET') {
                return json({ projects: projectStore.list(), projectsRoot: projectStore.projectsRoot });
            }
            const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
            if (projectMatch && req.method === 'PATCH') {
                const projectId = decodeURIComponent(projectMatch[1]);
                const body = await req.json().catch(() => ({}));
                try {
                    const project = projectStore.setBootstrapCommands(projectId, body.bootstrapCommands);
                    return json({ project });
                } catch (error) {
                    return badRequest(error.message);
                }
            }

            // --- Workspaces collection ---
            if (path === '/api/workspaces') {
                if (req.method === 'GET') return json({ workspaces: listWorkspaces(context) });
                if (req.method === 'POST') {
                    const body = await req.json().catch(() => ({}));
                    const selectedProject = body.projectId ? projectStore.get(body.projectId) : null;
                    if (body.projectId && (!selectedProject || !selectedProject.path)) {
                        return badRequest('Select a configured project repository.');
                    }
                    const requestedName = selectedProject?.name || body.projectName;
                    const requestedDir = selectedProject?.path || body.projectDir;
                    if (!requestedName || !requestedDir) {
                        return badRequest('projectName and projectDir are required');
                    }
                    const projectDir = resolvePath(requestedDir);
                    if (!isGitRepo(projectDir)) {
                        return badRequest(`${projectDir} is not a git repository (or does not exist).`);
                    }
                    const name = body.name || requestedName;
                    const id = `web:${slugify(name)}-${Date.now().toString(36)}`;
                    const patch = {
                        name,
                        projectName: requestedName,
                        projectDir,
                        provider: body.provider || 'claude',
                    };
                    if (body.baseBranch) patch.baseBranch = body.baseBranch;
                    channelStore.updateChannel(id, patch);
                    if (selectedProject) projectStore.assignWorkspace(id, selectedProject.id);
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
                        for (const key of ['name', 'projectName', 'provider', 'baseBranch']) {
                            if (body[key] != null) patch[key] = body[key];
                        }
                        if (body.projectDir != null) {
                            const dir = resolvePath(body.projectDir);
                            if (!isGitRepo(dir)) return badRequest(`${dir} is not a git repository (or does not exist).`);
                            patch.projectDir = dir;
                        }
                        if (body.projectId != null) {
                            const project = projectStore.get(body.projectId);
                            if (!project) return badRequest('Unknown project.');
                            patch.projectName = project.path ? project.name : null;
                            patch.projectDir = project.path;
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
                        if (body.projectId != null) projectStore.assignWorkspace(workspaceId, body.projectId);
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

                // Rules repo config + pull (system prompt + skills), mirrors !repo.
                if (sub === '/repo/config' && req.method === 'POST') {
                    const body = await req.json().catch(() => ({}));
                    const repo = normalizeRepoSlug(body.repo || '');
                    if (!repo) return badRequest('Use owner/repo or a GitHub URL.');
                    channelStore.updateChannel(workspaceId, { rulesRepo: repo });
                    return json({ ok: true, rulesRepo: repo, warnNoPat: !config.GITHUB_PAT });
                }
                if (sub === '/repo/pull' && req.method === 'POST') {
                    const repo = channelStore.loadChannelConfig()[workspaceId]?.rulesRepo;
                    if (!repo) return badRequest('No rules repo set. Configure one first.');
                    const body = await req.json().catch(() => ({}));
                    const relPath = (body.path || '').replace(/^\/+|\/+$/g, '');
                    try {
                        const result = await context.rulesRepo.pull({
                            channelId: workspaceId,
                            channelName: ws.name,
                            repo,
                            relPath,
                            wantPrompt: !!body.prompt,
                            wantSkill: !!body.skill,
                        });
                        return json({ ok: true, ref: result.ref, results: result.results });
                    } catch (e) {
                        return badRequest(`Failed to pull from ${repo}: ${e.message}`);
                    }
                }

                // Provision the worktree + scaffolding (.out, git excludes, skills dirs).
                if (sub === '/worktree/setup' && req.method === 'POST') {
                    if (!ws.projectDir) return badRequest('workspace has no project');
                    try {
                        const baseBranch = worktrees.getBaseBranch(workspaceId);
                        const worktreePath = worktrees.ensureWorktree(ws.name, baseBranch, workspaceId);
                        return json({ ok: true, worktreePath, baseBranch });
                    } catch (e) {
                        return badRequest(e.message);
                    }
                }
                if (sub === '/worktree/bootstrap' && req.method === 'POST') {
                    if (!ws.projectDir) return badRequest('workspace has no project');
                    try {
                        const info = worktrees.getWorktreeInfo(ws.name, workspaceId);
                        if (!require('fs').existsSync(info.worktreePath)) return badRequest('Set up the worktree first.');
                        return json(bootstrap.run({ workspaceId, worktreePath: info.worktreePath, force: true }));
                    } catch (error) {
                        return badRequest(error.message);
                    }
                }

                const actionMatch = sub.match(/^\/actions\/(preview|reset|remove-worktree|destroy)$/);
                if (actionMatch) {
                    const action = actionMatch[1];
                    if (action === 'preview' && req.method === 'GET') {
                        return json(workspaceLifecycle.preview({ workspaceId, workspaceName: ws.name }));
                    }
                    if (req.method === 'POST') {
                        const body = await req.json().catch(() => ({}));
                        if (action === 'reset') {
                            const result = workspaceLifecycle.resetSession(body.conversationId);
                            if (body.conversationId) hub.clearConversation(body.conversationId);
                            return json({ ok: true, ...result });
                        }
                        const options = {
                            workspaceId,
                            workspaceName: ws.name,
                            conversationId: body.conversationId,
                            confirmPath: body.confirmPath,
                        };
                        const result = action === 'destroy'
                            ? workspaceLifecycle.destroy(options)
                            : workspaceLifecycle.removeWorktree(options);
                        return json(result, { status: result.confirmationRequired ? 409 : 200 });
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
                if (sub === '/conversations' && req.method === 'POST') {
                    return json(conversationStore.createConversation(workspaceId), { status: 201 });
                }

                // Discord message history for a conversation that started on Discord.
                const histMatch = sub.match(/^\/conversations\/([^/]+)\/history$/);
                if (histMatch && req.method === 'GET') {
                    const convId = decodeURIComponent(histMatch[1]);
                    const messages = await bridge.fetchHistory(workspaceId, convId);
                    return json({ messages });
                }

                // Conversation actions: /conversations/:cid/(prompt|answer|approval|clear)
                const convMatch = sub.match(/^\/conversations\/([^/]+)\/(prompt|answer|approval|clear)$/);
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
                    if (action === 'approval') {
                        const result = answerApproval(convId, body.decision);
                        return result.error ? badRequest(result.error) : json(result);
                    }
                    if (action === 'clear') {
                        return json(clearConversation(workspaceId, convId));
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
