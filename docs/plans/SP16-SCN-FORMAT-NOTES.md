# SP-16 `.scn` Scene File — Format Notes (reverse-engineered 2026-08-30)

Source specimen: `707 stomp.scn` (3.4MB), exported from the user's Toraiz
SP-16 via Scene Manager. Every claim below was verified against real bytes;
a full container round-trip rebuild (unzip → unwrap → rewrap → rezip)
reproduced every member byte-identically after unwrap. This supersedes the
assumption in `STUDIO-LOOPS-SP16-EXPORT-REVIEW.md` that scene export would
need the `.prj` path — **the `.scn` is the right export target for Loop
Studio**: one clean scene, importable into any project on the unit, samples
included.

## Container: a plain ZIP

```text
707 stomp.scn                     (ZIP, no encryption)
├── "# 707 stomp.prj"             scene data — note the "# " filename prefix
├── uid.spid                      sample manifest ("ScenePackId")
├── <Sample>.wav                  bundled samples (deflate-compressed members)
└── <Sample>.wav.dat              optional 68-byte per-sample analysis sidecar
```

Yes — samples ARE bundled (the operating-instructions summary that scenes
exclude samples describes the *scene data blob*, not the package). On import
the unit copies samples to `$Int0/%Smp/[Imported]/<name>/…` per `uid.spid`.

## Inner blobs: `vltrgzip` + zlib

Both `# <name>.prj` and `uid.spid` are `"vltrgzip"` (8 bytes) followed by a
**zlib** stream (`78 01`; any zlib level works — the round-trip used level 9).
Same container as the big project `.prj`, same TLV field grammar as already
decoded in `STUDIO-LOOPS-SP16-EXPORT-REVIEW.md` (verified again here:
`volume` = `01 05 01 <int32le>`, `holdNorm` = `01 09 04 <f64le>`, strings =
`01 <len+1> 05 <ascii> 00`, bools = `01 01 <02|03>`).

## Scene blob (`# <name>.prj`, inflated 48,928 bytes for this specimen)

**Corrected 2026-08-30** (the earlier sketch here had the nesting wrong; the
tree below is a full parse that consumes all 48,928 bytes exactly).

The blob is ONE root `ProjectData` — 20 leaves (masterVolume, headphoneVolume,
`projectBpm`, swingRate, DaveSmith filter settings, `projectFilePath`,
versionNo…) plus exactly one container: **`SceneData8`**. The scene keeps the
index suffix of the slot it was exported from (here scene 9 of the source
project); import re-slots it.

`SceneData8` = 3 leaves (`colourIndex` = -1, `name` = the SOURCE PROJECT name,
`bpm` = 0 on this specimen) + 24 containers:

```text
SceneData8
├── TrackData0..15        9 leaves + 11 containers each
│   ├── leaves            trackMode, triggerMode, chokeGroup, volume, pan,
│   │                     soloSetting, muteSetting, colourIndex, instrument
│   ├── PlaybackData      startSample, loopStartSample, lengthSample, bLoop,
│   │                     bReverse, pitchCent, stretchMode, audioSourceUrl, bBypass
│   ├── AmpEnvelopeData · SequencerData · SliceData · ScaleSetting
│   ├── ScaleSettingMidi · InsertFx0 · InsertFx1 · SendData · LfoData
│   └── MidiTrackData     MidiNoteData, MidiCc1Data, MidiCc2Data,
│                         MidiOtherData, MidiModeData
├── PatternData0..4       Steps (compressed blob), Length, TrackMutes, TrackSolos
├── SendFx · MasterFx
└── RoutingData           TrackRoutingData0..15
```

⚠️ `MidiTrackData` and `TrackRoutingData` are NOT scene-level siblings of
`TrackData` — the first is a child of each track, the second lives under
`RoutingData`. `SequencerData` and the scale settings are per-TRACK.
`TrackMutes`/`TrackSolos` are per-PATTERN leaves (inline `0x07` objects of 16
bools), not scene state.

