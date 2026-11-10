#!/usr/bin/env python3
# Watches inbox.log and prints only what the owner addresses to Claude.
# A line starting with the wake word (BAI, heard as bye/bai/buy/by/bae) opens a listening window;
# every following line inside the window passes and extends it. "bai over" closes it early.
# Lines heard while speak.sh is talking (plus a short tail) are dropped so Claude never hears itself.
import os, re, sys, time

HOME = os.environ.get("BAI_HOME", os.path.expanduser("~/bai-voice"))
INBOX = os.path.join(HOME, "inbox.log")
SPEAKING_ON = os.path.join(HOME, "speaking.on")    # exists while speak.sh talks
SPEAKING_END = os.path.join(HOME, "speaking.end")  # touched when speech ends
WINDOW_S = 300                                # listening window after the last accepted line (5 min)
ECHO_TAIL_S = 4                                # transcription lag after speech ends
SPOKEN = os.path.join(HOME, "spoken.txt")      # recent replies, for echo matching

def words(s):
    return set(re.findall(r"[a-z0-9]+", s.lower()))

def is_echo(text):
    # A heard line that is mostly words Claude just said is its own voice coming back.
    heard = words(text)
    if len(heard) < 2:
        return False
    try:
        recent = words(" ".join(open(SPOKEN).read().splitlines()[-3:]))
    except FileNotFoundError:
        return False
    return len(heard & recent) / len(heard) >= 0.7

STAMP = re.compile(r"^\[[0-9:. >-]+\]\s*")
# Wake word may follow leading punctuation or a short opener ("- Bye, ...", "Hey, bye. ...").
WAKE = re.compile(r"^[\s\-–—.,!\"']*(?:(?:hey|hi|ok|okay|so|um|uh)[\s,.!]+)?(bai|bye|buy|by|bae|bi)\b[\s,.!-]*(.*)$", re.I)
EMPTY_WAKE_WINDOW_S = 20                       # bare "Bye." opens a shorter window
NOT_WAKE = re.compile(r"^\s*(by the|by a|by an|bye[\s,.!-]*bye)\b", re.I)
CLOSE = re.compile(r"\b(bai|bye|buy|by) (over|out|done)\b", re.I)
JUNK = re.compile(r"^\s*(\[[A-Z_ ]+\]|\(.*\)|thank you\.?|you)\s*$", re.I)

def speaking_recently():
    if os.path.exists(SPEAKING_ON):
        return True
    try:
        return time.time() - os.path.getmtime(SPEAKING_END) < ECHO_TAIL_S
    except FileNotFoundError:
        return False

def follow(path):
    # Follow the symlinked inbox; reopen if start.sh points it at a new session file.
    current, f = None, None
    while True:
        target = os.path.realpath(path)
        if target != current:
            if f: f.close()
            try:
                f = open(target); f.seek(0, os.SEEK_END); current = target
            except FileNotFoundError:
                time.sleep(1); continue
        line = f.readline()
        if line:
            yield line
        else:
            time.sleep(0.3)

# whisper-stream re-reads the last 30 s of audio after each pause, so the same speech arrives
# several times; drop a line whose words were almost all passed in the last minute.
recent_out = []                                # (time, word set) of lines already printed

def is_repeat(text, now):
    heard = words(text)
    recent_out[:] = [(t, w) for t, w in recent_out if now - t < 60]
    if not heard:
        return True
    seen = set().union(*[w for _, w in recent_out]) if recent_out else set()
    return len(heard) >= 4 and len(heard & seen) / len(heard) >= 0.95

open_until = 0.0
for raw in follow(INBOX):
    text = STAMP.sub("", raw).strip()
    if not text or JUNK.match(text) or speaking_recently() or is_echo(text):
        continue
    now = time.time()
    wake = WAKE.match(text) if not NOT_WAKE.match(text) else None
    if wake and wake.group(2).strip():
        open_until = now + WINDOW_S
        text = wake.group(2).strip()
    elif wake:
        open_until = max(open_until, now + EMPTY_WAKE_WINDOW_S)
        print("VOICE: [listening]", flush=True)
        continue
    elif now > open_until:
        continue
    else:
        open_until = now + WINDOW_S
    if CLOSE.search(raw):
        open_until = 0.0
        print("VOICE: [window closed]", flush=True)
        continue
    if is_repeat(text, now):
        continue
    recent_out.append((now, words(text)))
    print(f"VOICE: {text}", flush=True)
