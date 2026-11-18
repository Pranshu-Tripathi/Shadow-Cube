const { spawnSync } = require('child_process');
const { getDatabase } = require('../db/database');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_LENGTH = 100_000;

function defaultRunCommand(command, { cwd, shell, timeoutMs }) {
    const result = spawnSync(shell, ['-lc', command], {
        cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
    });
    return {
        command,
        exitCode: result.status == null ? 1 : result.status,
        signal: result.signal || null,
        stdout: result.stdout || '',
        stderr: result.stderr || (result.error ? result.error.message : ''),
    };
}

function createBootstrapService({
    db = getDatabase(),
    shell = process.env.SHELL || '/bin/zsh',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    runCommand = defaultRunCommand,
} = {}) {
    function commandsForWorkspace(workspaceId) {
        const row = db.query(`
            SELECT p.bootstrap_commands
            FROM workspaces w JOIN projects p ON p.id = w.project_id
            WHERE w.id = ?
        `).get(workspaceId);
        if (!row) return [];
        try { return JSON.parse(row.bootstrap_commands || '[]'); } catch { return []; }
    }

    function latest(workspaceId, worktreePath) {
        const row = db.query(`
            SELECT status, output, created_at FROM worktree_setup_runs
            WHERE workspace_id = ? AND worktree_path = ? ORDER BY id DESC LIMIT 1
        `).get(workspaceId, worktreePath);
        if (!row) return null;
        return { status: row.status, output: row.output || '', createdAt: row.created_at };
    }

    function run({ workspaceId, worktreePath, force = false }) {
        const commands = commandsForWorkspace(workspaceId);
        if (!commands.length) return { status: 'skipped', reason: 'no-commands', commands: [], results: [] };
        const previous = latest(workspaceId, worktreePath);
        if (!force && previous?.status === 'success') {
            return { status: 'skipped', reason: 'already-complete', commands, results: [] };
        }

        const results = [];
        let status = 'success';
        for (const command of commands) {
            const result = runCommand(command, { cwd: worktreePath, shell, timeoutMs });
            results.push(result);
            if (result.exitCode !== 0) {
                status = 'failed';
                break;
            }
        }
        const output = results.map((result) => [
            `$ ${result.command}`,
            result.stdout,
            result.stderr,
            `exit ${result.exitCode}${result.signal ? ` (${result.signal})` : ''}`,
        ].filter(Boolean).join('\n')).join('\n\n').slice(-MAX_OUTPUT_LENGTH);
        db.query(`
            INSERT INTO worktree_setup_runs (workspace_id, worktree_path, status, output, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(workspaceId, worktreePath, status, output, Date.now());
        return { status, commands, results, output };
    }

    return { commandsForWorkspace, latest, run };
}

module.exports = { createBootstrapService, defaultRunCommand };
