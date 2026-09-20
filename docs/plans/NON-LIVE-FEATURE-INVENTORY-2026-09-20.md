# Non-Live Feature Inventory - 2026-09-20

Live production for `https://hitloop.agency` is currently the GitHub/Vercel production deployment at commit `4ea390ee87264d2c5ba804d2dcd89891615edb7f`, matching `origin/main` as of this review.

This document tracks feature work that exists outside the live production baseline and organizes it into merge lanes.

## Branch And Repo Map

| Source | State vs live | Purpose | Merge priority |
| --- | ---: | --- | --- |
| `origin/claude/archive-poc-finalization-6qmg7k` | 45 commits ahead, 0 behind | Archive/IP control plane plus Vercel build fixes | P0 |
| `origin/feat/archive-jev-poc` | 42 commits ahead, 0 behind | Earlier archive/IP control plane branch | P0, superseded by finalization branch |
| `/Users/bballi/Documents/Repos/assetManager` `origin/feat/archive-master-plan` | separate repo; local copy is 8 commits behind remote | NAS archive worker, source scanning, schemas, Jev, Arweave seams | P0 |
| `origin/claude/archive-poc-finalization-f0u17f` | 51 commits ahead, 22 behind | Archive Inbox to X scheduler bridge, plus X content work | P0/P1 |
| `feat/brief-rendered-scrape-phase-1` | local current branch; 46 commits ahead, 22 behind | X content engine, rendered scrape, email digest, Paint Studio, homepage work | P1 |
| `origin/fix/email-digest-phase-0-1` | 20 commits ahead, 22 behind | Email digest phase 0/1 fixes | P2 |
| local untracked Studio files | not on any branch yet | Invoice Studio, Loop Studio, standalone `/looper`, Edittrax player, loopcore service | P1 |
| local dirty homepage files | not committed yet | Optional homepage layout/interaction experiments | P2 |

Branches such as `origin/feat/social-auto-publish`, `origin/feat/client-brain-voice-fidelity`, and `origin/feat/digest-granular-toggles-hosted-brief-link` are already ancestors of production. They do not appear to need merge work unless we are mining them for lost ideas.

## P0 - IP Archive / NAS / Jev / Arweave

### Asset Manager Worker Repo

Primary source: `/Users/bballi/Documents/Repos/assetManager`

Remote: `https://github.com/Bai-ee/assetManager.git`

Branch: `origin/feat/archive-master-plan`

The worker repo is the source of truth for the NAS-side archive engine. It contains the local archive worker that scans selected NAS folders without mutating originals, hashes files with SHA-256, creates durable asset records, runs Jev/TwelveLabs-style analysis seams, and talks outbound to the HITLOOP control plane.

Important files:

- `lib/archive/worker.ts`
- `lib/archive/daemon.ts`
- `lib/archive/control-plane.ts`
- `lib/archive/database.ts`
- `lib/archive/manifest.ts`
- `lib/archive/hash.ts`
- `lib/archive/schema/asset-state.ts`
- `lib/archive/jev/service.ts`
- `lib/archive/providers/twelvelabs.ts`
- `lib/archive/analysis/service.ts`
- `lib/archive/arweave/manifest.ts`
- `lib/archive/arweave/uploader.ts`
- `lib/archive/cli.ts`
- `lib/archive/source-cli.ts`
- `docs/archive/CURRENT_STATE.md`
- `docs/archive/ARCHITECTURE.md`
- `docs/archive/CONTROL_PLANE.md`
- `docs/archive/DATA_MODEL.md`
- `docs/archive/DECISIONS.md`

Core contract:

- NAS-first and read-only originals.
- Worker initiates outbound HTTPS only; no inbound NAS exposure.
- SHA-256 is the content identity; path is provenance.
- Worker does not transmit absolute local NAS paths by default.
- Human approval is required before permanent archive upload.
- Arweave quote happens before upload.
- Re-hash before upload is required.

Current known gaps from the handoff docs:

