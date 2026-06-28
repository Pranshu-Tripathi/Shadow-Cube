const { spawn } = require('child_process');

function createAppServerManager({ state, projectDir }) {
    let handlers = {
        handleNotification: () => {},
        handleServerRequest: () => {},
    };

    function setHandlers(nextHandlers) {
        handlers = { ...handlers, ...nextHandlers };
    }

    function writeRaw(obj) {
        const mgr = state.mgr;
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
            const id = state.mgr.nextId++;
            state.mgr.pending.set(id, { resolve, reject });
            const ok = writeRaw(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params });
            if (!ok) {
                state.mgr.pending.delete(id);
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
        if (state.mgr) {
            for (const { reject } of state.mgr.pending.values()) {
                reject(new Error(`codex app-server gone: ${reason || 'closed'}`));
            }
            state.mgr.pending.clear();
        }
        state.mgr = null;
        state.openThreads.clear();
        for (const approval of state.pendingApprovals.values()) approval.resolved = true;
        state.pendingApprovals.clear();
        state.pendingPatches.clear();
    }

    function dispatch(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            return;
        }

        if (msg.id !== undefined && msg.method) {
            handlers.handleServerRequest(msg.id, msg.method, msg.params || {});
            return;
        }
        if (msg.id !== undefined) {
            const pending = state.mgr?.pending.get(msg.id);
            if (pending) {
                state.mgr.pending.delete(msg.id);
                if (msg.error) pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else pending.resolve(msg.result);
            }
            return;
        }
        if (msg.method) handlers.handleNotification(msg.method, msg.params || {});
    }

    function ensureManager() {
        if (state.mgr && state.mgr.child && !state.mgr.child.killed) return state.mgr.ready;

        const child = spawn('codex', ['app-server'], { cwd: projectDir });
        state.mgr = { child, nextId: 1, pending: new Map(), buffer: '', ready: null };

        child.stdout.on('data', (raw) => {
            state.mgr.buffer += raw.toString();
            const lines = state.mgr.buffer.split('\n');
            state.mgr.buffer = lines.pop();
            for (const line of lines) {
                if (line.trim()) dispatch(line);
            }
        });
        child.stderr.on('data', (data) => {
            const text = data.toString().trim();
            if (text) console.error('[DEBUG] CODEX APP-SERVER STDERR:', text);
        });
        child.on('close', (code) => {
            console.log(`[DEBUG] CODEX APP-SERVER EXITED (Code: ${code})`);
            resetManager(`exit ${code}`);
        });

        state.mgr.ready = new Promise((resolve, reject) => {
            let settled = false;
            child.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
                resetManager(err.message);
            });
            (async () => {
                try {
                    await rpc('initialize', { clientInfo: { name: 'shadow-cube-bridge', version: '1.0.0' } });
                    notify('initialized');
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                } catch (e) {
                    if (!settled) {
                        settled = true;
                        reject(e);
                    }
                }
            })();
        });

        return state.mgr.ready;
    }

    return {
        setHandlers,
        writeRaw,
        rpc,
        notify,
        respond,
        respondError,
        resetManager,
        ensureManager,
    };
}

module.exports = {
    createAppServerManager,
};
