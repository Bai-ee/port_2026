# Archive ⇄ X — Master Execution Plan (2026-09-20)

Orchestration plan for one Opus-level orchestrator directing several Sonnet
executors. Written after a live localhost bring-up on this date; every "verified"
claim below was observed, not inferred from docs.

Supersedes for execution: `ARCHIVE-X-SESSION-HANDOFF-2026-09-20.md` (context),
`HITLOOP-MERGE-PROGRAM-2026-09-20.md` (merge sequencing still authoritative for
promotion to `main`). Read those for rationale; execute from this file.

---

## 0. Locked owner decisions (do not reopen)

| # | Decision | Consequence |
|---|---|---|
| D1 | **NAS is analysis-only.** The WD My Cloud EX2 Ultra is a master drive the owner sorts over time. Nothing is ever written to it by this system. | No "copy uploads to NAS" step anywhere. |
| D2 | **Two intake lanes, one pipeline.** Lane 1 = NAS folders picked from `/archive`. Lane 2 = single-file uploads from phone/camera roll on `/archive` (ships to prod). | Both lanes converge on the same hash → analyze → Jev → human review → Arweave path. |
| D3 | **Lane 2 stages in Firebase Storage, transiently.** Object is deleted once its Arweave upload succeeds after review. Direct-to-Arweave before review is rejected (permanent + paid before dedupe/rights check). | Firebase is an inbox, never a library. Lifecycle rule as backstop. |
| D4 | **Worker executes both lanes.** For Lane 2 it downloads the object to a scratch dir, runs the identical pipeline, deletes scratch + cloud object on Arweave success. Cloud-only execution inside Vercel is rejected (300 s / memory / 12-function cap). | No hashing or Arweave streaming in Vercel functions. |
| D5 | **POC worker host = the owner's laptop** on the home network, NAS mounted at `/Volumes/bryan`. Bridge box (Path B: headless always-on machine, SMB mount) is a later phase, decision-gated. Running the worker on the NAS itself (Path A) is rejected. | Worker uptime = laptop uptime for now. |
| D6 | **Human approval gates permanent publishing.** Unchanged from ARCHITECTURE.md. | Nothing reaches Arweave without a review decision. |
| D7 | **Archive is read-only from the X side.** `archive-inbox` never writes `archive_review`/`archive_uploads`. The story is the only field the X side owns. | Preserved from the session handoff §5. |
| D8 | **One integration branch for local dev**: `codex/wip/archive-x-localhost-test`. Promotion to `main` follows the merge program (P0 `6qmg7k` first, then P1 rebase). | Do not merge live `main` into the dev branch (23 conflicts, all marketing/digest). |

---

## 1. Target architecture

```
Lane 1  /archive browse → Process Folder ──┐        (worker on laptop, NAS mounted)
                                           ├─► discover → SHA-256 → dedupe → TwelveLabs → Jev (6 questions)
Lane 2  /archive Quick Ingest → Firebase ──┘              │
        (phone, one file at a time)                       ▼
                                             HUMAN REVIEW on /archive (confirm / correct)
                                                          │  archive_review.state = CONFIRMED
                                                          ▼
                                           Arweave upload (worker re-hashes bytes first)
                                                          │  Lane 2: delete Firebase object
                                                          ▼
                                           ARCHIVE INBOX card → story → x_content_packages
                                                          ▼
                                           CONTENT ENGINE card → today's slots
```

Control plane = HITLOOP (`/archive` page + `app/api/archive/*`). It never touches
a filesystem; it queues `archive_commands` in Firestore and the worker polls
them outbound. This is why `/archive` on `hitloop.agency` works from a phone as
long as the laptop worker is up.

Worker = `Bai-ee/assetManager` (`lib/archive/*`, `npm run archive:worker`).

---

## 2. Verified state (2026-09-20, localhost)

### Works end to end
- Dev branch runs on `localhost:3000` with all local features + f0u17f seam + transplanted archive control plane (commit `d4879bbe`).
- Feature tests: 57/57 `features/x-content-inventory/`, 5/5 archive control-plane, 14/14 worker `test:archive`.
- Worker registers source, heartbeats ONLINE, `/archive` shows **ONLINE**.
- `/archive` BROWSE lists real NAS folders via `LIST_DIRECTORY` round trip.
- Process Folder on `hpit03_finals` (6 × ~135 MB MP4 + 6 AppleDouble `._` files) queued → claimed → running with heartbeats. (Hash outcome: see §2b.)

