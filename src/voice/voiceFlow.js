const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const audio = require('./audio');

const MAX_TRANSCRIPT_DISPLAY = 1500;
const MODAL_INPUT_LIMIT = 4000;

function fenceSafe(text) {
    return text.replace(/```/g, "ʼʼʼ");
}

function createVoiceFlow({
    config,
    channelHelpers,
    worktrees,
    formatting,
    transcriber,
    vocabulary,
    cleanup,
    dispatch,
    audioOps = audio,
}) {
    const pending = new Map();
    let tokenCounter = 0;

    // whisper is GPU-bound; two voice notes at once just makes both slower.
    let queue = Promise.resolve();
    function enqueue(task) {
        const run = queue.then(task, task);
        queue = run.catch(() => {});
        return run;
    }

    function nextToken() {
        tokenCounter = (tokenCounter + 1) % 1_000_000;
        return `${Date.now().toString(36)}-${tokenCounter}`;
    }

    // A long dictation can exceed Discord's 2000 character message limit; the agent
    // still receives the full text, only the card is abbreviated.
    function transcriptBlock(text) {
        const shown = text.length > MAX_TRANSCRIPT_DISPLAY
            ? `${text.slice(0, MAX_TRANSCRIPT_DISPLAY)}…`
            : text;
        return `\`\`\`text\n${fenceSafe(shown)}\n\`\`\``;
    }

    function isEditable(entry) {
        return entry.text.length <= MODAL_INPUT_LIMIT;
    }

    function buildRows(token, { paused, editable = true } = {}) {
        const buttons = [
            new ButtonBuilder()
                .setCustomId(`vt:send:${token}`)
                .setLabel(paused ? 'Send' : 'Send now')
                .setStyle(ButtonStyle.Success),
        ];
        if (editable) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`vt:edit:${token}`)
                    .setLabel('Edit')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`vt:cancel:${token}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );
        return [new ActionRowBuilder().addComponents(buttons)];
    }

    function renderCard(entry, { paused } = {}) {
        const meta = ['🎙️ **Transcript**'];
        if (entry.durationLabel) meta.push(entry.durationLabel);
        if (entry.cleaned) meta.push(`cleaned by \`${cleanup.model}\``);

        const notes = [];
        if (paused) {
            notes.push('⏸️ Auto-send paused. Press **Send** when you are happy with it.');
        } else {
            notes.push(`Sending <t:${Math.floor(entry.sendAt / 1000)}:R> — edit or cancel before then.`);
        }
        if (!isEditable(entry)) {
            notes.push('*(Too long to edit here — cancel and re-record if it is wrong.)*');
        }

        return `${meta.join(' · ')}\n${transcriptBlock(entry.text)}\n${notes.join('\n')}`;
    }

    function clearTimer(entry) {
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
    }

    async function finish(entry, { note, keepText }) {
        clearTimer(entry);
        pending.delete(entry.token);
        const body = `🎙️ **Transcript**${entry.durationLabel ? ` · ${entry.durationLabel}` : ''}\n`
            + (keepText ? `${transcriptBlock(entry.text)}\n` : '')
            + note;
        await entry.card.edit({ content: body, components: [] }).catch(() => {});
    }

    async function send(entry) {
        if (entry.resolved) return;
        entry.resolved = true;
        await finish(entry, { note: '✅ Sent to the agent.', keepText: true });
        try {
            await dispatch(entry.message, entry.text);
        } catch (e) {
            console.error('[DEBUG] failed to dispatch voice transcript:', e.message);
            await entry.card.channel.send('⚠️ Failed to hand the transcript to the agent.').catch(() => {});
        }
    }

    function armTimer(entry) {
        clearTimer(entry);
        entry.sendAt = Date.now() + config.VOICE_AUTO_SEND_MS;
        entry.timer = setTimeout(() => { send(entry); }, config.VOICE_AUTO_SEND_MS);
    }

    async function transcribeMessage(message, attachment) {
        const tmpDir = audioOps.createTempDir();
        try {
            const ext = path.extname(attachment.name || '') || '.ogg';
            const sourcePath = path.join(tmpDir, `input${ext}`);
            const wavPath = path.join(tmpDir, 'input.wav');

            await audioOps.downloadAttachment(attachment, sourcePath);
            await audioOps.toWav(config.FFMPEG_BIN, sourcePath, wavPath);

            const channelId = channelHelpers.getParentChannelId(message.channel);
            const terms = vocabulary.buildTerms({
                channelName: channelHelpers.getParentChannelName(message.channel),
                projectName: worktrees.getProjectConfig(channelId)?.projectName,
            });

            const raw = await transcriber.transcribe(wavPath, {
                prompt: vocabulary.buildWhisperPrompt(terms),
            });
            if (!raw) return { text: '', cleaned: false };

            console.log(`[DEBUG] transcribed ${attachment.name}: "${raw}"`);
            const result = await cleanup.clean(raw, terms);

            // An audio file can arrive with a typed caption; keep both, caption first.
            const caption = formatting.stripDiscordTags(message.content || '');
            if (caption) result.text = `${caption}\n\n${result.text}`;
            return result;
        } finally {
            audioOps.cleanupTempDir(tmpDir);
        }
    }

    async function handle(message) {
        const attachment = audio.pickAudioAttachment(message);
        if (!attachment) return;

        if (attachment.size > config.VOICE_MAX_BYTES) {
            await message.reply(`🎙️ That clip is ${(attachment.size / 1024 / 1024).toFixed(1)}MB — the limit is ${Math.round(config.VOICE_MAX_BYTES / 1024 / 1024)}MB.`).catch(() => {});
            return;
        }
        const duration = attachment.duration ?? null;
        if (duration && duration > config.VOICE_MAX_DURATION_SEC) {
            await message.reply(`🎙️ That clip is ${audio.formatDuration(duration)} — the limit is ${audio.formatDuration(config.VOICE_MAX_DURATION_SEC)}.`).catch(() => {});
            return;
        }

        await message.react('🎙️').catch(() => {});

        let result;
        try {
            result = await enqueue(() => transcribeMessage(message, attachment));
        } catch (e) {
            console.error('[DEBUG] transcription failed:', e.message);
            await message.react('⚠️').catch(() => {});
            await message.reply(`🎙️ Transcription failed: ${e.message}`).catch(() => {});
            return;
        }

        if (!result.text) {
            await message.react('❓').catch(() => {});
            await message.reply('🎙️ Could not make out any speech in that clip.').catch(() => {});
            return;
        }

        const token = nextToken();
        const entry = {
            token,
            message,
            text: result.text,
            cleaned: result.cleaned,
            durationLabel: audio.formatDuration(duration),
            resolved: false,
            timer: null,
            sendAt: Date.now() + config.VOICE_AUTO_SEND_MS,
        };

        try {
            entry.card = await message.reply({
                content: renderCard(entry),
                components: buildRows(token, { editable: isEditable(entry) }),
            });
        } catch (e) {
            console.error('[DEBUG] failed to post transcript card:', e.message);
            return;
        }

        pending.set(token, entry);
        armTimer(entry);
    }

    async function showEditModal(interaction, entry) {
        const input = new TextInputBuilder()
            .setCustomId('transcript')
            .setLabel('Transcript')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.text.slice(0, MODAL_INPUT_LIMIT))
            .setMaxLength(MODAL_INPUT_LIMIT)
            .setRequired(true);

        const modal = new ModalBuilder()
            .setCustomId(`vt:modal:${entry.token}`)
            .setTitle('Edit transcript')
            .addComponents(new ActionRowBuilder().addComponents(input));

        await interaction.showModal(modal);
    }

    async function handleInteraction(interaction) {
        const parts = (interaction.customId || '').split(':');
        const action = parts[1];
        const token = parts[2];
        const entry = pending.get(token);

        if (!entry || entry.resolved) {
            await interaction.reply({ content: 'That transcript is no longer pending.', ephemeral: true }).catch(() => {});
            return;
        }

        if (action === 'send') {
            await interaction.deferUpdate().catch(() => {});
            await send(entry);
            return;
        }

        if (action === 'cancel') {
            entry.resolved = true;
            await interaction.deferUpdate().catch(() => {});
            await finish(entry, { note: '🗑️ Discarded.', keepText: false });
            return;
        }

        if (action === 'edit') {
            // Pause first: the modal can sit open far longer than the auto-send window.
            clearTimer(entry);
            await showEditModal(interaction, entry);
            await entry.card.edit({
                content: renderCard(entry, { paused: true }),
                components: buildRows(token, { paused: true, editable: isEditable(entry) }),
            }).catch(() => {});
            return;
        }

        if (action === 'modal') {
            const edited = interaction.fields.getTextInputValue('transcript').trim();
            await interaction.deferUpdate().catch(() => {});
            if (!edited) {
                entry.resolved = true;
                await finish(entry, { note: '🗑️ Discarded (empty after edit).', keepText: false });
                return;
            }
            // Editing is itself a confirmation — no second countdown.
            entry.text = edited;
            entry.cleaned = false;
            await send(entry);
        }
    }

    function start() {
        const problems = transcriber.checkAvailability();
        for (const problem of problems) {
            console.warn(`[DEBUG] voice messages unavailable: ${problem}`);
        }
        if (problems.length > 0) return;

        const cleanupNote = cleanup.enabled ? `cleanup: ${cleanup.model}` : 'cleanup: off';
        console.log(`[DEBUG] VOICE ENABLED (model: ${path.basename(config.WHISPER_MODEL)}, ${cleanupNote}, auto-send: ${config.VOICE_AUTO_SEND_MS}ms)`);
        cleanup.warm();
    }

    return {
        isAudioMessage: audio.isAudioMessage,
        handle,
        handleInteraction,
        start,
    };
}

module.exports = {
    createVoiceFlow,
};
