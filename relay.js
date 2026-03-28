const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURATION ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd();
const BRANCH_PREFIX = process.env.BRANCH_PREFIX != null ? process.env.BRANCH_PREFIX : 'shadow-cube';

if (!DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is required. Set it in your .env file.');
    process.exit(1);
}

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);
const SESSIONS_CONFIG_PATH = path.join(SESSIONS_DIR, 'config.json');

function loadSessionsConfig() {
    try {
        if (!fs.existsSync(SESSIONS_CONFIG_PATH)) return { threads: {} };
        return JSON.parse(fs.readFileSync(SESSIONS_CONFIG_PATH, 'utf8'));
    } catch {
        return { threads: {} };
    }
}

function saveSessionsConfig(config) {
    fs.writeFileSync(SESSIONS_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getSessionId(threadId) {
    const config = loadSessionsConfig();
    const entry = config.threads[threadId];
    return entry ? entry['claude session id'] : '';
}

function setSessionId(threadId, sessionId, channelName) {
    const config = loadSessionsConfig();
    config.threads[threadId] = {
        'claude session id': sessionId,
        'channel': channelName
    };
    saveSessionsConfig(config);
}

function clearSession(threadId) {
    const config = loadSessionsConfig();
    delete config.threads[threadId];
    saveSessionsConfig(config);
}

const CONFIG_DIR = path.join(__dirname, 'config');
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR);
const CHANNEL_CONFIG_PATH = path.join(CONFIG_DIR, 'channels.json');

const WORKTREES_BASE = process.env.WORKTREES_DIR || path.join(PROJECT_DIR, '..', '.shadow-cube-worktrees');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});

// Map threadId -> { child, stdin writable }
const activeProcesses = new Map();

// --- 2. UTILS ---
const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
const stripDiscordTags = (str) => str.replace(/<[^>]+>/g, '').trim();

const MAX_MSG_LEN = 1950;

function prettifyCodeBlocks(text) {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        if (!lang) lang = detectLanguage(code);
        const cleanCode = code.replace(/\n{3,}/g, '\n\n').trim();
        return `\`\`\`${lang}\n${cleanCode}\n\`\`\``;
    });
}

