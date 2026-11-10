# bai-voice — hands-free voice mode for Claude Code

Talk to Claude Code with the mic open; it answers in the terminal and out loud. Everything runs locally
on the Mac: no API keys, no word caps, transcripts never leave the machine.

| Piece | What it does |
|---|---|
| `voice/start.sh` | Runs `whisper-stream` (whisper.cpp, large-v3-turbo, pause-based) and writes each spoken chunk to `sessions/<time>.txt`; `inbox.log` points at the newest |
| `voice/listen.py` | Follows `inbox.log`, passes only speech addressed to Claude: wake word **"bai"** (heard as bye/bai/buy/by) opens a 5-minute window; drops Claude's own voice and repeats |
| `voice/speak.sh` | Reads a reply aloud (Kokoro, falls back to macOS `say`), muting the listener while it talks |
| `voice/tts_server.py` + `tts.sh` | Local Kokoro text-to-speech server on 127.0.0.1:5297 (model loaded once, ~1 s per reply) |
| `skill/SKILL.md` | The `/bai` Claude Code skill: starts everything, handles voice events, speaks replies, `/bai off` |
| `install.sh` | One-shot installer (Homebrew whisper-cpp + sdl2, models, uv venv, skill) |
| `AGENT_PROMPT.md` | Master prompt to hand an agent so it installs this on its own machine |

## Install
```
zsh tools/bai-voice/install.sh          # into ~/bai-voice
BAI_HOME=~/somewhere zsh tools/bai-voice/install.sh
```
Then in Claude Code: `/bai`. Stop with `/bai off`.

## Requirements
macOS (Apple Silicon recommended; large-v3-turbo runs faster than speech on M-series), Homebrew,
~2.5 GB disk (whisper model 1.6 GB, Kokoro ~350 MB, venv), Claude Code with the Monitor tool.

## Using it
- Start a request with "bai", e.g. "Bai, make the upgrade button narrower." Keep talking; the window stays
  open 5 minutes after your last line. "Bai over" closes it. Spoken replies are 1–3 sentences; details are on screen.
- TV/radio in the room is transcribed too; Claude ignores off-topic lines, but quieter rooms work best.
- Voice and speed: `BAI_VOICE` (default `af_heart`) and `BAI_SPEED` (default `1.1`) when starting `tts_server.py`.

## Remove
`/bai off`, then delete `~/bai-voice` and `~/.claude/skills/bai`; optionally `brew uninstall whisper-cpp sdl2`.
