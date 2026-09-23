// The bridge unifies the two ways a conversation can be driven — the web notebook
// and Discord — onto one keying scheme so they stay in sync:
//
//   workspace  = a channel config entry (Discord channel id, or a web:… id)
//   conversation (convId) = the session key. For Discord-native threads it IS the
//                thread id; for web-created chats it's a client id (conv-…).
//
// Every run goes through dispatch(), which builds a sink that fans out to the web
// (always) and to Discord (when broadcasting, or when the conversation already lives
// in a Discord thread). Inbound Discord messages in a bound mirror thread are routed
// back to the same convId, so you can talk from either side.

const { ChannelType } = require('discord.js');
const { createWebSink } = require('../transport/webSink');
const { createFanoutSink } = require('../transport/fanoutSink');
const { createDiscordSink } = require('../transport/sink');

function createWebBridge(context, hub) {
    const { channelStore, worktrees, agentRouter, activeProcesses, claudeStdio, client, config } = context;

    function cfgFor(workspaceId) {
        return channelStore.loadChannelConfig()[workspaceId] || {};
    }

    function getWorkspaceName(workspaceId) {
        const cfg = cfgFor(workspaceId);
        if (cfg.name) return cfg.name;
        const ch = client?.channels?.cache?.get(workspaceId);
        return ch?.name || workspaceId;
    }

    function echoUser(workspaceId, convId, content) {
        hub.broadcast({ type: 'message.create', workspaceId, convId, msgId: hub.nextMsgId(), role: 'user', content });
    }

    async function fetchChannel(id) {
        if (!client || !id) return null;
        return client.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
    }

    // Resolve the Discord text channel that mirrors a workspace. A Discord-originated
    // workspace *is* a channel already, so it mirrors to itself — no creation (and no
    // Manage Channels permission) required. Only web:… workspaces get a new channel.
    async function ensureMirrorChannel(workspaceId) {
        const cfg = cfgFor(workspaceId);
        if (cfg.discordChannelId) {
            const existing = await fetchChannel(cfg.discordChannelId);
            if (existing) return existing.id;
        }
        if (!client || !config.DISCORD_TOKEN) throw new Error('Discord is not connected (no token).');

        // Non-web workspace ids are real Discord channel ids — use the channel itself.
        if (!workspaceId.startsWith('web:')) {
            const own = await fetchChannel(workspaceId);
            if (own) {
                channelStore.updateChannel(workspaceId, { discordChannelId: workspaceId });
                return workspaceId;
            }
        }

        const guild = config.DISCORD_GUILD_ID
            ? await client.guilds.fetch(config.DISCORD_GUILD_ID).catch(() => null)
            : client.guilds.cache.first();
        if (!guild) throw new Error('Bot is not in any Discord guild.');

        const wantName = worktrees.sanitizeChannelName(getWorkspaceName(workspaceId)) || 'shadow-cube';

        // Reuse a channel with the same name if one already exists (e.g. you created it
        // by hand), so we don't need the "Manage Channels" permission to create one.
        try {
            const existing = (await guild.channels.fetch()).find(
                (c) => c && c.type === ChannelType.GuildText && c.name === wantName
            );
            if (existing) {
                channelStore.updateChannel(workspaceId, { discordChannelId: existing.id });
                return existing.id;
            }
        } catch { /* fall through to creation */ }

        let channel;
        try {
            channel = await guild.channels.create({ name: wantName, type: ChannelType.GuildText });
        } catch (e) {
            throw new Error(`No channel named "${wantName}" found and could not create one: ${e.message} — either create a channel named "${wantName}" by hand, or give the bot the "Manage Channels" permission.`);
        }
        channelStore.updateChannel(workspaceId, { discordChannelId: channel.id });
        return channel.id;
    }

    // Ensure a Discord thread bound to a web conversation, so web-created chats get a
    // durable home in Discord and become bidirectional.
    async function ensureMirrorThread(workspaceId, convId, name) {
        const cfg = cfgFor(workspaceId);
        const threads = { ...(cfg.mirrorThreads || {}) };
        if (threads[convId]) {
            const t = await fetchChannel(threads[convId]);
            if (t) return t;
        }
        const channelId = await ensureMirrorChannel(workspaceId);
        const channel = await fetchChannel(channelId);
        if (!channel || !channel.threads) throw new Error('mirror channel unavailable');
        const thread = await channel.threads.create({
            name: (name || 'chat').replace(/\s+/g, ' ').trim().slice(0, 80) || 'chat',
            autoArchiveDuration: 1440,
        });
        threads[convId] = thread.id;
        channelStore.updateChannel(workspaceId, { mirrorThreads: threads });
        return thread;
    }

    // Reverse-lookup: is this Discord channel/thread a bound mirror of a web conv?
    function resolveInbound(channelId) {
        const channels = channelStore.loadChannelConfig();
        for (const [workspaceId, cfg] of Object.entries(channels)) {
            const threads = cfg.mirrorThreads || {};
            for (const [convId, threadId] of Object.entries(threads)) {
                if (threadId === channelId) return { workspaceId, convId };
            }
        }
        return null;
    }

    // Build the sink for a web-originated run: web primary, plus a Discord mirror when
    // broadcasting or when the conversation already lives in a real Discord thread.
    async function buildWebSink(workspaceId, convId, firstPrompt) {
        const primary = createWebSink({ hub, workspaceId, workspaceName: getWorkspaceName(workspaceId), convId });
        const mirrors = [];
        const cfg = cfgFor(workspaceId);

        // Conversation is itself a Discord thread (Discord-native workspace) — post there.
        const asThread = await fetchChannel(convId);
        if (asThread && typeof asThread.isThread === 'function' && asThread.isThread()) {
            mirrors.push(createDiscordSink(asThread));
        } else if (cfg.broadcastDiscord && client && config.DISCORD_TOKEN) {
            const thread = await ensureMirrorThread(workspaceId, convId, firstPrompt).catch(() => null);
            if (thread) mirrors.push(createDiscordSink(thread));
        }
        return mirrors.length ? createFanoutSink({ primary, mirrors }) : primary;
    }

    // Web-originated dispatch (also used for inbound from bound mirror threads).
    async function dispatch(workspaceId, convId, prompt, { provider } = {}) {
        if (!worktrees.getProjectConfig(workspaceId)) {
            return { error: 'No project set for this workspace.' };
        }
        echoUser(workspaceId, convId, prompt);

        const existing = activeProcesses.get(convId);
        if (existing && existing.stdin && !existing.stdin.destroyed) {
            claudeStdio.writeUserText(existing, prompt);
            return { ok: true, piped: true };
        }
        activeProcesses.delete(convId);

        const sink = await buildWebSink(workspaceId, convId, prompt);
        agentRouter.runAgent(prompt, sink, { provider });
        return { ok: true, piped: false };
    }

    // Called from the Discord message path for messages typed into a bound mirror
    // thread (a web-created conversation). Returns true if handled.
    async function handleInbound(message, cleanPrompt) {
        const found = resolveInbound(message.channel.id);
        if (!found) return false;
        if (!cleanPrompt) return true;
        const provider = cfgFor(found.workspaceId).provider;
        await dispatch(found.workspaceId, found.convId, cleanPrompt, { provider });
        await message.react('⚙️').catch(() => {});
        return true;
    }

    // Wrap a Discord-native run so its output also streams to the web notebook.
    function mirrorDiscordSink(discordSink) {
        const convId = discordSink.id;
        const workspaceId = discordSink.parentId;
        const web = createWebSink({ hub, workspaceId, workspaceName: getWorkspaceName(workspaceId), convId });
        return createFanoutSink({ primary: discordSink, mirrors: [web] });
    }

    // List a workspace's conversations for the notebook sidebar: web-created bound
    // chats plus the live Discord threads of a Discord-native channel.
    async function listConversations(workspaceId) {
        const cfg = cfgFor(workspaceId);
        const out = [];
        const seen = new Set();
        const push = (id, name, source) => { if (!seen.has(id)) { seen.add(id); out.push({ id, name: name || null, source }); } };

        for (const convId of Object.keys(cfg.mirrorThreads || {})) push(convId, null, 'web');

        if (!workspaceId.startsWith('web:') && client) {
            const ch = await fetchChannel(workspaceId);
            if (ch && ch.threads) {
                const active = await ch.threads.fetchActive().catch(() => null);
                const archived = await ch.threads.fetchArchived({ limit: 25 }).catch(() => null);
                active?.threads?.forEach((t) => push(t.id, t.name, 'discord'));
                archived?.threads?.forEach((t) => push(t.id, t.name, 'discord'));
            }
        }
        return out;
    }

    // Fetch recent Discord message history for a thread so the notebook can show
    // context for a conversation that started on Discord.
    async function fetchHistory(convId, limit = 30) {
        const thread = await fetchChannel(convId);
        if (!thread || typeof thread.messages?.fetch !== 'function') return [];
        const msgs = await thread.messages.fetch({ limit }).catch(() => null);
        if (!msgs) return [];
        return [...msgs.values()]
            .reverse()
            .filter((m) => (m.content || '').trim())
            .map((m) => ({ msgId: m.id, role: m.author?.bot ? 'agent' : 'user', content: m.content }));
    }

    return {
        hub,
        echoUser,
        dispatch,
        handleInbound,
        mirrorDiscordSink,
        ensureMirrorChannel,
        listConversations,
        fetchHistory,
        getWorkspaceName,
    };
}

module.exports = {
    createWebBridge,
};
