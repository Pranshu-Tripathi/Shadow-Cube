const config = require('../../config');
const formatting = require('../../discord/formatting');
const formatter = require('./codexFormatter');
const { createCodexRuntimeState } = require('./runtimeState');
const { createCodexSessionStore } = require('./codexSessionStore');
const { createAppServerManager } = require('./appServerManager');
const { createCodexRenderer } = require('./codexRenderer');
const { createApprovalFlow } = require('./approvalFlow');
const { createCodexRunner } = require('./codexRunner');
const { bumpDesktopRecency } = require('./desktopRecency');

const state = createCodexRuntimeState();
const sessionStore = createCodexSessionStore({ state });
const appServer = createAppServerManager({ state, projectDir: config.PROJECT_DIR });
const renderer = createCodexRenderer({
    state,
    formatting,
    formatter,
    bumpDesktopRecency,
});
const approvalFlow = createApprovalFlow({
    state,
    appServer,
    formatter,
});
const runner = createCodexRunner({
    state,
    appServer,
    renderer,
    sessionStore,
});

appServer.setHandlers({
    handleNotification: renderer.handleNotification,
    handleServerRequest: approvalFlow.handleServerRequest,
});

module.exports = {
    runCodex: runner.runCodex,
    handleCodexApproval: approvalFlow.handleCodexApproval,
    getCodexSession: sessionStore.getCodexSession,
    setCodexSession: sessionStore.setCodexSession,
    clearCodexSession: sessionStore.clearCodexSession,
};
