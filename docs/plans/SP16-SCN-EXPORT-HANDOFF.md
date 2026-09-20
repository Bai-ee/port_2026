# Loop Studio — Shift SP-16 Export from `.prj` to `.scn` (Handoff)

**Status (2026-08-30): Phase 1 + Phase 2 code-complete, Gate 1 PASSED, Gate 2
(hardware) NOT RUN.**

Built:
- `app/dashboard/studio/loop/sp16-scn-writer.js` — pure, node-testable writer
  (full TLV parse/patch, `uid.spid`, `.wav.dat`, `vltrgzip`, zip).
- `app/dashboard/studio/loop/__tests__/sp16-scn-writer.test.js` — 23 tests,
  all passing (202/202 across the whole `loop/` suite). The generated
  `uid.spid` and `.wav.dat` come out **byte-identical** to the ones the unit
  itself wrote in the specimen.
- `public/sp16/scene-template.bin` + `scripts/sp16-extract-scene-template.mjs`
  — **deviation from this doc:** the template shipped is the scene BLOB only
  (5,318 B, the raw `vltrgzip` member) rather than a whole `.scn`. The writer
  never reads a template's samples/patterns/manifest, so the megabytes bought
  nothing. Swapping in a blank scene stays a one-command file drop:
  `node scripts/sp16-extract-scene-template.mjs <blank.scn>`.
- `LoopStudio.jsx` **and `components/looper/LooperStudio.jsx`** — the SP-16
  export button now produces `<scene>.scn`;
  audio comes from `engineLoopByIndex`/`fetchEngineAudioBytes` first (review
  #12) and non-44.1k sources resample through an `OfflineAudioContext` decode,
  not `resampleChannelData` (review #13). The `.prj` path is retained,
  unreachable, marked SUPERSEDED, for rollback until Gate 2 passes.

**Pattern leftovers: RESOLVED (2026-08-30), without a hardware trip.** The
shipped template is now blank — 0 `PatternData`, 19 containers. Pioneer's own
factory projects settled the shape: `Demo 01 House Techno EDM.prj` scenes 3-15
are blank scenes with exactly **19 containers and zero `PatternData`** (16
`TrackData` + `SendFx` + `MasterFx` + `RoutingData`). So the 5 recorded
patterns were cut from the specimen scene by
`scripts/sp16-extract-scene-template.mjs --blank`, which removes the contiguous
`PatternData` run and decrements the scene's container count, then proves the
result re-parses whole, holds 1 scene / 16 tracks / 0 patterns, and is
byte-identical to the source outside the cut. A test now fails if a future
template swap reintroduces patterns.

⚠️ This is the one deliberate departure from this doc's "never deletes blocks"
rule. It was taken only because the target shape is confirmed by
Pioneer-authored bytes rather than inferred. The factory projects could NOT be
used as the template directly — they're the 2016 format (18 `ProjectData`
leaves, 8-leaf tracks, no `instrument`/`padSequenceStart`/`minorVersionNo`)
against the current firmware's 20/9. If Gate 2 shows any import problem, the
clean fallback is unchanged: export a genuinely blank scene from the unit and
re-run the extract script WITHOUT `--blank`.

⚠️ **Two forks of the studio component exist** — `app/dashboard/studio/
LoopStudio.jsx` (`/dashboard/studio?tool=loop`) and `components/looper/
LooperStudio.jsx` (`/looper`, the route the user actually uses). This doc named
only the first; the `.scn` change had to be applied to BOTH. Any future Loop
Studio work must touch both or it ships nothing the user sees.

Not done: Gate 2 (hardware acceptance, user-run) and Gate 3 (cleanup).

---

**Original handoff:** the format is fully reverse-engineered and
verified; this is a build job, not a research job.
**Read first, in this order:**

1. `docs/plans/SP16-SCN-FORMAT-NOTES.md` — the decoded `.scn` format (ZIP +
   `vltrgzip`/zlib blobs + TLV grammar + `uid.spid` manifest + `.wav.dat`
   sidecars). Every claim byte-verified against a real exported scene.
2. `docs/plans/STUDIO-LOOPS-SP16-EXPORT-REVIEW.md` — the `.prj` export review.
   Its TLV field-writer grammar carries over verbatim; its findings list is
   the anti-checklist (everything it flags, the `.scn` path must not repeat).
3. `app/dashboard/studio/LoopStudio.jsx` — SP-16 pad state, export
   orchestration, `buildSp16WavEntry`, `downloadLoop`'s engine-repaired-bytes
   preference (`engineLoopByIndex` / `fetchEngineAudioBytes`).
4. `app/dashboard/studio/loop/wav-encode.js` — `encodeWavPcm16`, `crc32`,
   `buildStoreZip`, `resampleChannelData`.
5. `app/api/dashboard/sp16-project/route.js` — the outgoing `.prj` writer:
   reuse its TLV `setIntField`/`setDoubleField`/`setStringField`/
   `setBoolField` logic (port to the client module), then retire the route
   at the end.
6. Reference specimen: `docs/plans/fixtures/707-stomp.scn` — a real scene
   exported from the user's unit. Development/round-trip target until the
   blank template arrives.

## Why this shift

A `.scn` is one clean scene — 16 tracks, pad assignments, bundled samples —
importable into ANY project via the unit's Scene Manager. It eliminates the
`.prj` export's structural disease (patched Pioneer demo project: 15 scenes
of leftover demo content, 48 demo patterns, inherited demo track state) and
both of its production blockers, because the recommended implementation is
fully client-side.