function detectLanguage(code) {
    const trimmed = code.trim();
    if (/^(import|from|def |class |if __name__)/.test(trimmed)) return 'python';
    if (/^(const |let |var |function |import |export |=>|async )/.test(trimmed)) return 'javascript';
    if (/^(interface |type |enum |const \w+:\s)/.test(trimmed)) return 'typescript';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(trimmed)) return 'sql';
    if (/^(\$|#!\/)/.test(trimmed) || /\b(echo|cd|mkdir|rm|grep|awk|sed)\b/.test(trimmed)) return 'bash';
    if (/^<[!a-zA-Z]/.test(trimmed)) return 'html';
    if (/^\{[\s\n]*"/.test(trimmed)) return 'json';
    if (/^(package |func |import \()/.test(trimmed)) return 'go';
    if (/^(use |fn |let mut |pub |impl )/.test(trimmed)) return 'rust';
    return '';
}

function splitForDiscord(text) {
    if (text.length <= MAX_MSG_LEN) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= MAX_MSG_LEN) {
            chunks.push(remaining);
            break;
        }

        let cutPoint = MAX_MSG_LEN;
        const lastNewline = remaining.lastIndexOf('\n', cutPoint);
        if (lastNewline > cutPoint * 0.5) cutPoint = lastNewline;

        let chunk = remaining.slice(0, cutPoint);
        remaining = remaining.slice(cutPoint);

        const openTicks = (chunk.match(/```/g) || []).length;
        if (openTicks % 2 !== 0) {
            chunk += '\n```';
            remaining = '```\n' + remaining;
        }

        chunks.push(chunk);
    }

    return chunks;
}

function getLatestSessionId(sessionIndexPath) {
    try {
        if (!fs.existsSync(sessionIndexPath)) return null;
        const data = JSON.parse(fs.readFileSync(sessionIndexPath, 'utf8'));
        if (!data.entries || data.entries.length === 0) return null;
        const sorted = data.entries.sort((a, b) => b.fileMtime - a.fileMtime);
        return sorted[0].sessionId;
    } catch (e) {
        console.error("[DEBUG] Failed to read session index:", e.message);
        return null;
    }
}

// --- CHANNEL CONFIG ---
function loadChannelConfig() {
    try {
        if (!fs.existsSync(CHANNEL_CONFIG_PATH)) return {};
        return JSON.parse(fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveChannelConfig(config) {
    fs.writeFileSync(CHANNEL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- WORKTREE UTILS ---
let cachedDefaultBranch = null;

function getDefaultBranch() {
    if (cachedDefaultBranch) return cachedDefaultBranch;
    try {
        const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
        cachedDefaultBranch = ref.replace('refs/remotes/origin/', '');
        return cachedDefaultBranch;
    } catch {
        // Fallback: check if main or master exists
        try {
            execSync('git rev-parse --verify main', { cwd: PROJECT_DIR, stdio: 'ignore' });
            cachedDefaultBranch = 'main';
        } catch {
            cachedDefaultBranch = 'master';
        }
        return cachedDefaultBranch;
    }
}

function getBaseBranch(channelId) {
    const config = loadChannelConfig();
    return (config[channelId] && config[channelId].baseBranch) || getDefaultBranch();
}

function sanitizeChannelName(name) {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function branchName(sanitizedChannel) {
    return BRANCH_PREFIX ? `${BRANCH_PREFIX}/${sanitizedChannel}` : sanitizedChannel;
}

function ensureWorktree(channelName, baseBranch) {
    const sanitized = sanitizeChannelName(channelName);
    const worktreePath = path.join(WORKTREES_BASE, sanitized);
    const branch = branchName(sanitized);

    if (fs.existsSync(worktreePath)) {
        console.log(`[DEBUG] Worktree already exists: ${worktreePath}`);
        return worktreePath;
    }

    try {
        if (!fs.existsSync(WORKTREES_BASE)) fs.mkdirSync(WORKTREES_BASE, { recursive: true });

        try {
            execSync(`git worktree add -b "${branch}" "${worktreePath}" "${baseBranch}"`, { cwd: PROJECT_DIR, encoding: 'utf8', stdio: 'pipe' });
        } catch (e) {
            if (e.stderr && e.stderr.includes('already exists')) {
                execSync(`git worktree add "${worktreePath}" "${branch}"`, { cwd: PROJECT_DIR, encoding: 'utf8', stdio: 'pipe' });
            } else {
                throw e;
            }
        }

        console.log(`[DEBUG] Created worktree: ${worktreePath} (branch: ${branch}, base: ${baseBranch})`);
        return worktreePath;
    } catch (e) {
        console.error(`[DEBUG] Failed to create worktree, falling back to PROJECT_DIR:`, e.message);
        return PROJECT_DIR;
    }
}

function removeWorktree(channelName) {
    const sanitized = sanitizeChannelName(channelName);
    const worktreePath = path.join(WORKTREES_BASE, sanitized);
    const branch = branchName(sanitized);

    try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: PROJECT_DIR, stdio: 'pipe' });
        console.log(`[DEBUG] Removed worktree: ${worktreePath}`);
    } catch (e) {
        console.error(`[DEBUG] Failed to remove worktree:`, e.message);
        return false;
    }

    try {
        execSync(`git branch -d "${branch}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch {
        // Branch may not exist or may have unmerged changes, that's ok
    }

    return true;
}

function getParentChannelName(channel) {
    if (channel.isThread() && channel.parent) {
        return channel.parent.name;
    }
    return channel.name;
}

function getParentChannelId(channel) {
    if (channel.isThread() && channel.parentId) {
        return channel.parentId;
    }
    return channel.id;
}

client.on(Events.ClientReady, () => {
    console.log('--------------------------------------------------');
    console.log(`[DEBUG] SHADOW CUBE V3.2 (STREAMING + WORKTREES) ONLINE`);
    console.log(`[DEBUG] PROJECT_DIR: ${PROJECT_DIR}`);
    console.log(`[DEBUG] WORKTREES_BASE: ${WORKTREES_BASE}`);
    console.log('--------------------------------------------------');
});

// --- 3. THE EXECUTOR ---
function runClaude(prompt, targetChannel) {
    const threadId = targetChannel.id;
    let sessionId = getSessionId(threadId);

    // Resolve worktree for this channel
    const channelName = getParentChannelName(targetChannel);
    const channelId = getParentChannelId(targetChannel);
    const baseBranch = getBaseBranch(channelId);
    const activeCwd = ensureWorktree(channelName, baseBranch);

    // Derive session index path from the active working directory
    const activePathKey = activeCwd.replace(/\//g, '-');
    const sessionIndexPath = path.join(
        process.env.HOME,
        `.claude/projects/${activePathKey}/sessions-index.json`
    );

    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--dangerously-skip-permissions'];
    if (sessionId) {
        args.push('--resume', sessionId);
    }

    console.log(`[DEBUG] [Thread: ${threadId}] SPAWNING CLAUDE in ${activeCwd} (branch: ${branchName(sanitizeChannelName(channelName))})...`);
    // Keep stdin as pipe so we can send permission approvals from Discord
    const child = spawn('claude', args, { cwd: activeCwd });

    activeProcesses.set(threadId, child);

    let thinkingBuffer = '';
    let textBuffer = '';
    let currentBlockType = null;
    let currentToolName = null;
    let toolInputBuffer = '';
    let thinkingMessage = null;
    let textMessage = null;
    let resultSessionId = null;
    let lineBuffer = '';
    let hasOutput = false;

    let thinkingEditTimer = null;
    let textEditTimer = null;
    const EDIT_INTERVAL = 1500;

    async function sendOrEditThinking(final = false, snapshot = null) {
        const text = snapshot || thinkingBuffer;
        if (!text.trim()) return;
        hasOutput = true;

        const header = final ? '**Thinking** (complete)' : '**Thinking...**';
        let thinkingText = text.trim();
        const maxThinkingLen = MAX_MSG_LEN - header.length - 20;
        if (thinkingText.length > maxThinkingLen) {
            if (!final) {
                thinkingText = '...' + thinkingText.slice(-maxThinkingLen);
            }
        }

        const lines = thinkingText.split('\n').map(l => `> ${l}`).join('\n');
        const content = `${header}\n${lines}`;
        const chunks = splitForDiscord(content);

        try {
            if (!thinkingMessage) {
                thinkingMessage = await targetChannel.send(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await targetChannel.send(chunks[i]);
                }
            } else {
                await thinkingMessage.edit(chunks[0]);
            }
        } catch (e) {
            console.error('[DEBUG] Failed to send/edit thinking:', e.message);
        }
    }

    async function sendOrEditText(final = false, snapshot = null) {
        const text = snapshot || textBuffer;
        if (!text.trim()) return;
        hasOutput = true;

        let content = prettifyCodeBlocks(text.trim());
        const chunks = splitForDiscord(content);

        try {
            if (!textMessage) {
                textMessage = await targetChannel.send(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await targetChannel.send(chunks[i]);
                }
            } else if (final) {
                await textMessage.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await targetChannel.send(chunks[i]);
                }
            } else {
                let preview = content;
                if (preview.length > MAX_MSG_LEN) {
                    preview = content.slice(0, MAX_MSG_LEN - 10) + '\n...';
                    const openTicks = (preview.match(/```/g) || []).length;
                    if (openTicks % 2 !== 0) preview += '\n```';
                }
                await textMessage.edit(preview);
            }
        } catch (e) {
            console.error('[DEBUG] Failed to send/edit text:', e.message);
        }
    }

    function formatToolUse(toolName, inputJson) {
        const stripCwd = (p) => p.replace(activeCwd + '/', '').replace(PROJECT_DIR + '/', '');
        try {
            const input = JSON.parse(inputJson);
            if (toolName === 'Edit') {
                const file = input.file_path ? stripCwd(input.file_path) : '?';
                let msg = `**Edit:** \`${file}\`\n`;
                if (input.old_string && input.new_string) {
                    const diffLines = [];
                    input.old_string.split('\n').forEach(l => diffLines.push(`- ${l}`));
                    input.new_string.split('\n').forEach(l => diffLines.push(`+ ${l}`));
                    msg += `\`\`\`diff\n${diffLines.join('\n')}\n\`\`\``;
                }
                return msg;
            }
            if (toolName === 'Write') {
                const file = input.file_path ? stripCwd(input.file_path) : '?';
                let msg = `**Write:** \`${file}\`\n`;
                if (input.content) {
                    const lang = detectLanguage(input.content);
                    const preview = input.content.length > 800 ? input.content.slice(0, 800) + '\n...' : input.content;
                    msg += `\`\`\`${lang}\n${preview}\n\`\`\``;
                }
                return msg;
            }
            if (toolName === 'Read') {
                const file = input.file_path ? stripCwd(input.file_path) : '?';
                return `**Read:** \`${file}\``;
            }
            if (toolName === 'Bash') {
                return `**Bash:**\n\`\`\`bash\n${input.command || input.description || '?'}\n\`\`\``;
            }
            if (toolName === 'Glob') {
                return `**Glob:** \`${input.pattern || '?'}\``;
            }
            if (toolName === 'Grep') {
                return `**Grep:** \`${input.pattern || '?'}\`${input.path ? ` in \`${stripCwd(input.path)}\`` : ''}`;
            }
            // Default: just show tool name
            return `**Tool:** \`${toolName}\``;
        } catch {
            return `**Tool:** \`${toolName}\``;
        }
    }

    async function sendToolUse(toolName, inputJson) {
        const formatted = formatToolUse(toolName, inputJson);
        const chunks = splitForDiscord(formatted);
        for (const chunk of chunks) {
            await targetChannel.send(chunk).catch(console.error);
        }
        hasOutput = true;
    }

    function processLine(line) {
        if (!line.trim()) return;

        let data;
        try {
            data = JSON.parse(line);
        } catch {
            return;
        }

        // Handle stream events (deltas)
        if (data.type === 'stream_event' && data.event) {
            const evt = data.event;

            if (evt.type === 'content_block_start' && evt.content_block) {
                currentBlockType = evt.content_block.type;
                if (currentBlockType === 'tool_use') {
                    currentToolName = evt.content_block.name || null;
                    toolInputBuffer = '';
                }
            }

            if (evt.type === 'content_block_delta' && evt.delta) {
                if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                    thinkingBuffer += evt.delta.thinking;
                    clearTimeout(thinkingEditTimer);
                    thinkingEditTimer = setTimeout(() => sendOrEditThinking(false), EDIT_INTERVAL);
                }
                if (evt.delta.type === 'text_delta' && evt.delta.text) {
                    textBuffer += evt.delta.text;
                    clearTimeout(textEditTimer);
                    textEditTimer = setTimeout(() => sendOrEditText(false), EDIT_INTERVAL);
                }
                if (evt.delta.type === 'input_json_delta' && evt.delta.partial_json) {
                    toolInputBuffer += evt.delta.partial_json;
                }
            }

            if (evt.type === 'content_block_stop') {
                if (currentBlockType === 'thinking') {
                    clearTimeout(thinkingEditTimer);
                    const snap = thinkingBuffer;
                    thinkingBuffer = '';
                    thinkingMessage = null;
                    sendOrEditThinking(true, snap);
                }
                if (currentBlockType === 'text') {
                    clearTimeout(textEditTimer);
                    const snap = textBuffer;
                    textBuffer = '';
                    textMessage = null;
                    sendOrEditText(true, snap);
                }
                if (currentBlockType === 'tool_use' && currentToolName) {
                    sendToolUse(currentToolName, toolInputBuffer);
                    currentToolName = null;
                    toolInputBuffer = '';
                }
                currentBlockType = null;
            }
        }

        // Capture session ID from result
        if (data.type === 'result') {
            resultSessionId = data.session_id;
            if (data.total_cost_usd) {
                const cost = `*Cost: $${data.total_cost_usd.toFixed(4)} | Turns: ${data.num_turns || 1}*`;
                targetChannel.send(cost).catch(console.error);
            }
        }
    }

    child.stdout.on('data', (rawData) => {
        lineBuffer += rawData.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
            processLine(line);
        }
    });

    child.stderr.on('data', (data) => {
        const text = stripAnsi(data.toString()).trim();
        if (text && !text.includes('no stdin data received')) {
            console.error(`[DEBUG] [Thread: ${threadId}] STDERR: ${text}`);
        }
    });

    child.on('close', (code) => {
        if (lineBuffer.trim()) {
            processLine(lineBuffer);
            lineBuffer = '';
        }

        clearTimeout(thinkingEditTimer);
        clearTimeout(textEditTimer);

        (async () => {
            if (thinkingBuffer.trim()) await sendOrEditThinking(true);
            if (textBuffer.trim()) await sendOrEditText(true);

            if (!hasOutput) {
                targetChannel.send('*(No output received)*').catch(console.error);
            }
        })();

        activeProcesses.delete(threadId);
        console.log(`[DEBUG] [Thread: ${threadId}] PROCESS EXITED (Code: ${code})`);

        const sid = resultSessionId || getLatestSessionId(sessionIndexPath);
        if (sid) {
            setSessionId(threadId, sid, channelName);
        }
    });
}

