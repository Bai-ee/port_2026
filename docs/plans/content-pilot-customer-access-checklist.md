# Content Management - customer access checklist

Status: customer access is DISABLED. The pilot is owner-only (`PILOT_OWNER_UIDS` + `PILOT_CLIENT_IDS`, `api/_lib/pilot-access.cjs`).
The pilot is NOT multi-tenant ready. Do not enable any customer until every item below is closed. Each item: current state -> required -> verification.

## 1. Client-scoped library
- x_content_packages is one global collection (`features/x-content-inventory/store.js`, `COLLECTION`; no clientId field on packages). -> Add `clientId` to every package, scope every read/write/query, backfill owner rows. -> Cross-tenant test: client B cannot list/get/approve/delete a client A package by id.
- Corpora default to `bai_ee` / `seb__design` (`features/x-strategy/loop-corpora.js`, bundled `docs/audits/*-x-corpus.json`). -> Per-client corpora in Firestore; no bundled owner corpus as a fallback for other clients. -> A client with no corpus gets an empty state, never owner data.
- NAS library and `nas-*` actions are global (`features/x-content-inventory/nas.js`, `NAS_ACTIONS`). -> Per-client root/prefix, path-traversal checks, per-client journal. -> Test: client B cannot browse/stage/process a path under client A's root.
- Buckets, folders, inventory, calendar and results all read via the route's resolved client; confirm none fall back to a global default. -> Audit each `handle*` in `app/api/dashboard/quote-targets/route.js`. -> Grep + tests that assert a clientId predicate on every query.

## 2. Membership and role enforcement
- Pilot gate lives only in `quote-targets` POST and four `social-posting` actions (`app/api/social-posting/route.js`). -> Replace the allowlist with a membership/role check (owner/editor/viewer) in one shared capability function used by every route, tool and worker. -> Table-driven test: every action x every role.
- `social-posting` has no admin gate; `schedule`, `post-now`, `attach-media`, `retry-self-reply`, `approve-post`, `reject-post`, `revoke-approvals` are open to any signed-in client user. -> Decide per action which roles may publish; gate publishing to approved roles. -> Non-member and viewer get 403 for each.
- `x-oauth` trusts `body.clientId` for connect and account listing (`app/api/social-posting/x-oauth/route.js`, ~L95, L106). -> Derive client from the server-resolved context; verify membership. -> Test: body clientId of another client is ignored/403.
- Worker/cron routes derive the client from env `DISCOGS_X_CLIENT_ID` (`features/discogs-ingest/service.js`, `scripts/x-content/*`, `scripts/social-archive/ingest.mjs`). -> Per-client job records carrying clientId; no env-scoped single client. -> Two-client run produces no cross-writes.
- Strategy Builder push/generate (`app/api/dashboard/strategy-builder/{push,generate}/route.js`) and Client Brain export can create social drafts. -> Same capability check and lifecycle (v2) as Content Management. -> Pushed drafts carry the caller's client and lifecycleVersion.
- `?as=` impersonation resolves through `getEffectiveClientContext`. -> Impersonation must never widen pilot/customer access; log every impersonated write. -> Existing pilot-gate tests extended to customer roles.
- Strategy chat tools take identity from the server only, never from model output. -> Tool layer receives a bound context. -> Prompt-injection test: a model-supplied clientId is ignored.

## 3. Quotas and spend caps
- No per-client limits on LLM calls, enhance, NAS processing, Arweave uploads or X API calls; X spend is invisible on the Operating Cost card (`docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`). -> Per-client daily/monthly caps, hard stop with a clear error, ledger via `logAnthropicCall`. -> Test that the cap trips and that one client's use does not consume another's.
- Publishing cadence: `process-due` cron is once daily (`vercel.json`), 26h staleness guard. -> Per-client posts/day and spacing enforced atomically (Hardening Phase 2). -> Race tests, no live platform writes.
- Arweave permanence stays a manual quoted gate (`archive_settings/permanence.autoUpload` default off). -> Per-client approval and budget. -> Kill-switch test.

## 4. Privacy and deletion
- Customer media, captions and client stories are stored without a retention or deletion policy. -> Define retention; account deletion removes packages, drafts, NAS files, thumbs, tokens and corpora (`api/_lib/deleted-accounts.cjs` audit trail only). -> Delete a test client; assert no residual docs/objects.
- Signed/tokenized media URLs (`resolveMediaUrls`, `tokenUrlFor`) must be client-bound and expiring. -> Token embeds clientId + expiry. -> Test: token for A fails for B and after expiry.
- Public approval links (`api/_lib/social-approval.cjs`) stay single-use, token/post/client bound. -> Keep as is; re-run `characterization-approve.test.js`.
- Logs and error bodies must not leak other clients' ids or content. -> Review route error paths. -> Manual log sample.

## 5. Cross-tenant tests (required before enablement)
- Wrong-client reads, writes and late responses fail (Hardening Phase 1 gate) for every route, tool and worker, with two seeded clients. -> One shared harness (see `pilot-gate.test.js` files) parameterised over all actions. -> CI must fail if a new action is added without a gate entry.
- Late/async responses (long-running tool calls, polling) re-check client binding at completion. -> Bind job to clientId at creation; verify on every poll. -> Test: swapping the active client mid-run returns 403.

## 6. Onboarding review
- No self-serve path: enrollment is a manual owner action. -> Written onboarding review (data sources, rights to media, X account ownership, brand voice approval via Client Brain). -> Checklist signed per client before adding to `PILOT_CLIENT_IDS` / membership.
- Rights and clearance per item (`setRights`) must be set before scheduling. -> Enforce at schedule and at delivery. -> Test.
- Public marketing/demo pages must not expose real dashboard data. -> Audit `app/` public routes. -> Manual pass.

## 7. Capacity evidence
- Pilot is validated for a single owner client only. -> Load test with N clients: Firestore index needs (no composite-index surprises), function count (Vercel Hobby 12-function cap, `docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md`), cron fan-out time, NAS throughput. -> Recorded numbers and a go/no-go decision from the owner.

## Exit criteria
All sections closed, cross-tenant suite green in CI, owner sign-off, then enable one design-partner client behind its own flag before general availability.

## Notes from the Phase 1 review (2026-10-11)
- The pilot gate covers the WHOLE `quote-targets` route (GET + POST) and the archive inbox (uid check). Consequence: any non-owner admin also loses the x-calendar card, quote targets and the archive inbox. Intended for the owner pilot.
- `social-posting`: `approve-draft`, `approve-and-schedule`, `reject-draft` are always owner-gated; `update`, `approve-post`, `reject-post`, `attach-media`, `retry-self-reply` are owner-gated only for `lifecycleVersion: 2` rows; legacy rows (Copywriter, Schedule Posts, Social Auto-Publish) keep serving every client.
- Production AND Vercel preview deployments fail closed (503) when `PILOT_OWNER_UIDS` or `PILOT_CLIENT_IDS` is unset (previews share production data).
- Still open for the customer gate: `social-posting` `schedule`/`post-now` have no admin/membership gate; `x-oauth` trusts `body.clientId`; worker routes derive the client from env (`DISCOGS_X_CLIENT_ID`).
