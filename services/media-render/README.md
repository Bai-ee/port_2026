# @hitloop/media-render

Standalone FFmpeg **media-render worker** for Hitloop. Ported and normalized from
the EditVideos video engine (Underground Existence). It composes a short, square,
branded MP4 ("video remix") from client-scoped source media.

> **This is an EXTERNAL worker, never a Vercel function.** FFmpeg, large file
> transfer, and (later) Arweave upload must run here — not in a Next.js route.
> Vercel routes stay metadata-only. See the port plan:
> `docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md` (Worker Architecture, pitfall #6).

## What this package does (Phase 0)

- `renderRemix(...)` — pure render function. No Firestore, no Vercel, no network.
- Gathers source media from **client-scoped** folders, builds 5-second segments,
  composes a 720x720 ~30s MP4, optionally applies a look filter and a music track,
  and writes the output through a `MediaStore`.
- Storage is abstracted behind `MediaStore` so the engine never knows whether it
  is reading from local disk or (later) Firebase Storage.

## Storage model (client-scoped)

Every path is scoped to one client. There are **no** global folders (the
EditVideos `skyline` / `logos` / `videos` / `paper_backgrounds` top-level buckets
were removed):

```
clients/{clientId}/media/
  source/{folder}/{fileName}      # inputs (videos, images, audio)
  generated/{jobId}.mp4           # outputs
```

`LocalMediaStore` roots at the `clients/{clientId}/media` directory on disk. A
`FirebaseMediaStore` can be added later behind the same interface.

### MediaStore interface

```
listFolders()              -> Promise<string[]>          folder names under source/
listFiles(folder)          -> Promise<string[]>          "{folder}/{file}" relative paths
readFile(relPath)          -> Promise<Buffer>            read a source file
writeOutput(relPath, buf)  -> Promise<string>            write output, returns locator
// helpers used by the engine (real on-disk paths for ffmpeg):
resolveSource(relPath)     -> string
ensureOutputDir(relPath)   -> Promise<string>            absolute output path, dir created
storagePrefix              -> "clients/{clientId}/media"
```

`safeRelative()` rejects absolute paths and `..` traversal so a recipe can never
escape the client-scoped source root.

## renderRemix signature

```js
import { renderRemix, LocalMediaStore } from '@hitloop/media-render';

const store = new LocalMediaStore({ clientId, rootDir }); // rootDir = clients/{clientId}/media on disk

const result = await renderRemix({
  clientId,
  recipe,        // see below
  store,
  outputPath,    // relative, e.g. `${jobId}.mp4` (written under generated/)
  deps,          // optional: { compositor, audioClient } for tests
});
// -> { outputPath, storagePath, absolutePath, contentType, sizeBytes,
//      width, height, durationSeconds, fps, segmentCount, sourceFolders, usedFiles }
```

### Recipe shape

Matches the plan's Data Model `recipe`:

```js
{
  durationSeconds: 30,
  output: { width: 720, height: 720, fps: 30, format: 'mp4' },
  sourceFolders: ['skyline', 'neighborhood'],
  sourceFiles: [],                 // optional explicit "{folder}/{file}" refs
  arweaveAudioUrl: null,           // Phase 0: local path | file://… | store:{relPath}
  arweaveMediaUrls: [],
  filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
  overlay: { enabled: true, effect: 'retro_dust' },
  logos: { topStoragePath: null, endStoragePath: null },
  endCard: { mode: 'none', mediaPath: null, text: null },
  videoOrder: null                 // explicit "{folder}/{file}" ordering
}
```

## Run it

```bash
cd services/media-render
npm install                 # zero runtime deps; ffmpeg is a system requirement
bash scripts/make-fixtures.sh   # (re)generate tiny fixture clips (needs ffmpeg)
node --test                 # MediaStore unit tests + fixture render test
npm run render:fixture      # manual: render fixtures -> generated/fixture-demo.mp4
```

- `node --test` always runs the MediaStore unit tests.
- The render test **really renders** when `ffmpeg` + `ffprobe` are on PATH and
  asserts the output is a non-zero 720x720 MP4. If they are absent it **skips**
  with a clear message (FFmpeg is an environment requirement, not a code failure).

## FFmpeg requirement (do not "simplify")

This engine needs a **full FFmpeg build**, not a minimal apt/npm default. EditVideos
pinned a specific BtbN GPL build because:

- **VFR iPhone `.mov`** inputs need a complete build to re-encode reliably.
- The **`drawtext`** filter (text end-cards, future overlays) requires libfreetype,
  which minimal builds omit.

When the worker is containerized (Cloud Run) or run in CI (GitHub Actions), pin a
full FFmpeg build in the image/workflow. Override the binary location with
`FFMPEG_PATH` / `FFPROBE_PATH` env vars if needed.

## Intentionally NOT ported yet (later phases)

- **FirebaseMediaStore** — Phase 0 uses the local filesystem only; no production
  Firebase connection.
- **Arweave audio fetching** — Phase 0 resolves audio from local/`store:` only;
  no network. (`ArweaveAudioClient` keeps the seam.)
- **Arweave upload / archive / ArNS** — permanent, wallet-funded; later admin phase.
- **Job claim / lease loop** — the worker enqueue/claim/heartbeat lives in the
  Hitloop repo (`media_jobs`), not here. This package is the pure render core.
- **Overlays, logos, end-cards, DALL·E, artist images, BPM beat-sync** — recipe
  fields exist for forward-compat but are not applied in Phase 0.
