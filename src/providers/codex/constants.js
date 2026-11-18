const SANDBOX_MODE = 'workspace-write';
const APPROVAL_POLICY = 'on-request';
const MAX_MSG_LEN = 1950;
const EDIT_INTERVAL = 1500;
// A `codex` on PATH is often an older release (e.g. Homebrew) that rejects every model
// with "not supported when using Codex with a ChatGPT account". The CLI bundled with the
// ChatGPT desktop app tracks the account, so prefer it. Override with CODEX_BIN.
const CODEX_BIN_CANDIDATES = [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
];

module.exports = {
    SANDBOX_MODE,
    APPROVAL_POLICY,
    MAX_MSG_LEN,
    EDIT_INTERVAL,
    CODEX_BIN_CANDIDATES,
};
