#!/bin/zsh
# Reads text aloud, muting the listener while it talks.
# Usage: speak.sh "short reply"   (returns immediately; speech runs in the background)
# speaking.on exists during speech; speaking.end is touched when it finishes;
# spoken.txt keeps recent replies so listen.py can drop echoes that arrive late.
dir="${BAI_HOME:-$HOME/bai-voice}"
pkill -x say 2>/dev/null; pkill -x afplay 2>/dev/null
print -r -- "$*" >> "$dir/spoken.txt"
tail -n 20 "$dir/spoken.txt" > "$dir/spoken.tmp" && mv "$dir/spoken.tmp" "$dir/spoken.txt"
(
  touch "$dir/speaking.on"
  if [[ -x "$dir/tts.sh" ]]; then "$dir/tts.sh" "$*" || say -r 205 -- "$*"
  else say -r 205 -- "$*"; fi
  rm -f "$dir/speaking.on"
  touch "$dir/speaking.end"
) >/dev/null 2>&1 &!