### Exists but NOT wired
- **TwelveLabs**: `lib/archive/providers/twelvelabs.ts` + `analysis/service.ts` are tested modules. `analyzeVideo()` has **zero callers** outside tests. The daemon never analyzes anything.
- **Jev**: `lib/archive/jev/service.ts` defines a `JevProvider` interface. **No implementation exists.** No LLM is called anywhere in the worker. `archive_review` therefore never receives decisions from a real run; the "Jev decisions" panel stays at 0 pending.
- **Lane 2 upload**: no file input on `/archive`, no intake collection, no worker source type.
- **Arweave upload in worker** is buffered (`uploader.ts`), fails on large originals.

### Credentials (names only, never values)
- HITLOOP `.env.local`: full Firebase admin/client set; `HITLOOP_ARCHIVE_WORKER_TOKEN` added this session (generated, local only). **Missing:** `ARWEAVE_WALLET_JWK`.
- Worker `.env.local`: `HITLOOP_ARCHIVE_CONTROL_URL=http://localhost:3000`, `HITLOOP_ARCHIVE_WORKER_ID=bryan-macbook-worker`, token set. **Empty:** `TWELVELABS_API_KEY`, `TWELVELABS_INDEX_ID`, `JEV_API_KEY`, `JEV_API_URL`, `ARWEAVE_WALLET_JWK`. The earlier claim that the worker had a TwelveLabs key was wrong; the variable exists, its value is empty. Owner says a key exists somewhere; location unknown.

### 2b. Process Folder outcome (`hpit03_finals`, first real NAS job)
- Command `PROCESS_COLLECTION` → COMPLETE in ~84 s over SMB.
- 12 files discovered → **7 content assets** (882,808,161 bytes): the 6 MP4s, plus **one** 368-byte asset shared by all six macOS AppleDouble `._*` files (identical bytes → 1 asset, 6 locations, 5 marked `DUPLICATE`). Byte-identity dedupe proven.
- 7 `archive_review` docs written to Firestore, all `QUEUED`, each with `0 observations`, `0 decisions` (analysis unwired, see above). Human Review panel correctly shows 0 pending because there is nothing to decide yet.
- `/archive` counters (DISCOVERED/HASHED/DUPLICATES/FAILED) still render `—`: the final ONLINE heartbeat carries `counters: null` and the page reads only the latest heartbeat. → W5(d).
- Worker SQLite: `assetManager/.moleboard/archive.sqlite` (tables `sources, collection_jobs, content_assets, file_locations, observations, jev_decisions`).
- **New item → W1:** skip macOS resource forks (`._*`, `.DS_Store`) at discovery; they are SMB artifacts, not content, and would otherwise reach TwelveLabs/Jev and the review queue.

---

## 3. Bugs found this session

| Bug | Where | Status |
|---|---|---|
| Worker never loads `.env.local` (no dotenv, no `--env-file`). Daemon ran unconfigured and silently skipped every HITLOOP call. | `assetManager/package.json` scripts | **Fixed, uncommitted**: `tsx --env-file-if-exists=.env.local` on `archive:scan`, `archive:worker`, `archive:source`. Node ≥ 22.9 required (laptop has 24.7). |
| Idle worker invisible: `archive_workers/{id}` doc is only created by a heartbeat; daemon only heartbeats during a job. `/archive` showed WAITING FOR WORKER and BROWSE had no worker to target. | `assetManager/lib/archive/daemon.ts` | **Fixed, uncommitted**: ONLINE heartbeat per source on startup and every 12 polls (~60 s). Tests still 14/14. |
| Stale `.next/dev/lock` after killing a dev server makes the next `npm run dev` fall to :3001 while printing Ready on :3000. | HITLOOP local | Runbook step (§7). |
| Two competing fixes for the dropped-file durability bug: remote `8d9fa08` (Claude, in `feat/archive-master-plan`) and local `codex/archive-worker-retryable-file-state` `049249e`. | assetManager | Remote taken (pulled ff). Codex branch to be deleted in W7. |
| `x-profile` and `x-calendar` share badge `XC`. | HITLOOP dashboard | Cosmetic, pre-existing, untouched. |
| Homepage `HeroSchematicOverlay.jsx:147` destructures null `shape` (seen in old dev log). | HITLOOP homepage lane | Not archive scope; log for the homepage lane. |

