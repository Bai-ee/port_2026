# EditTrax Player Template — Build Notes & Handoff

Status doc for the generic player at `Bballi_Portfolio/edittrax_player/`. Covers what was built,
how it was verified, what's left to make it a fully working track player, and how it ties into
the auto loop-slicer POC. **Not committed** — working tree only.

Source of the extraction: the et006 "Deliver Me" unlocked player in
`EditTraxV2/edittrax_dapp/public/et006/`.

---

## 1. What this is

A self-contained, de-branded EditTrax interactive-loop player. Static HTML + JS, no build step.
Clone the folder, drop in sliced WAV loops, fill `track.js`, and you have a new track player that
loops/edits/exports — runnable from any static host or as a Teia/hicetnunc Interactive OBJKT.

User-facing usage lives in `README.md`. This file is the engineering breakdown.

---

## 2. What was done

### Extracted (engine copied as-is from et006)
`Tone.js`, `gsap.min.js`, `Draggable.min.js`, `gsap_plugin_cssrule.min.js`,
`seamless-scroll-polyfill.min.js`, `pts.js`, `bufferToWav.js`, `scroll_unlock.js`,
`script_unlocked.js`, `base.css`, `style.css`, `Poppins-Black.otf`, `Poppins-Regular.otf`,
`loader.gif`. Plus functional UI glyphs: `download_img.svg`, `lock.svg`, `sort-up/down.svg`,
`master-sort-up/down.svg`, `header_mobile.svg/png`.

### De-branded `index.html`
- `<title>` → `EDITTRAX PLAYER`.
- `og:image` → `cover.jpg`.
- Removed `<script src="axios.min.js">` (only existed for the token gate).
- Deliver-Me / Audio Soul Project copy → `TRACK TITLE` / `ARTIST` placeholders.
- Status title `UNLOCKED PLAYER` → `PLAYER`.
- Preset label `DUB` → `FULL`.
- Info-CTA `href` `http://edittrax.nft` → `#`.
- Kept the EditTrax/Bballi ASCII banner (platform signature, not track branding).

### Removed the token gate — `script_unlocked.js`
- Deleted the dead tzkt `validateToken` (the on-chain big-map lookup + `axios.get`).
- Replaced the shadowing no-op `validateToken(viewer, objkt)` with `unlockDownload()`:
  always shows the download, hides the purchase CTA. The template ships **unlocked**.
- Left a TEMPLATE NOTE comment explaining how to re-add gating.
- `viewer`/`creator`/`objkt`/`owner`/`isOwned` are still parsed at the top of the file (harmless,
  now unused) — kept so re-adding a gate is a one-function change.

### Placeholder `track.js`
- Empty `parts[]` with a documented example entry.
- `bpm = 120` (TODO).
- Presets generated from `parts` (`parts.map(() => n)`) so their length always matches
  `parts.length` — the player requires this.
- `downloadName = "EDITTRAX_EDIT.wav"` (TODO).
- Kept the loader-status DOM tail (`statusScript` / `statusScriptIcon` / `boxHeight` /
  `reverseScrolling`) — the loading screen depends on those globals.

### Placeholder assets (kill all 404s)
- `cover.jpg` — generated placeholder cover / og:image.
- `background.jpg`, `wrapper_cont_bg.jpg` — neutral solid fills replacing stripped brand art.
- `directions_small.png` (transparent) + `preview.svg` (play triangle) — these were referenced by
  CSS but never existed even in the et006 build (pre-existing dead refs); stubbed for a clean load.

### Docs
- `README.md` — how to clone + fill + run.
- `BUILD_NOTES.md` — this file.

---

## 3. How it was verified

Served the folder (`python3 -m http.server`) and loaded it in a browser:
- Engine boots: Tone.js v14.5.46 initializes, `unlockDownload()` logs "Download enabled", no
  fatal JS errors, no missing `axios` reference.
- All assets return 200 — zero 404s after the placeholder pass.
- **Dynamic UI proven live**: temporarily populated `track.js` with 3 real WAV loops → the player
  generated 3 loop boxes (Loop 1/2/3), presets, MASTER EDIT status, per-loop up/down, and the
  EDIT THIS TRACK control, all from `parts[]` (`numBoxes = parts.length` in `scroll_unlock.js`).
  Then reverted to the clean empty template and removed the test audio.

Confirmed: the loop engine, dynamic editor UI, and unlocked download path all work.

