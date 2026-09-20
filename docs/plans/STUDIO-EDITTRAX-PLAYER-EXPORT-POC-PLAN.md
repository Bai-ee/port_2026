# Loop Studio — EDITTRAX Player Export POC (Sonnet multi-agent handoff)

Status: **PHASES 0–4 COMPLETE — implemented + live-verified 2026-08-29.** All uncommitted.
Branch: `feat/brief-rendered-scrape-phase-1` (all Loop Studio work is uncommitted/untracked
— do not commit anything unless the user asks). End-to-end verified live in a browser:
target toggle swaps the SP-16 panel for the EDITTRAX panel; drag-drop builds parts; the
embedded player boots with the studio build; in-player counts survive rebuilds; the export
zip (33 files) unzips and serves standalone with zero 404s/console errors and the exact
counts set in-studio. See §9 for as-built deltas from this plan.

Written 2026-08-29 by the planning session after reading:
- `edittrax_player/BUILD_NOTES.md` + `README.md` + `index.html` + `track.js` +
  `scroll_unlock.js` + `script_unlocked.js` (the extracted, de-branded, unlocked player template)
- `docs/plans/STUDIO-LOOPS-SP16-EXPORT-REVIEW.md` (SP-16 export review — parked, separate)
- `app/dashboard/studio/LoopStudio.jsx` (~2995 L) + `app/dashboard/studio/loop/*`

---

## 1. Objective

Add a **third export target** to the Loop Studio Export card: **EDITTRAX**.

When selected:
1. The stage shows the **live EditTrax player** in place of the SP-16 pad panel, populated
   with the studio's sliced loops via the same drag-and-drop gesture the SP-16 pads use.
