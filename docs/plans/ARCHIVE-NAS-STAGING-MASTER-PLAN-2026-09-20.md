# Archive — NAS Staging + Manual Arweave Gate — Master Plan (2026-09-20, evening)

> Session continuity for this workstream (live state, traps, restart prompt):
> `~/.claude/threads/2026-09-21-archive-nas-staging.md` — reopen with `/open archive-nas-staging`.

Owner steer after the first paid Arweave batch (Turbo ≈ $90/GB, wallet ran dry
after 3 of 6 videos). This plan **supersedes** `ARCHIVE-X-MASTER-PLAN-2026-09-20.md`
§0 D1 and D6 and `docs/archive/PERMANENT_ARCHIVE_CONTRACT.md`'s "everything
uploads" rule. Everything else in that plan (branches, runbook, W1–W5 as-built,
traps) still holds. Read this file first; read the older plan for rationale.

Status (2026-09-20, late): **W-A, W-B1, W-B2 code-complete, uncommitted, tests
green** (HITLOOP archive suites 34 + 27 + 18; worker `test:archive` 84). Not yet
exercised live: dev-server restart, worker restart, PLAN/APPLY/UNDO on the copy
folder. W-C, W-D, W-E not started. Orchestrator = Fable; executors = Sonnet, one
per workstream, no pushes/deploys/spend.

Landed beyond the plan text: the three legacy HITLOOP routes
`arweave/{assets,upload}` and the legacy body of `arweave/collection` are also
bound to `archive_settings/permanence.autoUpload` (409 `auto-upload-off`), so no
route can enqueue or upload while the flag is off. The `/archive` organizer panel
normalizes the worker's flat apply/undo result shapes (`moved[]`, `restored[]`)
via `organize*FromResult` helpers in `app/archive/page.jsx`. Worker `.gitignore`
was empty and now ignores `.env*`, SQLite state, logs.

---

## 0. The steer, in one paragraph

The NAS (not Arweave) becomes the working library. Content the owner drops on the
NAS is pointed at by `/archive`, analyzed as today (hash → TwelveLabs → Jev), and
then **physically reorganized on the NAS** into a schema-derived folder tree with
normalized names. That organized NAS copy is what the X scheduler draws from.
Arweave becomes a **manual, quoted, per-collection approval** after the owner has
reviewed the analysis and the organized tree. Lane B (phone/cloud upload) lands
in Firebase Storage and stays there until the same Arweave approval.

## 1. Decision changes (owner-stated 2026-09-20 evening)

| Old | New | Docs to update |
|---|---|---|
| D1 / worker D002: NAS is read-only, never written. | **NAS is written — but only inside one owned root** (`<NAS>/HITLOOP-ARCHIVE/`) and only by the organizer step, which is journaled and reversible. Files outside that root are never modified in place; they are **moved into** it. | `ARCHIVE-X-MASTER-PLAN` §0, worker `DECISIONS.md` D002, `ARCHITECTURE.md`, `AGENT_HANDOFF.md` |
| D6 (revised): documented asset → automatic Arweave upload. | **No automatic upload.** Arweave requires an explicit per-collection approval on `/archive` with a live Turbo quote and a wallet-balance check. Restores worker D009/D010. | `PERMANENT_ARCHIVE_CONTRACT.md`, `archive-permanent-archive.cjs` header comment, worker `AGENT_HANDOFF.md` invariant 9 |
| D3: Lane 2 Firebase object purged after Arweave success (lifecycle rule as backstop). | Unchanged purge trigger, but **no lifecycle TTL** — an unapproved Lane B object must survive indefinitely. | `INTAKE_CONTRACT.md` |
| Worker D003: "normalized archive names and logical structure" (never implemented). | **Implemented** as the organizer (W-B). | `DECISIONS.md` D003 |

Not changed: D2 (two lanes, one pipeline), D4 (worker executes both lanes), D5
(laptop worker), D7 (archive read-only from the X side), D8 (dev branch).

