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

function bumpDesktopRecency(codexThreadId) {
    if (!codexThreadId) return;
    const dbPath = findCodexStateDb();
    if (!dbPath) return;
    let db;
    try {
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

module.exports = {
    findCodexStateDb,
    bumpDesktopRecency,
};