2. The player is **fully interactive inside the studio** — the user builds the track in the
   player itself: per-loop repeat counts (the player's own up/down UI), presets, master
   repeat, play/preview, even the player's own `.wav` edit download.
3. The export button produces a **complete, self-contained EditTrax player folder as a
   .zip** — template assets + `audio/seg.N.wav` loops + a generated `track.js` that bakes in
   BPM, part order, bar lengths, and the loop counts the user set inside the embedded
   player. Unzip → `python3 -m http.server` → identical player, ready for static hosting or
   Teia/hicetnunc minting (per `edittrax_player/README.md`).

**Hard rule from the user: this is a completely separate feature from the SP-16 export.
Zero SP-16 code is modified or shared. Only the UI *structure* (export-target toggle, a
stage panel, drag-drop from the loop list) is mirrored.**

## 2. Current relevant architecture (verified anchors)

### Loop Studio side
- `exportTarget` state: `'wav' | 'sp16'` — `LoopStudio.jsx:309`. Export RailCard
  (`#loop-export-panel`, ~L2834–2921) renders a 2-button toggle; SP-16 sub-section is
  `exportTarget === 'sp16'`-gated.
- Stage panels: `.loop-stage-panel` sections inside the container-query layout
  (`#loop-stage-styles`, ~L1777). The SP-16 chassis panel (`#loop-studio-sp16-panel`,
  ~L2016–2115) mounts when `showSp16Panel = exportTarget === 'sp16'` (L1260).
- Loops: `loops = [{ index, startSample, endSample, durationSeconds }]` (from the loopcore
  engine slice manifest, L362–388); globals `bpm`, `barsPerLoop`, `audioBuffer`.
- Drag source: loop rows set `e.dataTransfer.setData('text/x-hitloop-loop-index', String(loop.index))`
  (L1073). ⚠️ Known bug in the SP-16 drop handler (`Number('') === 0` assigns Loop 01 on
  foreign drops — review finding 14): the new EDITTRAX drop handler must guard
  `raw !== ''`. Do **not** fix the SP-16 handler here (parked review owns that).
- Audio bytes policy: the WAV export prefers engine-repaired bytes
  (`engineLoopByIndex.get(i).path` → `fetchEngineAudioBytes` from `loop/loopcore-client.js`)
  and falls back to a local `encodeWavPcm16` slice of `audioBuffer` (L1186–1230). **EDITTRAX
  follows the WAV path's policy** (seamlessness matters most for a looping player), NOT the
  SP-16 path (which bypasses the engine — review finding 12; that divergence stays theirs).
- Zip: `buildStoreZip(entries)` from `loop/wav-encode.js` — shared neutral util, reuse it.
- `downloadBlob(blob, filename)` helper at L121.

### Player template side (`edittrax_player/`, repo top level, 1.5MB, uncommitted)
- Static, no build step. Script order in `index.html` (L271–273):
  `track.js` → `scroll_unlock.js` → `script_unlocked.js`.
- The engine reads config **synchronously at parse time**: `const numBoxes = parts.length`
  is top-level in `scroll_unlock.js:11`; buffers load as
  `parts.map(part => new Tone.Buffer({ url: trackDir + part.file }))`
  (`script_unlocked.js:146`). ⇒ `parts`/`bpm`/`presets`/`downloadName`/`boxHeight`/
  `reverseScrolling` + the loader-status DOM writes (see `track.js`) must exist **before**
  the engine scripts execute. postMessage-after-load cannot work; the embed must be
  **rebuilt (iframe re-rendered) whenever the part assignment changes**.
- Loop counts are live state: the player's up/down UI mutates `parts[i].loop`
  (`scroll_unlock.js:231–241`), presets overwrite it (`script_unlocked.js:200–202`). A
  **same-origin** iframe lets the parent read `iframe.contentWindow.parts[i].loop` back
  directly at export/rebuild time — no bridge protocol needed for the POC.
- `parts[].length` is in **bars**; scheduling is by musical measures at `bpm`
  (`"...start(playhead + 'm')"`). Studio loops are all `barsPerLoop` bars — the values line
  up natively.
- Template ships unlocked (`unlockDownload()`), zero 404s, empty `audio/` + empty `parts`.
  Required per-track fills are BUILD_NOTES §4: loops → `audio/`, `track.js`, cover art.

## 3. Proposed direction

### A. Serve the template (it must be web-reachable for both embed and export)
`edittrax_player/` (top level) stays the **template source of truth**. A sync script copies
it to `public/edittrax-player/` (static assets — no Vercel function-count impact) and emits
`public/edittrax-player/manifest.json`: the exact file list for the export zip (everything
except `README.md`, `BUILD_NOTES.md`, `track.js`, and the empty `audio/` dir), plus
byte sizes. Editing the template = edit top-level folder, re-run sync. `public/edittrax-player/`
is generated output (note in the sync script header; both folders remain untracked for now).

### B. Embed = transformed srcdoc iframe
`edittrax-embed.js` fetches `/edittrax-player/index.html` once, then per rebuild produces a
srcdoc string:
1. Inject `<base href="/edittrax-player/">` at head start → all relative assets (css, fonts,
   svg, engine js, `cover.jpg`) resolve against the public copy.
2. Replace `<script src="track.js"></script>` with an inline script defining the same
   globals `track.js` defines: `trackDir=""`, `bpm` (studio bpm), `parts` (one entry per
   assigned slot: `{ file: <blob URL>, length: barsPerLoop, loop: <count> }`),
   4 generated presets sized `parts.length` (template semantics: all-0 / all-1 / all-2 /
   all-0), `downloadName`, `boxHeight=60`, `reverseScrolling=false`, **plus the
   loader-status DOM tail verbatim** (the loading screen depends on
   `statusScript`/`statusScriptIcon` — see `track.js:40–52`).
3. Iframe: no `sandbox` attribute (srcdoc is same-origin; needed for blob URLs + reading
   `contentWindow.parts`). Audio = blob URLs of loop WAVs (engine bytes preferred, local
   slice fallback — §2 policy), created/revoked by the panel; absolute `blob:` URLs win over
   the `<base>`, so `trackDir=""` is untouched.
4. On assignment change: read current `contentWindow.parts[i].loop` counts (try/catch),
   carry them over for surviving slots, revoke stale blob URLs, re-render srcdoc. Player
   playback state resets on rebuild — acceptable for POC.

### C. Panel UX (mirrors the SP-16 *pattern*, own code)
New `#loop-studio-edittrax-panel` stage section (own chassis styling), mounted when
`exportTarget === 'edittrax'`, in the same spot the SP-16 panel occupies for `'sp16'`:
- **Part slot strip** (`#loop-edittrax-slot-row`): ordered list of assigned parts
  (PART 01…N), each showing its loop number + a clear (×) control; plus an "ADD" drop zone.
  Drop a loop from the LOOPS list onto the zone → appends a part; drop onto an existing slot
  → replaces it. Same loop droppable multiple times (a part sequence, not a pad grid).
  Guard the empty-payload drop (`raw !== ''`).
- **The player iframe** below the strip (min-height ~640px, internal scroll) — all
  editing (counts, presets, master repeat, play, player's own WAV download) happens in the
  player itself.
- Switching `exportTarget` to `'edittrax'` calls the existing `handleStop()` so studio
  transport and the embedded player's Tone.js audio don't stack.

### D. Export = client-side zip
"BUILD EDITTRAX PLAYER (.ZIP)" button in the Export card's `exportTarget === 'edittrax'`
sub-section:
1. Read live loop counts from the mounted iframe (fallback: last-known / 1).
2. Generate `track.js` (pure function, unit-testable): header comment, `trackDir=""`,
   `bpm`, `parts` referencing `audio/seg.N.wav`, hand-baked presets (preset 1 FULL = the
   user's current counts; 0/2/3 per template semantics), `downloadName =
   "<projectBase>_EDIT.wav"`, loader-status DOM tail verbatim.
3. Fetch template files per `manifest.json` from `/edittrax-player/`, assemble entries:
   template files + `track.js` + `audio/seg.N.wav` (same bytes as the embed used).
4. `buildStoreZip` → `downloadBlob` as `<projectBase>-edittrax-player.zip`.
Cover art / `<title>` / og:image stay template placeholders — that's BUILD_NOTES §4 manual
finishing, out of POC scope.

## 4. Keep vs change

| Keep untouched | Change (additive only) |
|---|---|
| Everything SP-16: `app/api/dashboard/sp16-project/route.js`, `loop/sp16-pad-colors.js`, all `sp16*` state/handlers/panel in `LoopStudio.jsx`, the `.prj` template | `LoopStudio.jsx`: third `exportTarget` value, panel mount, Export-card sub-section, imports (small, surgical diffs) |
| `edittrax_player/` engine files (`Tone.js`, gsap, `scroll_unlock.js`, `script_unlocked.js`, css, fonts, glyphs) — template is read-only for this workstream | New files only: `loop/edittrax/` module folder, sync script, public copy (generated) |
| `loop/wav-encode.js`, `loop/loopcore-client.js` (reused as-is) | — |
| WAV export path, loopcore engine, all other Studio tools | — |
| SP-16 review findings (`STUDIO-LOOPS-SP16-EXPORT-REVIEW.md`) — parked, not fixed here | — |

No new npm dependencies. No new API routes (Vercel 12-function cap untouched).

## 5. Files

### New
| File | Contents |
|---|---|
| `scripts/sync-edittrax-player.mjs` | copy `edittrax_player/` → `public/edittrax-player/` + write `manifest.json` |
| `app/dashboard/studio/loop/edittrax/edittrax-embed.js` | fetch+transform index.html → srcdoc; inline-config generator; pure string fns |
| `app/dashboard/studio/loop/edittrax/edittrax-export.js` | `generateTrackJs(...)` + zip-entry assembly (uses `buildStoreZip`) |
| `app/dashboard/studio/loop/edittrax/EdittraxPlayerPanel.jsx` | slot strip + iframe lifecycle (blob URL create/revoke, count read-back, rebuild) |
| `app/dashboard/studio/loop/__tests__/edittrax-embed.test.js` | base-href injection, track.js script replacement, config emission |
| `app/dashboard/studio/loop/__tests__/edittrax-export.test.js` | generated track.js: parts/presets lengths match, bpm, paths, loop counts |

### Edited
- `app/dashboard/studio/LoopStudio.jsx` — only: `exportTarget` third value `'edittrax'`,
  `showEdittraxPanel` derivation, `<EdittraxPlayerPanel …/>` mount beside the SP-16 mount
  point (~L2115), third toggle button + EDITTRAX sub-section in the Export card
  (~L2839/2866), Export subtitle string, `handleStop()` on target switch. Props down:
  `loops`, `bpm`, `barsPerLoop`, `audioBuffer`, `engineLoopByIndex`, `trackBase`,
  `setStatus`, `downloadBlob`-equivalent.

### DOM ids (repo naming rule)
`loop-studio-edittrax-panel`, `loop-studio-edittrax-panel-header`,
`loop-edittrax-slot-row`, `loop-edittrax-add-drop-zone`, `loop-edittrax-player-frame`,
`loop-edittrax-export-section`.

## 6. Phase order (Sonnet, multiple agents — stop for approval after each phase)

**Phase 0 — Template serving (1 agent, small).**
Write + run `scripts/sync-edittrax-player.mjs`. Gate: `http://localhost:3000/edittrax-player/index.html`
loads in the running `npm run dev` with zero 404s and the empty-editor state (matches
BUILD_NOTES §3). ⚠️ Do NOT run `npm run build` (live dev server — memory rule).

**Phase 1 — Two agents in parallel (independent, both pure-module):**
- *Agent A — embed module:* `edittrax-embed.js` + its tests. Deliver `buildEmbedSrcdoc({indexHtml, baseHref, config})`
  and `buildTrackConfigScript({bpm, parts, downloadName})` as pure functions; `node --test` green.
- *Agent B — export module:* `edittrax-export.js` + its tests. Deliver `generateTrackJs(...)`
  + `buildPlayerZipEntries({manifest, templateBytesByPath, trackJs, audioEntries})`; `node --test` green.
Neither touches `LoopStudio.jsx`.

**Phase 2 — Integration (1 agent).**
`EdittraxPlayerPanel.jsx` + the surgical `LoopStudio.jsx` edits (§5). Gate: manual — select
EDITTRAX target → panel replaces SP-16 panel; drop 3 loops → player rebuilds showing Loop
1/2/3 boxes; up/down counts + presets + play work inside the frame; switching back to
WAV/SP-16 restores prior behavior untouched; `node --test 'app/dashboard/studio/loop/__tests__/**/*.test.js'`
still fully green (85 existing + new).

**Phase 3 — Export wiring (1 agent).**
Export-card sub-section + zip flow (live count read-back → track.js → zip). Gate: download
zip, unzip to a scratch dir, `python3 -m http.server`, verify the standalone player plays
identically with the counts that were set in-studio, and its own EDIT `.wav` download works.

**Phase 4 — Review + docs (1 agent, reviewer thread).**
Review against this plan (scope drift, SP-16 contamination, blob-URL leaks, dead code).
Update `edittrax_player/BUILD_NOTES.md` with a "§ Studio integration" addendum + add a
Loop-Studio/EDITTRAX line to the repo-map when the user asks for the LOOPS SSOT (finding 20
of the SP-16 review covers the broader doc debt — don't absorb it all here).

## 7. Risks / open questions

- **Layout inside an iframe**: the player is a full-page design (pts.js canvas bg, album
  card, scroll interactions). It boots fine standalone; inside a ~640px panel it may need
  the panel to grant more height or internal scrolling. Phase 2 gate is visual — budget
  iteration there, don't restyle the template.
- **Two audio systems**: studio Web Audio + player Tone.js can sound simultaneously. POC
  mitigation is the `handleStop()` on target switch + user discipline; full ducking is out
  of scope.
- **Rebuild-resets-playback**: every part add/remove reloads the iframe. Accepted for POC.
- **Loop-count read-back is best-effort**: if the iframe hasn't finished booting, fall back
  to last-known counts (never throw during export).
- **`length` correctness**: parts assume every loop is exactly `barsPerLoop` bars at `bpm` —
  true by construction of the slicer grid; if the user re-slices after assigning, slots
  must be validated against the new `loops` (drop stale indices, same as SP-16 pads reset
  on new track — mirror that reset in `resetForNewTrack` area ~L579, additively).
- **Template licensing/branding**: template is already de-branded; export ships the
  EditTrax ASCII banner (platform signature — intended per BUILD_NOTES §2).
- **Both `edittrax_player/` and all Loop Studio work are uncommitted** — agents must not
  commit, and must preserve unrelated dirty worktree files.

## 8. Approval

Recommend approving Phases 0–1 to start (pure additive, no `LoopStudio.jsx` edits, no
visual risk), then gating 2–4 on the Phase 1 modules landing clean.

## 9. As-built deltas

Differences from this plan's design, found during Phase 4 review of the shipped code:

- **Config generator consolidated into `edittrax-export.js`, not split with the embed
  module.** §5's file table implies `buildTrackConfigScript` would live alongside
  `buildEmbedSrcdoc` in `edittrax-embed.js`. As built, `generateTrackJs` (the full
  `track.js`-shaped generator) lives solely in `edittrax-export.js` and is the single
  canonical generator for both the export zip's `track.js` and the embed's srcdoc config —
  `edittrax-embed.js` only splices in whatever string it's handed (`buildEmbedSrcdoc`
  never generates config itself). One generator, two callers — see BUILD_NOTES §8.
- **Preset-0 boot fix (post-Phase-3).** The player auto-applies preset 0 on boot
  (`script_unlocked.js:161` `loadPreset(0)`), so `generateTrackJs` bakes preset 0 = the
  *current* per-part counts (was all-0 in an earlier pass, which silently wiped every
  build on load). Preset order is now PREVIEW(current)/FULL(all-1)/EXTENDED(all-2)/
  ZERO(all-0, moved to the last slot). Covered by `edittrax-export.test.js`. See
  BUILD_NOTES §8 ⚠️.
- **`window.parts` exposure.** Classic `<script>` top-level `const`s don't attach to
  `window`; `generateTrackJs` adds `window.parts = parts;` so the studio's live
  count read-back (`readLivePartLoops` reading `iframe.contentWindow.parts`) works. Not
  called out in the original plan's config-shape description. No-op in the exported
  standalone player.
- **`data-edittrax` grid CSS**, additive in `#loop-stage-styles` — mirrors the existing
  `data-sp16` attribute pattern exactly (`#loop-studio-workspace[data-edittrax="true"]`
  grid columns + the `@container`/`@media` stacked-layout rules). Zero SP-16 CSS lines
  touched.
- **Stale-closure fix applied (Task B, Phase 4 review).** `EdittraxPlayerPanel.jsx`'s
  `handleAppendLoop`/`handleReplaceLoop`/`handleRemoveLoop` called
  `onSlotsChange([...slots, …])` off the `slots` *prop* closure — several slot mutations
  fired in the same tick (impossible at human drag cadence, real for programmatic/rapid
  input) would collapse to the last call, silently dropping the others. Fixed by using
  the functional-updater form of `onSlotsChange` (it's literally `setEdittraxSlots`, a
  plain `useState` setter, so this needed no prop-contract change), and by having
  `syncCountsFromLive`'s self-heal compare against `countsRef.current`'s own length
  instead of the same stale `slots` prop. The srcdoc-rebuild effect's independent
  length self-heal (against the committed `slots` prop, post-render) remains the final
  safety net either way. Full `node --test` suite re-run green after the fix (162/162).
- **Known hidden-tab rAF note.** The player's boot/scroll animation (`pts.js` canvas,
  gsap) can appear frozen when the embedding browser tab is backgrounded during
  automated verification — `requestAnimationFrame` throttles/stops in hidden tabs by
  design. This is an artifact of how the tab was driven during testing, not a product
  bug; a foregrounded tab boots and animates normally.
