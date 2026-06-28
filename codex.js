// Codex provider for the Shadow Cube Bridge.
//
// Kept fully separate from the Claude engine in relay.js (runClaude), which is functional
// and must not be touched. relay.js dispatches here via runCodex() when a channel's provider
// is set to `codex`, and forwards `cxa:`-prefixed Discord button clicks to
// handleCodexApproval(). Shared renderer/worktree helpers are injected through `deps`.
//
// Unlike the one-shot `codex exec`, this drives the interactive `codex app-server`
// (NDJSON JSON-RPC over stdio — the protocol the Codex desktop app uses). That is the only
// Codex surface that supports interactive approvals: with approvalPolicy `on-request` the
// server sends approval REQUESTS before risky actions, which we surface as Discord buttons.
//
// Protocol shape (codex-cli 0.142.3, v2 thread/turn API):
//   spawn `codex app-server`  ->  one long-lived process multiplexing many threads.
//   handshake:  initialize (request) -> initialized (notification)
//   start:      thread/start {cwd, approvalPolicy, sandbox, developerInstructions}
//                 -> result.thread.id  (the Codex thread/session id)
//   resume:     thread/resume {threadId, approvalPolicy, sandbox}
//   prompt:     turn/start {threadId, input:[{type:'text', text}]}
//   stream:     notifications item/started, item/agentMessage/delta, item/completed,
//               thread/tokenUsage/updated, turn/completed, error  (each carries threadId)
//   approvals:  server->client REQUESTS item/commandExecution/requestApproval and
//               item/fileChange/requestApproval — reply {decision: accept|acceptForSession
//               |decline|cancel} echoing the request id.

const { spawn } = require('child_process');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Sandbox + approval policy. `workspace-write` (not `danger-full-access`) is deliberate:
// under full access the agent never needs to escalate, so Codex would never emit approval
// requests — defeating the whole point. With workspace-write + on-request the agent edits
// freely inside its worktree and PROMPTS (-> Discord buttons) before escaping the sandbox
// (network, writes outside the worktree, risky commands). danger-full-access + on-request is
// also allowed by org policy if full access is ever wanted.
const SANDBOX_MODE = 'workspace-write';
const APPROVAL_POLICY = 'on-request';

const MAX_MSG_LEN = 1950;
const EDIT_INTERVAL = 1500;

// --- Codex session storage (separate file so Claude's sessions/config.json is untouched) ---
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const CODEX_SESSIONS_PATH = path.join(SESSIONS_DIR, 'codex-config.json');

function loadCodexSessions() {
    try {
        if (!fs.existsSync(CODEX_SESSIONS_PATH)) return { threads: {} };
        return JSON.parse(fs.readFileSync(CODEX_SESSIONS_PATH, 'utf8'));
    } catch {
        return { threads: {} };
    }
}

function saveCodexSessions(config) {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(CODEX_SESSIONS_PATH, JSON.stringify(config, null, 2));
}

function getCodexSession(threadId) {
    const config = loadCodexSessions();
    const entry = config.threads[threadId];
    return entry ? entry['codex session id'] : '';
}

function setCodexSession(threadId, sessionId, channelName) {
    const config = loadCodexSessions();
    config.threads[threadId] = {
        'codex session id': sessionId,
        'channel': channelName,
    };
    saveCodexSessions(config);
}

function clearCodexSession(threadId) {
    const config = loadCodexSessions();
    delete config.threads[threadId];
    saveCodexSessions(config);
    // Also drop any in-memory routing so a re-use starts a fresh Codex thread.
    const codexThreadId = [...channelByThread.entries()].find(([, ch]) => ch?.id === threadId)?.[0];
    if (codexThreadId) {
        openThreads.delete(codexThreadId);
        channelByThread.delete(codexThreadId);
        renderStates.delete(codexThreadId);
    }
}

// --- Desktop app sync ---
// The Codex desktop app lists threads from ~/.codex/state_<N>.sqlite and orders the sidebar
// by `recency_at`, which Codex only sets on thread CREATION (there is an INSERT trigger but no
// UPDATE trigger for it). app-server bumps `updated_at` per turn but leaves `recency_at` frozen,
// so a session we keep driving from Discord never floats back to the top of the desktop list.
// After each turn we bump recency_at (and updated_at) for our thread id so it sorts as recent.
// The thread id we hold is the rollout session_id, which is exactly threads.id in the DB.
function findCodexStateDb() {
    const dir = path.join(os.homedir(), '.codex');
    try {
        const files = fs.readdirSync(dir).filter((f) => /^state_\d+\.sqlite$/.test(f));
        if (!files.length) return null;
        // Highest version wins (state_5 -> state_6 across Codex upgrades).
        files.sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
        return path.join(dir, files[0]);
    } catch {
        return null;
    }
}