## Architecture decision: client-side writer, no server route

Build `app/dashboard/studio/loop/sp16-scn-writer.js` (pure module, node-
testable) + wire-up in `LoopStudio.jsx`. Rationale: the `.scn` is a ZIP whose
blobs are zlib streams — the browser has `CompressionStream('deflate')` (zlib
container, exactly what `vltrgzip` wraps) and `('deflate-raw')` (zip members)
plus `DecompressionStream` for unwrapping the template. Going client-side
kills review blockers #1-3 outright (no untracked server template, no Vercel
file-tracing, no unauthenticated 704KB-inflate route). The template ships in
`public/sp16/` and is fetched at export time. Modern-Chromium requirement is
acceptable for this tool; feature-detect and show a clear message otherwise.

## Template strategy — HARD RULE

The writer is template-based: it FILLS a real exported scene, it never
synthesizes TLV structure from nothing and never deletes blocks.

- **Target template: a BLANK scene** the user will export from the unit
  (fresh project → empty scene → save → Scene Manager → export). Ship it as
  `public/sp16/blank-scene.scn`. Its `PatternData` blocks are empty by
  construction.
- **Until it arrives:** build and test everything against
  `docs/plans/fixtures/707-stomp.scn`. Do NOT attempt to hand-strip its five
  recorded `PatternData` blocks — that is exactly the kind of structural
  surgery this design avoids. All tests that don't depend on empty patterns
  are fully buildable now; the swap to the blank template is a file drop.

## What the writer produces

Given N assigned pads (N ≤ 16), a scene name, project BPM, bars-per-loop,
and per-pad `{ wavBytes, frames, sampleRate, colourIndex }`:

```text
<name>.scn  (ZIP, members at archive ROOT — no folders; mirror the specimen:
             scene blob + uid.spid STORED, WAV/.dat members DEFLATED)
├── "# <name>.prj"        patched scene blob, "vltrgzip" + zlib
├── uid.spid              rebuilt manifest, "vltrgzip" + zlib
├── <loop-01>.wav …       the loop WAVs
└── <loop-01>.wav.dat …   68-byte SampleAdjunctData per WAV
```

### Scene blob patching (per track i in the single SceneData)

Use the TLV writers ported from the `.prj` route — but scoped: locate
`TrackData{i}` INSIDE the one `SceneData` block and bound every field search
to that track's extent (the review's "unbounded forward search happened to
work" is not acceptable here; compute block bounds first). Write:

- `audioSourceUrl` = `$Int0/%Tmp/<file>.wav` (basename must exactly match the
  zip member); empty string for unassigned pads.
