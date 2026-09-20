# Loop Studio — SP-16 Export Review (2026-08-29)

Status: **review only, nothing implemented.** Parked here to resume later.

Scope reviewed: the TORAIZ SP-16 export path inside the Loop Studio feature —
pad assignment/trigger UI, `.prj` project writer, WAV resample + zip packaging.
Everything reviewed is currently **uncommitted / untracked** on branch
`feat/brief-rendered-scrape-phase-1` (baseline commit `2db4207d`, 2026-08-28).

## Files in scope

| File | Role |
|---|---|
| `app/dashboard/studio/LoopStudio.jsx` (~2995 L) | Loop Studio component; SP-16 pad state, pad transport, export orchestration |
| `app/api/dashboard/sp16-project/route.js` | Binary `.prj` writer — inflate template, patch fields, deflate |
| `app/dashboard/studio/loop/sp16-pad-colors.js` | Hardware pad color spectrum (UI only) |
| `app/dashboard/studio/loop/wav-encode.js` | `encodeWavPcm16`, `resampleChannelData`, `crc32`, `buildStoreZip` |
| `Demo 01 House Techno EDM.prj` (repo root, 69KB, untracked) | Pioneer demo project used as the export template |
| `app/dashboard/studio/loop/__tests__/*` | 85 tests, all passing — none cover the `.prj` writer |

## Verdict

**Not ready to ship.** The local-dev happy path works and the binary format
assumptions were verified correct against the real template. But there are two
production blockers, and the exported artifact is a *modified Pioneer demo
project*, not a clean project — most of what the SP-16 actually reads is still
demo content.

## How the template was verified

The `.prj` is `vltrgzip` + raw deflate. Decompressed and inspected:

```
node -e '
const fs=require("fs"),zlib=require("zlib");
const body=zlib.inflateSync(fs.readFileSync("Demo 01 House Techno EDM.prj").subarray(8));
// 704,474 bytes inflated
'
```

Confirmed structure:

- `ProjectData` @ 0 — holds `projectBpm` (125), `projectFilePath`
  (`/mnt/emmc/TORAIZ/SP-16 Projects/Demo 01 House Techno EDM.prj`).
- **16 × `SceneData`** @ offsets 503, 67161, 127372, 193274, 232312, 271350,
  310388, 349426, 388464, 427502, 466540, 505579, 544618, 583657, 622696, 661735.
- Each scene holds `TrackData0`…`TrackData15` ⇒ **256 real track blocks**
  (`trackMode` appears 256×; `TrackData` appears 512× because `MidiTrackData`
  also matches).
- **48 × `PatternData`** (demo sequencer content), living inside the scenes.

