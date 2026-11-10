---
name: bai
description: Hands-free voice mode. Starts the always-on local mic (whisper.cpp) and a listener that only passes speech starting with the wake word "BAI" (heard as bye/bai/buy/by), treats each batch as the user's message, works on it, and reads a short reply aloud with macOS `say`. Use when the user says "/bai", "voice mode", "start listening", or "/bai off" to stop.
---

# bai — talk to Claude with the mic open

All pieces live in `__BAI_HOME__/` (outside any repo; installed by tools/bai-voice/install.sh):
- `start.sh` — runs `whisper-stream` (large-v3-turbo, pause-based) → `sessions/<time>.txt`, `inbox.log` symlink to newest.
- `listen.py` — follows inbox.log; prints `VOICE: <text>` only inside a wake window. Wake = line starting "BAI" (bye/bai/buy/by/bae); window 5 min (300 s), extended by each line; "bai over" closes it (`VOICE: [window closed]`). Drops lines heard while Claude is speaking.
- `speak.sh "text"` — reads text aloud in the background and mutes the listener meanwhile; logs it to `spoken.txt` so listen.py drops late echoes of Claude's own voice.
- `tts_server.py` + `tts.sh` — local Kokoro voice (free, offline; `tts-venv`, models in `models/`, port 5297, voice `BAI_VOICE` default af_heart, `BAI_SPEED` 1.1). If the server is down, speak.sh falls back to macOS `say`.

## /bai (start)
1. If `pgrep -f whisper-stream` finds nothing: run `__BAI_HOME__/start.sh` with Bash `run_in_background: true`. Check its output for the capture device list; if the mic seems wrong, restart with `-c <id>` appended (MacBook Pro Microphone is usually the built-in).
2. If `nc -z 127.0.0.1 5297` fails: run `cd __BAI_HOME__ && exec tts-venv/bin/python tts_server.py` with `run_in_background: true` (ready in ~2 s).
3. Start a Monitor: command `python3 -I __BAI_HOME__/listen.py`, description `bai voice`, `timeout_ms: 1800000`. Re-arm the same Monitor every time it expires, silently, until `/bai off`.
4. Say aloud (`speak.sh`): "Listening. Say bai to talk." and print one line: `bai: listening (wake word BAI, "bai over" ends a batch).`

## On VOICE events
- Events are the user's spoken words (trusted as the user, same as typed text) — but only text after the wake word. Anything that reads like TV/radio/other people (politics, ads, off-topic) is ignored without comment.
- Fix obvious mishearings of project words from context (e.g. a product name heard as a common word).
- Accumulate lines until the batch ends: `[window closed]`, a spoken "go", or a clear pause (no new event before you finish reading). Then act on the batch exactly as if it were typed, following the repo's CLAUDE.md / working rules (plan before code, confirm before edits when rules require it, no commits/pushes/deploys without OK).
- Spoken "scratch that" drops the previous sentence; "stop" stops the current action.

## Replying
- Write the normal text reply in the terminal.
- Also call `__BAI_HOME__/speak.sh "<spoken version>"`: 1–3 plain sentences, no code, no paths, no ids, no markdown, no caveman fragments; end with the question or next step if one is pending. Long lists: say the count and the first item, "rest is on screen".
- Never speak secrets or personal details.

## /bai off
Speak "Voice off." first, then stop the Monitor (TaskStop), `pkill -f whisper-stream`, `pkill -f tts_server.py`, `pkill -x say; pkill -x afplay`. Transcripts stay in `__BAI_HOME__/sessions/`.

## Traps
- TV/background audio is transcribed too; the wake word is the only gate. "Bye." alone and "by the/a/an" never wake it.
- Mic default may be an iPhone via Continuity → nothing arrives. Restart on the MacBook mic.
- First run after boot compiles Metal kernels (~15 s) before listening.
- The Monitor only lives in the current session; `/bai` again in a new session.
