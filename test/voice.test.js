const { test, expect, describe } = require('bun:test');

const audio = require('../src/voice/audio');
const { createVocabulary } = require('../src/voice/vocabulary');
const { looksHallucinated } = require('../src/voice/transcriber');
const { stripModelArtifacts, createCleanup } = require('../src/voice/cleanup');
const { createVoiceFlow } = require('../src/voice/voiceFlow');

const IS_VOICE_MESSAGE = 1 << 13;

function collection(items) {
    const map = new Map(items.map((it, i) => [String(i), it]));
    map.find = (fn) => [...map.values()].find(fn) || null;
    return map;
}

function fakeMessage({ attachments = [], flags = 0, content = '' } = {}) {
    return {
        content,
        flags: { bitfield: flags },
        attachments: collection(attachments),
        reactions: [],
        replies: [],
        channel: { id: 'chan', name: 'shadow-cube-dev', isThread: () => false },
        async react(emoji) { this.reactions.push(emoji); },
        async reply(payload) {
            this.replies.push(payload);
            const card = {
                content: payload.content ?? payload,
                components: payload.components,
                edits: [],
                channel: { send: async () => {} },
                async edit(next) {
                    this.content = next.content;
                    this.components = next.components;
                    this.edits.push(next.content);
                    return this;
                },
            };
            this.card = card;
            return card;
        },
    };
}

describe('audio detection', () => {
    test('detects a Discord voice message by flag', () => {
        const message = fakeMessage({
            flags: IS_VOICE_MESSAGE,
            attachments: [{ name: 'voice-message.ogg', contentType: 'audio/ogg', size: 1 }],
        });
        expect(audio.isVoiceMessage(message)).toBe(true);
        expect(audio.isAudioMessage(message)).toBe(true);
    });

    test('detects an uploaded audio file with no voice flag', () => {
        const message = fakeMessage({ attachments: [{ name: 'memo.m4a', contentType: null, size: 1 }] });
        expect(audio.isVoiceMessage(message)).toBe(false);
        expect(audio.isAudioMessage(message)).toBe(true);
    });

    test('ignores non-audio attachments and plain text', () => {
        expect(audio.isAudioMessage(fakeMessage({ attachments: [{ name: 'diff.patch', contentType: 'text/plain', size: 1 }] }))).toBe(false);
        expect(audio.isAudioMessage(fakeMessage({ attachments: [{ name: 'shot.png', contentType: 'image/png', size: 1 }] }))).toBe(false);
        expect(audio.isAudioMessage(fakeMessage({ content: 'hello' }))).toBe(false);
    });

    test('picks the audio attachment out of a mixed upload', () => {
        const message = fakeMessage({
            attachments: [{ name: 'shot.png', contentType: 'image/png', size: 1 }, { name: 'note.wav', contentType: 'audio/wav', size: 2 }],
        });
        expect(audio.pickAudioAttachment(message).name).toBe('note.wav');
    });

    test('formats durations', () => {
        expect(audio.formatDuration(6)).toBe('0:06');
        expect(audio.formatDuration(75)).toBe('1:15');
        expect(audio.formatDuration(null)).toBe('');
    });
});

describe('vocabulary', () => {
    const vocab = createVocabulary({ config: { VOCABULARY_PATH: '/nonexistent/vocabulary.txt' } });

    test('survives a missing vocabulary file', () => {
        expect(vocab.buildTerms()).toEqual([]);
        expect(vocab.buildWhisperPrompt([])).toBe('');
    });

    test('seeds terms from the channel and project', () => {
        const terms = vocab.buildTerms({ channelName: 'maestro-bots', projectName: 'maestro-assistant' });
        expect(terms).toContain('maestro-assistant');
        expect(terms).toContain('maestro bots');
        expect(terms).toContain('maestro-bots');
    });

    test('de-duplicates case-insensitively', () => {
        const terms = vocab.buildTerms({ channelName: 'Maestro-Assistant', projectName: 'maestro-assistant' });
        expect(terms.filter(t => t.toLowerCase() === 'maestro-assistant')).toHaveLength(1);
    });

    test('builds a glossary prompt and caps its length', () => {
        expect(vocab.buildWhisperPrompt(['worktree', 'Codex'])).toBe('Glossary: worktree, Codex.');
        const huge = Array.from({ length: 500 }, (_, i) => `term-number-${i}`);
        expect(vocab.buildWhisperPrompt(huge).length).toBeLessThanOrEqual(801);
    });
});

