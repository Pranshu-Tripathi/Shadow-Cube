const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function createWorkspaceLifecycleService({
    config,
    worktrees,
    activeProcesses,
    sessionStore,
    clearCodexSession,
    questionCoordinator,
}) {
    function assertSafeWorktreePath(worktreePath) {
        const root = path.resolve(config.WORKTREES_ROOT);
        const target = path.resolve(worktreePath);
        if (target !== root && !target.startsWith(root + path.sep)) {
            throw new Error(`Refusing to operate outside the worktree root: ${target}`);
        }
        return target;
    }

    function preview({ workspaceId, workspaceName }) {
        if (!worktrees.getProjectConfig(workspaceId)) {
            return { configured: false, exists: false, dirtyFiles: 0 };
        }
        const info = worktrees.getWorktreeInfo(workspaceName, workspaceId);
        const worktreePath = assertSafeWorktreePath(info.worktreePath);
        if (!fs.existsSync(worktreePath)) {
            return { configured: true, exists: false, worktreePath, branch: info.branch, dirtyFiles: 0, changes: [] };
        }
        let changes = [];
        try {
            const output = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
            changes = output ? output.split('\n') : [];
        } catch (error) {
            throw new Error(`Could not inspect worktree: ${error.message}`);
        }
        return {
            configured: true,
            exists: true,
            worktreePath,
            branch: info.branch,
            dirtyFiles: changes.length,
            changes: changes.slice(0, 25),
        };
    }

    function resetSession(conversationId) {
        if (!conversationId) return { processKilled: false };
        let processKilled = false;
        const child = activeProcesses.get(conversationId);
        if (child) {
            try { child.kill('SIGTERM'); } catch {}
            activeProcesses.delete(conversationId);
            processKilled = true;
        }
        sessionStore.clearSession(conversationId);
        clearCodexSession(conversationId);
        questionCoordinator?.clear(conversationId, 'Session cleared.');
        return { processKilled };
    }

    function removeWorktree({ workspaceId, workspaceName, conversationId, confirmPath, allowDirty = false }) {
        const state = preview({ workspaceId, workspaceName });
        const reset = resetSession(conversationId);
        if (!state.configured) return { ...reset, removed: false, reason: 'no-project', preview: state };
        if (!state.exists) return { ...reset, removed: false, reason: 'missing', preview: state };
        if (state.dirtyFiles > 0 && !allowDirty && confirmPath !== state.worktreePath) {
            return { ...reset, removed: false, confirmationRequired: true, preview: state };
        }
        const removed = worktrees.removeWorktree(workspaceName, workspaceId);
        return { ...reset, removed, preview: state };
    }

    function destroy(options) {
        const result = removeWorktree(options);
        if (result.confirmationRequired || !result.preview?.configured) return result;
        const branch = result.preview.branch;
        const fetchedRemote = branch ? worktrees.fetchRemoteBranch(branch, options.workspaceId) : false;
        return { ...result, fetchedRemote };
    }

    return { preview, resetSession, removeWorktree, destroy, assertSafeWorktreePath };
}

module.exports = { createWorkspaceLifecycleService };
