const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const DISCORD_CONTENT_LIMIT = 2000;

function text(value) {
    return value == null ? '' : String(value);
}

function clipped(value, limit, fallback = '') {
    const clean = text(value).trim() || fallback;
    return clean.length <= limit ? clean : `${clean.slice(0, Math.max(0, limit - 1))}…`;
}

function createQuestionFlow({ activeProcesses, writeStdin, coordinator }) {
    const pendingQuestions = new Map();
    let interactionCounter = 0;

    function nextInteractionToken() {
        interactionCounter = (interactionCounter + 1) % 1_000_000;
        return `${Date.now().toString(36)}-${interactionCounter}`;
    }

    function buildQuestionComponents(token, question, questionIndex) {
        const rows = [];
        const visibleOptions = question.options.slice(0, 25);
        const tooManyOptions = visibleOptions.length > 4;
        const useSelect = visibleOptions.length > 0 && (question.multiSelect || tooManyOptions);

        if (useSelect) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`auq:select:${token}:${questionIndex}`)
                .setPlaceholder(question.multiSelect ? 'Pick one or more…' : 'Pick one…')
                .setMinValues(1)
                .setMaxValues(question.multiSelect ? visibleOptions.length : 1)
                .addOptions(
                    visibleOptions.map((opt, i) => ({
                        label: clipped(opt.label, 100, `Option ${i + 1}`),
                        description: opt.description ? clipped(opt.description, 100) : undefined,
                        value: String(i),
                    }))
                );
            rows.push(new ActionRowBuilder().addComponents(select));
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`auq:custom:${token}:${questionIndex}`)
                    .setLabel('Custom answer')
                    .setStyle(ButtonStyle.Secondary)
            ));
        } else {
            const buttons = visibleOptions.slice(0, 4).map((opt, i) =>
                new ButtonBuilder()
                    .setCustomId(`auq:btn:${token}:${questionIndex}:${i}`)
                    .setLabel(clipped(opt.label, 80, `Option ${i + 1}`))
                    .setStyle(ButtonStyle.Primary)
            );
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`auq:custom:${token}:${questionIndex}`)
                    .setLabel('Custom')
                    .setStyle(ButtonStyle.Secondary)
            );
            rows.push(new ActionRowBuilder().addComponents(buttons));
        }
        return rows;
    }

    function renderQuestionBody(question, questionIndex, total) {
        const header = question.header ? `**${question.header}**` : '';
        const prefix = total > 1 ? `❓ Question ${questionIndex + 1}/${total}` : '❓';
        const lines = [];
        let length = 0;
        const append = (value, { allowTruncate = true } = {}) => {
            const line = text(value);
            const separator = lines.length ? 1 : 0;
            const available = DISCORD_CONTENT_LIMIT - length - separator;
            if (available <= 0) return false;
            if (line.length <= available) {
                lines.push(line);
                length += separator + line.length;
                return true;
            }
            if (!allowTruncate) return false;
            lines.push(clipped(line, available));
            length += separator + Math.min(line.length, available);
            return false;
        };

        append(`${prefix} ${header}`.trim());
        if (!append(question.question)) return lines.join('\n');
        if (question.multiSelect && !append('*Select one or more, then submit.*')) return lines.join('\n');
        for (let i = 0; i < question.options.length; i++) {
            const opt = question.options[i];
            let line = `\`${i + 1}.\` **${clipped(opt.label, 100, `Option ${i + 1}`)}**`;
            if (opt.description) line += ` — ${clipped(opt.description, 180)}`;
            if (!append(line)) break;
            if (opt.preview) append(`\`\`\`\n${clipped(opt.preview, 500)}\n\`\`\``, { allowTruncate: false });
        }
        return lines.join('\n');
    }

    async function handleAskUserQuestion(targetChannel, child, requestId, toolUseId, input, { conversationId } = {}) {
        const threadId = targetChannel.id;
        const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
        const questions = rawQuestions.map(q => ({
            question: text(q.question),
            header: text(q.header),
            multiSelect: !!q.multiSelect,
            options: Array.isArray(q.options) ? q.options.map((option) => ({
                label: text(option?.label),
                description: text(option?.description),
                preview: text(option?.preview),
            })) : [],
        }));

        if (questions.length === 0) {
            writeStdin(child, {
                type: 'control_response',
                response: {
                    subtype: 'success',
                    request_id: requestId,
                    response: { behavior: 'allow', updatedInput: { questions: [], answers: {} } },
                },
            });
            return;
        }

        const canonicalId = conversationId || threadId;
        if (coordinator) {
            coordinator.create({ conversationId: canonicalId, child, requestId, toolUseId, input });
            coordinator.addAlias(canonicalId, threadId);
        }

        const token = nextInteractionToken();
        const pending = {
            toolUseId,
            requestId,
            originalInput: input,
            questions,
            answers: {},
            currentIndex: 0,
            awaitingCustomFor: null,
            messages: [],
            token,
            conversationId: canonicalId,
        };
        pendingQuestions.set(threadId, pending);

        await renderCurrentQuestion(targetChannel);
    }

    async function renderCurrentQuestion(targetChannel) {
        const threadId = targetChannel.id;
        const pending = pendingQuestions.get(threadId);
        if (!pending) return;
        const q = pending.questions[pending.currentIndex];
        const body = renderQuestionBody(q, pending.currentIndex, pending.questions.length);
        const components = buildQuestionComponents(pending.token, q, pending.currentIndex);

        try {
            const msg = await targetChannel.send({ content: body, components });
            pending.messages.push(msg);
        } catch (e) {
            console.error('[DEBUG] Failed to send AskUserQuestion message:', e.message);
        }
    }

    async function advanceOrFinishQuestion(targetChannel) {
        const threadId = targetChannel.id;
        const pending = pendingQuestions.get(threadId);
        if (!pending) return;

        if (pending.currentIndex < pending.questions.length - 1) {
            pending.currentIndex += 1;
            await renderCurrentQuestion(targetChannel);
            return;
        }

        const child = activeProcesses.get(pending.conversationId) || activeProcesses.get(threadId);
        if (!child && !coordinator?.get(pending.conversationId)) {
            pendingQuestions.delete(threadId);
            await targetChannel.send('*(Answers collected, but the Claude process is no longer running.)*').catch(() => {});
            return;
        }

        const result = coordinator
            ? coordinator.resolve(pending.conversationId, pending.answers)
            : { ok: writeStdin(child, {
                type: 'control_response',
                response: {
                    subtype: 'success',
                    request_id: pending.requestId,
                    response: {
                        behavior: 'allow',
                        updatedInput: { questions: pending.originalInput.questions, answers: pending.answers },
                    },
                },
            }) };
        if (!result.ok) {
            await targetChannel.send('*(Failed to send answers — Claude stdin closed.)*').catch(() => {});
        }
    }

    async function disableQuestionComponents(pending, summary) {
        for (const msg of pending.messages) {
            try {
                await msg.edit({ content: msg.content + (summary ? `\n\n✅ ${summary}` : ''), components: [] });
            } catch { }
        }
    }

    async function handleInteraction(interaction) {
        const customId = interaction.customId || '';
        if (!customId.startsWith('auq:')) return false;

        const parts = customId.split(':');
        const kind = parts[1];
        const token = parts[2];
        const questionIndex = Number(parts[3]);

        const threadId = interaction.channelId;
        const pending = pendingQuestions.get(threadId);
        if (!pending || pending.token !== token) {
            await interaction.reply({ content: 'This question is no longer active.', ephemeral: true }).catch(() => {});
            return true;
        }
        if (questionIndex !== pending.currentIndex) {
            await interaction.reply({ content: 'Answer the current question first.', ephemeral: true }).catch(() => {});
            return true;
        }

        const q = pending.questions[questionIndex];

        if (kind === 'btn') {
            const optionIndex = Number(parts[4]);
            const label = q.options[optionIndex]?.label;
            if (label == null) {
                await interaction.reply({ content: 'Invalid option.', ephemeral: true }).catch(() => {});
                return true;
            }
            pending.answers[q.question] = label;
            await interaction.update({
                content: interaction.message.content + `\n\n✅ **${label}**`,
                components: [],
            }).catch(() => {});
            await advanceOrFinishQuestion(interaction.channel);
            return true;
        }

        if (kind === 'select') {
            const values = interaction.values || [];
            const labels = values.map(v => q.options[Number(v)]?.label).filter(Boolean);
            if (labels.length === 0) {
                await interaction.reply({ content: 'No valid options selected.', ephemeral: true }).catch(() => {});
                return true;
            }
            pending.answers[q.question] = q.multiSelect ? labels : labels[0];
            await interaction.update({
                content: interaction.message.content + `\n\n✅ ${labels.map(l => `**${l}**`).join(', ')}`,
                components: [],
            }).catch(() => {});
            await advanceOrFinishQuestion(interaction.channel);
            return true;
        }

        if (kind === 'custom') {
            pending.awaitingCustomFor = questionIndex;
            await interaction.update({
                content: interaction.message.content + `\n\n✏️ *Reply in this thread with your custom answer…*`,
                components: [],
            }).catch(() => {});
            return true;
        }

        return true;
    }

    async function consumeCustomAnswer(message, cleanPrompt) {
        const threadId = message.channel.isThread() ? message.channel.id : null;
        if (!threadId || !pendingQuestions.has(threadId)) return false;

        const pending = pendingQuestions.get(threadId);
        if (pending.awaitingCustomFor !== pending.currentIndex) return false;

        const q = pending.questions[pending.currentIndex];
        pending.answers[q.question] = q.multiSelect ? [cleanPrompt] : cleanPrompt;
        pending.awaitingCustomFor = null;
        await message.react('✏️');
        await advanceOrFinishQuestion(message.channel);
        return true;
    }

    async function clearForThread(threadId, summary) {
        const pending = pendingQuestions.get(threadId);
        if (!pending) return;
        pendingQuestions.delete(threadId);
        coordinator?.clear(pending.conversationId, summary);
        await disableQuestionComponents(pending, summary);
    }

    if (coordinator) {
        coordinator.subscribe(({ type, record, answers, summary }) => {
            if (type !== 'resolved' && type !== 'cleared') return;
            for (const [threadId, pending] of pendingQuestions) {
                if (pending.conversationId !== record.conversationId) continue;
                pendingQuestions.delete(threadId);
                const answerText = answers
                    ? Object.values(answers).flat().filter(Boolean).join(', ')
                    : '';
                disableQuestionComponents(pending, summary || (answerText ? `Answered: ${answerText}` : 'Answered.'));
            }
        });
    }

    return {
        pendingQuestions,
        handleAskUserQuestion,
        handleInteraction,
        consumeCustomAnswer,
        clearForThread,
    };
}

module.exports = {
    createQuestionFlow,
};