- End-to-end validation still needed.
- Automatic sync from worker observations into review records needs validation.
- Approved collection asset and byte totals need final derivation.
- Command claiming/leases are not fully hardened.
- TwelveLabs lifecycle needs real-provider validation.
- Turbo/Arweave quote and TX availability need live verification.
- Static viewer upload to Arweave is still unfinished.
- `better-sqlite3` needs validation on the worker host.

### HITLOOP Archive Control Plane

Best branch to start from: `origin/claude/archive-poc-finalization-6qmg7k`

This appears to supersede `origin/feat/archive-jev-poc` because it includes the archive POC plus Vercel import and lockfile fixes.

Important files:

- `api/_lib/archive-arweave.cjs`
- `api/_lib/archive-manifest.cjs`
- `api/_lib/__tests__/archive-manifest.test.js`
- `app/__tests__/archive-arweave.test.mjs`
- `app/api/archive/worker/heartbeat/route.js`
- `app/api/archive/worker/sources/route.js`
- `app/api/archive/commands/worker/route.js`
- `app/api/archive/commands/process/route.js`
- `app/api/archive/browse/route.js`
- `app/api/archive/review/route.js`
- `app/api/archive/approved/route.js`
- `app/api/archive/arweave/quote/route.js`
- `app/api/archive/arweave/assets/route.js`
- `app/api/archive/arweave/upload/route.js`
- `app/api/archive/arweave/collection/route.js`
- `app/archive/page.jsx`
- `public/archive-viewer/index.html`
- `docs/archive/README.md`
- `docs/plans/ARCHIVE-POC-AGENT-HANDOFF.md`

What it adds:

- Authenticated worker heartbeat registration.
- Source registration and status tracking.
- Admin NAS browsing via queued commands.
- Collection processing command queue.
- Archive review API and UI.
- Human Jev review flow.
- Approved assets list.
- Arweave quote route.
- Approved original upload command route.
- Manifest upload / collection finalization route.
- Independent static archive viewer.

Merge recommendation:

1. Start a clean branch from `origin/main`.
2. Merge or cherry-pick `origin/claude/archive-poc-finalization-6qmg7k`.
3. Validate Vercel build locally before touching X scheduler work.
4. Test with the updated `assetManager` worker against a non-production Firebase or carefully scoped production test collection.

Required environment:

- `HITLOOP_ARCHIVE_WORKER_TOKEN`
- `HITLOOP_ARCHIVE_CONTROL_URL` in the worker repo
- Arweave/Turbo wallet or upload credentials
- TwelveLabs key if enabling real provider analysis

## P0/P1 - Archive Inbox To X Scheduler

Source branch: `origin/claude/archive-poc-finalization-f0u17f`

This is the bridge that lets human-confirmed archive records become X scheduler inventory. It is important, but should land after the archive control plane data shape is stable.

Important files:

- `components/dashboard/ArchiveInboxCard.jsx`
- `app/api/dashboard/archive-inbox/route.js`
- `app/api/dashboard/x-content/route.js`
- `features/x-content-inventory/archive-ingest.js`
- `features/x-content-inventory/day-plan-projection.js`
- `features/x-content-inventory/jev-taxonomy.export.json`
- `scripts/x-content/export-jev-taxonomy.mjs`
- `styles/dashboard/12-x-content.css`

What it adds:

- Dashboard Archive Inbox card.
- Reads confirmed `archive_review` records.
- Converts archive assets into draft X content packages.
- Keeps source paths out of social packages.
- Preserves SHA-256 and Arweave references.
- Saves human-written stories into `x_content_packages`.
- Merges stored packages into day-plan projection.

Merge recommendation:

Selectively port the archive-inbox and archive-ingest changes after the P0 archive branch lands. Avoid blindly merging the whole branch because it is also 22 commits behind live and contains broader X content/dashboard changes.

## P1 - X Content Engine / Scheduler

