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

## Git Worktrees

Each Discord channel automatically gets its own [git worktree](https://git-scm.com/docs/git-worktree), allowing parallel work on different tickets without file conflicts. Worktrees are created on first message and branch off the channel's configured base branch (or the repo default).

- Branch naming: `<BRANCH_PREFIX>/<channel-name>` (default prefix: `shadow-cube`)
- Worktree location: `WORKTREES_DIR` or `PROJECT_DIR/../.shadow-cube-worktrees/<channel-name>`
- Set base branch per channel: `!base feature/my-branch`
- If worktree creation fails, the bot falls back to `PROJECT_DIR`

## How It Works

The bot spawns `claude -p` with `--output-format stream-json` for each query, parsing the JSONL stream to separate thinking blocks, text content, and tool use into distinct Discord messages. Sessions are persisted per-thread so follow-up messages resume the same Claude conversation.
