const { createDiscordSink } = require('../transport/sink');

// `thread` lets a caller that has already opened a thread (the voice flow, which
// posts its confirmation card there) hand it over instead of opening a second one.
async function execute({ message, cleanPrompt, context, thread = null }) {
    if (!cleanPrompt) return;

    const activeChannel = thread || message.channel;
    const threadId = activeChannel.isThread() ? activeChannel.id : null;

    // Wrap a Discord channel as a sink; when the web bridge is present, mirror the
    // conversation onto the notebook and echo the user's Discord message there too.
    function buildSink(channel) {
        const sink = createDiscordSink(channel);
        if (context.webBridge) {
            context.webBridge.echoUser(sink.parentId, sink.id, cleanPrompt);
            return context.webBridge.mirrorDiscordSink(sink);
        }
        return sink;
    }

    if (await context.questionFlow.consumeCustomAnswer(message, cleanPrompt)) {
        return;
    }

    if (threadId && context.activeProcesses.has(threadId)) {
        const child = context.activeProcesses.get(threadId);
        if (child.stdin && !child.stdin.destroyed) {
            console.log(`[DEBUG] Piping Discord input to Claude stdin in ${threadId}: "${cleanPrompt}"`);
            if (context.webBridge) {
                context.webBridge.echoUser(context.channelHelpers.getParentChannelId(activeChannel), activeChannel.id, cleanPrompt);
            }
            context.claudeStdio.writeUserText(child, cleanPrompt);
            await message.react('📨');
        } else {
            console.log(`[DEBUG] stdin closed for ${threadId}, starting new process`);
            context.activeProcesses.delete(threadId);
            await message.react('⚙️');
            context.agentRouter.runAgent(cleanPrompt, buildSink(activeChannel));
        }
        return;
    }

    let targetChannel = activeChannel;
    if (!thread && !message.channel.isThread() && message.guild) {
        try {
            const created = await message.startThread({
                name: cleanPrompt.substring(0, 50),
                autoArchiveDuration: 60,
            });
            console.log(`[DEBUG] Thread created: ${created.id} (${created.name})`);
            targetChannel = created;
        } catch (e) {
            console.error(`[DEBUG] Failed to create thread, using channel:`, e.message);
        }
    }

    await message.react('⚙️');
    const workspaceId = context.channelHelpers.getParentChannelId(targetChannel);
    if (context.webBridge) {
        context.webBridge.titleConversation(workspaceId, targetChannel.id, cleanPrompt, { source: 'discord', thread: targetChannel.raw || targetChannel }).catch(() => {});
    } else if (context.titleService) {
        context.titleService.ensure({
            workspaceId,
            conversationId: targetChannel.id,
            prompt: cleanPrompt,
            source: 'discord',
            rename: (title) => typeof targetChannel.setName === 'function' ? targetChannel.setName(title) : undefined,
        }).catch(() => {});
    }
    context.agentRouter.runAgent(cleanPrompt, buildSink(targetChannel));
}

module.exports = {
    execute,
};
