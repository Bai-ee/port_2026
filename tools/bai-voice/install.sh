#!/bin/zsh
# Installs the /bai hands-free voice mode for Claude Code on macOS (Apple Silicon recommended).
# Usage: ./install.sh            (installs into ~/bai-voice)
#        BAI_HOME=/path ./install.sh
# What it does: whisper.cpp (Homebrew) + speech model, Kokoro TTS (Python venv via uv) + voice model,
# copies the voice scripts into $BAI_HOME, and installs the /bai skill into ~/.claude/skills/bai.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BAI_HOME="${BAI_HOME:-$HOME/bai-voice}"
SKILL_DIR="$HOME/.claude/skills/bai"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
KOKORO_BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

say_step() { print -P "%F{green}==>%f $1"; }

[[ "$(uname)" == "Darwin" ]] || { echo "macOS only (uses afplay/say and Homebrew)."; exit 1; }
command -v brew >/dev/null || { echo "Homebrew is required: https://brew.sh"; exit 1; }

say_step "Installing whisper.cpp + SDL2 (Homebrew)"
brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp
brew list sdl2 >/dev/null 2>&1 || brew install sdl2

say_step "Installing uv (Python env manager) if missing"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

say_step "Copying voice scripts into $BAI_HOME"
mkdir -p "$BAI_HOME/models" "$BAI_HOME/sessions"
cp "$HERE"/voice/{start.sh,listen.py,speak.sh,tts.sh,tts_server.py} "$BAI_HOME/"
chmod +x "$BAI_HOME"/{start.sh,listen.py,speak.sh,tts.sh}

say_step "Downloading speech-to-text model (~1.6 GB, skipped if present)"
[[ -s "$BAI_HOME/models/ggml-large-v3-turbo.bin" ]] || curl -L --fail -o "$BAI_HOME/models/ggml-large-v3-turbo.bin" "$WHISPER_MODEL_URL"

say_step "Setting up Kokoro text-to-speech (venv + ~350 MB model)"
[[ -d "$BAI_HOME/tts-venv" ]] || uv venv -q --python 3.12 "$BAI_HOME/tts-venv"
VIRTUAL_ENV="$BAI_HOME/tts-venv" uv pip install -q kokoro-onnx soundfile
[[ -s "$BAI_HOME/models/kokoro-v1.0.onnx" ]] || curl -L --fail -o "$BAI_HOME/models/kokoro-v1.0.onnx" "$KOKORO_BASE/kokoro-v1.0.onnx"
[[ -s "$BAI_HOME/models/voices-v1.0.bin" ]] || curl -L --fail -o "$BAI_HOME/models/voices-v1.0.bin" "$KOKORO_BASE/voices-v1.0.bin"

say_step "Installing the /bai skill into $SKILL_DIR"
mkdir -p "$SKILL_DIR"
sed "s#__BAI_HOME__#$BAI_HOME#g" "$HERE/skill/SKILL.md" > "$SKILL_DIR/SKILL.md"

say_step "Smoke test: TTS loads and synthesises"
"$BAI_HOME/tts-venv/bin/python" - "$BAI_HOME" <<'PY'
import sys, time
from kokoro_onnx import Kokoro
h = sys.argv[1]
t = time.time()
k = Kokoro(f"{h}/models/kokoro-v1.0.onnx", f"{h}/models/voices-v1.0.bin")
s, r = k.create("Voice mode installed.", voice="af_heart", speed=1.1, lang="en-us")
print(f"kokoro ok ({time.time() - t:.1f}s, {len(s) / r:.1f}s audio)")
PY
command -v whisper-stream >/dev/null && echo "whisper-stream ok"

cat <<EOF

Installed.
  Home:  $BAI_HOME   (set BAI_HOME in your shell profile if you used a custom path)
  Skill: $SKILL_DIR/SKILL.md
Next: open Claude Code and type /bai. The first run asks macOS for microphone access for your terminal app; allow it.
Turn off with /bai off. Transcripts are kept in $BAI_HOME/sessions/ (local only).
EOF