Primary source: current local branch `feat/brief-rendered-scrape-phase-1`, with related work also in `origin/claude/archive-poc-finalization-f0u17f`.

Important areas:

- `features/x-content-inventory/`
- `features/x-benchmark/`
- `features/x-monitor/`
- `features/x-quote-targets/`
- `components/dashboard/XCalendarCard.jsx`
- `components/dashboard/XContentEngineCard.jsx`
- `components/dashboard/XBenchmarkCard.jsx`
- `app/api/dashboard/x-content/route.js`
- `scripts/x-content/`
- `docs/x-content/`

What it appears to add:

- X content package inventory.
- Calendar/day-plan projection.
- Benchmark and monitoring surfaces.
- Rendered scrape and quote-target workflows.
- Stored package integration used by the Archive Inbox bridge.

Merge recommendation:

Treat this as the second major lane after archive. Before merging, separate source code from generated reports/audits because the branch diff includes a large amount of generated output that may not belong in production.

## P1 - Studio Standalone Page And Invoices

Primary source: local untracked files in this repo.

Source-of-truth doc:

- `docs/source-of-truth/INVOICE-STUDIO.md`

Important files and directories:

- `app/dashboard/studio/page.jsx`
- `app/dashboard/studio/LoopStudio.jsx`
- `app/dashboard/studio/invoice/`
- `app/dashboard/studio/loop/`
- `app/dashboard/studio/remix/`
- `app/preview/invoice/`
- `features/invoices/`
- `components/dashboard/InvoiceBuilderCard.jsx`
- `docs/source-of-truth/INVOICE-STUDIO-HANDOFF.md`
- `docs/source-of-truth/INVOICE-STUDIO-RECONCILIATION.md`

Invoice Studio status:

- Public tool at `/dashboard/studio?tool=invoice`.
- Supports invoice, quote, estimate, receipt, and credit note.
- Two-way editable canvas.
- Built-in themes.
- Browser-local numbering, saved clients, saved items, and logo upload.
- Admin-only publish/PDF/saved-invoice features.
- Public users should have zero network calls.

Merge recommendation:

Commit this as its own lane before mixing with homepage work. The files are currently untracked, so the first step should be a WIP branch/snapshot to preserve them exactly, then a cleanup pass around routes, imports, package dependencies, and admin-only network boundaries.

## P1 - Wallpaper Maker / Paint Studio

Primary source: local branch and dirty working tree.

Important files:

- `app/dashboard/studio/paint/PaintStudio.jsx`
- `app/dashboard/studio/paint/paint-print.css`
- `app/dashboard/studio/paint/page.jsx`
- `docs/source-of-truth/PAINT-STUDIO-HANDOFF.md`

What it adds:

- Procedural wallpaper authoring inside Studio.
- p5.js templates such as Watercolour Bloom, Botanical Weave, and Pigment Burst.
- Palette, composition, texture, and seed controls.
- Local saved recipes.
- PNG export.
- Provenance JSON export.

Merge recommendation:

Keep this separate from Invoice Studio unless the shared Studio shell forces a combined merge. Verify browser-only behavior and package dependencies before production.

## P1 - Loop Studio / Standalone Looper

Primary source: local untracked files.

Important files and directories:

- `app/looper/`
- `components/looper/`
- `app/dashboard/studio/LoopStudio.jsx`
- `services/loopcore/`
- `edittrax_player/`
- `public/edittrax-player/`
- `docs/source-of-truth/LOOPER-STUDIO-HANDOFF.md`
- `docs/source-of-truth/LOOPCORE-RUNNER-HANDOFF.md`
- `docs/source-of-truth/EDITTRAX-PLAYER-HANDOFF.md`

What it adds:

- Standalone public `/looper` experience.
- Studio loop slicer.
- Browser-only Web Audio loop workflow.
- Optional loopcore Python analysis engine.
- TORAIZ SP-16 export path.
- Edittrax player export path.

Merge recommendation:

