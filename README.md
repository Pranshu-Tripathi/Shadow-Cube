# Shadow Cube Bridge

A Discord bot that bridges Claude Code CLI to Discord. Send prompts in a channel, get streaming responses in threads with real-time thinking, tool use diffs, and code block syntax highlighting.

## Features

- Streams Claude's thinking process in real-time (block-quoted, live-edited)
- Displays tool usage with formatted code blocks (Edit diffs, Bash commands, file reads)
- Auto-creates Discord threads per query
- Session persistence across messages in the same thread
- Code block auto-detection and syntax highlighting for Discord
- **Git worktree support** - each Discord channel gets its own worktree, enabling parallel work on different tickets without file conflicts

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` available in PATH)
- *(optional)* [Codex CLI](https://developers.openai.com/codex) installed and authenticated (`codex` in PATH) — only needed for channels using `!provider codex`
- A [Discord bot token](https://discord.com/developers/applications) with the following permissions:
  - Send Messages
  - Send Messages in Threads
  - Create Public Threads
  - Read Message History
  - Add Reactions
  - Message Content intent (enabled in bot settings)

## Setup

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd shadow-cube-bridge
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

4. Fill in the `.env` values:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   # WORKTREES_DIR=/optional/custom/path/for/worktrees
   ```
   - `DISCORD_TOKEN` - Your Discord bot token
   - `WORKTREES_DIR` *(optional)* - Root directory that holds all worktrees (default: `/Users/tripathi/Desktop/development/code/worktrees`). Each project gets a subfolder: `WORKTREES_DIR/<project-name>/<channel-name>`.
   - `BRANCH_PREFIX` *(optional)* - Prefix for worktree branch names (default: `shadow-cube`). Set to empty string for no prefix.
   - `GITHUB_PAT` *(optional)* - GitHub personal access token used by `!repo` to read prompts/skills (required for private repos)

   Which repository a channel works on is **not** set here — each channel points itself at a project at runtime with **`!project -name <name> -path <path>`** (see [Projects](#projects-per-channel) below).

5. Run the bot:
   ```bash
   bun relay.js
   ```

## Usage

- **`!project -name <name> -path <path>`** to point the channel at a git repository (required before the bot will do any work — see below)
- **Send a message** mentioning the bot in any channel - it creates a thread and streams Claude's response
- **Reply in thread** to continue the conversation in the same Claude session
- **`!clear`** in a thread to reset the session and kill any running process
- **`!deploy`** or **`!deploy <message>`** to commit all changes in the channel's worktree branch
- **`!clear --worktree`** (or `!clear -w`) in a thread to also remove the channel's git worktree
- **`!base <branch>`** in a channel to set the base branch for that channel's worktree (persists across restarts)
- **`!worktrees`** to list all active git worktrees
- **`!repo`** to pull a system prompt and skills from a configured GitHub repo (see below)
- **`!memory`** to teach the channel a lasting lesson that's layered onto its system prompt (see below)
- **`!provider claude|codex`** to choose which agent backs the channel (see below)

## Projects (per-channel)

Each channel chooses which git repository it operates on. **A channel must be pointed at a project before the bot will run an agent or touch worktrees** — otherwise it replies asking you to configure one.

- **`!project -name <name> -path <path>`** - point this channel at a git repo. `<path>` may use `~` and is validated as a git repository before being saved. `<name>` becomes the project's folder under the worktrees root.
- **`!project`** or **`!project -view`** - show the channel's configured project
- **`!project -clear`** - clear the project for this channel

The setting is per-channel and persists across restarts (stored in `config/channels.json`). A channel's worktree is created at **`<WORKTREES_DIR>/<name>/<channel-name>`**, so multiple channels can share one project and different projects stay isolated. Two channels can also target completely different repositories.

## Providers (Claude / Codex)

Each channel can be backed by either [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (default) or [Codex](https://developers.openai.com/codex) (`codex` CLI must be installed and authenticated, available in PATH).

- **`!provider`** - show the current provider and usage
- **`!provider claude`** - use Claude Code (default; full token-by-token streaming, tool diffs, and interactive `AskUserQuestion` approvals)
- **`!provider codex`** - use Codex via the `codex app-server` protocol

The setting is per-channel and persists across restarts. Worktrees, `!base`, `!repo`, and `!memory` work for both providers; the channel's system prompt + learned memory are passed as Codex `developerInstructions` when a fresh Codex session starts.

**Codex approvals:** Codex runs under the `codex app-server` JSON-RPC protocol with `sandbox = workspace-write` and `approvalPolicy = on-request`. The agent edits files freely inside its worktree and runs sandboxed commands, but when it needs to **escape the sandbox** (network access, writing outside the worktree, risky commands) it asks first — surfaced in Discord as an approval message with **Approve / Approve (session) / Deny / Deny & stop** buttons. (`danger-full-access` is intentionally *not* used: with full access the agent never needs to escalate, so no approvals would ever fire.)

Other Codex notes: the assistant message streams token-by-token (live-edited like Claude); command runs and file changes render as cards; a token-usage footer is posted per turn. A single shared `codex app-server` process multiplexes all Codex channels, and sessions resume across bot restarts via `thread/resume`. Codex session ids are stored separately in `sessions/codex-config.json`.

## System Prompts & Skills from a Repo

`!repo` lets each channel pull its system prompt and skills from a GitHub repo (private repos need `GITHUB_PAT`):

- **`!repo -config owner/repo`** - set the rules repo for this channel (accepts a slug or GitHub URL)
- **`!repo -prompt -skill -path <dir>`** - pull from the repo, where `<dir>` is repo-root-relative:
  - `-prompt` reads `<dir>/system.md` and sets it as the channel's system prompt
  - `-skill` pulls `<dir>/skills/**` into the worktree's generic `.skills/` (mirrored to `.claude/skills/` so the current Claude session can use them)
  - both flags are optional; use either or both
- **`!repo -view`** - show the configured repo

Skills are stored under `.skills/` (provider-neutral) and mirrored to `.claude/skills/`. Each pull replaces the previous skill files.

## Channel Memory

`!memory` lets a channel accumulate lessons ("don't make this mistake again") that are layered onto the system prompt **after** the `!repo`/`!rule` prompt — so re-pulling the repo prompt never wipes them. Memory lives as one file per lesson in the worktree's `.memory/` directory.

- **`!memory <note>`** - save a lesson verbatim; applies from the next message
- **`!memory -agentic [hint]`** - have the agent distill the lesson from the current conversation and write it itself (the optional hint steers what to capture)
- **`!memory -remote`** - open a PR promoting this channel's memory files to `<dir>/memory/` in the configured rules repo (needs a write-scoped `GITHUB_PAT`: `Contents: Read & Write` + `Pull requests: Read & Write`)
- **`!memory -view`** - list the channel's saved memory
- **`!memory -wipe`** - clear the channel's memory

Memory is local to the worktree (and removed with `!clear --worktree`/`!destroy`); use `!memory -remote` to persist lessons to the repo so they survive and can be shared.

## Git Worktrees

Each Discord channel automatically gets its own [git worktree](https://git-scm.com/docs/git-worktree), allowing parallel work on different tickets without file conflicts. Worktrees are created on first message (after the channel is pointed at a project with `!project`) and branch off the channel's configured base branch (or the repo default).

- Branch naming: `<BRANCH_PREFIX>/<channel-name>` (default prefix: `shadow-cube`)
- Worktree location: `<WORKTREES_DIR>/<project-name>/<channel-name>` — one folder per project under the shared worktrees root
- Set the channel's project: `!project -name <name> -path <path>` (required)
- Set base branch per channel: `!base feature/my-branch`
- Each worktree is scaffolded with an `.out/` directory on creation; bot artifacts (`.out/`, `.skills/`, `.claude/`, `.shadow-cube-base`) are added to the worktree's local git exclude so they never appear in the target repo's `git status`

## How It Works

The bot spawns `claude -p` with `--output-format stream-json` for each query, parsing the JSONL stream to separate thinking blocks, text content, and tool use into distinct Discord messages. Sessions are persisted per-thread so follow-up messages resume the same Claude conversation.

For channels set to `!provider codex`, the bot instead drives a long-lived `codex app-server` process over its NDJSON JSON-RPC protocol (`initialize` → `thread/start`/`thread/resume` → `turn/start`), routing the streamed `item/*` and `turn/*` notifications to Discord and turning `requestApproval` server-requests into Discord approval buttons. Codex lives under `src/providers/codex/`, kept separate from the Claude engine under `src/providers/claude/`.
