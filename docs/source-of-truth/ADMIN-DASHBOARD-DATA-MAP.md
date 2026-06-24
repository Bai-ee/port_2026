# Admin Dashboard Data Map

Last updated: 2026-06-23
Scope: admin/ops data relevant to Creative Brief & Deliverables launch confidence. Verified against code.

## Admin Surfaces → Data Source

| Surface | Endpoint | Firestore queried | File |
|---|---|---|---|
| Clients list | `/api/admin/clients` | `clients` (full scan, createdAt desc) | `app/api/admin/clients/route.js:40` |
| Queue (queued+running) | `/api/admin/brief-runs?status=queue` | `brief_runs` where status in [queued,running], limit 50 | `app/api/admin/brief-runs/route.js:60` |
| Failed runs | `/api/admin/brief-runs?status=failed` | `brief_runs` where status=failed, limit 50 | same:68 |
| Run detail | `/api/admin/brief-runs?runId=` | `brief_runs/{id}` | same:49 |
| Client config | `/api/admin/client-configs?clientId=` | `client_configs/{id}` | `app/api/admin/client-configs/route.js:51` |
| Intelligence | `/api/admin/intelligence?clientId=` | `intelligence_master`, `intelligence_sources`, `intelligence_recent_events` (50) | `app/api/admin/intelligence/route.js:37` |
| Requeue | `/api/admin/requeue` | rewrites `brief_runs/{id}` to queued | referenced `AdminPage.jsx:226` |
| Whoami | `/api/admin/whoami` | `admins/{email}` | `app/api/admin/whoami/route.js:28` |
| Ops overview | `/api/ops/overview` | `clients`, `brief_runs`, `client_configs`, `dashboard_state`, `browserless_requests` (2000), `usage_events` (2000) | `api/_lib/ops-overview.cjs:314` |
| Daily digest (cron) | `/api/admin/daily-digest` | `users`, `clients`, `brief_runs`, `homepage_events` + Vercel/GA4/Calendar | `app/api/admin/daily-digest/route.js:120` |

## Launch Telemetry — Pulled vs Missing

**Admin DOES pull (launch-relevant):**
- Client list with status, owner, latest run id/status, pricing tier
- Brief run history: queued / running / failed / succeeded (50 per bucket + aggregate counts)
- Run detail: error stage/message, exhaustion flag, attempts, worker lease, timestamps
- Dashboard state sections (snapshot/signals/strategy/outputs/system/seoAudit) via ops-overview
- Deliverable artifact refs (`artifactRefs` in brief_runs; `homepageScreenshot` in dashboard_state)
- Cost tracking: `providerUsage` per run + `usage_events` aggregation (USD, per client, per module/provider)
- Browserless telemetry: status, endpoint, viewport, httpStatus, duration, bytes (table + aggregates)

**Admin DOES NOT pull (missing launch telemetry):**
- **Studio/render job queue** — `render_jobs` is indexed (firestore.indexes.json) but no admin/ops endpoint surfaces it. Studio video is a launch deliverable; render queue/health is currently invisible to admin. **Gap.**
- **Per-run pipeline events** — `clients/{id}/brief_runs/{id}/events` subcollection feeds the client terminal only, not admin.
- **Stripe subscription detail** — only tier name is stored; no subscription id / invoice / webhook status surfaced.
- **Browserless error detail** — only status/timing, not error message/stack.
- Out of launch scope but also unsurfaced: `social_posts`, `leadgen_prospects`, KB `chunks` embedding status.

## Redundant Reads (perf, non-blocking)

- `clients` full-scanned by `/admin/clients`, `/admin/intelligence`, `/ops/overview`, `daily-digest` (~4× per cycle).
- `brief_runs` read as full + per-status + aggregate counts inside ops-overview/digest.
- `dashboard_state` scanned twice in ops-overview (module state + latest payload).
- Recommendation (post-launch): a pre-aggregated `platform_metrics` doc (counts, cost totals) to cut repeat full scans; not a launch blocker.

## Recommended Admin Additions Before/After Launch

1. **`/api/admin/studio-jobs`** (or add render_jobs to ops-overview) — surface render queue depth/age/failures for the Studio video deliverable. *Highest-value gap.*
2. Surface Stripe subscription status alongside client list once payments are live.
3. Add `usage_events` index (`clientId ASC, createdAt DESC`) before scale.

See [LAUNCH-DATA-PIPELINE.md](LAUNCH-DATA-PIPELINE.md) for where this data originates.