Field encoding (all confirmed against real bytes, the route's writers are correct):

| Writer | Emitted bytes after key | Meaning |
|---|---|---|
| `setIntField` | `01 05 01 <int32le>` | len 5 = type `0x01` + 4 bytes |
| `setDoubleField` | `01 09 04 <f64le>` | len 9 = type `0x04` + 8 bytes |
| `setStringField` | `01 <len+1> 05 <ascii> 00` | len = type byte + string + NUL |
| `setBoolField` | `01 01 <02\|03>` | `0x02` true / `0x03` false |

Every one of the 9 keys the route writes exists in every `TrackData` block, so
the unbounded forward search happens to land correctly **for this template**.

Per-track demo values found in Scene 1 (the only scene the route touches):

```
i  trackMode triggerMode colourIndex volume chokeGroup bLoop stretchMode holdNorm releaseNorm sendAmount bReverse
0  Sample    OneShot     0           46     -1         false Off         0.98     0.98        0          false
2  Sample    OneShot     10          42      0         false Off         0.14     0.09        0          false
3  Sample    OneShot     10          46      0         false Off         0.00     0.16        0          false
4  Sample    OneShot     0          111     -1         false Off         0.15     0.16        0          false
6  Sample    Gate        8           35     -1         false Off         0.16     0.39       64          false
9  Sample    Gate        9           54     -1         false Off         0.24     0.28       51          true
13 Sample    OneShot     13          36     -1         true  MT          0.11     0.64        0          false
```

(Full 16-row dump reproducible with the node snippet above + `fieldBounds`-style reads.)

## Findings

### Blockers — production

1. **Template is untracked.** `Demo 01 House Techno EDM.prj` sits at repo root,
   untracked (`git status` `??`), not gitignored. It never deploys → the route
   500s on Vercel.
2. **Not file-traced.** Even once committed,
   `fs.readFileSync(path.join(process.cwd(), TEMPLATE_NAME))` is not covered by
   `next.config` `outputFileTracingIncludes['*']` → ENOENT inside the Vercel
   function bundle. Repo root is also the wrong home for it.
3. **Route is unauthenticated.** Every other `app/api/dashboard/*` route runs
   `verifyRequestUser` (see `app/api/dashboard/web-stats/config/route.js`). This
   one has no gate, and each call inflates 704KB + deflates at level 9. The
   Studio is a deliberately public tool, so this may be intentional — needs an
   explicit decision, not silence.

### Correctness — what actually lands on the hardware

4. **Only Scene 1 is written.** `trackStart()` uses `buf.indexOf("TrackData"+i)`
   — first occurrence — which always resolves inside `SceneData` #1. Scenes 2–16
   keep their demo `$Int0/%Smp/LOOPMASTERS SAMPLE PACK/...` paths ⇒ 15 scenes of
   missing samples on the user's unit.
5. **Demo sequencer content is retained.** 48 `PatternData` blocks survive. Press
   Play on the hardware and it runs Pioneer's house/techno pattern through the
   user's loops. The user expects a clean project with their 16 loops.
6. **Per-track demo state is never reset.** The route writes 9 fields; everything
   else is inherited: `volume` ranging 28–111 (wildly uneven pad levels),
   `chokeGroup=0` on tracks 3 and 4 (those pads cut each other), amp envelope
   (track 2: `holdNorm=0.14`, `releaseNorm=0.09` — will truncate a 4-bar loop),
   `sendAmount` up to 64, `bReverse=true` on track 10, plus LFO / InsertFx state.
7. **`colourIndex` is never written.** `sp16-pad-colors.js` exists so the on-screen
   pad matches the physical unit, but the export doesn't carry color to hardware —
   pads keep the demo's colors.
8. **Dead ternary:** `setStringField(body, t0, 'trackMode', pad ? 'Sample' : 'Sample')`.
   Empty pads stay `Sample` with an empty `audioSourceUrl`.
9. **`bLoop=true` + `triggerMode='OneShot'` on every assigned pad** — the template
   uses `bLoop` on 1 track of 16. Unverified combination on hardware.
10. **`stretchMode='MT'` with no source-tempo field written.** The template's MT
    tracks carried the SP-16's own analysis. Loops whose tempo differs from
    `projectBpm` may stretch wrong.
11. **Path convention unresolved.** The project is written to
    `/mnt/emmc/TORAIZ/SP-16 Projects/<name>.prj` and samples to
    `$Int0/%Smp/Hitloop/<base>/<file>.wav` (both *internal eMMC*), but the zip
    layout is `TORAIZ/...` at archive root — the SD/USB shape. If the user loads
    from the card, every sample link breaks.

### Functional divergence

12. **SP-16 export bypasses loopcore entirely.** `downloadLoop` (L1186) and
    `downloadAllZip` (L1204) prefer engine-repaired bytes via `engineLoopByIndex`
    / `fetchEngineAudioBytes`. `buildSp16WavEntry` (L1266) always re-cuts the raw
    decoded buffer. Repair strategies (equal-power crossfade, zero-cross snap,
    microfade, silence trim) never reach the SP-16 samples. Pad audition
    (`startSp16PadNow`, L1037) also skips engine audio — so pad preview matches
    the export but *not* the tool's own Play-loop button.
13. **Naive resampler.** `resampleChannelData` is linear interpolation with no
    anti-alias filter. `SP16_ACCEPTED_SAMPLE_RATES = [44100]`, and every lossy
    source decodes at the device rate (typically 48k), so the common path is an
    unfiltered 48k→44.1k downsample. Audible aliasing on hi-hats. WAV path
    unaffected (it exports at source rate).

### Bugs

14. **Foreign drop assigns Loop 01.** `onSp16PadDrop` (L1088):
    `Number('') === 0` and `Number.isInteger(0)` is `true`, so dropping any
    payload without the `text/x-hitloop-loop-index` type (a file, text, an image)
    silently assigns Loop 01 to that pad. Guard `raw !== ''`.
15. **Dead bounds check + unbounded field search** in the route. `if (t1 <= t0) throw`
    uses a `t1` computed *before* the writes mutate `body`. And `fieldBounds`
    searches forward from `t0` with no section end — a key missing from track *i*
    would write into track *i+1*. Safe for this template only, by luck.
16. **Route returns 400 for everything**, missing template included. Should be 500
    for server-side faults — the client currently can't distinguish a config
    error from bad input.
17. **Nested interactive element.** The clear-pad `<span role="button" tabIndex={0}>`
    is nested inside the pad `<button>` (LoopStudio ~L2100). Invalid HTML,
    screen-reader confusion. Works only because of `stopPropagation`.
18. **Quantize is next beat, on a resetting clock.** `triggerSp16Pad` (L1047) waits
    to the next *beat*, not bar, and `sp16ClockStartRef` resets on every pad start
    — there is no free-running bar clock, so loop switches land off the bar.
19. **Zero test coverage on the highest-risk file.** `node --test 'app/dashboard/studio/loop/__tests__/**/*.test.js'`
    ⇒ 85 pass / 0 fail, but nothing exercises `app/api/dashboard/sp16-project/route.js`.

### Handoff

20. No SSOT doc and no `CLAUDE.md` entry for the LOOPS feature or the SP-16 path —
    the repo convention for a feature this size. All work is uncommitted/untracked
    (`LoopStudio.jsx`, `loop/`, `sp16-project/`, `services/loopcore/`,
    the template, plus `page.jsx` → `StudioPage.jsx` rename).

## Risks

- **No evidence any export has been loaded on a real SP-16.** Findings 4–11 are
  all hardware-verify gates; fixing them blind risks fixing the wrong thing.
- **Licensing:** committing the template puts a 68KB Pioneer demo project
  (referencing LOOPMASTERS sample paths) in the repo. Check before tracking.
- **Vercel Hobby function cap:** the new route counts against the 12-function
  packaging cap — see `docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md`.

## Recommended phase order

Stop for approval after each phase.

1. **Hardware truth pass** — export one zip, load it on the unit, answer findings
   4, 5, 9, 10, 11 with real observed behavior. Everything downstream is guesswork
   until this happens.
2. **Template hygiene** — move the template out of repo root, add the tracing
   include, decide committed-vs-fetched; clear scenes 2–16 and the demo patterns;
   reset the inherited per-track params; write `colourIndex`.
3. **Route hardening** — auth decision, section-bounded `fieldBounds`, 500 vs 400,
   cache the inflated template, `node:test` coverage on the writer.
4. **Engine parity** — route SP-16 samples through `engineLoopByIndex` like the WAV
   path; better resampler, or block non-44.1k sources outright.
5. **Small bugs + SSOT doc + commit** — findings 14, 17, 18, plus a
   `docs/source-of-truth/` entry and the `CLAUDE.md` Repo Map line.
