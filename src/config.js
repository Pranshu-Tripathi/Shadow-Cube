const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const BRANCH_PREFIX = process.env.BRANCH_PREFIX != null ? process.env.BRANCH_PREFIX : 'shadow-cube';
const GITHUB_PAT = process.env.GITHUB_PAT;
const WEB_PORT = Number(process.env.WEB_PORT || 8200);
// Guild the web notebook creates Discord mirror channels in. Optional — defaults to
// the first guild the bot is a member of.
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || null;
const WEB_ENABLED = process.env.WEB_ENABLED !== '0' && process.env.WEB_ENABLED !== 'false';

const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions');
const SESSIONS_CONFIG_PATH = path.join(SESSIONS_DIR, 'config.json');
const WEB_CONVERSATIONS_PATH = path.join(SESSIONS_DIR, 'web-conversations.json');
const STATE_DB_PATH = process.env.STATE_DB_PATH || path.join(SESSIONS_DIR, 'shadow-cube.sqlite');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const CHANNEL_CONFIG_PATH = path.join(CONFIG_DIR, 'channels.json');
const WORKTREES_ROOT = process.env.WORKTREES_DIR || '/Users/tripathi/Desktop/development/code/worktrees';

const VOCABULARY_PATH = path.join(CONFIG_DIR, 'vocabulary.txt');
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL
    || path.join(os.homedir(), '.cache', 'whisper.cpp', 'ggml-large-v3-turbo-q5_0.bin');
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'en';
const VOICE_AUTO_SEND_MS = Number(process.env.VOICE_AUTO_SEND_MS || 15000);
const VOICE_MAX_DURATION_SEC = Number(process.env.VOICE_MAX_DURATION_SEC || 600);
const VOICE_MAX_BYTES = Number(process.env.VOICE_MAX_BYTES || 25 * 1024 * 1024);
// Small and fast beats smart here: the job is proof-reading, and a slow model would
// eat the auto-send window. Set to an empty string to skip the cleanup pass entirely.
const VOICE_CLEANUP_MODEL = process.env.VOICE_CLEANUP_MODEL != null
    ? process.env.VOICE_CLEANUP_MODEL
    : 'gemma3:1b';
const VOICE_CLEANUP_KEEP_ALIVE = process.env.VOICE_CLEANUP_KEEP_ALIVE || '30m';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

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

// config/ is runtime state and gitignored, so seed the editable glossary from the
// checked-in example the first time the bot runs. Never overwrite the user's copy.
function seedVocabulary() {
    try {
        if (fs.existsSync(VOCABULARY_PATH)) return;
        const example = path.join(ROOT_DIR, 'vocabulary.example.txt');
        if (!fs.existsSync(example)) return;
        fs.copyFileSync(example, VOCABULARY_PATH);
        console.log(`[DEBUG] Seeded ${VOCABULARY_PATH} from vocabulary.example.txt`);
    } catch (e) {
        console.error('[DEBUG] Failed to seed vocabulary.txt:', e.message);
    }
}

ensureDir(SESSIONS_DIR);
cleanupLegacySessionFiles();
ensureDir(CONFIG_DIR);
seedVocabulary();

module.exports = {
    ROOT_DIR,
    DISCORD_TOKEN,
    PROJECT_DIR,
    BRANCH_PREFIX,
    GITHUB_PAT,
    WEB_PORT,
    WEB_ENABLED,
    DISCORD_GUILD_ID,
    SESSIONS_DIR,
    SESSIONS_CONFIG_PATH,
    WEB_CONVERSATIONS_PATH,
    STATE_DB_PATH,
    CONFIG_DIR,
    CHANNEL_CONFIG_PATH,
    WORKTREES_ROOT,
    VOCABULARY_PATH,
    FFMPEG_BIN,
    WHISPER_BIN,
    WHISPER_MODEL,
    WHISPER_LANGUAGE,
    VOICE_AUTO_SEND_MS,
    VOICE_MAX_DURATION_SEC,
    VOICE_MAX_BYTES,
    VOICE_CLEANUP_MODEL,
    VOICE_CLEANUP_KEEP_ALIVE,
    OLLAMA_HOST,
};
