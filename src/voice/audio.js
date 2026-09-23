const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IS_VOICE_MESSAGE = 1 << 13;
const AUDIO_EXTENSIONS = ['.ogg', '.oga', '.opus', '.mp3', '.m4a', '.wav', '.flac', '.aac', '.webm', '.aiff'];

function isVoiceMessage(message) {
    const bits = message.flags?.bitfield ?? 0;
    return (bits & IS_VOICE_MESSAGE) !== 0;
}

function looksLikeAudio(attachment) {
    if (attachment.contentType && attachment.contentType.startsWith('audio/')) return true;
    const ext = path.extname(attachment.name || '').toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
}

function pickAudioAttachment(message) {
    if (!message.attachments || message.attachments.size === 0) return null;
    return message.attachments.find(looksLikeAudio) || null;
}

function isAudioMessage(message) {
    return isVoiceMessage(message) || pickAudioAttachment(message) != null;
}

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cube-voice-'));
}

async function downloadAttachment(attachment, destPath) {
    const response = await fetch(attachment.url);
    if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return destPath;
}

// whisper.cpp cannot decode Opus (which is what Discord voice messages are), so
// everything gets normalised to the 16kHz mono PCM that the model expects anyway.
function toWav(ffmpegBin, inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const args = ['-v', 'error', '-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath];
        const child = spawn(ffmpegBin, args);
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => reject(new Error(`${ffmpegBin} failed to start: ${err.message}`)));
        child.on('close', (code) => {
            if (code === 0) return resolve(outputPath);
            reject(new Error(`${ffmpegBin} exited ${code}: ${stderr.trim().slice(0, 300)}`));
        });
    });
}

function cleanupTempDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        console.error(`[DEBUG] failed to clean up ${dir}:`, e.message);
    }
}

function formatDuration(seconds) {
    if (!seconds || !Number.isFinite(seconds)) return '';
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

module.exports = {
    isVoiceMessage,
    isAudioMessage,
    pickAudioAttachment,
    createTempDir,
    cleanupTempDir,
    downloadAttachment,
    toWav,
    formatDuration,
};
