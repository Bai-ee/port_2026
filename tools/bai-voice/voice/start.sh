#!/bin/zsh
# Always-on mic -> text. Each spoken chunk (ended by a pause) becomes lines in sessions/<time>.txt.
# inbox.log always points at the newest session file. Stop with Ctrl+C.
cd "$(dirname "$0")"
mkdir -p sessions
session="sessions/$(date +%Y-%m-%d_%H%M%S).txt"
: > "$session"
ln -sf "$session" inbox.log
echo "Listening. Writing to $PWD/$session (inbox.log). Ctrl+C to stop."

# --step 0 = pause-based mode: transcribe after you stop talking, max 30s per chunk.
exec whisper-stream \
  -m models/ggml-large-v3-turbo.bin \
  --step 0 --length 30000 \
  -vth 0.6 -mt 0 -t 8 -l en \
  -f "$session"