Per-track values on this specimen: `trackMode` = Sample (Midi on 11, Thru on
12), `triggerMode` = OneShot, `stretchMode` = MT or Off, `bLoop` = false
everywhere, `colourIndex` = the pad index 0-15 (the factory rainbow — so the
UI's `sp16-pad-colors.js` index IS `colourIndex`), and four pads carry an empty
`audioSourceUrl`.

## TLV grammar (fully decoded — this is what the writer implements)

Every node is `key\0` followed by a LEAF LIST then a CONTAINER LIST. A list is
either `0x00` (empty) or `0x01 <count>`:

```text
list      := 0x00 | 0x01 <count>
leaf      := key\0 0x01 <len8>    <type> <payload>     len8  = 1 + payload
           | key\0 0x02 <len16le> <type> <payload>     len16 = WHOLE field
container := key\0 <leafList> <leaves...> <contList> <containers...>

type 0x01 int32le · 0x02 true · 0x03 false · 0x04 f64le
     0x05 ascii + NUL · 0x07 inline object · 0x08 compressed blob
```

There is no separate end-of-block terminator: the `0x00` seen after a block's
last field IS its empty container list. The long form (`0x02`) shows up only on
`PatternData.Steps`, whose payload is a zlib stream; note its length covers the
whole field including the marker, not just the payload.

A parser built on this consumes the specimen's scene blob (48,928 B), its
`uid.spid` (1,512 B) and every `.wav.dat` (68 B) to the exact last byte —
that exactness is the writer's guard against patching a file it only half
understands (`app/dashboard/studio/loop/sp16-scn-writer.js`, `parseTlv`).

**Track sample references use a temp namespace:**
`audioSourceUrl = "$Int0/%Tmp/<basename>.wav"` — pointing at the bundled zip
member by basename, not at the final install path. Unassigned pads have an
empty string. The unit resolves `%Tmp`→ zip member at import, then installs.

## `uid.spid` (inflated 1,512 bytes): the `ScenePackId` manifest

Sixteen `SourceId0..15` records (one per pad, in pad order), each:
`size` (int: exact WAV byte size; 0 for empty pads), `adjunctSize` (int: 68
when a `.wav.dat` sidecar is present, else 0), `url` (string: the INSTALL
path, `$Int0/%Smp/[Imported]/<source project name>/<file>.wav`; empty for
empty pads). Sizes verified to match the bundled members exactly.

## `.wav.dat` sidecar (68 bytes): `SampleAdjunctData`

TLV: `bar` (f64 — length in bars, e.g. 0.25), `bpm` (f64 — 0.0 when
unanalyzed), `sampleNum` (int32 — frame count; verified = data bytes /
block-align). **This is where Loop Studio should write real values**: for an
exported loop, `bar = barsPerLoop`, `bpm = the detected/override BPM`,
`sampleNum = exact frames` — which directly supplies the source-tempo
metadata whose absence was flagged as `.prj` finding #10 (MT stretch with no
tempo). Optional per sample (several specimen samples ship without one).

## Bundled WAVs

The specimen's are 24-bit PCM stereo 44.1k. Loop Studio currently encodes
16-bit PCM; both are plausible-legal (the SP-16 spec accepts 16/24-bit) —
verify 16-bit on hardware once, or add a 24-bit encode path.

## As-built writer (2026-08-30)

Built per the plan below, with one deviation: the shipped template is the
scene BLOB only (`public/sp16/scene-template.bin`, 5,318 B — the raw
`vltrgzip` member lifted out of a real `.scn` by
`scripts/sp16-extract-scene-template.mjs`), not a whole `.scn`. The writer
never reads a template's samples, patterns or manifest, so shipping the
megabytes they cost buys nothing.

Verified by `app/dashboard/studio/loop/__tests__/sp16-scn-writer.test.js`:
the generated `uid.spid` and `.wav.dat` are **byte-identical** to the ones the
unit itself wrote, and a full export re-parses with only the intended fields
changed.

## Writer plan (template-based, like the proven `.prj` route)

1. Template = a real exported scene. The `707 stomp.scn` works mechanically
   but carries its 5 recorded patterns — leftover content, the exact disease
   the `.prj` export suffers from. **Best template: export a BLANK scene
   from the unit** (fresh project, one empty scene, no patterns recorded,
   save + export). Then the template has empty `PatternData`/pads by
   construction and the writer only ever *fills*, never *erases*.
2. Per export: unzip template → inflate scene blob → patch per-track TLV
   fields with the existing `.prj` route's writers, scoped to the single
   `SceneData` (no first-occurrence ambiguity — there is only one scene):
   `audioSourceUrl = "$Int0/%Tmp/<loop-file>.wav"`, trigger/loop/stretch
   fields, `colourIndex` (finally deliverable to hardware), scene `name`,
   `bpm` → rewrap `vltrgzip`+zlib. Inner filename: `# <scene name>.prj`.
3. Rebuild `uid.spid`: SourceId per pad with exact WAV sizes,
   `adjunctSize = 68`, install urls
   `$Int0/%Smp/[Imported]/<scene name>/<file>.wav`.
4. Emit each loop WAV + a 68-byte `SampleAdjunctData` sidecar with real
   `bar`/`bpm`/`sampleNum`.
5. Zip everything (scene blob + uid.spid STORED like the specimen, WAVs
   DEFLATED) → serve as `<name>.scn`.
6. Hardware acceptance: import on the SP-16 via Scene Manager; pads sound,
   colors match, MT stretch follows the written bpm, no demo/leftover
   patterns play.

Open questions for hardware testing: whether import validates the
`SceneDataN` index suffix; whether 16-bit WAVs are accepted (expected yes);
whether `uid.spid` `size` mismatches are fatal (write exact sizes; don't
find out).
