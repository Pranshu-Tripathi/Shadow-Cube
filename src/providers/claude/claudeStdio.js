function writeStdin(child, payload) {
    if (!child?.stdin || child.stdin.destroyed) return false;
    try {
        child.stdin.write(JSON.stringify(payload) + '\n');
        return true;
    } catch (e) {
        console.error('[DEBUG] Failed to write to claude stdin:', e.message);
        return false;
    }
}

function writeUserText(child, text) {
    return writeStdin(child, {
        type: 'user',
        message: { role: 'user', content: text },
    });
}

module.exports = {
    writeStdin,
    writeUserText,
};
