function match(cleanPrompt) {
    if (/^!memory\s+(?:--view|-view)$/i.test(cleanPrompt)) return { kind: 'view' };
    if (/^!memory\s+(?:--wipe|-wipe|-w)$/i.test(cleanPrompt)) return { kind: 'wipe' };
    if (/^!memory\s+(?:--remote|-remote)$/i.test(cleanPrompt)) return { kind: 'remote' };

    const agenticMatch = cleanPrompt.match(/^!memory\s+(?:--agentic|-agentic)\s*(.*)$/i);
    if (agenticMatch) return { kind: 'agentic', note: agenticMatch[1].trim() };

    const addMatch = cleanPrompt.match(/^!memory\s+(.+)$/is);
    if (addMatch) return { kind: 'add', note: addMatch[1] };

    if (/^!memory$/i.test(cleanPrompt)) return { kind: 'usage' };
    return null;
}

async function execute({ message, match: commandMatch, context }) {
    const channelName = context.channelHelpers.getParentChannelName(message.channel);
    const channelId = context.channelHelpers.getParentChannelId(message.channel);
    const threadId = message.channel.isThread() ? message.channel.id : null;

    const needsWorktree = ['view', 'wipe', 'remote', 'add'].includes(commandMatch.kind);
    if (needsWorktree && !context.worktrees.getProjectConfig(channelId)) {
        return message.reply('**No project set for this channel.** Run `!project -name <name> -path <path>` first.');
    }

    if (commandMatch.kind === 'view') {
        const worktreePath = context.worktrees.ensureWorktree(channelName, context.worktrees.getBaseBranch(channelId), channelId);
        const files = context.memory.listMemoryFiles(worktreePath);
        if (!files.length) {
            return message.reply('**No memory for this channel.** Use `!memory <note>` to add one.');
        }
        const body = files.map(f => `• \`${f}\`\n${context.memory.readMemoryFile(worktreePath, f).trim()}`).join('\n\n');
        const chunks = context.formatting.splitForDiscord(`**Memory for this channel (${files.length}):**\n\n${body}`);
        for (const chunk of chunks) await message.reply(chunk);
        return;
    }

    if (commandMatch.kind === 'wipe') {
        const worktreePath = context.worktrees.ensureWorktree(channelName, context.worktrees.getBaseBranch(channelId), channelId);
        context.memory.wipeMemory(worktreePath);
        return message.reply('**Memory cleared for this channel.**');
    }

    if (commandMatch.kind === 'remote') {
        const config = context.channelStore.loadChannelConfig();
        const repo = config[channelId]?.rulesRepo;
        if (!repo) {
            return message.reply('**No rules repo set.** Use `!repo -config owner/repo` first.');
        }
        if (!context.config.GITHUB_PAT) {
            return message.reply('**`GITHUB_PAT` is not set.** A write-scoped token (`Contents: RW` + `Pull requests: RW`) is required to open PRs.');
        }

        const worktreePath = context.worktrees.ensureWorktree(channelName, context.worktrees.getBaseBranch(channelId), channelId);
        const files = context.memory.listMemoryFiles(worktreePath);
        if (!files.length) {
            return message.reply('**No local memory to promote.** Add some with `!memory <note>` first.');
        }

        try {
            const result = await context.rulesRepo.promoteMemory({ channelId, channelName, repo });
            return message.reply(`**Opened PR with ${result.files.length} memory file(s):**\n${result.prUrl}`);
        } catch (e) {
            return message.reply(`**Failed to open memory PR on \`${repo}\`:** ${e.message}`);
        }
    }

    if (commandMatch.kind === 'agentic') {
        const note = commandMatch.note;
        const instruction = [
            'Reflect on this conversation — especially the most recent mistake or correction',
            note ? ` (context from me: ${note})` : '',
            '. Distill it into ONE concise, durable rule (1–3 lines) that will prevent the mistake from recurring.',
            ' Create the `.memory/` directory in the current working directory if needed, then use the Write tool to save the rule to a new file `.memory/<short-kebab-name>.md`.',
            ' Write only the rule itself in the file (no preamble). Then reply with a one-line confirmation of what you saved.',
        ].join('');

        if (threadId && context.activeProcesses.has(threadId)) {
            const child = context.activeProcesses.get(threadId);
            if (child.stdin && !child.stdin.destroyed) {
                context.claudeStdio.writeUserText(child, instruction);
                await message.react('🧠');
                return;
            }
            context.activeProcesses.delete(threadId);
        }
        await message.react('🧠');
        context.agentRouter.runAgent(instruction, message.channel);
        return;
    }

    if (commandMatch.kind === 'add') {
        const worktreePath = context.worktrees.ensureWorktree(channelName, context.worktrees.getBaseBranch(channelId), channelId);
        const name = context.memory.writeMemoryFile(worktreePath, commandMatch.note);
        return message.reply(`**Memory saved** (\`${name}\`). It will apply from the next message. Use \`!memory -remote\` to open a PR promoting it to the repo.`);
    }

    return message.reply([
        '**Usage:**',
        '`!memory <note>` — save a lesson verbatim (applies next message)',
        '`!memory -agentic [hint]` — have the agent distill the lesson from this conversation and save it',
        '`!memory -remote` — open a PR promoting this channel\'s memory to the rules repo',
        '`!memory -view` — list saved memory',
        '`!memory -wipe` — clear this channel\'s memory',
    ].join('\n'));
}

module.exports = {
    match,
    execute,
};
