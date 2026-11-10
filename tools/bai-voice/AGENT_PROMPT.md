# Master prompt: install the /bai voice mode

Paste this into a Claude Code session on the target Mac.

```
Install the /bai hands-free voice mode on this machine from the repo Bai-ee/port_2026, folder tools/bai-voice.

1. Get the folder: if the repo isn't cloned, run
   git clone --depth 1 --branch tools/bai-voice https://github.com/Bai-ee/port_2026.git /tmp/bai-src
   (use branch main once tools/bai-voice is merged). Read tools/bai-voice/README.md and every file in
   tools/bai-voice/voice/ and tools/bai-voice/install.sh before running anything.
2. Check prerequisites and tell me what's missing before installing: macOS, Homebrew, ~2.5 GB free disk,
   Claude Code. Ask before installing Homebrew or uv if they're absent.
3. Run: zsh tools/bai-voice/install.sh   (default home ~/bai-voice; honour BAI_HOME if I give one).
   It installs whisper-cpp + sdl2 via Homebrew, downloads the whisper large-v3-turbo model (~1.6 GB) and
   the Kokoro TTS model (~350 MB), creates a Python venv with uv, copies the scripts, and installs the
   skill to ~/.claude/skills/bai/SKILL.md.
4. Verify: the installer's smoke test prints "kokoro ok" and "whisper-stream ok". Then run
   ~/bai-voice/speak.sh "Voice mode installed." and confirm I heard it.
5. Start it: invoke the /bai skill (Skill tool, name "bai"). Check the whisper-stream output's capture
   device list; if no speech arrives, restart start.sh with -c <id> for the built-in MacBook microphone.
   macOS will ask once for microphone access for the terminal app.
6. Test the loop: ask me to say "bai, testing" and confirm the VOICE event arrives and you answer aloud.
7. Report: what was installed where, disk used, and how to turn it off (/bai off) or remove it
   (delete ~/bai-voice and ~/.claude/skills/bai; brew uninstall whisper-cpp).
Rules: don't change anything outside ~/bai-voice, ~/.claude/skills/bai and Homebrew packages; never upload
transcripts (they stay in ~/bai-voice/sessions/).
```
