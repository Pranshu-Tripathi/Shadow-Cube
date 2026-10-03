const fs = require('fs');
const path = require('path');
const { Database } = require('bun:sqlite');
const config = require('../config');

const SCHEMA_VERSION = 1;
let singleton = null;

function readJson(filePath, fallback) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`[DEBUG] Legacy state import skipped for ${filePath}:`, error.message);
        return fallback;
    }
}

function initSchema(db) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS legacy_imports (
            source_path TEXT PRIMARY KEY,
            imported_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT,
            bootstrap_commands TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path) WHERE path IS NOT NULL;

        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            name TEXT,
            project_name TEXT,
            project_dir TEXT,
            provider TEXT NOT NULL DEFAULT 'claude',
            base_branch TEXT,
            broadcast_discord INTEGER NOT NULL DEFAULT 0,
            discord_channel_id TEXT,
            config_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            title TEXT,
            source TEXT NOT NULL DEFAULT 'web',
            provider TEXT,
            discord_thread_id TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id, created_at);

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            role TEXT,
            kind TEXT,
            title TEXT,
            content TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(conversation_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

        CREATE TABLE IF NOT EXISTS provider_sessions (
            conversation_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            session_id TEXT NOT NULL,
            channel_name TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, provider)
        );

        CREATE TABLE IF NOT EXISTS worktree_setup_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,
            output TEXT,
            created_at INTEGER NOT NULL
        );
    `);
    db.query('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(SCHEMA_VERSION, Date.now());
}

function upsertWorkspace(db, id, cfg, now = Date.now()) {
    db.query(`
        INSERT INTO workspaces (
            id, name, project_name, project_dir, provider, base_branch,
            broadcast_discord, discord_channel_id, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            project_name = excluded.project_name,
            project_dir = excluded.project_dir,
            provider = excluded.provider,
            base_branch = excluded.base_branch,
            broadcast_discord = excluded.broadcast_discord,
            discord_channel_id = excluded.discord_channel_id,
            config_json = excluded.config_json,
            updated_at = excluded.updated_at
    `).run(
        id,
        cfg.name || null,
        cfg.projectName || null,
        cfg.projectDir || null,
        cfg.provider || 'claude',
        cfg.baseBranch || null,
        cfg.broadcastDiscord ? 1 : 0,
        cfg.discordChannelId || null,
        JSON.stringify(cfg),
        now,
        now,
    );
}

function importOnce(db, sourcePath, importer) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return;
    const imported = db.query('SELECT 1 FROM legacy_imports WHERE source_path = ?').get(path.resolve(sourcePath));
    if (imported) return;

    db.transaction(() => {
        importer();
        db.query('INSERT INTO legacy_imports (source_path, imported_at) VALUES (?, ?)')
            .run(path.resolve(sourcePath), Date.now());
    })();
}

function importLegacyState(db, legacy = {}) {
    importOnce(db, legacy.channelsPath, () => {
        const channels = readJson(legacy.channelsPath, {});
        for (const [id, cfg] of Object.entries(channels)) upsertWorkspace(db, id, cfg || {});
    });

    const importSessions = (filePath, provider, key) => importOnce(db, filePath, () => {
        const sessions = readJson(filePath, { threads: {} }).threads || {};
        const statement = db.query(`
            INSERT OR IGNORE INTO provider_sessions
                (conversation_id, provider, session_id, channel_name, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const [conversationId, entry] of Object.entries(sessions)) {
            const sessionId = entry?.[key];
            if (sessionId) statement.run(conversationId, provider, sessionId, entry.channel || null, Date.now());
        }
    });
    importSessions(legacy.claudeSessionsPath, 'claude', 'claude session id');
    importSessions(legacy.codexSessionsPath, 'codex', 'codex session id');

    importOnce(db, legacy.webConversationsPath, () => {
        const data = readJson(legacy.webConversationsPath, { workspaces: {} });
        const insertConversation = db.query(`
            INSERT OR IGNORE INTO conversations
                (id, workspace_id, title, source, status, created_at, updated_at)
            VALUES (?, ?, ?, 'web', 'active', ?, ?)
        `);
        const insertMessage = db.query(`
            INSERT OR IGNORE INTO messages
                (conversation_id, message_id, role, kind, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [workspaceId, workspace] of Object.entries(data.workspaces || {})) {
            const conversations = workspace?.conversations || {};
            const ordered = Array.isArray(workspace?.order) ? workspace.order : Object.keys(conversations);
            ordered.forEach((conversationId, conversationIndex) => {
                const conversation = conversations[conversationId];
                if (!conversation) return;
                const createdAt = Number(conversation.createdAt) || Date.now() + conversationIndex;
                insertConversation.run(
                    conversationId,
                    workspaceId,
                    conversation.name || null,
                    createdAt,
                    createdAt,
                );
                (conversation.messages || []).forEach((message, messageIndex) => {
                    const at = createdAt + messageIndex;
                    insertMessage.run(
                        conversationId,
                        message.msgId || `legacy-${messageIndex}`,
                        message.role || null,
                        message.kind || null,
                        message.title || null,
                        message.content || '',
                        at,
                        at,
                    );
                });
            });
        }
    });
}

function createStateDatabase({ dbPath = config.STATE_DB_PATH, importLegacy = true, legacyPaths = {} } = {}) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    initSchema(db);
    if (importLegacy) {
        importLegacyState(db, {
            channelsPath: config.CHANNEL_CONFIG_PATH,
            claudeSessionsPath: config.SESSIONS_CONFIG_PATH,
            codexSessionsPath: path.join(config.SESSIONS_DIR, 'codex-config.json'),
            webConversationsPath: config.WEB_CONVERSATIONS_PATH,
            ...legacyPaths,
        });
    }
    return db;
}

function getDatabase() {
    if (!singleton) singleton = createStateDatabase();
    return singleton;
}

module.exports = {
    SCHEMA_VERSION,
    createStateDatabase,
    getDatabase,
    importLegacyState,
    upsertWorkspace,
};
