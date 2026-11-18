# Mixtape Processing (HITLOOP Studio Tape Deck) — as built

**Status:** shipped on branch `feat/mixtape-processing` (worktree `~/Documents/Repos/Bballi_Portfolio-mixtape`), not yet merged or deployed. Deploys and pushes need owner OK. First real tape: REC020, published as review `rec020-424c38eb` (section 12).

Digitized cassette DJ mixes are dropped in a NAS folder. Local CLIs trim the empty audio, restore the sound conservatively, then publish a 60 s before/after clip pair to the public **Tape Deck** (`/dashboard/studio?tool=tapes`). Everything runs by hand from the Mac; there is no cron or watch folder.

```
NAS Mix_Tapes_For_Processing/REC020.WAV            (original, never modified)
  --trim-mixtapes-->     _trimmed/REC020.trimmed.wav + .trim.json (+ .noise.wav, REPORT.md)
  --restore-mixtapes-->  _restored/REC020.restored.wav + .restore.json (+ REPORT.md)
  --publish-tape-review--> Storage mixtape-reviews/{reviewId}/{chainHash}/{original,restored}.m4a
                           + Firestore mixtape_reviews/{reviewId}
  --> GET /api/public/tape-deck --> Studio Tape Deck UI (two <audio>, A/B)
```

## 1. Owner decisions (fixed, do not reopen)