function bumpDesktopRecency(codexThreadId) {
    if (!codexThreadId) return;
    const dbPath = findCodexStateDb();
    if (!dbPath) return;
    let db;
    try {
        // bun:sqlite is the project's SQLite (per CLAUDE.md); required lazily so the module
        // still loads under plain `node --check`. WAL mode lets us write alongside the app.
        const { Database } = require('bun:sqlite');
        db = new Database(dbPath);
        const nowMs = Date.now();
        const nowS = Math.floor(nowMs / 1000);
        db.run(
            'UPDATE threads SET recency_at = ?, recency_at_ms = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?',
            [nowS, nowMs, nowS, nowMs, codexThreadId]
        );
    } catch (e) {
        console.error('[DEBUG] codex desktop recency bump failed:', e.message);
    } finally {
        try { db?.close(); } catch {}
    }
}

// --- App-server manager (single shared process, multiplexes all Codex threads) ---
let mgr = null;                       // { child, nextId, pending: Map<id,{resolve,reject}>, buffer, ready }
const renderStates = new Map();       // codexThreadId -> render state
const channelByThread = new Map();    // codexThreadId -> Discord channel
const openThreads = new Set();        // codexThreadIds started/resumed in THIS process
const pendingApprovals = new Map();   // token -> { reqId, message, resolved }
const pendingPatches = new Map();     // itemId -> changes[]  (buffered for file-change approvals)
let approvalCounter = 0;

function writeRaw(obj) {
    if (!mgr?.child?.stdin || mgr.child.stdin.destroyed) return false;
    try {
        mgr.child.stdin.write(JSON.stringify(obj) + '\n');
        return true;
    } catch (e) {
        console.error('[DEBUG] Failed to write to codex app-server:', e.message);
        return false;
    }
}

function rpc(method, params) {
    return new Promise((resolve, reject) => {
        const id = mgr.nextId++;
        mgr.pending.set(id, { resolve, reject });
        const ok = writeRaw(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params });
        if (!ok) {
            mgr.pending.delete(id);
            reject(new Error('app-server stdin not writable'));
        }
    });
}

