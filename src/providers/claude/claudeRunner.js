const { spawn } = require('child_process');
const path = require('path');
const { writeStdin, writeUserText } = require('./claudeStdio');
const { createToolFormatter } = require('./toolFormatter');

function createClaudeRunner({
    config,
    activeProcesses,
    sessionStore,
    channelStore,
    worktrees,
    memory,
    formatting,
    channelHelpers,
    questionFlow,
}) {
    function runClaude(prompt, targetChannel) {
        const threadId = targetChannel.id;
        let sessionId = sessionStore.getSessionId(threadId);

        const channelName = channelHelpers.getParentChannelName(targetChannel);
        const channelId = channelHelpers.getParentChannelId(targetChannel);
        const baseBranch = worktrees.getBaseBranch(channelId);
        const activeCwd = worktrees.ensureWorktree(channelName, baseBranch);

        const activePathKey = activeCwd.replace(/\//g, '-');
        const sessionIndexPath = path.join(
            process.env.HOME,
            `.claude/projects/${activePathKey}/sessions-index.json`
        );

        const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--dangerously-skip-permissions', '--permission-prompt-tool', 'stdio'];
        let systemPrompt = `The base branch for this worktree is \`${baseBranch}\`. Use \`${baseBranch}\` as the target for PRs, diffs, and comparisons — not \`main\` or \`master\` unless they match.`;

        const channelConfig = channelStore.loadChannelConfig();
        const channelRule = channelConfig[channelId]?.systemPrompt;
        if (channelRule) {
            systemPrompt += `\n\n${channelRule}`;
        }

        const learnedMemory = memory.readWorktreeMemory(activeCwd);
        if (learnedMemory) {
            systemPrompt += `\n\n# Learned memory — past corrections, do not repeat these mistakes\n${learnedMemory}`;
        }

        args.push('--append-system-prompt', systemPrompt);
        if (sessionId) {
            args.push('--resume', sessionId);
        }

        console.log(`[DEBUG] [Thread: ${threadId}] SPAWNING CLAUDE in ${activeCwd} (branch: ${worktrees.branchName(worktrees.sanitizeChannelName(channelName))})...`);
        const child = spawn('claude', args, { cwd: activeCwd });

        activeProcesses.set(threadId, child);
        writeUserText(child, prompt);

        let thinkingBuffer = '';
        let textBuffer = '';
        let currentBlockType = null;
        let currentToolName = null;
        let toolInputBuffer = '';
        let thinkingMessage = null;
        let textMessage = null;
        let resultSessionId = null;
        let lineBuffer = '';
        let hasOutput = false;

        let thinkingEditTimer = null;
        let textEditTimer = null;
        const EDIT_INTERVAL = 1500;
        const formatToolUse = createToolFormatter({
            activeCwd,
            projectDir: config.PROJECT_DIR,
            detectLanguage: formatting.detectLanguage,
        });

        async function sendOrEditThinking(final = false, snapshot = null) {
            const text = snapshot || thinkingBuffer;
            if (!text.trim()) return;
            hasOutput = true;

            const header = final ? '**Thinking** (complete)' : '**Thinking...**';
            let thinkingText = text.trim();
            const maxThinkingLen = formatting.MAX_MSG_LEN - header.length - 20;
            if (thinkingText.length > maxThinkingLen) {
                if (!final) {
                    thinkingText = '...' + thinkingText.slice(-maxThinkingLen);
                }
            }

            const lines = thinkingText.split('\n').map(l => `> ${l}`).join('\n');
            const content = `${header}\n${lines}`;
            const chunks = formatting.splitForDiscord(content);

            try {
                if (!thinkingMessage) {
                    thinkingMessage = await targetChannel.send(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        await targetChannel.send(chunks[i]);
                    }
                } else {
                    await thinkingMessage.edit(chunks[0]);
                }
            } catch (e) {
                console.error('[DEBUG] Failed to send/edit thinking:', e.message);
            }
        }

        async function sendOrEditText(final = false, snapshot = null) {
            const text = snapshot || textBuffer;
            if (!text.trim()) return;
            hasOutput = true;

            let content = formatting.prettifyCodeBlocks(text.trim());
            const chunks = formatting.splitForDiscord(content);

            try {
                if (!textMessage) {
                    textMessage = await targetChannel.send(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        await targetChannel.send(chunks[i]);
                    }
                } else if (final) {
                    await textMessage.edit(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        await targetChannel.send(chunks[i]);
                    }
                } else {
                    let preview = content;
                    if (preview.length > formatting.MAX_MSG_LEN) {
                        preview = content.slice(0, formatting.MAX_MSG_LEN - 10) + '\n...';
                        const openTicks = (preview.match(/```/g) || []).length;
                        if (openTicks % 2 !== 0) preview += '\n```';
                    }
                    await textMessage.edit(preview);
                }
            } catch (e) {
                console.error('[DEBUG] Failed to send/edit text:', e.message);
            }
        }

        async function sendToolUse(toolName, inputJson) {
            const formatted = formatToolUse(toolName, inputJson);
            const chunks = formatting.splitForDiscord(formatted);
            for (const chunk of chunks) {
                await targetChannel.send(chunk).catch(console.error);
            }
            hasOutput = true;
        }

        function processLine(line) {
            if (!line.trim()) return;

            let data;
            try {
                data = JSON.parse(line);
            } catch {
                return;
            }

            if (data.type === 'stream_event' && data.event) {
                const evt = data.event;

                if (evt.type === 'content_block_start' && evt.content_block) {
                    currentBlockType = evt.content_block.type;
                    if (currentBlockType === 'tool_use') {
                        currentToolName = evt.content_block.name || null;
                        toolInputBuffer = '';
                    }
                }

                if (evt.type === 'content_block_delta' && evt.delta) {
                    if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                        thinkingBuffer += evt.delta.thinking;
                        clearTimeout(thinkingEditTimer);
                        thinkingEditTimer = setTimeout(() => sendOrEditThinking(false), EDIT_INTERVAL);
                    }
                    if (evt.delta.type === 'text_delta' && evt.delta.text) {
                        textBuffer += evt.delta.text;
                        clearTimeout(textEditTimer);
                        textEditTimer = setTimeout(() => sendOrEditText(false), EDIT_INTERVAL);
                    }
                    if (evt.delta.type === 'input_json_delta' && evt.delta.partial_json) {
                        toolInputBuffer += evt.delta.partial_json;
                    }
                }

                if (evt.type === 'content_block_stop') {
                    if (currentBlockType === 'thinking') {
                        clearTimeout(thinkingEditTimer);
                        const snap = thinkingBuffer;
                        thinkingBuffer = '';
                        thinkingMessage = null;
                        sendOrEditThinking(true, snap);
                    }
                    if (currentBlockType === 'text') {
                        clearTimeout(textEditTimer);
                        const snap = textBuffer;
                        textBuffer = '';
                        textMessage = null;
                        sendOrEditText(true, snap);
                    }
                    if (currentBlockType === 'tool_use' && currentToolName) {
                        if (currentToolName !== 'AskUserQuestion') {
                            sendToolUse(currentToolName, toolInputBuffer);
                        }
                        currentToolName = null;
                        toolInputBuffer = '';
                    }
                    currentBlockType = null;
                }
            }

            if (data.type === 'control_request' && data.request?.subtype === 'can_use_tool') {
                const req = data.request;
                const requestId = data.request_id;
                if (req.tool_name === 'AskUserQuestion') {
                    questionFlow.handleAskUserQuestion(targetChannel, child, requestId, req.tool_use_id, req.input || {});
                } else {
                    writeStdin(child, {
                        type: 'control_response',
                        response: {
                            subtype: 'success',
                            request_id: requestId,
                            response: { behavior: 'allow', updatedInput: req.input || {} },
                        },
                    });
                }
                return;
            }

            if (data.type === 'result') {
                resultSessionId = data.session_id;
                if (data.total_cost_usd) {
                    const cost = `*Cost: $${data.total_cost_usd.toFixed(4)} | Turns: ${data.num_turns || 1}*`;
                    targetChannel.send(cost).catch(console.error);
                }
            }
        }

        child.stdout.on('data', (rawData) => {
            lineBuffer += rawData.toString();
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop();
            for (const line of lines) {
                processLine(line);
            }
        });

        child.stderr.on('data', (data) => {
            const text = formatting.stripAnsi(data.toString()).trim();
            if (text && !text.includes('no stdin data received')) {
                console.error(`[DEBUG] [Thread: ${threadId}] STDERR: ${text}`);
            }
        });

        child.on('close', (code) => {
            if (lineBuffer.trim()) {
                processLine(lineBuffer);
                lineBuffer = '';
            }

            clearTimeout(thinkingEditTimer);
            clearTimeout(textEditTimer);

            (async () => {
                if (thinkingBuffer.trim()) await sendOrEditThinking(true);
                if (textBuffer.trim()) await sendOrEditText(true);

                if (!hasOutput) {
                    targetChannel.send('*(No output received)*').catch(console.error);
                }
            })();

            activeProcesses.delete(threadId);
            questionFlow.clearForThread(threadId, 'Session ended.').catch(() => {});
            console.log(`[DEBUG] [Thread: ${threadId}] PROCESS EXITED (Code: ${code})`);

            const sid = resultSessionId || sessionStore.getLatestSessionId(sessionIndexPath);
            if (sid) {
                sessionStore.setSessionId(threadId, sid, channelName);
            }
        });
    }

    return {
        runClaude,
    };
}

module.exports = {
    createClaudeRunner,
};