describe('hallucination filter', () => {
    test('rejects whisper silence artefacts', () => {
        for (const junk of ['[BLANK_AUDIO]', 'Thank you.', 'you', '(soft music)', 'Subtitles by the Amara.org community', 'Bye.']) {
            expect(looksHallucinated(junk)).toBe(true);
        }
    });

    test('keeps real prompts', () => {
        for (const real of ['Fix the failing test.', 'Thank you for fixing the worktree bug.', 'Run the tests']) {
            expect(looksHallucinated(real)).toBe(false);
        }
    });
});

describe('cleanup output sanitising', () => {
    test('strips reasoning traces, fences and preambles', () => {
        expect(stripModelArtifacts('<think>hmm</think>\nRun the tests.')).toBe('Run the tests.');
        expect(stripModelArtifacts('```\nRun the tests.\n```')).toBe('Run the tests.');
        expect(stripModelArtifacts('Corrected: Run the tests.')).toBe('Run the tests.');
        expect(stripModelArtifacts('"Run the tests."')).toBe('Run the tests.');
    });

    test('is a no-op when disabled', async () => {
        const cleanup = createCleanup({ config: { VOICE_CLEANUP_MODEL: '' } });
        expect(cleanup.enabled).toBe(false);
        expect(await cleanup.clean('Run the tests.')).toEqual({ text: 'Run the tests.', cleaned: false });
    });

    test('falls back to the raw transcript when ollama is unreachable', async () => {
        const cleanup = createCleanup({
            config: { VOICE_CLEANUP_MODEL: 'gemma3:1b', OLLAMA_HOST: 'http://127.0.0.1:1', VOICE_CLEANUP_KEEP_ALIVE: '30m' },
        });
        expect(await cleanup.clean('Run the tests.')).toEqual({ text: 'Run the tests.', cleaned: false });
    });
});