---

## 4. What's left to make a real player work

### Required (per track)
1. **Loops** → `audio/`. 16-bit PCM WAV, cut on exact bar boundaries. (This is the slicer POC's
   output — see §5.) The folder ships empty.
2. **`track.js`**:
   - set `bpm` to the track tempo;
   - one `parts` entry per loop: `{ file: "audio/seg.N.wav", length: <bars>, loop: 1 }`;
   - real preset patterns (each array exactly `parts.length` long);
   - `downloadName`.
3. **`cover.jpg`** → real track art; set `<title>` + `og:image` in `index.html`.

### Recommended cleanups (template quality)
- **Album-front card is imageless** (renders dark) until real cover art + the front-face CSS image
  are set. Wire the cover into the front card, or restyle the front to a neutral state.
- **`pts.js` canvas background is dark by design** — confirm that's wanted, or theme it.
- **Unused URL-param parsing** in `script_unlocked.js` (`viewer`/`objkt`/…) can be deleted if you
  never plan to re-add gating; leave it if you might.
- **Preset labels** (PREVIEW / FULL / EXTENDED / ZERO) are generic — rename per track if desired.
- **`.wav` export** is desktop + iOS Safari only (browser blob/audio limits) — note for end users.

### Optional (if minting on-chain as an Interactive OBJKT)
- Re-add a token gate (tzkt big-map lookup) in `script_unlocked.js` and gate the download on
  ownership. The contract/big-map id are marketplace-specific (hicetnunc OBJKT = big map 511).
- Zip the folder, test the preview at `teia.art/mint`, then mint. Keep all paths relative and no
  external calls except allowlisted domains.

---

## 5. Tie-in with the auto loop-slicer POC

This template is the **consumer** of the slicer output (see
`EditTraxV2/edittrax_dapp/docs/POC_AUTO_LOOP_SLICER.md`).

Pipeline once both exist:
```
track (stereo) → slicer: detect BPM + cut seamless bar loops → seg.N.wav
              → fill audio/ + generate track.js → this player loops/edits/exports
```
The slicer must emit exactly what the player expects:
- WAV loops cut on bar boundaries (seamless; no MP3 in the loop path);
- a `track.js` whose `parts[].length` = each segment's bar count and whose `bpm` matches;
- presets sized to `parts.length`.

The player schedules by **musical measures**, so each segment's real duration must equal its
`length` bars at `bpm` — the slicer's bar-accurate cutting is what guarantees gapless playback.

---

## 6. File inventory

| File | State | Action needed |
|---|---|---|
| `index.html` | de-branded | set title / og:image per track |
| `track.js` | placeholder (empty parts) | **fill per track** |
| `audio/` | empty | **add WAV loops** |
| `cover.jpg` | placeholder | replace with track art |
| `script_unlocked.js` | gate removed, unlocked | optional: re-add gate / trim unused params |
| `scroll_unlock.js` | as-is | none |
| `bufferToWav.js`, `Tone.js`, gsap/pts/etc. | as-is | none |
| `base.css`, `style.css` | as-is | optional: theme front card / canvas |
| `background.jpg`, `wrapper_cont_bg.jpg`, `preview.svg`, `directions_small.png` | neutral placeholders | optional: replace |
| UI glyph svgs, fonts, `loader.gif` | as-is | none |
| `README.md`, `BUILD_NOTES.md` | docs | none |

---

## 7. Run locally

```bash
cd Bballi_Portfolio/edittrax_player
python3 -m http.server 5057   # or: npx serve . -l 5057
# open http://localhost:5057/
```
Empty `track.js` → player loads to an empty editor. Fill `parts[]` + `audio/` → it plays, edits,
and exports.

---

## 8. Studio integration (Loop Studio EDITTRAX export)

Loop Studio (`app/dashboard/studio/LoopStudio.jsx`) ships EDITTRAX as a third export
target (`'wav' | 'sp16' | 'edittrax'`), separate from the SP-16 hardware-sampler path —
zero shared code, only the toggle/panel/drag-drop UI pattern is mirrored. Plan:
`docs/plans/STUDIO-EDITTRAX-PLAYER-EXPORT-POC-PLAN.md`.

