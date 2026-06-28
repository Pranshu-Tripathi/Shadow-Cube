const fs = require('fs');
const path = require('path');

function createRulesRepoService({ github, channelStore, worktrees, memory }) {
    async function pull({ channelId, channelName, repo, relPath, wantPrompt, wantSkill }) {
        channelStore.updateChannel(channelId, { rulesPath: relPath });

        const ref = await github.defaultBranch(repo);
        const results = [];

        if (wantPrompt) {
            const promptPath = relPath ? `${relPath}/system.md` : 'system.md';
            const content = (await github.fetchFile(repo, promptPath, ref)).toString('utf8');
            channelStore.updateChannel(channelId, { systemPrompt: content });
            results.push(`✅ system prompt set from \`${promptPath}\` (${content.length} chars)`);
        }

        if (wantSkill) {
            const baseBranch = worktrees.getBaseBranch(channelId);
            const worktreePath = worktrees.ensureWorktree(channelName, baseBranch);
            const skillsPrefix = relPath ? `${relPath}/skills/` : 'skills/';
            const tree = await github.listTree(repo, ref);
            const blobs = tree.filter(e => e.type === 'blob' && e.path.startsWith(skillsPrefix));
            if (!blobs.length) {
                results.push(`⚠️ no files found under \`${skillsPrefix}\``);
            } else {
                const dests = [path.join(worktreePath, '.skills'), path.join(worktreePath, '.claude', 'skills')];
                for (const dest of dests) fs.rmSync(dest, { recursive: true, force: true });
                for (const blob of blobs) {
                    const rel = blob.path.slice(skillsPrefix.length);
                    const content = await github.fetchFile(repo, blob.path, ref);
                    for (const dest of dests) {
                        const target = path.join(dest, rel);
                        fs.mkdirSync(path.dirname(target), { recursive: true });
                        fs.writeFileSync(target, content);
                    }
                }
                results.push(`✅ pulled ${blobs.length} skill file(s) into \`.skills/\` (mirrored to \`.claude/skills/\`)`);
            }
        }

        return { ref, results };
    }

    async function promoteMemory({ channelId, channelName, repo }) {
        const sanitized = worktrees.sanitizeChannelName(channelName);
        const worktreePath = worktrees.ensureWorktree(channelName, worktrees.getBaseBranch(channelId));
        const files = memory.listMemoryFiles(worktreePath);
        const relPath = channelStore.loadChannelConfig()[channelId]?.rulesPath || '';
        const memBase = relPath ? `${relPath}/memory` : 'memory';

        const ref = await github.defaultBranch(repo);
        const baseSha = await github.getRefSha(repo, ref);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const newBranch = `shadow-cube-memory/${sanitized}-${ts}`;
        await github.createBranch(repo, newBranch, baseSha);
        for (const f of files) {
            const buf = Buffer.from(memory.readMemoryFile(worktreePath, f));
            await github.putFile(repo, `${memBase}/${f}`, buf, newBranch, `memory: add ${f}`);
        }
        const body = `Promoted ${files.length} learned memory file(s) from Discord channel \`${channelName}\`:\n\n${files.map(f => `- \`${memBase}/${f}\``).join('\n')}`;
        const prUrl = await github.openPR(repo, newBranch, ref, `Memory update from #${channelName}`, body);

        return {
            files,
            prUrl,
        };
    }

    return {
        pull,
        promoteMemory,
    };
}

module.exports = {
    createRulesRepoService,
};
