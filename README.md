# Shadow Cube Bridge

A local web and Discord workspace for Claude Code and Codex. The Bun backend owns agent sessions, Git worktrees, voice transcription, Discord mirroring, and durable SQLite state; the React interface provides the primary desktop experience.

## Features

- Streams Claude's thinking process in real-time (block-quoted, live-edited)
- Displays tool usage with formatted code blocks (Edit diffs, Bash commands, file reads)
- Auto-creates Discord threads per query
- Session persistence across messages in the same thread
- Code block auto-detection and syntax highlighting for Discord
- **Git worktree support** - each Discord channel gets its own worktree, enabling parallel work on different tickets without file conflicts
- **Voice messages** - record a Discord voice note, get it transcribed locally and confirm it before it reaches the agent

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` available in PATH)
- *(optional)* [Codex CLI](https://developers.openai.com/codex) installed and authenticated (`codex` in PATH) — only needed for channels using `!provider codex`
- *(optional)* `ffmpeg` + `whisper-cpp` + a ggml model — only needed for [voice messages](#voice-messages); run `bun run setup:voice` to install them
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
   bun start
   ```

   `bun start` builds the React/Vite client and starts the Bun backend at `http://127.0.0.1:8200`. For frontend development, run `bun run start:server` and `bun run dev:web` in separate terminals.

## Web interface

The web interface groups workspaces under their source projects and keeps conversations synchronized with Discord when broadcasting is enabled. It includes:

- streamed agent messages, thinking and tool activity;
- AskUserQuestion and Codex approval controls that can be answered from web or Discord;
- local voice dictation;
- project, provider, base-branch, rules, memory and Discord settings;
- initial worktree commands;
- session reset, worktree removal and destroy actions with dirty-worktree warnings.

Set `PROJECTS_ROOT` to the directory whose immediate Git-repository children should appear in the project picker. It defaults to the parent of `PROJECT_DIR`. The selected folder name is used as the default project and workspace name.

## Usage

- **`!project -name <name> -path <path>`** to point the channel at a git repository (required before the bot will do any work — see below)
- **Send a message** mentioning the bot in any channel - it creates a thread and streams Claude's response
- **Send a voice message** - it's transcribed locally and shown for confirmation before it reaches the agent (see below)
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

The setting is per-channel/workspace and persists across restarts in SQLite. A workspace's worktree is created at **`<WORKTREES_DIR>/<name>/<workspace-name>`**, so multiple workspaces can share one project and different projects stay isolated.

### Initial worktree commands

Project settings can contain an ordered list of trusted local shell commands such as `bun install`. `.out` and the local Git excludes are always created first. Commands run sequentially only after a genuinely new worktree is created, stop on the first failure, and record their output in SQLite. Existing worktrees do not execute newly configured commands automatically; use **Run setup again** when that is intended.

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

## Voice Messages

Record a Discord voice message (or upload any audio file) in a configured channel and the bot transcribes it **entirely on-device** — no audio ever leaves the machine and there is no per-minute cost.

Run the one-time setup first:

```bash
bun run setup:voice
```

That installs `ffmpeg` and `whisper-cpp` via Homebrew, downloads the `large-v3-turbo` ggml model to `~/.cache/whisper.cpp/`, and pulls the `gemma3:1b` ollama model used for proof-reading. On an M4 Pro the whole pipeline runs in **~1.7s for a 30-second clip**.

**The flow:**

1. You send a voice note; the bot reacts 🎙️
2. `ffmpeg` converts the ogg/opus to 16kHz mono wav, then `whisper-cli` transcribes it
3. A small local LLM proof-reads the transcript (fixes "work tree" → `worktree`, "get hub" → `GitHub`, strips "um"/"you know")
4. A thread is opened off the voice message, named after the transcript, and the transcript is posted **inside it** in a code block with a live countdown and **Send now / Edit / Cancel** buttons — so the parent channel stays clean
5. After **15 seconds** it auto-sends to the agent, in that same thread — unless you edited or cancelled it

**Edit** opens a modal pre-filled with the transcript, so fixing one word doesn't mean retyping the sentence. Opening it pauses the countdown. Submitting the modal sends immediately — editing is itself a confirmation.

Approved transcripts go **straight to the agent and never run `!commands`** — a misheard `!destroy` isn't a risk worth taking. Everything downstream behaves exactly like typed text, so a voice note in a thread with a live agent is piped to its stdin, and can even answer an `AskUserQuestion` prompt.

### Teaching it your vocabulary