Split into three commits or PRs if possible: browser Looper UI, loopcore service integration, and Edittrax/static player assets. The standalone page should be verified separately from the dashboard Studio route.

## P2 - Optional Homepage Layouts

Primary source: local dirty working tree and current branch.

Important files:

- `components/Header.jsx`
- `components/HeroHeadline.jsx`
- `components/HomePage.jsx`
- `components/StackedSlidesSection.jsx`
- `components/home/DeliverableHoverCards.jsx`
- `components/ox.jsx`

What it adds or changes:

- Optional header action slot.
- Revised hero headline from `HUMAN IN THE LOOP` to `BRYAN BALLI PORTFOLIO`.
- Click-to-reform hero particle behavior.
- Expanded dashboard peek cards.
- Revised services accordion.
- Portfolio sample marquee interactions.
- CTA and hover interaction refinements.

Merge recommendation:

Treat these as layout experiments until product direction is chosen. They should probably land behind an explicit layout flag or as a separate homepage PR after P0/P1 features are stabilized.

## P2 - Email Digest And Dashboard Recovery Work

Sources:

- `origin/fix/email-digest-phase-0-1`
- current local branch `feat/brief-rendered-scrape-phase-1`

Important areas:

- `app/api/email/`
- `app/api/admin/brief-digests/`
- `components/dashboard/AdminEmailPanel.jsx`
- `components/dashboard/DashboardCreationFailedModal.jsx`
- `components/dashboard/AdminDashboardFailuresView.jsx`

Merge recommendation:

Review after archive and X content because this lane is useful but not the current blocker. The branch is behind live, so cherry-picking focused commits is likely safer than merging the branch wholesale.

## Suggested Merge Order

1. Preserve the local dirty worktree before any branch surgery. Create a WIP branch or snapshot commit for the untracked Studio, Invoice, Looper, and homepage files.
2. Update and validate `/Users/bballi/Documents/Repos/assetManager` from `origin/feat/archive-master-plan`.
3. Merge the HITLOOP archive control plane from `origin/claude/archive-poc-finalization-6qmg7k` into a clean branch from `origin/main`.
4. Run the archive POC end to end with one small NAS collection: source registration, browse, process, review, approve, quote, upload command, manifest, viewer.
5. Selectively port the Archive Inbox and X scheduler bridge from `origin/claude/archive-poc-finalization-f0u17f`.
6. Merge the broader X content engine and scheduler work once the archive package shape is stable.
7. Stabilize and merge Studio tools: Invoice Studio, Paint Studio, then Loop Studio / standalone Looper.
8. Decide which optional homepage layout wins and merge it last.

## Risks To Resolve Before Production

- The `assetManager` local checkout is behind its remote by 8 commits and has a dirty `.gitignore`.
- The current HITLOOP branch is 22 commits behind live, so broad merges may replay stale code over production.
- The archive finalization branch has Vercel build fixes, but local production build was not run during this inventory pass.
- Some branches contain very large generated audit/report artifacts that should be reviewed before merging.
- Archive secrets and credentials need a clear production/staging split.
- NAS paths must stay private; social/X package records should only carry sanitized refs.
- The archive-to-X bridge depends on the final `archive_review` document shape.
- Studio tools are partly untracked, so they are easy to lose during branch switching unless snapshotted first.

## Verification Checklist

- In HITLOOP:
  - `npm run build`
  - archive manifest tests
  - archive Arweave tests
  - X content inventory tests or a focused route smoke
  - dashboard route smoke
  - Studio route smoke
- In `assetManager`:
  - `npm run typecheck`
  - `npm run test:archive`
  - worker dry run against a small local fixture
  - worker outbound control-plane test against HITLOOP
- End-to-end:
  - NAS file becomes SHA-256 asset
  - Jev decision appears in review
  - human confirmation writes approved archive record
  - Arweave quote is generated
  - upload command is picked up by worker
  - manifest includes uploaded assets
  - Archive Inbox sees confirmed asset
  - X scheduler can plan a story from the archive asset