## 2. WIP review findings (as-built, verified from code by the code-map pass)

Ordered by severity for this steer.

1. **No kill switch.** `app/api/archive/worker/assets/route.js` → `autoEnqueueArchiveUpload` fires on every asset sync once an asset is documented, and `hasActiveUploadCommand` treats FAILED as inactive. Restarting the worker re-enqueues the three `402` uploads. **Must land before the worker runs again** (W-A).
2. **Docs contradict each other.** HITLOOP `PERMANENT_ARCHIVE_CONTRACT.md` says everything uploads; worker `DECISIONS.md` D009/D010 + `AGENT_HANDOFF.md` say approval and quote are required. The steer resolves it in the worker docs' favor; both sets get rewritten in W-A.
3. **Scheduler cannot read the NAS.** X posting attaches media by `fetch(mediaUrl)` from Vercel (`twitter-service.js:546`). A NAS path is unreachable from prod. "NAS as scheduler source" therefore means: the worker stages bytes into Firebase Storage on demand when a package is scheduled, and the package carries that URL until Arweave replaces it (W-D). Publishing itself (P4) is still unbuilt, so this is a contract, not a regression.
4. **Organized structure is unimplemented.** `archiveName` = basename; `collectionId` = slug of the source folder. No naming scheme, no mover, no journal exist in either repo (W-B is greenfield).
5. **Cost surface.** The page now quotes Turbo live (`39da96cc`), but nothing checks wallet balance before enqueue, so a batch can half-fail with `402` mid-collection. W-C adds a balance pre-check and per-selection quote.
6. **Duplicates + artifacts.** Dedupe is proven (AppleDouble `._*` collapsed to 1 asset / 6 locations). The organizer must move only the canonical location per asset and skip `DUPLICATE` locations and filesystem artifacts.
7. **Non-video assets get no evidence.** TwelveLabs runs on video only; images reach Jev with no observations, so pillar/era are guesses. The organizer must have an `_unsorted` bucket rather than trusting low-confidence decisions.
8. **Dead code.** Worker `lib/archive/manifest.ts` and `arweave/manifest.ts` have no callers; HITLOOP `arweave/{assets,upload}` routes and the legacy body of `arweave/collection` are superseded. Remove in W-E, not before.
9. **Jev quality.** `era` = unknown and `series` = C2 at low confidence on every real asset. Not in scope here; it caps how much the folder scheme should lean on those two answers (see §3).

## 3. Target architecture

```
Lane A  /archive Browse → Process Folder ───┐   (worker on laptop, NAS at /Volumes/bryan)
                                            ├─► discover → SHA-256 → dedupe → TwelveLabs → Jev
Lane B  /archive Quick Ingest → Firebase ───┘                     │
        (object stays in Firebase)                                ▼
                                            ORGANIZE (Lane A only): move canonical file into
                                            <NAS>/HITLOOP-ARCHIVE/<scheme>, write journal + sidecar
                                                                  │  archive_review.organized = {…}
                                                                  ▼
                                            HUMAN REVIEW on /archive (corrections re-file, journaled)
                                                                  │
                        ┌─────────────────────────────────────────┤
                        ▼                                         ▼
          SCHEDULER (Archive Inbox → package)        APPROVE FOR ARWEAVE (per collection,
          package.media = NAS-staged URL             live quote + balance check, one click)
          (worker STAGE_FOR_PUBLISH → Firebase                    │
           publish-staging/, purged later)                        ▼
                                                    UPLOAD_ASSET_ARWEAVE (existing worker path)
                                                    → record v1 → manifest → Lane B purge
```

### 3a. NAS organized tree (owner-confirmed 2026-09-20 evening)

Root: `/Volumes/bryan/HITLOOP-ARCHIVE/` (worker refuses to write anywhere else;
constant `ORGANIZED_ROOT_NAME`, asserted on every path before `rename`).

