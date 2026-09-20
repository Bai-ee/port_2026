# EditTrax Player — Generic Template

A self-contained, de-branded EditTrax interactive-loop player. Clone this folder to build a
new track player: drop in your sliced loops, fill `track.js`, done. No build step — it's static
HTML + JS that runs from any static host (or a marketplace iframe as an Interactive OBJKT).

Extracted and de-branded from the et006 "Deliver Me" build. The specific track, artwork, copy,
and on-chain token gate were removed; the loop engine, editor UI, and WAV export are intact.

## What it does

Loads a track that's been pre-cut into per-section loops. The user can repeat/skip/preview each
loop, set a master repeat, play the arrangement, render it offline, and download the result as a
16-bit PCM WAV. This template ships **unlocked** (download always available).

## Files

| File | Role |
|---|---|
| `index.html` | Player shell. Loads everything below. Set `<title>` + `og:image` per track. |
| `track.js` | **The only file you edit per track.** BPM, `parts[]` (loop segments), presets, download name. |
| `audio/` | Your loop segments go here (WAV). Empty in the template. |
| `cover.jpg` | Cover / `og:image`. Replace with your track art. |
| `script_unlocked.js` | Player logic: scheduling, editor, offline render, download. Unlocked (no gate). |
| `scroll_unlock.js` | Builds the loop-box UI dynamically from `parts[]`. |
| `bufferToWav.js` | Renders the edited arrangement to a WAV blob. |
| `Tone.js` | Audio engine (loop scheduling + offline render). |
| `gsap.min.js`, `Draggable.min.js`, `gsap_plugin_cssrule.min.js`, `seamless-scroll-polyfill.min.js`, `pts.js` | UI / animation / interaction. |
| `base.css`, `style.css` | Player styling. |
| `Poppins-*.otf`, `loader.gif` | Fonts + loading spinner. |

## Make a new player

1. Copy this whole folder.
2. Put your loop segments in `audio/` — **16-bit PCM WAV**, cut on exact bar boundaries.
   (Seamless loops require WAV; MP3 encoder padding causes clicks when a segment repeats.)
3. Edit `track.js`:
   - `bpm` = track tempo.
   - one `parts` entry per segment: `{ file: "audio/seg.1.wav", length: <bars>, loop: 1 }`.
   - `presets` = loop-count patterns, each array **exactly `parts.length` long**.
   - `downloadName` = exported file name.
4. Replace `cover.jpg` and set `<title>` + `og:image` in `index.html`.
5. Serve statically and test (below).

The loop-box UI is generated from `parts[]` at runtime (`scroll_unlock.js`), so any segment
count works — you never touch the HTML for that.

## Run / test locally

Serve over HTTP (not `file://`, which blocks audio fetches):

```bash
npx serve . -l 5055
# or: python3 -m http.server 5055
```

Open <http://localhost:5055/> — with an empty `track.js` the player loads to an empty editor;
once `parts[]` + `audio/` are filled it plays, edits, and exports.

## How the schedule works (important for seamless playback)

The player schedules by **musical measures**, not audio seconds
(`.start(playhead+"m").stop(playhead+length+"m")`). So each segment's real audio duration must
equal exactly its `length` in bars at the track BPM:

- segment shorter than its `length` bars → silence gap before the next part;
- segment longer → it gets cut off at the bar boundary (click).

Cut segments sample-accurately on bar boundaries at a constant BPM and this holds.

## Notes

- **Unlocked build.** The on-chain tzkt token gate was removed. To re-add wallet/token gating,
  reinstate a tzkt big-map lookup in `script_unlocked.js` and gate the download on ownership
  (see the TEMPLATE NOTE comment in that file).
- **Interactive OBJKT compatible.** Entry point is `index.html`, all paths are relative, and no
  external calls remain — so this folder can be zipped and minted as a Teia/hicetnunc Interactive
  OBJKT as-is (add your own gate first if you want on-chain gating).
- **WAV export** works on desktop anywhere; on mobile, reliably only on iOS Safari (browser
  blob/audio constraints).
