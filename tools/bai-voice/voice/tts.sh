#!/bin/zsh
# Sends text to the local Kokoro server; exits non-zero if it is not running (speak.sh then falls back to `say`).
curl -sf --max-time 90 --data-binary "$*" http://127.0.0.1:5297/ >/dev/null
