const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getDatabase, ensureProject } = require('../db/database');

function isGitRepository(dir) {
    try {
        return execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
    } catch {
        return false;
    }
}

function createProjectStore({ db = getDatabase(), projectsRoot } = {}) {
    function discover() {
        if (!projectsRoot || !fs.existsSync(projectsRoot)) return [];
        let entries = [];
        try {
            entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
        } catch {
            return [];
        }
        const found = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const projectPath = path.join(projectsRoot, entry.name);
            if (!isGitRepository(projectPath)) continue;
            const id = ensureProject(db, entry.name, projectPath);
            found.push(id);
        }
        return found;
    }

    function list({ refresh = true } = {}) {
        if (refresh) discover();
        return db.query(`
            SELECT p.id, p.name, p.path, p.bootstrap_commands,
                   COUNT(w.id) AS workspace_count
            FROM projects p
            LEFT JOIN workspaces w ON w.project_id = p.id
            GROUP BY p.id
            ORDER BY CASE WHEN p.id = 'global' THEN 1 ELSE 0 END, lower(p.name)
        `).all().map((project) => ({
            id: project.id,
            name: project.name,
            path: project.path || null,
            workspaceCount: Number(project.workspace_count),
            configured: !!project.path,
            bootstrapCommands: JSON.parse(project.bootstrap_commands || '[]'),
        }));
    }

    function get(projectId) {
        const project = db.query('SELECT id, name, path, bootstrap_commands FROM projects WHERE id = ?').get(projectId);
        return project ? {
            id: project.id,
            name: project.name,
            path: project.path || null,
            bootstrapCommands: JSON.parse(project.bootstrap_commands || '[]'),
        } : null;
    }

    function assignWorkspace(workspaceId, projectId) {
        const project = get(projectId);
        if (!project) throw new Error('Unknown project.');
        const row = db.query('SELECT config_json FROM workspaces WHERE id = ?').get(workspaceId);
        if (!row) throw new Error('Unknown workspace.');
        const cfg = JSON.parse(row.config_json || '{}');
        if (project.path) {
            cfg.projectName = project.name;
            cfg.projectDir = project.path;
        } else {
            delete cfg.projectName;
            delete cfg.projectDir;
        }
        db.query(`
            UPDATE workspaces SET project_id = ?, project_name = ?, project_dir = ?, config_json = ?, updated_at = ?
            WHERE id = ?
        `).run(project.id, project.path ? project.name : null, project.path, JSON.stringify(cfg), Date.now(), workspaceId);
        return project;
    }

    function setBootstrapCommands(projectId, commands) {
        if (!Array.isArray(commands)) throw new Error('bootstrapCommands must be an array.');
        const cleaned = commands.map((command) => String(command).trim()).filter(Boolean);
        if (cleaned.length > 20) throw new Error('A maximum of 20 bootstrap commands is allowed.');
        if (cleaned.some((command) => command.length > 2000)) throw new Error('Bootstrap commands must be 2,000 characters or fewer.');
        const result = db.query('UPDATE projects SET bootstrap_commands = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(cleaned), Date.now(), projectId);
        if (!result.changes) throw new Error('Unknown project.');
        return get(projectId);
    }

    return { discover, list, get, assignWorkspace, setBootstrapCommands, projectsRoot };
}

module.exports = { createProjectStore, isGitRepository };