---

## 4. Workstreams

Each workstream is sized for one Sonnet executor. "Gate" = what the orchestrator
verifies before marking done. No executor deploys, spends, or pushes.

### W1 — Wire analysis into the worker job (TwelveLabs + Jev) — **critical path**
- **Repo:** assetManager. **Files:** `lib/archive/daemon.ts` (post-hash step), `lib/archive/analysis/service.ts`, new `lib/archive/jev/anthropic-provider.ts`, `lib/archive/worker.ts` only if a hook is needed.
- **Scope:** after `worker.run` completes and before `syncJobAssets`, for each new video asset: `analyzeVideo` → observations; then Jev answers the six questions from `jev-taxonomy.export.json` (vendored from HITLOOP `scripts/x-content/export-jev-taxonomy.mjs`) using observations only, never raw media. Persist decisions with `reviewBand`. Skip cleanly (log, no throw) when keys are empty so Lane 1 hashing still works without credentials.
- **Jev provider:** Anthropic Messages API, structured output, `claude-sonnet-5` default, temperature 0, one call per asset returning all six answers with probabilities. Instrument cost per call in the worker log.
- **Gate:** unit tests for the provider with a fake fetch; one real folder run produces ≥1 `QUICK_REVIEW` decision visible in `/archive` Human Review; no credentials in any commit.
- **Blocked on:** owner supplies `TWELVELABS_API_KEY` + `TWELVELABS_INDEX_ID` and an Anthropic key into the worker `.env.local`. Executor must not proceed to real calls without the orchestrator's explicit spend OK for one folder.

### W2 — Quick Ingest upload block on `/archive` (Lane 2, HITLOOP side)
- **Repo:** HITLOOP. **Files:** `app/archive/page.jsx` (new block, `id="archive-quick-ingest-panel"`), new `app/api/archive/intake/route.js` (POST mint signed PUT URL under `archive-intake/{uuid}/{filename}` via `editvideos-bridge.cjs` `bridgeBucket()` pattern; PATCH marks `UPLOADED`), Firestore `archive_intake/{id}` {state, storagePath, contentType, sizeBytes, createdBy, createdAt}.
- **Client:** reuse `uploadFileToSignedUrl` from `MediaLibraryCard.jsx` (extract to `lib/dashboard/upload-signed-url.js` rather than import a card). Single file, progress bar, image + video accept, mobile-width per `MOBILE-WIDTH-STANDARD.md`.
- **Gate:** upload a 5 MB image from Chrome mobile emulation; object appears in bucket; intake doc `UPLOADED`; no new `maxDuration`; route count stays within the Hobby packaging strategy (`VERCEL-HOBBY-DEPLOYMENT.md`).
- **Parallel with:** W1, W3 (contract first, see §5).

### W3 — Worker cloud-intake source (Lane 2, worker side)
- **Repo:** assetManager. **Files:** `lib/archive/daemon.ts` (poll `archive_intake` via a new HITLOOP route `GET /api/archive/worker/intake?workerId=`), new `lib/archive/intake.ts` (download signed GET URL → `os.tmpdir()/archive-intake/`, register as a virtual source `cloud-intake`, run the same job path), HITLOOP `app/api/archive/worker/intake/route.js` (list + claim + complete).
- **Rules:** never write the NAS (D1). Delete scratch + Firebase object only on `UPLOAD_ASSET_ARWEAVE` COMPLETE for that sha256; until then the object stays. Intake doc states: `UPLOADED → CLAIMED → HASHED → REVIEWED → ARCHIVED → PURGED`.
- **Gate:** W2's uploaded image flows to `archive_review`; duplicate upload of the same bytes is detected by hash, not filename.
- **Depends on:** W2 contract (intake doc shape + routes). Can start against a hand-written intake doc.