function notify(method, params) {
    writeRaw(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
}

function respond(id, result) {
    writeRaw({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
    writeRaw({ jsonrpc: '2.0', id, error: { code, message } });
}

function resetManager(reason) {
    if (mgr) {
        for (const { reject } of mgr.pending.values()) {
            reject(new Error(`codex app-server gone: ${reason || 'closed'}`));
        }
        mgr.pending.clear();
    }
    mgr = null;
    openThreads.clear();
    // Resolve any dangling approvals so their Discord messages don't hang forever.
    for (const ap of pendingApprovals.values()) ap.resolved = true;
    pendingApprovals.clear();
    pendingPatches.clear();
}

function ensureManager(deps) {
    if (mgr && mgr.child && !mgr.child.killed) return mgr.ready;

    const child = spawn('codex', ['app-server'], { cwd: deps.PROJECT_DIR });
    mgr = { child, nextId: 1, pending: new Map(), buffer: '', ready: null };

    child.stdout.on('data', (raw) => {
        mgr.buffer += raw.toString();
        const lines = mgr.buffer.split('\n');
        mgr.buffer = lines.pop();
        for (const line of lines) {
            if (line.trim()) dispatch(line);
        }
    });
    child.stderr.on('data', (d) => {
        const t = d.toString().trim();
        if (t) console.error('[DEBUG] CODEX APP-SERVER STDERR:', t);
    });
    child.on('close', (code) => {
        console.log(`[DEBUG] CODEX APP-SERVER EXITED (Code: ${code})`);
        resetManager(`exit ${code}`);
    });

    mgr.ready = new Promise((resolve, reject) => {
        let settled = false;
        child.on('error', (err) => {
            if (!settled) { settled = true; reject(err); }
            resetManager(err.message);
        });
        (async () => {
            try {
                await rpc('initialize', { clientInfo: { name: 'shadow-cube-bridge', version: '1.0.0' } });
                notify('initialized');
                if (!settled) { settled = true; resolve(); }
            } catch (e) {
                if (!settled) { settled = true; reject(e); }
            }
        })();
    });

    return mgr.ready;
}

function dispatch(line) {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        return;
    }

    // Server -> client request (has both id and method): approvals & misc.
    if (msg.id !== undefined && msg.method) {
        handleServerRequest(msg.id, msg.method, msg.params || {});
        return;
    }
    // Response to one of our requests (has id, no method).
    if (msg.id !== undefined) {
        const p = mgr?.pending.get(msg.id);
        if (p) {
            mgr.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else p.resolve(msg.result);
        }
        return;
    }
    // Notification (method, no id).
    if (msg.method) handleNotification(msg.method, msg.params || {});
}

// --- Rendering ---
let R = {}; // injected renderer helpers: { splitForDiscord, prettifyCodeBlocks }

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

function enqueue(state, fn) {
    state.chain = state.chain.then(fn).catch((e) => console.error('[DEBUG] codex render error:', e.message));
}

async function rawSend(state, content) {
    if (!content || !content.trim()) return;
    const chunks = R.splitForDiscord(content);
    for (const c of chunks) {
        await state.channel.send(c).catch((e) => console.error('[DEBUG] codex send failed:', e.message));
    }
    state.hasOutput = true;
}

async function flushAgent(state, final) {
    const text = state.agentBuf;
    if (!text.trim()) {
        if (final) { state.agentMsg = null; state.agentBuf = ''; }
        return;
    }
    state.hasOutput = true;
    const content = R.prettifyCodeBlocks(text.trim());
    const chunks = R.splitForDiscord(content);
    try {
        if (!state.agentMsg) {
            state.agentMsg = await state.channel.send(chunks[0]);
            for (let i = 1; i < chunks.length; i++) await state.channel.send(chunks[i]);
        } else if (final) {
            await state.agentMsg.edit(chunks[0]);
            for (let i = 1; i < chunks.length; i++) await state.channel.send(chunks[i]);
        } else {
            let preview = content;
            if (preview.length > MAX_MSG_LEN) {
                preview = content.slice(0, MAX_MSG_LEN - 10) + '\n...';
                const openTicks = (preview.match(/```/g) || []).length;
                if (openTicks % 2 !== 0) preview += '\n```';
            }
            await state.agentMsg.edit(preview);
        }
    } catch (e) {
        console.error('[DEBUG] codex flushAgent failed:', e.message);
    }
    if (final) { state.agentMsg = null; state.agentBuf = ''; }
}

function extractReasoning(item) {
    if (typeof item.text === 'string') return item.text;
    if (Array.isArray(item.summary)) return item.summary.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
    if (typeof item.summary === 'string') return item.summary;
    if (Array.isArray(item.content)) return item.content.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
    return '';
}

function handleNotification(method, params) {
    const threadId = params.threadId;
    const state = threadId ? renderStates.get(threadId) : null;

    switch (method) {
        case 'item/agentMessage/delta': {
            if (!state || typeof params.delta !== 'string') return;
            state.agentBuf += params.delta;
            clearTimeout(state.agentTimer);
            state.agentTimer = setTimeout(() => enqueue(state, () => flushAgent(state, false)), EDIT_INTERVAL);
            return;
        }
        case 'item/started': {
            // Buffer file-change diffs so a later approval request can show them.
            const item = params.item;
            if (item?.type === 'fileChange' && Array.isArray(item.changes)) {
                pendingPatches.set(item.id, item.changes);
            }
            return;
        }
        case 'item/fileChange/patchUpdated': {
            if (params.itemId && Array.isArray(params.changes)) pendingPatches.set(params.itemId, params.changes);
            return;
        }
        case 'item/completed': {
            if (!state) return;
            const item = params.item || {};
            if (item.type === 'agentMessage') {
                clearTimeout(state.agentTimer);
                if (typeof item.text === 'string') state.agentBuf = item.text;
                enqueue(state, () => flushAgent(state, true));
            } else if (item.type === 'reasoning') {
                const r = extractReasoning(item);
                if (r.trim()) {
                    const lines = r.trim().split('\n').map((l) => `> ${l}`).join('\n');
                    enqueue(state, () => rawSend(state, `**Thinking** (complete)\n${lines}`));
                }
            } else if (item.type === 'commandExecution') {
                const cmd = item.command || '?';
                let msg = `**Bash:**\n\`\`\`bash\n${cmd}\n\`\`\``;
                if (item.status === 'declined') msg += `\n*declined*`;
                else if (item.exitCode != null && item.exitCode !== 0) msg += `\n*exit ${item.exitCode}*`;
                enqueue(state, () => rawSend(state, msg));
            } else if (item.type === 'fileChange') {
                const icon = (k) => (k === 'delete' ? '🗑️' : k === 'add' ? '➕' : '✏️');
                const lines = (item.changes || []).map((c) => `${icon(c.kind)} \`${c.path}\``).join('\n');
                enqueue(state, () => rawSend(state, `**File changes:**\n${lines || '(none)'}`));
                pendingPatches.delete(item.id);
            }
            return;
        }
        case 'thread/tokenUsage/updated': {
            if (state && params.tokenUsage) state.lastUsage = params.tokenUsage.total || params.tokenUsage.last || null;
            return;
        }
        case 'turn/completed': {
            // Float this session to the top of the desktop app's thread list.
            bumpDesktopRecency(threadId);
            if (!state) return;
            clearTimeout(state.agentTimer);
            enqueue(state, async () => {
                await flushAgent(state, true);
                const u = state.lastUsage;
                if (u) {
                    await rawSend(state, `*Tokens: in ${u.inputTokens ?? '?'} (cached ${u.cachedInputTokens ?? 0}) / out ${u.outputTokens ?? '?'}*`);
                }
                if (!state.hasOutput) await state.channel.send('*(No output received)*').catch(() => {});
                state.hasOutput = false;
                state.lastUsage = null;
            });
            return;
        }
        case 'error': {
            if (!state) return;
            const m = params.error?.message || 'unknown error';
            enqueue(state, () => rawSend(state, `❌ **Codex error:** ${m}`));
            return;
        }
        default:
            return;
    }
}

// --- Approvals ---
const DECISIONS = {
    accept: { label: 'Approve', style: ButtonStyle.Success },
    acceptForSession: { label: 'Approve (session)', style: ButtonStyle.Primary },
    decline: { label: 'Deny', style: ButtonStyle.Secondary },
    cancel: { label: 'Deny & stop', style: ButtonStyle.Danger },
};

function approvalRows(token) {
    const buttons = Object.entries(DECISIONS).map(([decision, meta]) =>
        new ButtonBuilder()
            .setCustomId(`cxa:${token}:${decision}`)
            .setLabel(meta.label)
            .setStyle(meta.style)
    );
    return [new ActionRowBuilder().addComponents(buttons)];
}

async function postApproval(channel, reqId, body) {
    if (!channel) { respond(reqId, { decision: 'decline' }); return; }
    const token = `${approvalCounter++}`;
    const rows = approvalRows(token);
    try {
        const message = await channel.send({ content: body, components: rows });
        pendingApprovals.set(token, { reqId, message, resolved: false });
    } catch (e) {
        console.error('[DEBUG] failed to post codex approval:', e.message);
        respond(reqId, { decision: 'decline' });
    }
}

function handleServerRequest(id, method, params) {
    if (method === 'item/commandExecution/requestApproval') {
        const channel = channelByThread.get(params.threadId);
        const lines = ['🔐 **Codex wants to run a command**'];
        if (params.command) lines.push('```bash\n' + String(params.command).slice(0, 1500) + '\n```');
        if (params.cwd) lines.push(`in \`${params.cwd}\``);
        if (params.reason) lines.push(`*${params.reason}*`);
        postApproval(channel, id, lines.join('\n'));
        return;
    }
    if (method === 'item/fileChange/requestApproval') {
        const channel = channelByThread.get(params.threadId);
        const lines = ['🔐 **Codex wants to apply file changes**'];
        if (params.reason) lines.push(`*${params.reason}*`);
        if (params.grantRoot) lines.push(`grant write under \`${params.grantRoot}\``);
        const changes = pendingPatches.get(params.itemId);
        if (Array.isArray(changes)) {
            for (const c of changes.slice(0, 5)) {
                lines.push(`\`${c.path}\` (${c.kind})`);
                if (c.diff) lines.push('```diff\n' + String(c.diff).slice(0, 800) + '\n```');
            }
        }
        postApproval(channel, id, lines.join('\n'));
        return;
    }
    // Any other server->client request must still be answered or the turn hangs.
    respondError(id, -32601, `unsupported request: ${method}`);
}

// Called from relay.js's InteractionCreate handler for `cxa:`-prefixed buttons.
async function handleCodexApproval(interaction) {
    const parts = (interaction.customId || '').split(':');
    const token = parts[1];
    const decision = parts[2];
    const ap = pendingApprovals.get(token);
    if (!ap || ap.resolved) {
        await interaction.reply({ content: 'This approval is no longer active.', ephemeral: true }).catch(() => {});
        return;
    }
    if (!DECISIONS[decision]) {
        await interaction.reply({ content: 'Invalid decision.', ephemeral: true }).catch(() => {});
        return;
    }
    ap.resolved = true;
    pendingApprovals.delete(token);
    respond(ap.reqId, { decision });
    await interaction.update({
        content: interaction.message.content + `\n\n✅ **${DECISIONS[decision].label}**`,
        components: [],
    }).catch(() => {});
}

// --- The executor ---
async function runCodex(prompt, targetChannel, deps) {
    R = { splitForDiscord: deps.splitForDiscord, prettifyCodeBlocks: deps.prettifyCodeBlocks };

    const discordThreadId = targetChannel.id;
    const channelName = deps.getParentChannelName(targetChannel);
    const channelId = deps.getParentChannelId(targetChannel);
    const baseBranch = deps.getBaseBranch(channelId);
    const activeCwd = deps.ensureWorktree(channelName, baseBranch);

    // System-prompt equivalent, passed as developerInstructions on a fresh thread.
    let systemPrompt = `The base branch for this worktree is \`${baseBranch}\`. Use \`${baseBranch}\` as the target for PRs, diffs, and comparisons — not \`main\` or \`master\` unless they match.`;
    const channelRule = deps.loadChannelConfig()[channelId]?.systemPrompt;
    if (channelRule) systemPrompt += `\n\n${channelRule}`;
    const memory = deps.readWorktreeMemory(activeCwd);
    if (memory) {
        systemPrompt += `\n\n# Learned memory — past corrections, do not repeat these mistakes\n${memory}`;
    }

    try {
        await ensureManager(deps);
    } catch (e) {
        await targetChannel
            .send(`❌ Failed to launch \`codex app-server\`: ${e.message}. Is the Codex CLI installed and in PATH?`)
            .catch(() => {});
        return;
    }

    let codexThreadId = getCodexSession(discordThreadId);
    try {
        if (codexThreadId && openThreads.has(codexThreadId)) {
            // Already live in this process — just send another turn.
        } else if (codexThreadId) {
            const r = await rpc('thread/resume', {
                threadId: codexThreadId,
                approvalPolicy: APPROVAL_POLICY,
                sandbox: SANDBOX_MODE,
            });
            codexThreadId = r?.thread?.id || codexThreadId;
            openThreads.add(codexThreadId);
        } else {
            const r = await rpc('thread/start', {
                cwd: activeCwd,
                approvalPolicy: APPROVAL_POLICY,
                sandbox: SANDBOX_MODE,
                developerInstructions: systemPrompt,
            });
            codexThreadId = r.thread.id;
            openThreads.add(codexThreadId);
            setCodexSession(discordThreadId, codexThreadId, channelName);
        }
    } catch (e) {
        await targetChannel.send(`❌ Codex couldn't start a session: ${e.message}`).catch(() => {});
        return;
    }

    // Route this thread's events/approvals to this channel and start a fresh render state.
    channelByThread.set(codexThreadId, targetChannel);
    renderStates.set(codexThreadId, freshState(targetChannel));

    console.log(`[DEBUG] [Thread: ${discordThreadId}] CODEX turn/start (codexThread: ${codexThreadId})`);
    try {
        await rpc('turn/start', { threadId: codexThreadId, input: [{ type: 'text', text: prompt }] });
    } catch (e) {
        await targetChannel.send(`❌ Codex error: ${e.message}`).catch(() => {});
    }
}

module.exports = {
    runCodex,
    handleCodexApproval,
    getCodexSession,
    setCodexSession,
    clearCodexSession,
};