```
HITLOOP-ARCHIVE/
  <collectionId>/                       # slug of the processed source folder (stable, human-chosen)
    <pillar>/                           # Jev "pillar" after human correction; "_unsorted" if
                                        #   confidence < QUICK_REVIEW or no evidence
      <original filename>               # filename KEPT verbatim; only on collision: "name (sha12).ext"
    _meta/
      <sha12>.record.json               # sidecar schema hitloop-archive-sidecar/0 (worker-side:
                                        #   sha, size, mime, paths, all Jev decisions, evidence summary)
      collection.json                   # {collectionId, title, sourcePath, organizedAt, assets[], skipped[]}
      moves.jsonl                       # append-only journal: {ts, jobId, sha256, from, to, sizeBytes, reason}
```

Owner-confirmed scope lines:
- **Moves:** video (`mp4 mov m4v webm mkv avi`) + image (`jpg jpeg png heic gif webp tif tiff`) only; canonical location per sha256 only.
- **Never moves:** audio (`wav aif aiff mp3 flac m4a ogg`); project files (`als alp logicx flp ptx cpr rpp`) and any folder containing one, plus `Ableton Project Info/`, `Samples/`, `Backup/`; `._*`, `.DS_Store`, hidden, unknown extensions; anything already under `HITLOOP-ARCHIVE/`. Every skip listed with a reason.
- **Filenames:** kept.
- **Default:** `plan` auto after analysis, `apply` on click, undo available. Auto-apply is a later opt-in.

Why not `era/` in the path: `era` is `unknown` on every real asset today (§2.9);
putting a wrong era in a path means a second move after every correction. Era
stays in the sidecar and the record. Pillar is the one taxonomy axis the owner
actually browses by (it drives the X series), and corrections re-file with a
journaled move. Collection first keeps the tree stable when Jev is wrong.

### 3b. Organizer rules (W-B)

- Runs as a new command `ORGANIZE_COLLECTION` after Jev decisions are synced,
  **auto-queued in `plan` mode**, applied only on a click (`apply`) until the
  owner flips `archive_settings/organizer.mode` to `auto-apply`.
- `plan` writes nothing to disk. It produces the full move list into the command
  result and `archive_review/{id}.organizedPlan`; `/archive` shows it as a table
  (from → to) with counts before the owner clicks APPLY.
- `apply` moves with `fs.rename` (same volume, SMB) one file at a time, appends
  the journal line **before** the rename, verifies size after, updates SQLite
  `file_locations.relative_path` + a new `organized=1` column, then syncs
  `archive_review.organized = {path, appliedAt, journalOffset}`.
- Only the canonical location of each asset moves; `DUPLICATE` locations and
  `isFilesystemArtifact` files are left where they are and listed as skipped.
- `UNDO_ORGANIZE` replays `moves.jsonl` backwards for one job. Tested against a
  fixture tree, then against a **copy** of `hpit03_finals` (owner makes
  `/Volumes/bryan/_hitloop-organize-test/`), never the original folder until
  undo is proven on the copy.
- Human corrections on `/archive` that change `pillar` enqueue a re-file move
  (journaled) — the tree follows the current decision, never the model guess.
- Re-processing the organized root itself must be a no-op: the worker
  recognizes `HITLOOP-ARCHIVE/` by name and skips discovery inside it unless
  the job root *is* inside it (correction re-files).
- Lane B assets are not organized on the NAS in this pass (they are not on the
  NAS). Optional later phase: worker mirrors approved Lane B bytes into the tree.

### 3c. Arweave approval gate (W-C)

- `archive_settings/permanence` `{autoUpload:false, updatedBy, updatedAt}`.
  `autoEnqueueArchiveUpload` returns early unless `autoUpload === true` **and**
  the asset's `archive_review.state === 'ARWEAVE_APPROVED'`. Default off. This
  is the kill switch and ships first (W-A) with no UI beyond a status line.
