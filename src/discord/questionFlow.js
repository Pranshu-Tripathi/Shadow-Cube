const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

function createQuestionFlow({ activeProcesses, writeStdin }) {
    const pendingQuestions = new Map();
    let interactionCounter = 0;

    function nextInteractionToken() {
        interactionCounter = (interactionCounter + 1) % 1_000_000;
        return `${Date.now().toString(36)}-${interactionCounter}`;
    }

    function buildQuestionComponents(token, question, questionIndex) {
        const rows = [];
        const tooManyOptions = question.options.length > 4;
        const useSelect = question.multiSelect || tooManyOptions;

        if (useSelect) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`auq:select:${token}:${questionIndex}`)
                .setPlaceholder(question.multiSelect ? 'Pick one or more…' : 'Pick one…')
                .setMinValues(1)
                .setMaxValues(question.multiSelect ? question.options.length : 1)
                .addOptions(
                    question.options.slice(0, 25).map((opt, i) => ({
                        label: opt.label.slice(0, 100),
                        description: opt.description ? opt.description.slice(0, 100) : undefined,
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
            const buttons = question.options.slice(0, 4).map((opt, i) =>
                new ButtonBuilder()
                    .setCustomId(`auq:btn:${token}:${questionIndex}:${i}`)
                    .setLabel(opt.label.slice(0, 80))
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
        const lines = [`${prefix} ${header}`.trim(), question.question];
        if (question.multiSelect) lines.push('*Select one or more, then submit.*');
        for (let i = 0; i < question.options.length; i++) {
            const opt = question.options[i];
            let line = `\`${i + 1}.\` **${opt.label}**`;
            if (opt.description) line += ` — ${opt.description}`;
            lines.push(line);
            if (opt.preview) lines.push(`\`\`\`\n${opt.preview.slice(0, 500)}\n\`\`\``);
        }
        return lines.join('\n');
    }

    async function handleAskUserQuestion(targetChannel, child, requestId, toolUseId, input) {
        const threadId = targetChannel.id;
        const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
        const questions = rawQuestions.map(q => ({
            question: q.question || '',
            header: q.header || '',
            multiSelect: !!q.multiSelect,
            options: Array.isArray(q.options) ? q.options : [],
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

        const child = activeProcesses.get(threadId);
        pendingQuestions.delete(threadId);
        if (!child) {
            await targetChannel.send('*(Answers collected, but the Claude process is no longer running.)*').catch(() => {});
            return;
        }
        const ok = writeStdin(child, {
            type: 'control_response',
            response: {
                subtype: 'success',
                request_id: pending.requestId,
                response: {
                    behavior: 'allow',
                    updatedInput: {
                        questions: pending.originalInput.questions,
                        answers: pending.answers,
                    },
                },
            },
        });
        if (!ok) {
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
        await disableQuestionComponents(pending, summary);
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
