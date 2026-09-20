# loopcore — the Loop Studio analysis engine

The Python audio engine behind `app/dashboard/studio/LoopStudio.jsx`, ported
from the proven `edittrax_dapp/tools/slice_track` workbench (see that repo's
`docs/LOOPER_STATUS.md` and `docs/ACCURATE_TEMPO_PLAN.md` for full history).

What it provides over the browser-only v1: accurate auto BPM (robust
median-interval tempo from Beat This! beats with spurious-beat rejection,
comb-filter cross-check across metrical relatives, essentia/librosa
corroboration), downbeat/offset detection with a sanity gate (degenerate
model downbeats are replaced by a synthesized grid at the top-ranked phase),
plus the full slice/verify/repair toolchain and provenance/warnings the UI
surfaces.

## Run

```bash
cd services/loopcore
./setup.sh   # once (venv + deps; first analyze downloads the model checkpoint)
./run.sh     # engine on http://127.0.0.1:8766
```

The Loop Studio UI auto-detects the engine: with it running, dropping a track
uploads it to the engine and fills BPM + offset from real analysis (manual
override always available). Without it, the UI stays fully usable in manual
mode and says the engine is offline.

## Contracts

Same HTTP surface as the workbench (`/api/upload`, `/api/analyze`,
`/api/update_grid`, `/api/slice`, `/api/verify`, `/api/repair`, `/api/audio`,
`/api/tracks`, `/api/report`), CORS-enabled for local Next.js origins, bound
to 127.0.0.1 only. Uploads land in `services/loopcore/inputs/`, artifacts in
`services/loopcore/outputs/` (both gitignored).

Invariants that must not regress (see edittrax docs for the scars behind
each): boundaries from the origin, never accumulated; PCM WAV stereo output;
repairs explicit and reported; gapless audition = Web Audio buffer looping,
never an `<audio loop>` element; contested/warned analysis is shown as
contested, never as one confident number.