- `/archive` PERMANENT ARCHIVE panel becomes actionable: per collection, list
  documented assets with a checkbox (default: all not yet uploaded), show
  **live Turbo quote for the selected bytes** and the **wallet balance**
  (`turbo.getBalance`, cached 10 min like the price), and one button
  `APPROVE + UPLOAD SELECTED` (`id="archive-permanence-approve-button"`).
  Disabled when balance < quote × 1.1.
- Approval writes `state:'ARWEAVE_APPROVED'`, `approvedBy`, `approvedAt`,
  `approvedQuoteUsd` on each selected `archive_review` doc, then calls the
  existing enqueue path. Everything downstream (upload, record v1, manifest,
  Lane B purge) is unchanged.
- Failed uploads (`402` etc.) stay FAILED and are listed under the panel with
  a RETRY that re-runs the quote/balance check; nothing retries by itself.
- Lane B: intake state machine unchanged (`… HASHED → REVIEWED → ARCHIVED →
  PURGED`); `REVIEWED` no longer implies upload. No Storage lifecycle rule.

### 3d. Scheduler media from the NAS (W-D)

- `ContentPackage` gains `media: {state:'nas'|'staged'|'permanent', url, sha256,
  organizedPath?, expiresAt?}` (schema.js + archive-ingest seam). Packages built
  from an organized-but-not-uploaded asset get `state:'nas'`, no url.
- New worker command `STAGE_FOR_PUBLISH {sha256}`: worker reads the organized
  NAS file, re-hashes, uploads to HITLOOP's own bucket at
  `publish-staging/{sha256}/{basename}`, reports `{url (signed, 7 d), sizeBytes}`;
  HITLOOP writes `media.state='staged'` on the package. Lane B assets are
  already in Firebase: the seam reuses the intake object (no worker call).
- Trigger: placing a package on a day plan / saving a story from the Archive
  Inbox for an asset with `media.state==='nas'` enqueues the command. Archive
  Inbox shows a source badge (NAS / STAGED / ARWEAVE) and a "staging…" state
  while the worker is offline (laptop uptime = staging latency, D5).
- Purge `publish-staging/` object when the asset reaches Arweave (media
  flips to `permanent`, url = arweaveUrl) or after `expiresAt` if unused.
- Out of scope: actually posting to X (P4 stays unbuilt) and proxies/transcodes
  (would add ffmpeg to the worker — separate decision).

## 4. Workstreams

Each sized for one Sonnet executor. Gate = what the orchestrator verifies.

### W-A — Kill switch + contract reconciliation (HITLOOP + docs) — **first, tiny**
- Files: `api/_lib/archive-permanent-archive.cjs` (`autoEnqueueArchiveUpload`
  reads `archive_settings/permanence`; also skip when `state !== 'ARWEAVE_APPROVED'`),
  `app/archive/page.jsx` status line in `#archive-permanent-status-panel`
  ("AUTO UPLOAD: OFF"), test in `api/_lib/__tests__/archive-permanent-archive.test.js`.
- Docs: rewrite `docs/archive/PERMANENT_ARCHIVE_CONTRACT.md` §intro; add a
  "Superseded 2026-09-20 evening" banner to `ARCHIVE-X-MASTER-PLAN` §0 D1/D6;
  worker `DECISIONS.md` D002 → "written only inside HITLOOP-ARCHIVE/, journaled",
  D003 → "implemented by organizer", D009/D010 → "restored".
- Gate: with the flag absent or false, an asset sync that previously enqueued
  `UPLOAD_ASSET_ARWEAVE` enqueues nothing (test); worker may be restarted safely.
- Blocks: everything else touching the worker live.