// --- 4. THE HANDLER ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const cleanPrompt = stripDiscordTags(message.content);
    const threadId = message.channel.isThread() ? message.channel.id : null;

    // --- !base command ---
    const baseMatch = cleanPrompt.match(/^!base\s+(.+)$/i);
    if (baseMatch) {
        const branch = baseMatch[1].trim();
        const channelId = getParentChannelId(message.channel);
        const config = loadChannelConfig();
        config[channelId] = { ...(config[channelId] || {}), baseBranch: branch };
        saveChannelConfig(config);
        return message.reply(`**Base branch set to \`${branch}\` for this channel.** New worktrees will branch from it.`);
    }

    // --- !worktrees command ---
    if (/^!worktrees?$/i.test(cleanPrompt)) {
        try {
            const output = execSync('git worktree list', { cwd: PROJECT_DIR, encoding: 'utf8' });
            const lines = output.trim().split('\n');
            const worktreeLines = BRANCH_PREFIX ? lines.filter(l => l.includes(`${BRANCH_PREFIX}/`)) : lines.filter(l => l !== lines[0]);
            if (worktreeLines.length === 0) {
                return message.reply('**No active worktrees.**');
            }
            const formatted = worktreeLines.map(l => `\`${l}\``).join('\n');
            return message.reply(`**Active worktrees:**\n${formatted}`);
        } catch (e) {
            return message.reply(`**Failed to list worktrees:** ${e.message}`);
        }
    }

    // --- !deploy command ---
    const deployMatch = cleanPrompt.match(/^!deploy\s*(.*)$/i);
    if (deployMatch) {
        const channelName = getParentChannelName(message.channel);
        const sanitized = sanitizeChannelName(channelName);
        const worktreePath = path.join(WORKTREES_BASE, sanitized);
        const branch = branchName(sanitized);

        if (!fs.existsSync(worktreePath)) {
            return message.reply(`**No worktree found for this channel.** Send a message first to create one.`);
        }

        try {
            // Check for changes
            const status = execSync('git status --porcelain', { cwd: worktreePath, encoding: 'utf8' }).trim();
            if (!status) {
                return message.reply(`**Nothing to deploy.** No uncommitted changes on \`${branch}\`.`);
            }

            // Stage all changes
            execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });

            // Build commit message
            const userMsg = deployMatch[1].trim();
            const commitMsg = userMsg || `Deploy from Discord (${channelName}) - ${new Date().toISOString().slice(0, 19)}`;

            execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: worktreePath, encoding: 'utf8', stdio: 'pipe' });

            // Get short hash of new commit
            const hash = execSync('git rev-parse --short HEAD', { cwd: worktreePath, encoding: 'utf8' }).trim();

            const changedFiles = status.split('\n').length;
            return message.reply(`**Deployed to \`${branch}\`** (\`${hash}\`)\n${changedFiles} file(s) changed\nMessage: *${commitMsg}*`);
        } catch (e) {
            return message.reply(`**Deploy failed:** ${e.message}`);
        }
    }

    // --- !clear command ---
    const clearWithWorktree = cleanPrompt.match(/^!clear\s*(--worktree|-w)?$/i);
    if (clearWithWorktree && threadId) {
        clearSession(threadId);
        if (activeProcesses.has(threadId)) {
            activeProcesses.get(threadId).kill();
            activeProcesses.delete(threadId);
        }

        let extra = '';
        if (clearWithWorktree[1]) {
            const channelName = getParentChannelName(message.channel);
            const removed = removeWorktree(channelName);
            extra = removed ? ' Worktree removed.' : ' Failed to remove worktree.';
        }

        return message.reply(`**Thread session cleared & process killed.${extra}** Next message will start fresh.`);
    }

    if (!cleanPrompt) return;

    // --- If there's an active process in this thread, pipe input to stdin (approvals, follow-ups) ---
    if (threadId && activeProcesses.has(threadId)) {
        const child = activeProcesses.get(threadId);
        if (child.stdin && !child.stdin.destroyed) {
            console.log(`[DEBUG] Piping Discord input to Claude stdin in ${threadId}: "${cleanPrompt}"`);
            child.stdin.write(cleanPrompt + '\n');
            await message.react('📨');
        } else {
            console.log(`[DEBUG] stdin closed for ${threadId}, starting new process`);
            activeProcesses.delete(threadId);
            await message.react('⚙️');
            runClaude(cleanPrompt, message.channel);
        }
        return;
    }

    // --- Create thread for new queries ---
    let targetChannel = message.channel;
    if (!message.channel.isThread() && message.guild) {
        try {
            const thread = await message.startThread({
                name: cleanPrompt.substring(0, 50),
                autoArchiveDuration: 60,
            });
            console.log(`[DEBUG] Thread created: ${thread.id} (${thread.name})`);
            targetChannel = thread;
        } catch (e) {
            console.error(`[DEBUG] Failed to create thread, using channel:`, e.message);
            // Fallback: reply in channel
        }
    }

    await message.react('⚙️');
    runClaude(cleanPrompt, targetChannel);
});

client.login(DISCORD_TOKEN);