Whisper mangles project jargon. The bot seeds it with a glossary (used both as whisper's initial prompt and in the cleanup pass), assembled from:

- **`config/vocabulary.txt`** — one term per line, `#` for comments. Seeded from `vocabulary.example.txt` on first run, then it's yours to edit. It's **re-read on every transcription**, so changes take effect without restarting the bot.
- the channel's name and its configured project name, added automatically

### Tuning

All optional, via `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOICE_AUTO_SEND_MS` | `15000` | How long the confirm card waits before auto-sending |
| `VOICE_CLEANUP_MODEL` | `gemma3:1b` | ollama model for proof-reading. **Empty string disables it** |
| `VOICE_CLEANUP_KEEP_ALIVE` | `30m` | How long ollama keeps the model resident |
| `WHISPER_MODEL` | `~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin` | Path to the ggml model |
| `WHISPER_LANGUAGE` | `en` | Spoken language (`auto` to detect) |
| `VOICE_MAX_DURATION_SEC` / `VOICE_MAX_BYTES` | `600` / 25MB | Clip limits |

The cleanup pass is strictly best-effort: if ollama is down, slow, or returns something wildly longer or shorter than the input, the raw whisper transcript is used instead. Whisper's silence hallucinations (`[BLANK_AUDIO]`, "Thank you.", subtitle credits) are filtered out rather than sent to the agent.

> **Note:** whisper and the cleanup model share the GPU. Keeping several large ollama models resident will slow transcription down noticeably — `ollama ps` to check, `ollama stop <model>` to free them.

## Git Worktrees

Each Discord channel automatically gets its own [git worktree](https://git-scm.com/docs/git-worktree), allowing parallel work on different tickets without file conflicts. Worktrees are created on first message (after the channel is pointed at a project with `!project`) and branch off the channel's configured base branch (or the repo default).

- Branch naming: `<BRANCH_PREFIX>/<channel-name>` (default prefix: `shadow-cube`)
- Worktree location: `<WORKTREES_DIR>/<project-name>/<channel-name>` — one folder per project under the shared worktrees root
- Set the channel's project: `!project -name <name> -path <path>` (required)
- Set base branch per channel: `!base feature/my-branch`
- Each worktree is scaffolded with an `.out/` directory on creation; bot artifacts (`.out/`, `.skills/`, `.claude/`, `.shadow-cube-base`) are added to the worktree's local git exclude so they never appear in the target repo's `git status`

## How It Works

The bot spawns `claude -p` with `--output-format stream-json` for each query, parsing the JSONL stream to separate thinking blocks, text content, and tool use into distinct Discord messages. Sessions are persisted per-thread so follow-up messages resume the same Claude conversation.

Voice messages are intercepted in `src/commands/registry.js` before the command loop and handled by `src/voice/` — `audio.js` (detection, download, ffmpeg), `transcriber.js` (whisper.cpp), `vocabulary.js` (glossary), `cleanup.js` (ollama proof-read) and `voiceFlow.js` (the confirm card, countdown and edit modal). Transcription is serialised through a queue so two clips can't contend for the GPU.

For channels set to `!provider codex`, the bot instead drives a long-lived `codex app-server` process over its NDJSON JSON-RPC protocol (`initialize` → `thread/start`/`thread/resume` → `turn/start`), routing the streamed `item/*` and `turn/*` notifications to Discord and turning `requestApproval` server-requests into Discord approval buttons. Codex lives under `src/providers/codex/`, kept separate from the Claude engine under `src/providers/claude/`.

## State, migration, and backups

Structured runtime state lives in `sessions/shadow-cube.sqlite` by default. On the first launch after upgrading, Shadow Cube copies data from these legacy files in one transaction:

- `config/channels.json`
- `sessions/config.json`
- `sessions/codex-config.json`
- `sessions/web-conversations.json`

The importer is idempotent and never edits or deletes the legacy files. Existing project names are retained. Workspaces without a configured project are placed under **Global / no project**.

Create a transactionally consistent backup at any time:

```bash
bun run backup:state
```

Backups are written to `sessions/backups/` and are not automatically deleted. To restore, stop Shadow Cube, preserve the current `sessions/shadow-cube.sqlite*` files, copy the selected backup to the configured `STATE_DB_PATH`, and then restart. The retained legacy JSON files remain an additional rollback source.

Before releasing, run the complete validation gate:

```bash
bun run check
```

The HTTP server binds to `127.0.0.1`. Do not expose it directly to a network; use an authenticated TLS reverse proxy if remote browser access is required. Discord remains the intended remote-phone surface.