describe('voice flow', () => {
    const NEVER = 60_000;

    function harness({ transcript = 'run the tests', autoSendMs = NEVER, cleaned = false, downloadFails = false } = {}) {
        const dispatched = [];
        const flow = createVoiceFlow({
            config: {
                FFMPEG_BIN: 'ffmpeg',
                WHISPER_MODEL: '/models/whisper.bin',
                VOICE_AUTO_SEND_MS: autoSendMs,
                VOICE_MAX_BYTES: 1024 * 1024,
                VOICE_MAX_DURATION_SEC: 600,
            },
            channelHelpers: require('../src/discord/channel'),
            worktrees: { getProjectConfig: () => ({ projectName: 'demo' }) },
            formatting: require('../src/discord/formatting'),
            transcriber: { checkAvailability: () => [], transcribe: async () => transcript },
            vocabulary: { buildTerms: () => [], buildWhisperPrompt: () => '' },
            cleanup: { enabled: cleaned, model: 'gemma3:1b', warm: async () => {}, clean: async (t) => ({ text: t, cleaned }) },
            dispatch: async (message, text) => { dispatched.push(text); },
            audioOps: {
                ...audio,
                createTempDir: () => '/tmp/fake-voice',
                cleanupTempDir: () => {},
                downloadAttachment: async () => {
                    if (downloadFails) throw new Error('download failed with HTTP 404');
                },
                toWav: async () => '/tmp/fake-voice/input.wav',
            },
        });
        return { flow, dispatched };
    }

    function voiceMsg(extra = {}) {
        return fakeMessage({
            flags: IS_VOICE_MESSAGE,
            attachments: [{ name: 'voice-message.ogg', contentType: 'audio/ogg', size: 2048, duration: 6, url: 'http://example/x.ogg' }],
            ...extra,
        });
    }

    function tokenOf(card) {
        return card.components[0].components[0].data.custom_id.split(':')[2];
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    test('posts a confirm card with the transcript and three buttons', async () => {
        const { flow, dispatched } = harness();
        const message = voiceMsg();
        await flow.handle(message);

        expect(message.reactions).toContain('🎙️');
        expect(message.card.content).toContain('```text\nrun the tests\n```');
        expect(message.card.content).toContain('Sending <t:');
        const ids = message.card.components[0].components.map(b => b.data.custom_id.split(':')[1]);
        expect(ids).toEqual(['send', 'edit', 'cancel']);
        expect(dispatched).toHaveLength(0); // nothing sent before the window elapses
    });

    test('auto-sends when the window elapses', async () => {
        const { flow, dispatched } = harness({ autoSendMs: 40 });
        const message = voiceMsg();
        await flow.handle(message);
        expect(dispatched).toHaveLength(0);

        await sleep(120);
        expect(dispatched).toEqual(['run the tests']);
        expect(message.card.content).toContain('✅ Sent to the agent.');
        expect(message.card.components).toEqual([]);
    });

    test('"Send now" dispatches immediately and cancels the timer', async () => {
        const { flow, dispatched } = harness({ autoSendMs: 40 });
        const message = voiceMsg();
        await flow.handle(message);

        await flow.handleInteraction({
            customId: `vt:send:${tokenOf(message.card)}`,
            deferUpdate: async () => {},
        });
        expect(dispatched).toEqual(['run the tests']);

        await sleep(120); // the elapsed timer must not double-send
        expect(dispatched).toEqual(['run the tests']);
    });

    test('"Cancel" discards the transcript and never dispatches', async () => {
        const { flow, dispatched } = harness({ autoSendMs: 40 });
        const message = voiceMsg();
        await flow.handle(message);

        await flow.handleInteraction({
            customId: `vt:cancel:${tokenOf(message.card)}`,
            deferUpdate: async () => {},
        });
        expect(message.card.content).toContain('🗑️ Discarded.');
        expect(message.card.content).not.toContain('run the tests');

        await sleep(120);
        expect(dispatched).toHaveLength(0);
    });

    test('"Edit" pauses the countdown so the modal can stay open', async () => {
        const { flow, dispatched } = harness({ autoSendMs: 40 });
        const message = voiceMsg();
        await flow.handle(message);

        let shown = null;
        await flow.handleInteraction({
            customId: `vt:edit:${tokenOf(message.card)}`,
            showModal: async (modal) => { shown = modal; },
        });

        expect(shown.data.title).toBe('Edit transcript');
        expect(shown.components[0].components[0].data.value).toBe('run the tests');
        expect(message.card.content).toContain('⏸️ Auto-send paused');

        await sleep(120);
        expect(dispatched).toHaveLength(0); // paused, not fired
    });

    test('submitting the modal sends the edited text without a second countdown', async () => {
        const { flow, dispatched } = harness();
        const message = voiceMsg();
        await flow.handle(message);
        const token = tokenOf(message.card);

        await flow.handleInteraction({ customId: `vt:edit:${token}`, showModal: async () => {} });
        await flow.handleInteraction({
            customId: `vt:modal:${token}`,
            deferUpdate: async () => {},
            fields: { getTextInputValue: () => '  run the unit tests  ' },
        });

        expect(dispatched).toEqual(['run the unit tests']);
        expect(message.card.content).toContain('run the unit tests');
    });

    test('keeps a typed caption alongside the transcript', async () => {
        const { flow, dispatched } = harness({ autoSendMs: 40 });
        const message = voiceMsg({ content: 'context for this:' });
        await flow.handle(message);
        await sleep(120);
        expect(dispatched).toEqual(['context for this:\n\nrun the tests']);
    });

    test('escapes code fences so the card cannot be broken out of', async () => {
        const { flow } = harness({ transcript: 'use ``` to fence' });
        const message = voiceMsg();
        await flow.handle(message);
        expect(message.card.content).toContain('use ʼʼʼ to fence');
        expect(message.card.content.match(/```/g)).toHaveLength(2);
    });

    test('keeps the card under the Discord limit for a long dictation', async () => {
        const long = 'refactor the session store. '.repeat(400); // ~11k chars
        const { flow, dispatched } = harness({ transcript: long, autoSendMs: 40 });
        const message = voiceMsg();
        await flow.handle(message);

        expect(message.card.content.length).toBeLessThan(2000);
        expect(message.card.content).toContain('…');
        // Editing can't round-trip through a 4000-char modal, so it isn't offered.
        const ids = message.card.components[0].components.map(b => b.data.custom_id.split(':')[1]);
        expect(ids).toEqual(['send', 'cancel']);
        expect(message.card.content).toContain('Too long to edit here');

        await sleep(120);
        expect(message.card.content.length).toBeLessThan(2000);
        // ...but the agent still receives every word.
        expect(dispatched[0]).toBe(long);
    });

    test('says so when no speech was recognised', async () => {
        const { flow, dispatched } = harness({ transcript: '' });
        const message = voiceMsg();
        await flow.handle(message);
        expect(message.reactions).toContain('❓');
        expect(String(message.replies.at(-1))).toContain('Could not make out any speech');
        expect(dispatched).toHaveLength(0);
    });

    test('rejects clips over the size limit without transcribing', async () => {
        const { flow, dispatched } = harness();
        const message = fakeMessage({
            flags: IS_VOICE_MESSAGE,
            attachments: [{ name: 'voice-message.ogg', contentType: 'audio/ogg', size: 99 * 1024 * 1024, duration: 6 }],
        });
        await flow.handle(message);
        expect(String(message.replies[0])).toContain('the limit is 1MB');
        expect(dispatched).toHaveLength(0);
    });

    test('rejects clips over the duration limit', async () => {
        const { flow, dispatched } = harness();
        const message = fakeMessage({
            flags: IS_VOICE_MESSAGE,
            attachments: [{ name: 'voice-message.ogg', contentType: 'audio/ogg', size: 2048, duration: 4000 }],
        });
        await flow.handle(message);
        expect(String(message.replies[0])).toContain('66:40');
        expect(dispatched).toHaveLength(0);
    });

    test('reports a failed download instead of throwing', async () => {
        const { flow, dispatched } = harness({ downloadFails: true });
        const message = voiceMsg();
        await flow.handle(message);
        expect(message.reactions).toContain('⚠️');
        expect(String(message.replies.at(-1))).toContain('Transcription failed');
        expect(dispatched).toHaveLength(0);
    });

    test('stale interaction tokens are refused', async () => {
        const { flow } = harness();
        let replied = null;
        await flow.handleInteraction({
            customId: 'vt:send:does-not-exist',
            reply: async (payload) => { replied = payload; },
        });
        expect(replied.content).toContain('no longer pending');
        expect(replied.ephemeral).toBe(true);
    });

    test('a resolved transcript cannot be actioned twice', async () => {
        const { flow, dispatched } = harness();
        const message = voiceMsg();
        await flow.handle(message);
        const token = tokenOf(message.card);

        await flow.handleInteraction({ customId: `vt:send:${token}`, deferUpdate: async () => {} });
        let replied = null;
        await flow.handleInteraction({
            customId: `vt:send:${token}`,
            deferUpdate: async () => {},
            reply: async (p) => { replied = p; },
        });
        expect(dispatched).toHaveLength(1);
        expect(replied.content).toContain('no longer pending');
    });
});
