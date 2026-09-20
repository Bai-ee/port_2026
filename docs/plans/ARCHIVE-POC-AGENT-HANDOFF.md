# HITLOOP Archive POC — Agent Handoff

Updated: 2026-09-19
Branch: `feat/archive-jev-poc`
Repo: `Bai-ee/port_2026`

## Goal

Build a proof of concept that can ingest Bryan's NAS archive without modifying originals, hash/dedupe media, use Twelve Labs for video understanding, turn machine observations into Jev decisions that require human confirmation where appropriate, and permanently publish approved originals plus a collection manifest/viewer to Arweave.

Target operator flow:

`NAS source → hash/dedupe → Twelve Labs → Jev → human review → explicit archive approval → Arweave original(s) → collection manifest → permanent viewer`

The POC must keep destructive/permanent operations approval-gated. Originals on the NAS are read-only.

## Current implementation

The branch already contains:

- `/archive` authenticated control surface.
- Archive worker registration/heartbeat/source APIs.
- Folder browsing and process commands.
- Worker command polling/update API.
- Asset synchronization into `archive_review`.
- Human Jev review UI and review API.
- Arweave quote, asset-command, manifest upload, and collection upload routes.
- Archive manifest builder and publishing projection helpers/tests.
- Turbo/Arweave upload helper.
- Standalone `public/archive-viewer/index.html`.
- Existing HITLOOP/EditVideos Arweave infrastructure. Reuse it; do not create a second unrelated permanent-storage stack.

The current `/archive` page exposes source/worker state, counters, folder browsing, PROCESS FOLDER, pending Jev decisions, and pipeline status. It does **not yet provide the complete operator UI for approved assets → Arweave → manifest/viewer**.

## Twelve Labs status

Bryan now has a Twelve Labs API key and placed it in his local `.env`. Never commit or print the key.

Expected application variable:

`TWELVELABS_API_KEY`

The next agent should first verify the local env entry actually uses that variable name. Bryan described the key as being “#12 in the .env”; `#12` may only be a comment/label.

No Twelve Labs SDK is currently listed in `package.json`. Prefer a small provider module using the current Twelve Labs HTTP API unless the official SDK clearly reduces complexity. Keep the provider isolated so Jev/archive code is not coupled to Twelve Labs response shapes.

## Immediate work

1. Add a Twelve Labs provider boundary for video indexing/analysis.
2. Wire the archive worker's analysis stage to that provider for video assets.
3. Normalize Twelve Labs output into archive observations/evidence; Jev owns decisions, not the provider.
4. Preserve resumability/idempotency: a retry must not create duplicate analysis/index work for the same SHA-256 asset.
5. Sync resulting observations/decisions through the existing worker-assets endpoint into `archive_review`.
6. Complete `/archive` publishing controls: approved reviewed asset → explicit archive approval → asset upload command/status → collection manifest upload → permanent viewer/manifest links.
7. Add focused tests for provider normalization, missing credentials, retry/idempotency, and approval gating.
8. Run the relevant tests/build and fix Archive Worker CI failures before calling the POC complete.

## Important contracts

- Worker API auth uses `HITLOOP_ARCHIVE_WORKER_TOKEN`.
- Permanent archive actions require explicit approval.
- Asset upload commands carry `expectedSha256`; the worker must re-check the original before upload.
- Worker completion containing `transactionId` + `contentAssetId` is projected into `archive_uploads`.
- `archive_review` is the human review queue. Decisions are normalized as question/choices/selectedValue/confidence/reviewBand/evidence.
- Arweave collection publishing builds a collection manifest from approved uploaded assets.
- Never mutate the NAS originals.

## Blockers / external requirements

- Twelve Labs credential is now locally available, assuming it is named `TWELVELABS_API_KEY`.
- Local `.env` cannot be read through the GitHub connector; live Twelve Labs calls must be tested in the local checkout/runtime that owns that env file.
- Arweave/Turbo live publishing still requires the relevant wallet/Turbo credentials in the execution environment.
- Archive Worker CI has been reported failing and must be rechecked/fixed.

## Definition of POC complete

One real video can be selected from the NAS, hashed, analyzed by Twelve Labs, converted into Jev review data, human-confirmed, explicitly approved for archive, uploaded without changing the original, represented in a permanent collection manifest, and opened through the archive viewer. The run is observable enough to identify failure/retry state and does not duplicate work on retry.

## Where to start

Read these first:

- `app/archive/page.jsx`
- `app/api/archive/commands/worker/route.js`
- `app/api/archive/worker/assets/route.js`
- `app/api/archive/arweave/assets/route.js`
- `app/api/archive/arweave/collection/route.js`
- `api/_lib/archive-arweave.cjs`
- `api/_lib/archive-manifest.cjs`
- `public/archive-viewer/index.html`

Then inspect the worker implementation/runtime that executes PROCESS commands. Do not assume the web app itself has direct NAS access.
