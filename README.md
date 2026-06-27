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
   PROJECT_DIR=/absolute/path/to/your/project
   # WORKTREES_DIR=/optional/custom/path/for/worktrees
   ```
   - `DISCORD_TOKEN` - Your Discord bot token
   - `PROJECT_DIR` - The directory Claude Code will operate in (must be a git repository)
   - `WORKTREES_DIR` *(optional)* - Custom location for git worktrees (default: `PROJECT_DIR/../.shadow-cube-worktrees`)
   - `BRANCH_PREFIX` *(optional)* - Prefix for worktree branch names (default: `shadow-cube`). Set to empty string for no prefix.
   - `GITHUB_PAT` *(optional)* - GitHub personal access token used by `!repo` to read prompts/skills (required for private repos)

5. Run the bot:
   ```bash
   bun relay.js
   ```

## Usage

- **Send a message** mentioning the bot in any channel - it creates a thread and streams Claude's response
- **Reply in thread** to continue the conversation in the same Claude session
- **`!clear`** in a thread to reset the session and kill any running process
- **`!deploy`** or **`!deploy <message>`** to commit all changes in the channel's worktree branch
- **`!clear --worktree`** (or `!clear -w`) in a thread to also remove the channel's git worktree
- **`!base <branch>`** in a channel to set the base branch for that channel's worktree (persists across restarts)
- **`!worktrees`** to list all active git worktrees
- **`!repo`** to pull a system prompt and skills from a configured GitHub repo (see below)
- **`!memory`** to teach the channel a lasting lesson that's layered onto its system prompt (see below)

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

Each Discord channel automatically gets its own [git worktree](https://git-scm.com/docs/git-worktree), allowing parallel work on different tickets without file conflicts. Worktrees are created on first message and branch off the channel's configured base branch (or the repo default).

- Branch naming: `<BRANCH_PREFIX>/<channel-name>` (default prefix: `shadow-cube`)
- Worktree location: `WORKTREES_DIR` or `PROJECT_DIR/../.shadow-cube-worktrees/<channel-name>`
- Set base branch per channel: `!base feature/my-branch`
- If worktree creation fails, the bot falls back to `PROJECT_DIR`
- Each worktree is scaffolded with an `.out/` directory on creation; bot artifacts (`.out/`, `.skills/`, `.claude/`, `.shadow-cube-base`) are added to the worktree's local git exclude so they never appear in the target repo's `git status`

## How It Works

The bot spawns `claude -p` with `--output-format stream-json` for each query, parsing the JSONL stream to separate thinking blocks, text content, and tool use into distinct Discord messages. Sessions are persisted per-thread so follow-up messages resume the same Claude conversation.
