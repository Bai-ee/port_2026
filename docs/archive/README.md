# HITLOOP Archive POC

Branch: `feat/archive-jev-poc`

This directory documents the HITLOOP cloud/control-plane side of the archive POC. The NAS-side implementation lives in `Bai-ee/assetManager` on `feat/archive-master-plan`.

## Current boundary

- `/archive` is the WIP operator surface.
- `POST /api/archive/worker/heartbeat` authenticates the NAS worker using `HITLOOP_ARCHIVE_WORKER_TOKEN`.
- The NAS worker initiates outbound HTTPS. HITLOOP does not require inbound access to the private NAS.
- Heartbeat payloads contain IDs, state and counters, not absolute NAS paths or media bytes.
- Originals remain read-only.
- Permanent upload requires human approval and an Arweave quote.

## Next

1. Persist worker heartbeat/source/job projection in Firebase.
2. Read that projection into `/archive`.
3. Add collection commands/status contract.
4. Add TwelveLabs adapter and evidence normalization.
5. Add Jev decision layer and review UI.
6. Reuse established Arweave pricing/upload code and deploy independent Arweave viewer.