**This template folder is the source of truth and is READ-ONLY for the Studio
workstream.** `scripts/sync-edittrax-player.mjs` copies it verbatim to
`public/edittrax-player/` (a generated, git-ignorable static copy) and writes
`public/edittrax-player/manifest.json` — the exact file list the export zip assembles
from (everything except `README.md`, `BUILD_NOTES.md`, `track.js`, and `manifest.json`
itself). **To change the template: edit this folder, then re-run
`node scripts/sync-edittrax-player.mjs`.** Never hand-edit `public/edittrax-player/` —
the next sync overwrites (and prunes) it.

### Embed = transformed srcdoc iframe
`app/dashboard/studio/loop/edittrax/edittrax-embed.js`'s `buildEmbedSrcdoc()` fetches the
served `index.html` once, injects a `<base href="/edittrax-player/">` right after `<head>`
(so every relative asset — css, fonts, svg, engine js, `cover.jpg` — resolves against the
public copy), and replaces `<script src="track.js"></script>` with an inline `<script>`
carrying a generated config. This has to be a srcdoc rebuild rather than a postMessage
update: the engine reads `parts`/`bpm`/`presets`/etc. **synchronously at parse time**
(`const numBoxes = parts.length` is a top-level statement in `scroll_unlock.js:11`), so the
config must already exist in the DOM before `scroll_unlock.js`/`script_unlocked.js` execute.
Loop audio is blob URLs (engine-repaired bytes preferred, local re-encode fallback — the
same policy as the studio's plain WAV export), created/revoked by
`EdittraxPlayerPanel.jsx` as parts are assigned.

### One config generator, two consumers
`app/dashboard/studio/loop/edittrax/edittrax-export.js`'s `generateTrackJs(...)` is the
**single canonical generator** for the player's config script — its output text is used
verbatim for both:
- the export zip's `track.js` (`parts[].file = "audio/seg.N.wav"`), and
- the in-studio embedded player's srcdoc (`parts[].file` = a `blob:` URL).

Only the `file` strings differ between the two call sites; the embed module consumes the
generator's return value as an opaque string and never re-implements the config shape.
The export zip itself (`build-player-zip.js`'s `buildEdittraxZipBytes`) fetches the
manifest + every listed template file as bytes, assembles `{ name, data }` entries
(template files + generated `track.js` + `audio/seg.N.wav` per part) via
`buildPlayerZipEntries`, and hands them to the shared `buildStoreZip` (`../wav-encode.js`).

### ⚠️ Preset-0 boot contract
The player **auto-applies preset 0 on boot** (`script_unlocked.js:161`, `loadPreset(0)`
runs once audio finishes loading) — whatever preset 0 contains becomes the build the
listener actually hears, with no user action. **Preset 0 must never be an all-off
array.** `generateTrackJs` bakes this in by construction: preset 0 = the current per-part
loop counts (`parts.map(p => p.loop)`), preset 1 = all-1 ("FULL"), preset 2 = all-2
("EXTENDED"), preset 3 = all-0 ("ZERO", now pushed to the *last* slot instead of first).
A hand-written or future `track.js` generator that reuses the old convention (preset 0 =
all-off) will silently wipe every boot — this is the one thing in the four-preset array
that isn't just a template nicety.

### `window.parts` exposure
Classic (non-module) `<script>` top-level `const`s never attach to `window`.
`generateTrackJs` adds an explicit `window.parts = parts;` line after the `parts` array so
the studio embed's live count read-back (`edittrax-embed.js`'s `readLivePartLoops`, which
reads `iframe.contentWindow.parts[i].loop`) can see it. This line is a no-op in the
exported standalone player (nothing there reads `window.parts`) — harmless to ship in
every `track.js`, generated or not.

### Studio-side files
| File | Role |
|---|---|
| `scripts/sync-edittrax-player.mjs` | template → `public/edittrax-player/` + manifest |
| `app/dashboard/studio/loop/edittrax/edittrax-embed.js` | srcdoc transform + live-count read-back |
| `app/dashboard/studio/loop/edittrax/edittrax-export.js` | `generateTrackJs` + zip-entry assembly + project-name sanitizer |
| `app/dashboard/studio/loop/edittrax/build-player-zip.js` | fetches the served template + orchestrates the export zip |
| `app/dashboard/studio/loop/edittrax/EdittraxPlayerPanel.jsx` | part-slot strip + iframe lifecycle (blob URLs, rebuilds) |
| `app/dashboard/studio/loop/__tests__/edittrax-{embed,export,build-zip}.test.js` | `node --test` coverage for the three modules above |
