# Shadow Cube Bridge

A Discord bot that bridges Claude Code CLI to Discord. Send prompts in a channel, get streaming responses in threads with real-time thinking, tool use diffs, and code block syntax highlighting.

## Features

- Streams Claude's thinking process in real-time (block-quoted, live-edited)
- Displays tool usage with formatted code blocks (Edit diffs, Bash commands, file reads)
- Auto-creates Discord threads per query
- Session persistence across messages in the same thread
- Code block auto-detection and syntax highlighting for Discord

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
   ```
   - `DISCORD_TOKEN` - Your Discord bot token
   - `PROJECT_DIR` - The directory Claude Code will operate in (reads/edits files here)

5. Run the bot:
   ```bash
   bun relay.js
   ```

## Usage

- **Send a message** mentioning the bot in any channel - it creates a thread and streams Claude's response
- **Reply in thread** to continue the conversation in the same Claude session
- **`!clear`** in a thread to reset the session and kill any running process

## How It Works

The bot spawns `claude -p` with `--output-format stream-json` for each query, parsing the JSONL stream to separate thinking blocks, text content, and tool use into distinct Discord messages. Sessions are persisted per-thread so follow-up messages resume the same Claude conversation.
