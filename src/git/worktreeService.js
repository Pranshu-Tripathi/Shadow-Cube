const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKTREE_EXCLUDES = ['.out/', '.skills/', '.claude/', '.memory/', '.shadow-cube-base'];

function createWorktreeService({ config, channelStore }) {
    let cachedDefaultBranch = null;

    function getDefaultBranch() {
        if (cachedDefaultBranch) return cachedDefaultBranch;
        try {
            const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: config.PROJECT_DIR, encoding: 'utf8' }).trim();
            cachedDefaultBranch = ref.replace('refs/remotes/origin/', '');
            return cachedDefaultBranch;
        } catch {
            try {
                execSync('git rev-parse --verify main', { cwd: config.PROJECT_DIR, stdio: 'ignore' });
                cachedDefaultBranch = 'main';
            } catch {
                cachedDefaultBranch = 'master';
            }
            return cachedDefaultBranch;
        }
    }

    function getBaseBranch(channelId) {
        const channelConfig = channelStore.loadChannelConfig();
        return (channelConfig[channelId] && channelConfig[channelId].baseBranch) || getDefaultBranch();
    }

    function sanitizeChannelName(name) {
        return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    function branchName(sanitizedChannel) {
        return config.BRANCH_PREFIX ? `${config.BRANCH_PREFIX}/${sanitizedChannel}` : sanitizedChannel;
    }

    function getWorktreeInfo(channelName) {
        const sanitized = sanitizeChannelName(channelName);
        return {
            sanitized,
            worktreePath: path.join(config.WORKTREES_BASE, sanitized),
            branch: branchName(sanitized),
        };
    }

    function setupWorktreeScaffolding(worktreePath) {
        try {
            fs.mkdirSync(path.join(worktreePath, '.out'), { recursive: true });
        } catch (e) {
            console.error(`[DEBUG] Failed to create .out in ${worktreePath}:`, e.message);
        }

        try {
            const rel = execSync('git rev-parse --git-path info/exclude', { cwd: worktreePath, encoding: 'utf8' }).trim();
            const excludePath = path.isAbsolute(rel) ? rel : path.join(worktreePath, rel);
            let existing = '';
            try { existing = fs.readFileSync(excludePath, 'utf8'); } catch { }
            const present = new Set(existing.split('\n').map(l => l.trim()));
            const missing = WORKTREE_EXCLUDES.filter(l => !present.has(l));
            if (missing.length) {
                fs.mkdirSync(path.dirname(excludePath), { recursive: true });
                const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
                fs.appendFileSync(excludePath, `${prefix}${missing.join('\n')}\n`);
                console.log(`[DEBUG] Added excludes [${missing.join(', ')}] to ${excludePath}`);
            }
        } catch (e) {
            console.error(`[DEBUG] Failed to set up excludes in ${worktreePath}:`, e.message);
        }
    }

    function createWorktree(worktreePath, branch, baseBranch) {
        try {
            if (!fs.existsSync(config.WORKTREES_BASE)) fs.mkdirSync(config.WORKTREES_BASE, { recursive: true });

            try {
                execSync(`git worktree add -b "${branch}" "${worktreePath}" "${baseBranch}"`, { cwd: config.PROJECT_DIR, encoding: 'utf8', stdio: 'pipe' });
            } catch (e) {
                if (e.stderr && e.stderr.includes('already exists')) {
                    execSync(`git worktree add "${worktreePath}" "${branch}"`, { cwd: config.PROJECT_DIR, encoding: 'utf8', stdio: 'pipe' });
                } else {
                    throw e;
                }
            }

            fs.writeFileSync(path.join(worktreePath, '.shadow-cube-base'), baseBranch);
            setupWorktreeScaffolding(worktreePath);

            console.log(`[DEBUG] Created worktree: ${worktreePath} (branch: ${branch}, base: ${baseBranch})`);
            return worktreePath;
        } catch (e) {
            console.error(`[DEBUG] Failed to create worktree, falling back to PROJECT_DIR:`, e.message);
            return config.PROJECT_DIR;
        }
    }

    function ensureWorktree(channelName, baseBranch) {
        const { worktreePath, branch } = getWorktreeInfo(channelName);

        if (fs.existsSync(worktreePath)) {
            try {
                execSync('git rev-parse --git-dir', { cwd: worktreePath, stdio: 'pipe' });
            } catch {
                console.log(`[DEBUG] Worktree directory exists but is not a valid git worktree. Removing and recreating.`);
                fs.rmSync(worktreePath, { recursive: true, force: true });
                return createWorktree(worktreePath, branch, baseBranch);
            }

            const markerPath = path.join(worktreePath, '.shadow-cube-base');
            if (fs.existsSync(markerPath)) {
                const existingBase = fs.readFileSync(markerPath, 'utf8').trim();
                if (existingBase !== baseBranch) {
                    console.log(`[DEBUG] Worktree base mismatch: existing=${existingBase}, requested=${baseBranch}. Rebasing.`);
                    try {
                        rebaseWorktreeOnto(worktreePath, baseBranch);
                        console.log(`[DEBUG] Rebased worktree ${worktreePath} onto ${baseBranch}`);
                    } catch (e) {
                        try { execSync('git rebase --abort', { cwd: worktreePath, stdio: 'pipe' }); } catch { }
                        console.error(`[DEBUG] Failed to rebase worktree onto ${baseBranch}:`, e.message);
                    }
                }
            }
            setupWorktreeScaffolding(worktreePath);
            console.log(`[DEBUG] Worktree already exists: ${worktreePath}`);
            return worktreePath;
        }

        return createWorktree(worktreePath, branch, baseBranch);
    }

    function rebaseWorktreeOnto(worktreePath, branch) {
        execSync(`git fetch origin ${branch}`, { cwd: worktreePath, stdio: 'pipe' });
        execSync(`git rebase origin/${branch}`, { cwd: worktreePath, stdio: 'pipe' });
        fs.writeFileSync(path.join(worktreePath, '.shadow-cube-base'), branch);
    }

    function rebaseExistingWorktree(channelName, branch) {
        const { sanitized, worktreePath } = getWorktreeInfo(channelName);
        if (!fs.existsSync(worktreePath)) return '';

        try {
            rebaseWorktreeOnto(worktreePath, branch);
            console.log(`[DEBUG] Rebased worktree ${worktreePath} onto ${branch}`);
            return `\nExisting worktree \`${sanitized}\` has been rebased onto \`${branch}\`.`;
        } catch (e) {
            try { execSync('git rebase --abort', { cwd: worktreePath, stdio: 'pipe' }); } catch { }
            console.error(`[DEBUG] Failed to rebase worktree:`, e.message);
            return `\n⚠️ Failed to rebase worktree \`${sanitized}\` onto \`${branch}\`: ${e.message}\nYou may need to \`!reset ${channelName}\` and start fresh.`;
        }
    }

    function removeWorktree(channelName) {
        const { worktreePath, branch } = getWorktreeInfo(channelName);

        try {
            execSync(`git worktree remove "${worktreePath}" --force`, { cwd: config.PROJECT_DIR, stdio: 'pipe' });
            console.log(`[DEBUG] Removed worktree: ${worktreePath}`);
        } catch (e) {
            console.error(`[DEBUG] Failed to remove worktree:`, e.message);
            return false;
        }

        try {
            execSync(`git branch -d "${branch}"`, { cwd: config.PROJECT_DIR, stdio: 'pipe' });
        } catch { }

        return true;
    }

    function listActiveWorktrees() {
        const output = execSync('git worktree list', { cwd: config.PROJECT_DIR, encoding: 'utf8' });
        const lines = output.trim().split('\n');
        return config.BRANCH_PREFIX ? lines.filter(l => l.includes(`${config.BRANCH_PREFIX}/`)) : lines.filter(l => l !== lines[0]);
    }

    function deployWorktree(channelName, userMsg) {
        const { worktreePath, branch } = getWorktreeInfo(channelName);
        if (!fs.existsSync(worktreePath)) return { missing: true, branch };

        const status = execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf8' }).trim();
        if (!status) return { empty: true, branch };

        execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });

        const commitMsg = userMsg || `Deploy from Discord (${channelName}) - ${new Date().toISOString().slice(0, 19)}`;
        execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: worktreePath, encoding: 'utf8', stdio: 'pipe' });

        const hash = execSync('git rev-parse --short HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();
        return {
            branch,
            hash,
            changedFiles: status.split('\n').length,
            commitMsg,
        };
    }

    function pushWorktree(channelName) {
        const { worktreePath, branch } = getWorktreeInfo(channelName);
        if (!fs.existsSync(worktreePath)) return { missing: true, branch };

        execSync(`git push -u origin ${branch}`, { cwd: worktreePath, encoding: 'utf8', stdio: 'pipe' });
        return { branch };
    }

    function fetchRemoteBranch(branch) {
        try {
            execSync(`git fetch origin ${branch}`, { cwd: config.PROJECT_DIR, stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    return {
        getDefaultBranch,
        getBaseBranch,
        sanitizeChannelName,
        branchName,
        getWorktreeInfo,
        setupWorktreeScaffolding,
        createWorktree,
        ensureWorktree,
        removeWorktree,
        listActiveWorktrees,
        rebaseExistingWorktree,
        deployWorktree,
        pushWorktree,
        fetchRemoteBranch,
    };
}

module.exports = {
    createWorktreeService,
};
