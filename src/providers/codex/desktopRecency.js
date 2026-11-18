const fs = require('fs');
const path = require('path');
const os = require('os');

function findCodexStateDb() {
    const dir = path.join(os.homedir(), '.codex');
    try {
        const files = fs.readdirSync(dir).filter((f) => /^state_\d+\.sqlite$/.test(f));
        if (!files.length) return null;
        files.sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
        return path.join(dir, files[0]);
    } catch {
        return null;
    }
}

// The Codex desktop app holds the same sqlite file open, so writes can collide.
const BUSY_TIMEOUT_MS = 2000;

function bumpDesktopRecency(codexThreadId) {
    if (!codexThreadId) return;
    const dbPath = findCodexStateDb();
    if (!dbPath) return;
    let db;
    try {
        const { Database } = require('bun:sqlite');
        db = new Database(dbPath);
        // Wait for the desktop app's writer instead of failing instantly with
        // "database is locked".
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
        const nowMs = Date.now();
        const nowS = Math.floor(nowMs / 1000);
        db.run(
            'UPDATE threads SET recency_at = ?, recency_at_ms = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?',
            [nowS, nowMs, nowS, nowMs, codexThreadId]
        );
    } catch (e) {
        // Purely cosmetic (sorting in the desktop app) — never worth surfacing loudly.
        if (!/database is locked|database is busy/i.test(e.message)) {
            console.error('[DEBUG] codex desktop recency bump failed:', e.message);
        }
    } finally {
        try { db?.close(); } catch {}
    }
}

module.exports = {
    findCodexStateDb,
    bumpDesktopRecency,
};