- **Source:** NAS `/Volumes/bryan/Mix_Tapes_For_Processing` (SMB mount `//GUEST@192.168.1.6/bryan`). Read OK; writes only to the two subfolders below.
- **Trim rules:** output starts where audio comes on and stays on (short start/stop blips ignored); same at the end. Mid-tape silent gaps (side A/B flip, dead tape) are cut. Fully silent tape is flagged, never deleted. **Quiet intros are kept** (REC020's -28 dB intro is the real start). **Side-flip / stationary buzz is cut** (loud, dead-steady noise, see D10 below). **Always a 5 s linear (tri) end fade** on the last kept segment.
- **Restore chain = "V6"** (conservative, no loudness change; section 5).
- **Tape Deck is public** (no auth). Anything shown there is a whitelisted subset.
- **Standing OK** for per-tape uploads to the production project (Storage + Firestore) via the publisher. **Deploys and pushes need OK.**
- Dolby B decode, wow/flutter correction, de-click, AI/paid denoisers: out of scope.

## 2. Folder layout (NAS)

| Path under `Mix_Tapes_For_Processing/` | Contents |
|---|---|
| `*.wav/flac/aif/aiff/mp3/m4a/ogg/opus` | Originals. Never modified. |
| `_trimmed/` | `<stem>.trimmed.<ext>` (same codec/depth as source; lossy source becomes FLAC), `<stem>.trim.json`, `<stem>.noise.wav` (noise-only sample, when one exists), `REPORT.md` |
| `_restored/` | `<stem>.restored.<ext>` (16-bit gets triangular_hp dither; 24-bit none; float stays float), `<stem>.restore.json`, `REPORT.md` |

Local staging (default `~/mixtape-work`): `.lock`, per-tape work dirs, `reports/` (trim dry-run JSON), `diag/<stem>/` + `diag/<stem>.diag.json`, `samples/<stem>/`, `reviews/<stem>/` (clips + `.verify.json` sha cache).

## 3. The CLIs

Node ESM, ffmpeg/ffprobe at `/usr/local/bin` (override `FFMPEG_PATH`/`FFPROBE_PATH`). All under `scripts/mixtapes/`. Run from the worktree. Exit 0 ok, 1 error (any failed tape), 130 on SIGINT/SIGTERM (cleans work dir, lock and in-flight `.part`).

**Run order:** `trim-mixtapes` -> `restore-mixtapes` -> `publish-tape-review`. `diagnose-tape` and `make-samples` are for auditioning only.

```
node scripts/mixtapes/trim-mixtapes.mjs [--src DIR] [--dry-run | --write] [--only SUBSTR]
     [--force] [--staging DIR] [--params JSON] [--allow-local-src]
node scripts/mixtapes/restore-mixtapes.mjs [--src DIR] [--dry-run | --write] [--only NAME|STEM]
     [--force] [--staging DIR] [--allow-local-src]
node scripts/mixtapes/publish-tape-review.mjs --only <stem> [--title "<text>"] [--src DIR] [--staging DIR] [--force-hash]
     [--write] [--republish]
node scripts/mixtapes/publish-tape-review.mjs --unpublish <reviewId>
node scripts/mixtapes/publish-tape-review.mjs --delete <reviewId> [--yes]
node scripts/mixtapes/diagnose-tape.mjs [--in FILE] [--staging DIR] [--out JSON]      # read-only
node scripts/mixtapes/make-samples.mjs --diag <json> [--in FILE] [--out DIR] [--staging DIR] [--nf -50]   # local only
```

- `--dry-run` is the default for trim and restore; `--dry-run` with `--write` is an error.
- `trim --only` = filename substring. `restore --only` = exact trimmed filename or original stem (e.g. `REC020`).
- `trim --params` = JSON of detector overrides; unknown keys and `windowMs` are rejected, end-fade params validated.
- `publish` takes one tape per run (`--only` required); dry-run (no `--write`) builds clips and the record locally with **no network**.
- `--allow-local-src` is for tests only (skips the smbfs check; publisher refuses writes under `/Volumes` anyway).
- `diagnose-tape` default input is `REC020.trimmed.wav`; `make-samples` renders level-matched excerpt variants (V0..V6 A/B set) under `nice`, never writes under `/Volumes`.

## 4. Trim (`features/mixtape-processing/trim-detect.js`, detector v2)

Pure function over 100 ms window dB levels (max of L/R RMS after a 30 Hz HP, 16 kHz analysis). Key rules (defaults in `DEFAULT_PARAMS`):

- floor = minimum of a sliding 3 s median; content = median of windows > floor+10; threshold = max(content-30, floor+10).
- Interior gap is cut only if >= 6 s below floor+6; gaps < 4 s bridged; head/tail kept run >= 30 s; interior islands >= 10 s.
- Kept boundaries extend outward until < floor+4 (max 15 s), pad 1.0 s head/tail, 0.5 s interior, 50 ms crossfade.
- **Absolute `cutCeilingDb` -50:** nothing at or above -50 dB is ever cut as silence; a floor above it means no trim (`NO_TRIM`). Protects continuous music (REC020 shape).
- **LOW_HEADROOM** (content - floor < 25 dB): keep whole tape, no cuts.
- **Stationary buzz (D10):** over a centred 5 s span, std(dB) < 0.3 and mean |step| < 0.15; a run >= 10 s above -50 dB is non-program and cut-eligible at head/tail/interior, boundary refined to within 1 dB of the run median.
- **End fade:** `endFadeOutS` 5, curve `tri`, applied to the last kept segment at render.
- Render is one ffmpeg pass from the original (native rate/channels/depth), length forced to the planned sample count. `RENDER_VERSION` 1.

### Detector flags

| Flag | Meaning |
|---|---|
| `ALL_SILENT` | Nothing came on: nothing rendered, only reported |
| `NO_TRIM` | Whole tape kept (nothing quiet enough, or LOW_HEADROOM) |
| `LOW_HEADROOM` | content - floor < 25 dB: head/tail only, here no cuts |
| `NO_HISS_FLOOR` | No measurable hiss floor |
| `NO_SUSTAINED_RUN` | No run >= 30 s came on and stayed on; fallback result |
| `STATIONARY_NOISE` | One or more loud stationary buzz runs found |
| `STATIONARY_GAP` | A cut gap was stationary noise |
| `MANY_CUTS` | More than 4 interior gap cuts |
| `DIGITAL_SILENCE_FLOOR` | Floor below -90 dB (digital silence in leader/tail) |
| `NO_NOISE_SAMPLE` | No noise-only region found for a `.noise.wav` |
| `CLIPPING` | CLI-added: clipped samples counted in analysis |

## 5. Restore (V6, `restore-plan.js` / `restore-chains.js`, `RESTORE_VERSION` 1)

Needs `<stem>.trimmed.*` plus a `trim.json` whose `output` (name, sha256, samples) matches. Per tape: stage + verify, run diagnostics (cached by trimmed sha and `DIAG_VERSION`), build chain, render f32 internally, force exact sample count, measure peak.

Chain, in order:
1. `highpass` 22 Hz, 4th-order Butterworth (two cascaded biquads).
2. Notches **only for proven hum lines** (`equalizer ... t=q w=30`, depth min(prominence, 20) dB). No proven family, no notches.
3. L/R balance: only if |balance| > 0.5 dB and consistent (whole-tape and excerpt median agree in sign); the louder channel is attenuated by the full difference. Azimuth delay only if |lag| >= 0.5 sample and consistent.
4. `afftdn` nr=6, nf = min(diagnosed, -50) clamped to [-80, -20], tn=1, gs=8, nl=min.
5. `highshelf` +2 dB at 10 kHz, **only if rolloff < 13 kHz**.
6. Length forced to exactly the trimmed sample count.

No loudness change anywhere. If the output peak is > -0.1 dBFS the tape **fails** (`CLIP_RISK`, not published, no silent gain). Chain label is "Clean-up + gentle hiss" (+ " + air" when the shelf applies); `chainHash` = first 12 hex of sha256(chain).

`restore.json` is the contract the publisher reads: `restoreVersion, diagVersion, chainHash, chain, chainLabel, steps{hum,balanceDb,azimuth,air}, diagSummary{integratedLufs,truePeakDbtp,balanceDb,humHz,rolloffHz,nfUsedDb}, source{trimmedName,trimmedSha256,trimJsonName,originalName}, output{name,sha256,samples,sampleRate,channels,durationS,peakDbfs}, createdAt`.

## 6. Safety model

- **Dry-run default** on trim and restore; the publisher needs `--write` for any network.
- **NAS mount check:** writes refused unless the path is on an smbfs mount from `192.168.1.6` (`--allow-local-src` bypass for tests only).
- **Originals and trimmed masters never modified.** Writes go only into `_trimmed/` / `_restored/` (non-recursive, never creates parents under `/Volumes`).
- **`.part` + read-back:** copy to `.<name>.part`, verify size and sha256 by read-back, then rename. Existing identical output is accepted; different content needs `--force`. (Read-back may be served from the macOS SMB cache; it still catches truncated writes.)
- **Idempotency keys:** trim keyed on source size + mtime + detector version + render version + params hash; restore on trimmed sha + `RESTORE_VERSION` + chainHash + diagVersion; reviewId = `<stem slug>-<first 8 hex of trimmed sha>`. Unchanged inputs are skipped.
- **Versions** recorded in outputs (`detector`, `render`, `restore`, `publish`).
- **Lock:** exclusive `<staging>/.lock` with pid; stale locks replaced; one heavy job at a time (Intel Mac, 16 GB, shared with other jobs). Everything heavy runs under `nice -n 10`.
- **Staging** in `~/mixtape-work`: NAS file copied once (sha verified), all analysis on the local copy. A bad tape never stops a batch.
- **Credentials preflight (publisher):** parses `/Users/baiagentbai/Documents/Repos/Bballi_Portfolio/.env.local` by absolute path (read-only, no cwd lookup), sets **only** `FIREBASE_ADMIN_PROJECT_ID`, `_CLIENT_EMAIL`, `_PRIVATE_KEY`, `_STORAGE_BUCKET` (the last from that env's `FIREBASE_ADMIN_STORAGE_BUCKET` or `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`), and fails closed before any network unless project is `human-in-the-loop-a1a19`, bucket is `human-in-the-loop-a1a19.firebasestorage.app`, and the key is a PEM. Errors name variables, never values.
- Storage paths in a record must stay inside `mixtape-reviews/<reviewId>/`; delete refuses anything outside that prefix.

## 7. Data model

**Firestore `mixtape_reviews/{reviewId}`** (written by `buildReviewRecord`):
`status` (`published` | `hidden`), `title`, `tapeStem`, `createdAt`, `publishedAt`, `durations{originalS,trimmedS}`, `cuts{count,kinds[],removedS}`, `chainLabel`, `chain`, `diag{balanceDb,humHz,rolloffHz,lufs}`, `clip{startS,lengthS,gainsDb{original,restored}}`, `urls{original,restored}`, `storagePaths[]`, `versions{detector,render,restore,publish}`, `chainHash`; `hiddenAt` after unpublish. `createdAt` of an existing doc is preserved on republish.

**Storage** `mixtape-reviews/{reviewId}/{chainHash}/original.m4a` and `restored.m4a`: AAC 256k (`+faststart`), `audio/mp4`, download-token URLs (`firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=<uuid>`), `cacheControl: public, max-age=86400` (1 day). `chainHash` in the path means a re-restore never serves stale cached audio.

**Clips:** 60 s, seeded start from the trimmed sha within [120 s, duration-180 s], never within 30 s of an interior join (tapes < 6 min centred), 1 s fade in and out. Both clips are level-matched (`matchGains`: restored matched to original LUFS; both lowered together if either would pass -1 dBTP).

## 8. Takedown

```
node scripts/mixtapes/publish-tape-review.mjs --unpublish <reviewId>         # status 'hidden' (route drops it; objects stay)  -- NOT a takedown, see below
node scripts/mixtapes/publish-tape-review.mjs --delete <reviewId>            # dry-run: lists the doc + Storage objects
node scripts/mixtapes/publish-tape-review.mjs --delete <reviewId> --yes      # deletes objects under the prefix + the doc
node scripts/mixtapes/publish-tape-review.mjs --only <stem> --write --republish   # publish a hidden review again
```

A hidden review is refused by a plain `--write` unless `--republish` is given. reviewId must match `[a-z0-9-]{3,120}`.

## 9. Public route and Tape Deck UI

**`GET /api/public/tape-deck`** (`app/api/public/tape-deck/route.js`, `nodejs`, `force-dynamic`): queries `mixtape_reviews` with `status == 'published'`, limit 200, maps through `buildTapeDeckPayload` (`features/mixtape-processing/tape-deck-records.js`), sorts newest first **in memory** (no composite index), caps at 50. Cache `public, s-maxage=300, stale-while-revalidate=600`. Any failure answers 200 `{reviews: [], error: 'unavailable'}` with `no-store`; nothing about the backend leaks.

**Whitelisted public fields:** `id, title, tapeStem, publishedAt, durations{originalS,trimmedS}, cuts{count,kinds<=8,removedS}, chainLabel, diag{balanceDb,humHz[<=6],rolloffHz,lufs}, clip{startS,lengthS<=300}, urls{original,restored}`. Not exposed: `chain`, `storagePaths`, `versions`, `chainHash`, `status`, gains. Docs not `published` or without both audio URLs are dropped. URLs must be https on `firebasestorage.googleapis.com`, `storage.googleapis.com` or `*.firebasestorage.app`.

**Registration:** `studio-tools-meta.js` entry `tapes` (title "Tape Deck", OG `/img/og/studio-tapes.jpg`); `StudioPage.jsx` lazy `dynamic(() => import('./tapes/TapeDeckStudio'), { ssr: false })`, tab `['tapes','TAPE DECK']` (public, unlike CLIENT BRIEF which is admin-only), branch `tool === 'tapes'`.

**UI** (`app/dashboard/studio/tapes/`: `TapeDeckStudio.jsx`, `Cassette.jsx`, pure `tape-deck-sync.js`):
- Two decks (A = original, B = enhanced) with original CSS/SVG cassettes; reels turn only while playing. One transport: play/pause, scrub over the clip, time.
- **Two `<audio>` elements play in parallel; the inactive one is `.muted`.** Switching decks (click, keys `1`/`a`, `2`/`b`) swaps `.muted`; it resyncs the target only if drift > 30 ms (`DRIFT_RESYNC_S`) on a switch, never continuously.
- **First play (iOS Safari):** `play()` calls the audible element's `.play()` synchronously inside the click, then waits for both to be playable, sets the muted partner's `currentTime` to the lead's and starts it. `preload="none"` is kept.
- **iOS fallback:** if the second element's `play()` is rejected, parallel mode is off; a switch then pauses the source, seeks the target to the current time and plays it.
- Deep link `#<reviewId>` selects a tape. Diagnostic chips come from `diag`. Empty/unavailable states are handled.

**Takedown caveat.** `--unpublish` only hides the record: the clip URLs are token URLs, so anyone who already has them can still play the audio, and the public list can lag up to about 15 minutes (`s-maxage=300` + `stale-while-revalidate=600`). `--delete <reviewId> --yes` (removes the Storage objects and the doc) is the real takedown.

## 10. Traps learned (do not relearn)

- **Percentile floor bug:** a low percentile of window dB reads 1% of hiss-level windows as the floor in a dense mix and cut music. Floor is now a sliding 3 s median minimum, plus the -50 dB absolute ceiling.
- **LOW_HEADROOM / -50 dB ceiling:** real cassette hiss can sit near -50; REC020 has no measurable floor (quietest 3 s about -27 dBFS). Tapes like this must come back `NO_TRIM`, not be chopped.
- **Loud stationary buzz (REC020):** after the music ends at about 95:35 there are 22 min of loud buzz (mean -6.8 dB, 10 s std 0.00-0.02 dB) that a loudness gate keeps. Only the stationarity test catches it. Owner confirmed it is all cut.
- **FLAC is not servable in artifacts / needs AAC for public:** public clips are AAC `.m4a`, not FLAC; the restored lossless stays on the NAS.
- **`.env.local` cwd trap:** the worktree has no `.env.local`; prod creds live in the dev checkout. The publisher reads that absolute path itself and loads only the four admin vars. Never use `load-env` or merge the rest.
- **`saveBufferArtifact` defaults to a private cache:** not usable for public audio. The publisher has its own `file.save` with the token and 1-day cache; `saveBufferArtifact` defaults were left alone.
- **No composite index** on `status` + `publishedAt`: query filters on `status` only and sorts in memory.
- **No bucket CORS:** `<audio>` elements work cross-origin, WebAudio (sample-locked A/B) would not, hence the two-`<audio>` design. Setting bucket CORS is a prod infra change, not done.
- NAS read-back sha may come from the SMB cache (it guards truncation, not disk corruption).

## 11. Tests

`node --test features/mixtape-processing/__tests__/*.test.js app/dashboard/studio/tapes/__tests__/*.test.js` (synthetic envelopes for the detector including the REC020 shape, chain/plan/clip/record builders, CLI argument and path guards, sync and registration tests). No network, no NAS.

## 12. First real run: REC020

- Original `REC020.WAV` 1:57:31.6, 16-bit/44.1 kHz stereo; trimmed **1:35:21.5**.
- Cuts: gap **47:32.9-47:47.9** (side flip) and tail buzz at **21:55** long (the loud stationary noise after the music). Quiet intro kept; 5 s end fade.
- Diagnostics: L/R balance **-2.49 dB**, hum **59.89 Hz**, rolloff **9956 Hz** (so the air shelf applies), **-15.9 LUFS**.
- Published as `rec020-424c38eb` (chain label "Clean-up + gentle hiss + air").

## 13. Known limits and open items

- Held pure tones >= 10 s at >= -50 dB are cut as buzz (a long sustained synth tone in a mix could be misread). Tunable via `--params` (`stationaryMinS`, `cutCeilingDb`).
- Leader > 75% of cut windows: noise-sample selection may still pick leader (`test.todo` in the trim tests).
- Dolby B, wow/flutter, de-click: out of scope (Dolby B is flag-only; ffmpeg has no decoder).
- **iOS real-device test pending** (the fallback path is implemented and unit-tested, not heard on a phone).
- **OG image** `public/img/og/studio-tapes.jpg` (1200x630) is registered in `studio-tools-meta.js`. It is a screenshot of the deck UI. To regenerate: publish a real record, run the dev server, open `/dashboard/studio?tool=tapes` with Playwright at viewport 1200x630 (deviceScaleFactor 1), wait for the cassettes to render, `page.screenshot()` to PNG, then convert with sharp (`sharp(png).jpeg({ quality: 85 }).toFile('public/img/og/studio-tapes.jpg')`). Check it contains only public data (title, cassettes), no admin chrome.
- **`MIXTAPE_ENV_FILE`:** the publisher reads the four `FIREBASE_ADMIN_*` vars from `process.env.MIXTAPE_ENV_FILE`, falling back to the dev checkout's `.env.local` (`ENV_FILE_PATH` in `review-clip.js`). Set it when the checkout lives elsewhere.
- Not merged or deployed; the public route and UI go live only after a deploy (needs owner OK).
