function createCodexRuntimeState() {
    return {
        mgr: null,
        renderStates: new Map(),
        channelByThread: new Map(),
        openThreads: new Set(),
        pendingApprovals: new Map(),
        pendingPatches: new Map(),
        approvalCounter: 0,
    };
}

module.exports = {
    createCodexRuntimeState,
};
