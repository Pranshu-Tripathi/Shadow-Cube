const { describe, expect, test } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Database } = require('bun:sqlite');
const { createStateDatabase, upsertWorkspace } = require('../src/db/database');
const { createStateBackup } = require('../src/db/backup');

describe('SQLite state backups', () => {
    test('creates a consistent standalone database copy', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cube-backup-'));
        const db = createStateDatabase({ dbPath: path.join(dir, 'state.sqlite'), importLegacy: false });
        upsertWorkspace(db, 'workspace', { name: 'Preserved', projectName: 'Project', projectDir: '/repo' });
        const destination = createStateBackup({ db, destinationDir: path.join(dir, 'backups'), date: new Date('2026-01-02T03:04:05Z') });
        const backup = new Database(destination, { readonly: true });
        expect(backup.query('SELECT name FROM workspaces WHERE id = ?').get('workspace').name).toBe('Preserved');
        expect(path.basename(destination)).toBe('shadow-cube-2026-01-02T03-04-05-000Z.sqlite');
        backup.close(); db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
