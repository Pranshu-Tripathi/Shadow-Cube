const fs = require('fs');
const path = require('path');

function memoryDir(worktreePath) {
    return path.join(worktreePath, '.memory');
}

function listMemoryFiles(worktreePath) {
    const dir = memoryDir(worktreePath);
    try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    } catch {
        return [];
    }
}

function readWorktreeMemory(worktreePath) {
    const dir = memoryDir(worktreePath);
    const parts = listMemoryFiles(worktreePath)
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8').trim())
        .filter(Boolean);
    return parts.join('\n\n');
}

function memorySlug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'note';
}

function writeMemoryFile(worktreePath, text) {
    const dir = memoryDir(worktreePath);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${ts}-${memorySlug(text)}.md`;
    fs.writeFileSync(path.join(dir, name), `${text.trim()}\n`);
    return name;
}

function readMemoryFile(worktreePath, fileName) {
    return fs.readFileSync(path.join(memoryDir(worktreePath), fileName), 'utf8');
}

function wipeMemory(worktreePath) {
    fs.rmSync(memoryDir(worktreePath), { recursive: true, force: true });
}

module.exports = {
    memoryDir,
    listMemoryFiles,
    readWorktreeMemory,
    memorySlug,
    writeMemoryFile,
    readMemoryFile,
    wipeMemory,
};
