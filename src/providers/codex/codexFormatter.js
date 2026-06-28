function extractReasoning(item) {
    if (typeof item.text === 'string') return item.text;
    if (Array.isArray(item.summary)) return item.summary.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
    if (typeof item.summary === 'string') return item.summary;
    if (Array.isArray(item.content)) return item.content.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
    return '';
}

function formatReasoning(item) {
    const reasoning = extractReasoning(item);
    if (!reasoning.trim()) return '';
    const lines = reasoning.trim().split('\n').map((line) => `> ${line}`).join('\n');
    return `**Thinking** (complete)\n${lines}`;
}

function formatCommandExecution(item) {
    const cmd = item.command || '?';
    let msg = `**Bash:**\n\`\`\`bash\n${cmd}\n\`\`\``;
    if (item.status === 'declined') msg += `\n*declined*`;
    else if (item.exitCode != null && item.exitCode !== 0) msg += `\n*exit ${item.exitCode}*`;
    return msg;
}

function formatFileChanges(item) {
    const icon = (kind) => (kind === 'delete' ? '🗑️' : kind === 'add' ? '➕' : '✏️');
    const lines = (item.changes || []).map((change) => `${icon(change.kind)} \`${change.path}\``).join('\n');
    return `**File changes:**\n${lines || '(none)'}`;
}

function formatUsage(usage) {
    return `*Tokens: in ${usage.inputTokens ?? '?'} (cached ${usage.cachedInputTokens ?? 0}) / out ${usage.outputTokens ?? '?'}*`;
}

function formatError(params) {
    const message = params.error?.message || 'unknown error';
    return `❌ **Codex error:** ${message}`;
}

function formatCommandApproval(params) {
    const lines = ['🔐 **Codex wants to run a command**'];
    if (params.command) lines.push('```bash\n' + String(params.command).slice(0, 1500) + '\n```');
    if (params.cwd) lines.push(`in \`${params.cwd}\``);
    if (params.reason) lines.push(`*${params.reason}*`);
    return lines.join('\n');
}

function formatFileChangeApproval(params, changes) {
    const lines = ['🔐 **Codex wants to apply file changes**'];
    if (params.reason) lines.push(`*${params.reason}*`);
    if (params.grantRoot) lines.push(`grant write under \`${params.grantRoot}\``);
    if (Array.isArray(changes)) {
        for (const change of changes.slice(0, 5)) {
            lines.push(`\`${change.path}\` (${change.kind})`);
            if (change.diff) lines.push('```diff\n' + String(change.diff).slice(0, 800) + '\n```');
        }
    }
    return lines.join('\n');
}

module.exports = {
    extractReasoning,
    formatReasoning,
    formatCommandExecution,
    formatFileChanges,
    formatUsage,
    formatError,
    formatCommandApproval,
    formatFileChangeApproval,
};