### W-B — NAS organizer — **critical path** (split in two executors)
- **W-B1 (worker, runs in parallel with W-A):** assetManager. New
  `lib/archive/organize/{scheme,planner,mover,journal}.ts` + tests,
  `daemon.ts` (`ORGANIZE_COLLECTION` plan/apply, `UNDO_ORGANIZE`), `database.ts`
  (`file_locations.organized_path/organized_at`, `organize_moves` table),
  `control-plane.ts` (`syncAsset` carries `organized`), `worker.ts` (skip
  `HITLOOP-ARCHIVE/` at discovery), worker docs (`DECISIONS.md`, `ORGANIZER.md`).
- **W-B2 (HITLOOP, runs after W-A merges — same page file):** `commands/process`
  accepts `ORGANIZE_COLLECTION`/`UNDO_ORGANIZE` with `mode`; `worker/assets`
  persists `organized`; `/archive` plan table + PLAN / APPLY / UNDO buttons
  (`id="archive-organize-plan-panel"`); command COMPLETE handler stores
  `result.plan` on the command doc for the page to read.
- Gate: fixture tests (plan is pure; apply + undo round-trip on a temp tree;
  refuses any target outside the root; duplicates/artifacts skipped); then a real
  plan on `hpit03_finals` (no writes); then apply + undo on the owner's **copy**
  folder. Never `apply` on an original folder inside this workstream.

### W-C — Approval gate + quote + balance (HITLOOP)
- Files: `archive-permanent-archive.cjs` (`approveForArweave(ids, actor)`,
  `getPermanentArchiveSummary` adds per-asset rows + balance), `archive-arweave.cjs`
  (`getTurboBalanceLive`, cached), `app/api/archive/approved/route.js` (POST
  approve), `app/archive/page.jsx` panel, tests.
- Gate: quote for a 2-asset selection matches `estimateArchiveCostLive` for the
  summed bytes; button disabled below balance; approving writes
  `ARWEAVE_APPROVED` and enqueues exactly the selected assets. No real upload
  in this workstream.
- Depends on W-A. Parallel with W-B.

### W-D — Scheduler media contract + staging (HITLOOP + worker)
- HITLOOP: `features/x-content-inventory/{schema,archive-ingest}.js` (`media`),
  `app/api/dashboard/archive-inbox/route.js` (enqueue `STAGE_FOR_PUBLISH` on
  save-story when `media.state==='nas'`), `api/_lib/archive-publish-staging.cjs`
  (signed URL mint, purge), `handleCommandComplete` case, `ArchiveInboxCard.jsx`
  badge. Worker: `daemon.ts` `STAGE_FOR_PUBLISH` (re-hash, stream to the signed
  PUT URL, report).
- Gate: seam tests (57 + new) green; a hand-written organized `archive_review`
  doc yields a package with `media.state:'nas'`; save-story enqueues one command;
  a fake worker completion flips it to `staged` with a url. No real X call.
- Depends on W-B's `organized` shape (can start from the contract in §3d).

### W-E — Hygiene + real re-run
- Remove dead worker manifest modules and the superseded HITLOOP arweave routes
  (route count matters: `VERCEL-HOBBY-DEPLOYMENT.md`); update
  `HITLOOP-MERGE-PROGRAM-WORK-LOG`. Then, with owner OK: restart worker, plan +
  apply organize on the copy folder, approve one already-uploaded asset's
  collection to confirm the gate is a no-op for uploaded bytes, and run a real
  `STAGE_FOR_PUBLISH`.
- Gate: `npm test` green in HITLOOP, `npm run test:archive` green in the worker.

### W-F — `/archive` browser (owner request 2026-09-20 late; go given)
Cause of the ~1 min per click: the daemon is one serial loop, so `LIST_DIRECTORY`
waits behind a hash job (~90 s), the TwelveLabs sweep, the intake drain, then a
5 s poll and a 500 ms page poll. Listing returned folder names only.
- **F1 (DONE, uncommitted; measured 0.7 s root / 1.6 s for a 6-file folder over SMB, worker idle):** worker "browse lane" — a second 1 s loop that claims only
  `LIST_DIRECTORY` (claim route gains `types=`/`excludeTypes=`), runs concurrently
  with jobs. Result adds `entries[{name, kind, sizeBytes, modifiedAt, ext, movable}]`
  + `counts`, keeps `folders[]`. Page: `#archive-browser-panel` with breadcrumb,
  folders-then-files rows, size/ext, dimmed non-media, per-path cache, 250 ms poll,
  stale-poll abort. No selection yet; `BrowserRow` is the extension point.