### W4 — Streaming Arweave upload in the worker
- **Repo:** assetManager. **Files:** `lib/archive/arweave/uploader.ts`.
- **Scope:** replace buffered read with a stream to Turbo (`@ardrive/turbo-sdk` `uploadFile` with a stream factory), keep the re-hash-before-upload invariant, keep the returned `{transactionId, sizeBytes}` contract unchanged.
- **Gate:** test with a fake Turbo client asserting no `readFile` of the whole object; memory stays flat on a 1 GB fixture (generated, not committed). No real upload without `ARWEAVE_WALLET_JWK` and orchestrator spend OK.
- **Parallel with:** everything.

### W5 — Control-plane hardening (HITLOOP)
- **Files:** `app/api/archive/workers/route.js`, `app/api/archive/worker/sources/route.js`, `app/archive/page.jsx`.
- **Scope:** (a) `sources` POST also upserts the parent `archive_workers/{id}` doc so a freshly registered worker is visible even before its first heartbeat; (b) `/archive` shows OFFLINE when `lastHeartbeatAt` > 3 min old instead of a stale ONLINE; (c) `LIST_DIRECTORY` result also returns a file count per folder so the owner can see size before processing; (d) DISCOVERED/HASHED/DUPLICATES/FAILED counters actually render from the heartbeat `counters` (currently `—`; verify after §2b).
- **Gate:** kill the worker → page flips to OFFLINE within 3 min; restart → ONLINE without a job.
- **Parallel with:** everything; touches no worker code.

### W6 — Seam and X-card visual QA (localhost)
- **Repo:** HITLOOP. **Files:** read-only unless a defect is found: `components/dashboard/ArchiveInboxCard.jsx`, `XContentEngineCard.jsx`, `features/x-content-inventory/*`, `app/api/dashboard/archive-inbox/route.js`.
- **Scope:** with one CONFIRMED record from W1's gate, verify: Archive Inbox lists it; writing a story creates a `x_content_packages` row; Content Engine's day plan shows it in a slot; Jev human corrections (not model guesses) are what the package carries (key `d.id || d.question`, handoff §5). Screenshot every card at desktop and 390 px width. File defects as findings, fix only obvious one-liners.
- **Gate:** written report with screenshots in `docs/plans/ARCHIVE-X-VISUAL-QA-<date>.md`.
- **Depends on:** W1 gate (needs a real confirmed asset). Can pre-stage with a hand-written `archive_review` doc to unblock UI checks.

### W7 — Repo hygiene and merge program
- **assetManager:** commit the two fixes from §3 on `feat/archive-master-plan` (message: `fix(archive): load .env.local in worker scripts; heartbeat while idle`), push after owner OK. Delete `codex/archive-worker-retryable-file-state` (superseded by `8d9fa08`). Leave `.gitignore` dirty state to the owner.
- **HITLOOP:** keep `codex/wip/archive-x-localhost-test` as the dev branch. Promotion order unchanged: P0 `origin/claude/archive-poc-finalization-6qmg7k` → `main` (graph-clean), then P1 rebase of `f0u17f` + this branch's seam onto `main` resolving the 17–23 marketing/digest conflicts deliberately. Update `docs/plans/HITLOOP-MERGE-PROGRAM-WORK-LOG-2026-09-20.md` with this session's findings (its `codex/archive-inbox-x-content-source` head `1bfa87e6` is stale by 5 commits).
- **Gate:** owner approves every push; `npm test` green on HITLOOP before any PR.

### W8 — Bridge box (deferred, decision-gated)
- Hardware pick, SMB mount, systemd unit for `archive:worker`, control URL → `https://hitloop.agency`, token rotated into Vercel env. Not started until W1–W5 gates pass and the owner picks hardware.

---

## 5. Orchestration

### Dependency graph
```
W5 ──────────────────────────────┐
W4 ──────────────────────────────┤
W2 (contract) ─► W3 ─────────────┼─► W6 (needs W1 gate) ─► W7 promotion
W1 ──────────────────────────────┘
```

