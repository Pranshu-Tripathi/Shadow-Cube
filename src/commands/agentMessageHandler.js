async function execute({ message, cleanPrompt, context }) {
    if (!cleanPrompt) return;

    const threadId = message.channel.isThread() ? message.channel.id : null;

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
            context.agentRouter.runAgent(cleanPrompt, message.channel);
        }
        return;
    }

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
        }
    }

    await message.react('⚙️');
    context.agentRouter.runAgent(cleanPrompt, targetChannel);
}

module.exports = {
    execute,
};
