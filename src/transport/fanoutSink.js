// FanoutSink mirrors a conversation to several sinks at once — the web notebook's
// "broadcast to Discord" toggle wraps the WebSink (primary) plus a DiscordSink
// (mirror). The primary drives all keying (session id, worktree, questions); the
// mirrors are best-effort output copies and never block or break the primary.

function createFanoutSink({ primary, mirrors = [], getMirrors }) {
    async function send(payload) {
        const primaryHandle = await primary.send(payload);
        const activeMirrors = getMirrors
            ? await Promise.resolve(getMirrors()).catch(() => [])
            : mirrors;
        const mirrorHandles = await Promise.all(
            activeMirrors.map((m) => Promise.resolve(m.send(payload)).catch(() => null))
        );

        return {
            id: primaryHandle.id,
            edit(next) {
                return Promise.all([
                    primaryHandle.edit(next),
                    ...mirrorHandles.map((h) => (h && h.edit ? Promise.resolve(h.edit(next)).catch(() => {}) : null)),
                ]).then(() => {});
            },
        };
    }

    return {
        __sinkKind: 'fanout',
        id: primary.id,
        parentId: primary.parentId,
        parentName: primary.parentName,
        isThread: primary.isThread,
        send,
        // Interactive prompts stay on the primary (web) surface.
        askQuestion: primary.askQuestion ? (...args) => primary.askQuestion(...args) : undefined,
        requestApproval: primary.requestApproval ? (...args) => primary.requestApproval(...args) : undefined,
    };
}

module.exports = {
    createFanoutSink,
};
