const { describe, expect, test } = require('bun:test');
const { createStateDatabase, upsertWorkspace } = require('../src/db/database');
const { createProjectStore } = require('../src/stores/projectStore');
const { createBootstrapService } = require('../src/git/bootstrapService');

describe('worktree bootstrap commands', () => {
    test('runs commands in order once and stops after a failure', () => {
        const db = createStateDatabase({ dbPath: ':memory:', importLegacy: false });
        upsertWorkspace(db, 'workspace', { projectName: 'Project', projectDir: '/repo' });
        const projects = createProjectStore({ db, projectsRoot: null });
        const project = projects.list({ refresh: false }).find((item) => item.id !== 'global');
        projects.setBootstrapCommands(project.id, ['first', 'fail', 'never']);
        const called = [];
        const bootstrap = createBootstrapService({
            db,
            runCommand(command) {
                called.push(command);
                return { command, exitCode: command === 'fail' ? 1 : 0, signal: null, stdout: '', stderr: '' };
            },
        });

        const result = bootstrap.run({ workspaceId: 'workspace', worktreePath: '/worktree' });
        expect(result.status).toBe('failed');
        expect(called).toEqual(['first', 'fail']);
    });

    test('keeps current scaffolding behavior when no commands are set', () => {
        const db = createStateDatabase({ dbPath: ':memory:', importLegacy: false });
        upsertWorkspace(db, 'workspace', { projectName: 'Project', projectDir: '/repo' });
        const bootstrap = createBootstrapService({ db, runCommand: () => { throw new Error('should not run'); } });
        expect(bootstrap.run({ workspaceId: 'workspace', worktreePath: '/worktree' })).toMatchObject({ status: 'skipped', reason: 'no-commands' });
    });
});
