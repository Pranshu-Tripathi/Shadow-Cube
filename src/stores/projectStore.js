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
            SELECT p.id, p.name, p.path,
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
        }));
    }

    function get(projectId) {
        const project = db.query('SELECT id, name, path FROM projects WHERE id = ?').get(projectId);
        return project ? { id: project.id, name: project.name, path: project.path || null } : null;
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

    return { discover, list, get, assignWorkspace, projectsRoot };
}

module.exports = { createProjectStore, isGitRepository };
