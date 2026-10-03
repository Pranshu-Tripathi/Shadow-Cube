const { describe, expect, test } = require('bun:test');
const { createStateDatabase, upsertWorkspace } = require('../src/db/database');
const { createProjectStore } = require('../src/stores/projectStore');

describe('project hierarchy', () => {
    test('preserves configured project names and groups unset workspaces globally', () => {
        const db = createStateDatabase({ dbPath: ':memory:', importLegacy: false });
        upsertWorkspace(db, 'configured', { name: 'Feature', projectName: 'Authoritative Name', projectDir: '/tmp/repo' });
        upsertWorkspace(db, 'unset', { name: 'Old chat' });
        const store = createProjectStore({ db, projectsRoot: null });
        const projects = store.list({ refresh: false });
        expect(projects.find((project) => project.name === 'Authoritative Name').workspaceCount).toBe(1);
        expect(projects.find((project) => project.id === 'global').workspaceCount).toBe(1);
    });
});