- **F2 (DONE, uncommitted; live: `PROCESS_SELECTION` of 2 files 32.5 s, selection PLAN 5.7 s → 2 moves, 0 skips):** inline tree (▸ expands in place, lazy, cached), checkbox multi-select (files + folders, shift range),
  `#archive-selection-bar` (count, bytes, collection name defaulting to the common
  parent), ADD TO ANALYZER → new command `PROCESS_SELECTION { items:[{relativePath,
  kind}], collectionId }`; worker job over a selection (`collection_jobs.selection_json`);
  organizer planner accepts items. PROCESS FOLDER stays as the shortcut.
- **F2b (DONE 2026-09-21, uncommitted, live-verified):** page auto-lists the
  drive root on load and the tree has no inner height cap; command following
  never gives up (6 h cap, elapsed shown, resumes an in-flight job on reload);
  collection name follows the selection (React updater/ref bug fixed);
  `CANCEL_JOB {targetCommandId}` claimed by the 1 s browse lane cancels a
  running hash job mid-walk (job `CANCELLED`, hashed rows kept, not resumable,
  original command `FAILED · CANCELLED by owner`); `mediaOnly:true` (default
  for selections, `#archive-selection-media-only-toggle`) hashes only video +
  image files. Lesson: a Desktop backup (2,622 tiny Ableton files, 0 videos)
  ran 90 min before it could be stopped — hashing is the slow step over SMB,
  not TwelveLabs.
- **F3 (optional):** lazy child counts, name filter, remembered path, per-row
  hashed/organized badges from SQLite.

## 5. Orchestration

```
W-A ──► W-C ──┐
W-B ──► W-D ──┼─► W-E
```
- Wave 1 (2 agents): W-A (HITLOOP worktree), W-B (worker worktree). W-A merges
  first; nothing runs the live worker until it has.
- Wave 2 (2 agents): W-C, W-D.
- Wave 3 (1 agent): W-E, owner-gated for the live steps.

Executor rules (unchanged from the prior plan §5, plus):
- Any `fs.rename`/write in the worker must go through `organize/mover.ts` and
  assert the target is under `HITLOOP-ARCHIVE/`. No other module writes the NAS.
- No executor runs the live worker against `/Volumes/bryan`. Orchestrator runs
  the real gates on the copy folder only, after the owner creates it.
- Stop and ask on: schema change to `archive_review` beyond the fields named
  here, any new dependency (ffmpeg, sharp in the worker), any new HITLOOP route
  beyond `approved` POST, any Storage lifecycle rule, any X API call.

Per-agent brief template: as in `ARCHIVE-X-MASTER-PLAN` §5.

## 6. Owner decisions before Wave 1

1. **Confirm the NAS-write reversal** and the root name `HITLOOP-ARCHIVE/`
   (move-with-journal; not copy — a copy doubles the terabyte).
2. **Folder scheme**: §3a (`collection/pillar/`) as proposed, or another axis.
3. **Organizer default**: plan-then-click-APPLY per collection (proposed), or
   auto-apply from day one.
4. **Lane B retention**: confirm no lifecycle TTL (unapproved objects live
   forever in Firebase, at Storage cost).
5. **Test copy folder**: create `/Volumes/bryan/_hitloop-organize-test/` as a
   copy of `hpit03_finals` (~850 MB) before W-B's real gate.
6. Deferred, not blocking: masters vs compressed proxies on Arweave (cost),
   Lane B mirror into the NAS tree, bridge box (W8).