### Waves (Sonnet executors in parallel)
- **Wave 1 (4 agents):** W1, W2, W4, W5. W1 first defines the intake-agnostic "post-hash analysis hook"; W2 first publishes the intake doc + route contract into `docs/archive/INTAKE_CONTRACT.md` so W3 can start.
- **Wave 2 (2 agents):** W3 (against W2's contract), W6 (pre-staged doc, then real once W1 lands).
- **Wave 3 (1 agent):** W7 hygiene + merge-log update. W8 only on owner go.

### Orchestrator rules
1. Every executor gets: this file, the relevant SSOT (`assetManager/docs/archive/ARCHITECTURE.md`, `DATA_MODEL.md`, `CONTROL_PLANE.md`; HITLOOP `CLAUDE.md` archive + Vercel Hobby sections), and the runbook in §7. Nothing else.
2. Executors work on the dev branch (HITLOOP) or `feat/archive-master-plan` (worker) in their own worktree. No pushes, no deploys, no Vercel/IAM/env edits, no paid API calls without a per-call orchestrator OK that names the spend.
3. Spend gates: TwelveLabs (per-minute indexing), Anthropic (per Jev call, instrumented), Arweave/Turbo (per byte, permanent). Dry-run first, one folder (`hpit03_finals`, 6 videos) max, never the terabyte.
4. Each workstream ends with: files changed, behavior changed, tests run with output, what was not verified. Orchestrator re-runs the gate itself before accepting.
5. Stop and ask the owner on: any new dependency, any change to `archive_review` schema, any write to the NAS, any route added beyond W2/W3's three, any change to the marketing site.
6. Never edit `DashboardPage.jsx` while a dashboard run is streaming (Fast-Refresh kills the run; `MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`).

### Per-agent brief template
```
Workstream: W<n> — <title>
Repo/branch/worktree: ...
Read first: <2–3 docs max>
Do: <scope bullets from §4>
Do not: <the D-rules that apply>, no push/deploy/spend
Done when: <gate>
Report: files changed · behavior changed · tests + output · not verified
```

---

## 6. Open questions for the owner

1. Where is the TwelveLabs key (and index id)? Needed in worker `.env.local` for W1.
2. Anthropic key for Jev on the worker side: reuse HITLOOP's, or a separate key so Jev spend is visible on its own? (Operating Cost card only sees HITLOOP-side calls; worker-side spend is invisible unless logged separately.)
3. Arweave wallet JWK location for W4/real uploads.
4. Bridge hardware for W8 (Raspberry Pi 4 vs mini PC), when ready.

---

## 7. Runbook (localhost, laptop worker)

```bash
# HITLOOP
cd /Users/bballi/Documents/Repos/Bballi_Portfolio
git checkout codex/wip/archive-x-localhost-test
pkill -9 -f 'next dev'; pkill -9 -f next-server; rm -f .next/dev/lock   # stale lock → :3001 trap
npm run dev                                   # next dev --webpack on :3000
# sign in at http://localhost:3000/login (owner does this; agents never enter credentials)
# wrong client showing? sessionStorage.removeItem('dashboard.impersonateClientId'); location.reload();

# Worker (NAS mounted at /Volumes/bryan via SMB to 192.168.1.6)
cd /Users/bballi/Documents/Repos/assetManager        # feat/archive-master-plan @ 8d9fa08 + uncommitted §3 fixes
npm run archive:source -- /Volumes/bryan "Bryan NAS"  # once; idempotent
npm run archive:worker                                 # loads .env.local via --env-file-if-exists
# /archive should show WORKER ● ONLINE within ~10 s; BROWSE lists NAS folders

# Tests
node --test 'features/x-content-inventory/__tests__/*.test.js'      # 57
node --test api/_lib/__tests__/archive-manifest.test.js app/__tests__/archive-arweave.test.mjs app/api/archive/worker/heartbeat/__tests__/contract.test.mjs   # 5
(cd ../assetManager && npm run test:archive)                        # 14
```

Ports: dev server must own :3000; Chrome also holds a client socket on :3000, ignore it. Worker log: run with `> worker.log 2>&1` and tail it; the daemon swallows control-plane errors by design, so an empty log is not proof of health — check `/archive` ONLINE and the dev log's `POST /api/archive/worker/heartbeat 200`.
