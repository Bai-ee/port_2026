# Launch Data Pipeline — Creative Brief & Deliverables

Last updated: 2026-06-23
Scope: end-to-end production path that produces Creative Brief and Deliverables output, from signup through download and admin visibility. Verified against code.

## Stage Map

| # | Stage | Entry point | Writes | Service | Can run twice? |
|---|---|---|---|---|---|
| 1 | Signup / provisioning | `app/api/clients/provision/route.js:17` | `clients/{id}`, `users/{uid}`, `members/`, `dashboard_state/{id}`, `client_configs/{id}` | JWT verify; fires worker via `after()` (~85) | **No** — relinks owned client; gated on `initialRunCreated` (~81) |
| 1b | Initial brief run queue | `api/_lib/client-provisioning.cjs:181` `queueInitialBriefRun` | `brief_runs/{id}-signup` + `clients/{id}/brief_runs/{id}-signup` | deterministic runId | **No** — atomic `.create()` (~218); concurrent returns `created:false` |
| 2 | Dashboard bootstrap | `app/api/dashboard/bootstrap/route.js:31` | (read-only) + admin sample-brief write (~69) | none | sample-brief write is idempotent (same payload) |
| 3 | Worker brief run | `app/api/worker/run-brief/route.js:113` | `dashboard_state` (moduleBriefs ~299, evidence ~365, brandOverview ~385, studioVideoPending ~427); `completeRun` | worker-secret auth; `claimRun` atomic (~142) | claim is atomic; serial per client |
| 4 | Creative Brief run (user) | `app/api/dashboard/creative-brief/run/route.js:38` | new `brief_runs/{id}` + mirror + `dashboard_state` | fires worker via `after()` | **Yes (minor)** — fresh `.doc()`, no "already-running" guard (see Risks) |
| 5 | Marketing/Executive Brief run (user) | `app/api/dashboard/marketing-brief/run/route.js:47` | new `brief_runs/{id}` + mirror; some paths run inline | `claimRun`/`completeRun` inline for scoped paths | **Yes (minor)** — no atomic-create guard |
| 6 | Brief preview / render | `app/api/dashboard/brief-preview/route.js` | reads `brief_runs`, `dashboard_state`; PDF to Storage `clients/{id}/briefs/` | `renderBriefHtml` | read/render — idempotent |
| 7 | Studio video render | `app/api/dashboard/studio-render/route.js:60` → worker `app/api/worker/render-studio/route.js:72` | `render_jobs/{jobId}`; Storage `clients/{id}/studio/video-cloud-*.mp4`; `dashboard_state.studioCaptures` | Cloud Run GPU (`STUDIO_RENDER_URL`); retries `[8000,20000]ms` | **No** — `createRenderJob` dedupes via `dedupeWindowMs` (jobs.cjs:64–90) |
| 7b | Studio capture (screenshot/upload) | `app/api/dashboard/studio-capture/route.js:71` | Storage `clients/{id}/studio/*`; `dashboard_state.studioCaptures` (max 40) | Browserless | `appendCaptureRef` dedupes by storagePath |
| 8 | Deliverables ZIP | `app/api/dashboard/deliverables-zip/route.js:55` | (read-only) streamed ZIP | SSRF-guarded Storage fetch; caps 24 assets / 60MB / 15MB ea | idempotent by definition |
| 9 | Admin visibility | `/api/admin/*`, `/api/ops/overview` | (read-only) | — | see [ADMIN-DASHBOARD-DATA-MAP.md](ADMIN-DASHBOARD-DATA-MAP.md) |

## Firestore Collections (launch path)

`clients`, `clients/{id}/brief_runs`, `brief_runs` (top-level mirror), `users`, `members`, `client_configs`, `dashboard_state`, `render_jobs`, `browserless_requests`, `usage_events`, `admins`. (Out of launch scope but present: `chunks`/`knowledge_items`, `social_posts`, `leadgen_prospects`.)

## Storage Paths (launch path)

- `clients/{id}/studio/video-cloud-{ts}.{mp4|webm}` — GPU render output
- `clients/{id}/studio/{ts}-{viewport}{-full}.{png|jpg}` — Browserless captures
- `clients/{id}/homepage-screenshot/*`, `clients/{id}/homepage-mockup/*` — module artifacts
- `clients/{id}/briefs/*` — brief PDFs

## Duplicate / Double-Run Findings (verified)

| Risk | Verdict | Detail |
|---|---|---|
| Signup double-submit | **Safe** | Deterministic `{id}-signup` runId + atomic `.create()`; worker fire gated on `initialRunCreated`. |
| Studio video duplicate enqueue | **Safe** | `createRenderJob` dedupes within `dedupeWindowMs` (15 min for signup + creative-brief). Manual studio-render passes window=0 by design (user-initiated re-render is intentional). |
| KB embedding double-call on reindex | **Not a risk** (and out of scope) | `embedKnowledgeItemChunks` only fetches chunks with status `pending`/`error` (`features/knowledge-base/embed.js:156`); `ready` chunks are skipped. Reindex is idempotent. KB is a gated feature, not launch scope. |
| Creative-brief / marketing-brief rapid POSTs | **Real, minor** | Both routes use fresh `.doc()` with no "already-running" guard (`creative-brief/run/route.js:64`). Rapid direct POSTs queue multiple runs. Mitigated in UI by `marketingBriefRunning` + cooldown; worker claims serially; runs are scoped to 2 modules so cost is bounded. **Recommended hardening (post-launch):** check `dashboard_state.modules['marketing-brief'].status==='queued'/'running'` and return 409. |
| Admin bootstrap sample-brief race | **Minor** | Two simultaneous admin bootstraps can both write the sample brief (`bootstrap/route.js:69`); same payload, idempotent, negligible write cost. |
| Mid-run `dashboard_state` writes | **Architecture note** | Worker makes several non-transactional `dashboard_state` merges during a run; safe given serial per-client claiming, but relies on that external constraint rather than Firestore-level locking. |

## Idempotency Summary

- Atomic/safe: `queueInitialBriefRun` (`.create`), `claimRun` (transaction, MAX_ATTEMPTS=3), `completeRun` (merge), `appendCaptureRef` (dedupe by path), `createRenderJob` (window dedupe), `embedKnowledgeItemChunks` (status filter).
- No atomic guard (minor): user-triggered `creative-brief/run` and `marketing-brief/run` run creation.
