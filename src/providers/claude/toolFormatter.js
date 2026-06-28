function createToolFormatter({ activeCwd, projectDir, detectLanguage }) {
    const stripCwd = (p) => p.replace(activeCwd + '/', '').replace(projectDir + '/', '');

    return function formatToolUse(toolName, inputJson) {
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
            return `**Tool:** \`${toolName}\``;
        } catch {
            return `**Tool:** \`${toolName}\``;
        }
    };
}

module.exports = {
    createToolFormatter,
};
