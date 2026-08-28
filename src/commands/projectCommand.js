const { execSync } = require('child_process');
const path = require('path');

function match(cleanPrompt) {
    if (!/^!project\b/i.test(cleanPrompt)) return null;

    if (/^!project\s+(?:--clear|-clear|--reset|-reset)$/i.test(cleanPrompt)) return { kind: 'clear' };
    if (/^!project(?:\s+(?:--view|-view))?$/i.test(cleanPrompt)) return { kind: 'view' };

    const nameMatch = cleanPrompt.match(/(?:--name|-name)\s+(\S+)/i);
    const pathMatch = cleanPrompt.match(/(?:--path|-path)\s+(\S+)/i);
    return { kind: 'set', name: nameMatch ? nameMatch[1] : null, path: pathMatch ? pathMatch[1] : null };
}

function sanitizeProjectName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function resolvePath(input) {
    let resolved = input;
    if (resolved === '~') {
        resolved = process.env.HOME;
    } else if (resolved.startsWith('~/')) {
        resolved = path.join(process.env.HOME, resolved.slice(2));
    }
    return path.resolve(resolved);
}

async function execute({ message, match: commandMatch, context }) {
    const channelId = context.channelHelpers.getParentChannelId(message.channel);
    const { WORKTREES_ROOT } = context.config;

    if (commandMatch.kind === 'clear') {
        context.channelStore.removeChannelField(channelId, 'projectName');
        context.channelStore.removeChannelField(channelId, 'projectDir');
        return message.reply('**Project cleared for this channel.** Run `!project -name <name> -path <path>` to set one.');
    }

    if (commandMatch.kind === 'view') {
        const project = context.worktrees.getProjectConfig(channelId);
        return message.reply(project
            ? `**Project for this channel:** \`${project.projectName}\`\n**Path:** \`${project.projectDir}\`\n**Worktrees base:** \`${path.join(WORKTREES_ROOT, project.projectName)}\``
            : '**No project set.** Use `!project -name <name> -path <path>`.');
    }

    // kind === 'set'
    if (!commandMatch.name || !commandMatch.path) {
        return message.reply([
            '**Usage:**',
            '`!project -name <name> -path <path>` — point this channel at a git repo',
            '`!project -view` — show the configured project',
            '`!project -clear` — clear the configured project',
            '',
            `Worktrees are created under \`${WORKTREES_ROOT}/<name>/<channel>\`.`,
        ].join('\n'));
    }

    const projectName = sanitizeProjectName(commandMatch.name);
    if (!projectName) {
        return message.reply('**Invalid project name.** Use letters, numbers, `.`, `_`, or `-`.');
    }

    const projectDir = resolvePath(commandMatch.path);
    try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'pipe' });
    } catch {
        return message.reply(`**Invalid path.** \`${projectDir}\` is not a git repository (or does not exist).`);
    }

    context.channelStore.updateChannel(channelId, { projectName, projectDir });
    return message.reply([
        `**Project set to \`${projectName}\` for this channel.**`,
        `**Path:** \`${projectDir}\``,
        `**Worktrees base:** \`${path.join(WORKTREES_ROOT, projectName)}\``,
    ].join('\n'));
}

module.exports = {
    match,
    execute,
};
