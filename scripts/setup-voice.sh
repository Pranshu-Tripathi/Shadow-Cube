#!/usr/bin/env bash
# Installs everything the voice-message pipeline needs:
#   ffmpeg      - decodes Discord's ogg/opus into the 16kHz mono wav whisper wants
#   whisper-cpp - the local transcriber (whisper-cli)
#   a ggml model - downloaded to ~/.cache/whisper.cpp
#   gemma3:1b   - optional ollama model for the transcript cleanup pass
set -euo pipefail

MODEL_NAME="${WHISPER_MODEL_NAME:-ggml-large-v3-turbo-q5_0.bin}"
MODEL_DIR="${HOME}/.cache/whisper.cpp"
MODEL_PATH="${MODEL_DIR}/${MODEL_NAME}"
CLEANUP_MODEL="${VOICE_CLEANUP_MODEL:-gemma3:1b}"

echo "==> Installing ffmpeg and whisper-cpp"
if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install ffmpeg and whisper-cpp manually, then re-run." >&2
    exit 1
fi
brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp

echo "==> Fetching the whisper model (${MODEL_NAME})"
if [ -f "${MODEL_PATH}" ]; then
    echo "    already present at ${MODEL_PATH}"
else
    mkdir -p "${MODEL_DIR}"
    curl -fL --retry 3 --progress-bar \
        -o "${MODEL_PATH}" \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}"
fi

echo "==> Transcript cleanup model (${CLEANUP_MODEL})"
if [ -z "${CLEANUP_MODEL}" ]; then
    echo "    skipped (VOICE_CLEANUP_MODEL is empty)"
elif command -v ollama >/dev/null 2>&1; then
    ollama pull "${CLEANUP_MODEL}"
else
    echo "    ollama not found — cleanup will be skipped at runtime."
    echo "    Install from https://ollama.com, or set VOICE_CLEANUP_MODEL= to silence this."
fi

echo
echo "Voice setup complete. Model: ${MODEL_PATH}"
echo "Send a Discord voice message to any configured channel to try it."
