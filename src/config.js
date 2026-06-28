const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const BRANCH_PREFIX = process.env.BRANCH_PREFIX != null ? process.env.BRANCH_PREFIX : 'shadow-cube';
const GITHUB_PAT = process.env.GITHUB_PAT;

const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions');
const SESSIONS_CONFIG_PATH = path.join(SESSIONS_DIR, 'config.json');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const CHANNEL_CONFIG_PATH = path.join(CONFIG_DIR, 'channels.json');
const WORKTREES_BASE = process.env.WORKTREES_DIR || path.join(PROJECT_DIR, '..', '.shadow-cube-worktrees');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanupLegacySessionFiles() {
    try {
        const legacyFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.txt'));
        for (const f of legacyFiles) {
            fs.unlinkSync(path.join(SESSIONS_DIR, f));
        }
        if (legacyFiles.length > 0) console.log(`[DEBUG] Cleaned up ${legacyFiles.length} legacy session .txt files`);
    } catch { }
}

ensureDir(SESSIONS_DIR);
cleanupLegacySessionFiles();
ensureDir(CONFIG_DIR);

module.exports = {
    ROOT_DIR,
    DISCORD_TOKEN,
    PROJECT_DIR,
    BRANCH_PREFIX,
    GITHUB_PAT,
    SESSIONS_DIR,
    SESSIONS_CONFIG_PATH,
    CONFIG_DIR,
    CHANNEL_CONFIG_PATH,
    WORKTREES_BASE,
};