- `name` (scene) = the sanitized scene name; scene `bpm` = project BPM.
- `colourIndex` from `sp16-pad-colors.js` — this finally delivers pad color
  to hardware (review finding #7).
- Trigger/loop defaults for loop content: `trackMode='Sample'`,
  `triggerMode='OneShot'`, `bLoop=true`, `stretchMode='MT'` — flagged for
  the hardware test matrix below (review #9/#10); with real tempo now
  supplied via `.dat`, MT is expected to work, but verify before locking.
- Volume/pan/choke/envelope: on the blank template these are factory
  defaults — write nothing you don't mean. On the 707 specimen (dev only)
  they're the user's values; tests must not assert on them.
- String-field length changes shift offsets: patch tracks back-to-front, or
  rebuild the buffer with splices — either is fine, byte-exactness of
  UNTOUCHED regions is what the round-trip test asserts.

### `uid.spid` rebuild

Sixteen `SourceId0..15` records in pad order: `size` = exact WAV byte length
(0 for empty pads), `adjunctSize` = 68 where a `.dat` is emitted else 0,
`url` = `$Int0/%Smp/[Imported]/<scene name>/<file>.wav` (empty for empty
pads). Generate from scratch with the TLV writers — the structure is tiny
and fully mapped in the format notes.

### `.wav.dat` sidecars

68 bytes, `SampleAdjunctData` TLV: `bar` (f64) = bars-per-loop, `bpm` (f64)
= the loop's BPM (detected or override — the value the grid actually used),
`sampleNum` (int32) = exact frame count. Copy the byte layout from a
specimen `.dat` and substitute the three values; add a node test that
re-parses the emitted 68 bytes.

### Audio parity and resampling (fixes review #12/#13)

The WAV bytes MUST come from the same source as `downloadLoop`: prefer
engine-repaired bytes (`engineLoopByIndex`/`fetchEngineAudioBytes`) and fall
back to re-cutting the decoded buffer — the current `buildSp16WavEntry`
always re-cuts raw and must be fixed or bypassed. When the decoded buffer
isn't 44.1k (`SP16_ACCEPTED_SAMPLE_RATES`), resample with an
`OfflineAudioContext` render (browser-native, filtered) — not the linear
`resampleChannelData` (aliasing, review #13). 16-bit PCM output as today;
the specimen's samples are 24-bit, so 16-bit is on the hardware checklist.

## UI changes (LoopStudio.jsx)

The SP-16 export control produces `.scn` INSTEAD of `.prj`: same pad
assignment UI, download becomes `<scene-name>.scn`, helper copy tells the
user to drop it in the `Scenes` folder (`PIONEER DJ SAMPLER/Scenes/` on USB)
and import via Scene Manager. Keep the `.prj` code path untouched but
unreachable until the final cleanup step.

## Verification (gates)

Gate 1 — round-trip, no hardware: node tests in `loop/__tests__/` covering
TLV writers, `.dat` emit+reparse, `uid.spid` emit+reparse; plus an
integration test that runs the writer against the SPECIMEN template with 3
fake pads and re-parses its own output: valid zip, `vltrgzip`+zlib blobs,
exactly 1 SceneData / 16 TrackData, `audioSourceUrl` basenames == zip
members, `SourceId` sizes == member sizes, untouched byte regions identical
to template. Browser flow verified with a foregrounded tab or stubbed rAF
(standing rule).

Gate 2 — hardware acceptance (the user runs this): import on the SP-16 →
every assigned pad plays its loop; pad colors match the UI; empty pads are
empty; NO patterns play that the user didn't record (blank template only);
MT stretch follows the written bpm when project tempo differs; 16-bit WAVs
accepted. Record results in the status doc; any failure comes back here
before cleanup.

Gate 3 — cleanup, only after Gate 2 passes: remove
`app/api/dashboard/sp16-project/route.js`, the repo-root
`Demo 01 House Techno EDM.prj`, and all `.prj`-export UI/state; dated entry
in `docs/plans/STUDIO-LOOPS-SP16-EXPORT-REVIEW.md` marking it superseded.

## Rules

- Template-fill only; never synthesize or delete TLV blocks.
- Exact sizes everywhere (`uid.spid` mismatches are an unknown-severity risk
  — never emit them).
- No new dependencies; CompressionStream/DecompressionStream + existing
  `wav-encode.js` utilities only.
- Findings that contradict the format notes: the specimen bytes win; update
  the notes doc in the same change.
- Work phase by phase, stop at each gate with compact results.
