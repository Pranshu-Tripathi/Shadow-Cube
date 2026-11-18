const { describe, expect, test } = require('bun:test');
const { createWorkspaceLifecycleService } = require('../src/git/workspaceLifecycleService');

function service(overrides = {}) {
    const activeProcesses = new Map();
    const calls = [];
    const worktrees = {
        getProjectConfig: () => ({ projectName: 'Project', projectDir: '/repo' }),
        getWorktreeInfo: () => ({ worktreePath: '/safe/worktrees/project/task', branch: 'shadow/task' }),
        removeWorktree: () => { calls.push('remove'); return true; },
        fetchRemoteBranch: () => { calls.push('fetch'); return true; },
        ...overrides.worktrees,
    };
    const instance = createWorkspaceLifecycleService({
        config: { WORKTREES_ROOT: '/safe/worktrees' },
        worktrees,
        activeProcesses,
        sessionStore: { clearSession: () => calls.push('claude') },
        clearCodexSession: () => calls.push('codex'),
        questionCoordinator: { clear: () => calls.push('question') },
    });
    return { instance, activeProcesses, calls };
}

describe('workspace lifecycle', () => {
    test('reset clears both provider sessions without deleting history', () => {
        const { instance, activeProcesses, calls } = service();
        activeProcesses.set('conversation', { kill: () => calls.push('kill') });
        expect(instance.resetSession('conversation').processKilled).toBe(true);
        expect(calls).toEqual(['kill', 'claude', 'codex', 'question']);
    });

    test('refuses paths outside the configured worktree root', () => {
        const { instance } = service();
        expect(() => instance.assertSafeWorktreePath('/repo')).toThrow('outside the worktree root');
    });
});
