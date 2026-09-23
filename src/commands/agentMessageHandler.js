// `thread` lets a caller that has already opened a thread (the voice flow, which
// posts its confirmation card there) hand it over instead of opening a second one.
async function execute({ message, cleanPrompt, context, thread = null }) {
    if (!cleanPrompt) return;

    const activeChannel = thread || message.channel;
    const threadId = activeChannel.isThread() ? activeChannel.id : null;

    if (await context.questionFlow.consumeCustomAnswer(message, cleanPrompt)) {
        return;
    }

    if (threadId && context.activeProcesses.has(threadId)) {
        const child = context.activeProcesses.get(threadId);
        if (child.stdin && !child.stdin.destroyed) {
            console.log(`[DEBUG] Piping Discord input to Claude stdin in ${threadId}: "${cleanPrompt}"`);
            context.claudeStdio.writeUserText(child, cleanPrompt);
            await message.react('📨');
        } else {
            console.log(`[DEBUG] stdin closed for ${threadId}, starting new process`);
            context.activeProcesses.delete(threadId);
            await message.react('⚙️');
            context.agentRouter.runAgent(cleanPrompt, activeChannel);
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
    context.agentRouter.runAgent(cleanPrompt, targetChannel);
}

module.exports = {
    execute,
};
