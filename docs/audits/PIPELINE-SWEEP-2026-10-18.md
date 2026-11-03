# Pipeline sweep — 2026-10-18

Companion to `ADMIN-POC-READINESS-2026-10-18.md`. Read-only sweep of HEAD `3c25a7dd`: digest, signals, NAS/archive/media, multi-client isolation. No edits to code, no routes called, no paid calls. One read-only `gh` check (workflow status).
"Confirmed" = read in code (and spot-checked a second time for every P1). "Plausible" = depends on runtime behaviour not observed.

## Verdict

The POC audit's 4 findings all reproduce. The sweep adds 7 more P1s (2 are spend/security, 2 silently break a production pipeline). Not ready for unattended operation or for opening the dashboard to non-admin clients. Tenant isolation of records holds; global credentials and paid routes are the leak.

## P1

| # | Area | Where | Defect → failure | Conf. |
|---|---|---|---|---|
| 1 | Content | `features/x-strategy/route-handlers.js:1436`, `app/api/worker/daily-loop/route.js:109` | Factory never returns `dailyFill` → cron reports `ok:true, skipped:'daily-fill-unavailable'` every day. (One sub-agent claimed otherwise; re-checked: still missing.) | confirmed |
| 2 | Content | `features/x-strategy/agent/action-runtime.js:496–508` | Snapshot undo restores `scheduled` + old `approvedHash` with no confirmation. Also applies to **attach-media** undo (restores old media + matching hash ⇒ publishes). Undo writes via `docs.put`, bypassing `commitPostTransition`'s `x_schedule_ledger` reserve ⇒ caps/collision checks skipped, ledger drifts. | confirmed |
| 3 | Content/NAS | `quote-targets/route.js:858`, `archive/commands/worker/route.js:93`, `features/telegram/runtime.js:163`, `features/discogs-ingest/service.js:83–90` | Four direct `social_posts` media writes skip the lifecycle. v2 rows: stay "scheduled", parked `approval-stale` at publish. Legacy v1 rows (Discogs path): publish media/self-reply the owner never approved. Fix: route all through `attachMediaToPost` / `updateSocialPost`. | confirmed |
| 4 | Signals | `features/scout-intake/watchlist-pull.js:122,147` | `fetchTimelinesViaXApi({handles, detail})` uses undeclared `clientId` → every prod watchlist pull errors per-handle; "Happening on X" + reply-targets pool silently stale. ⚠️ Fixing it turns on paid X timeline reads from the 12:35 cron (`pre-digest-refresh:537`) with no `allowX`/budget gate — add the gate in the same change. | confirmed |
| 5 | Signals/Security | `app/api/dashboard/opportunity-signals/refresh/route.js:16,33`, `features/scout-intake/opportunity-signals-search.js:118` | Route only `verifyRequestUser` (not admin) and always `allowX:true`; no `assertXBudget`. Any signed-in client user can trigger up to 8 paid X searches per click on the owner's credentials. | confirmed |
| 6 | Digest | `vercel.json` `0 13 * * *` → `daily-digest/route.js:1134`, gate `_digest-config.js:294` | Only `enabled && frequency!=='off'` checked; `sendHour`/`weekday` never read on the 13:00 fan-out → "weekly Monday 5pm" emails daily at 13:00 UTC. | confirmed |
| 7 | Digest | `.github/workflows/email-digest-dispatch.yml` (`*/30`), `digest-delivery-sweep.yml` (`*/5`) | Headers say "NOT ENABLED / feature branch only", but both are on `main` and **active** (`gh run list`: scheduled runs succeeding today). Two schedulers ⇒ analyzers + summaries (no freshness skip) can run and bill twice per due client. Sends are deduped by delivery id. | confirmed live; double-spend plausible |
| 8 | Publish | `features/social-posting/twitter-service.js:780–791` (`postMedia`) | Publish uses stored `mediaUrl` as-is; no re-sign from `mediaStoragePath` despite 4 comments claiming "publish re-signs". `ev:` signed URLs last 6.9 days; fill drafts go 7–31 days ahead → 403 on media fetch → publish fails. | confirmed |
| 9 | Digest | `pre-digest-refresh/route.js:1233`, `email-digest-dispatch/route.js:90` | Cron/dispatcher child calls omit `phase` ⇒ `all` in one 300 s function; the route's own comment says cold full ≈ 5–6 min ⇒ analysis phase (runs last) killed; email sends with stale/empty sections. | plausible |

## P2

- **Credentials** `app/api/social-posting/route.js:135` — GET returns `getTwitterCredentialStatus()` (key/token prefix+suffix previews) to any signed-in user. `:254` `diagnose` is ungated and spends 2 X calls on the global @bai_ee token. (confirmed)
- **Refresh aliases bypass panel** (POC audit P2) — `signals.watchlist.pull`, `signals.opportunities.refresh`, `xmonitor.sync-profile|posts|audience`. (confirmed)
- **X budget** — `refreshXMarketTalk` (`pre-digest-refresh:852`) + watchlist X path lack `assertXBudget`; Market Talk runs from cron when `dailyXSearch:true` (contradicts "cron never spends"); `x-api ledger.js:67` returns ok when no cap ⇒ default budget cap stops nothing.
- **media-reconcile cron dead** — `app/api/worker/media-reconcile/route.js` exports only `POST`; Vercel cron sends GET ⇒ 405 daily. (confirmed)
- **Remix jobs stuck** — `dashboard/media/route.js:416`, `media-jobs.cjs:337`: failed enqueue stays `queued` w/o `editJobId`; sweep skips them; oldest 50 fill the `limit(50)` window forever ⇒ newer jobs never reconciled.
- **Archive commands** — `archive/commands/worker/route.js:36–63`: no lease/expiry, any state transition accepted; retried COMPLETE re-runs `handleUploadAssetArweaveComplete` (duplicate paid archive version) and re-runs hi-res attach; stale `LIST_DIRECTORY` commands crowd the unordered 50-doc window.
- **Arweave kill switch gaps** — already-queued uploads still dispatched after switch-off; `archive-to-arweave` (`dashboard/media/route.js:253`) never checks `autoUpload`.
- **Digest** — remix video missing/unprobeable throws and blocks the whole email (`digest-send-policy.cjs:49`); approval roll-up has no caller ⇒ `awaiting_approval` posts never expire and get fresh tokens daily (`daily-digest/route.js:964–998,1317`); approval-post dedupe is read-then-create (race; UTC day key); live preview omits `noLlm` ⇒ LLM calls on every tab open/form change (`AdminEmailModals.jsx:541`).
- **Signals data quality** — `recipe-run/route.js:182` missing `instagram-signals` content kind (analyzes whole agentData, writes `instagramAnalysis`); `:84,179` reddit collector without `relevance`; `_platform-signals.js:157,186` slices to 12 *before* relevance filter; `refresh-runners.js:54` treats `200 {skipped}` as failure (kills X-search group incl. Market Talk); opportunity search overwrites last good items with `[]` when all queries fail; `hasApiKey()` gates X-only setups on the ScrapeCreators key.
- **Media/NAS** — NAS `.mov` (`video/quicktime`) attaches fine, X rejects at publish (plausible, depends on worker transcode); hi-res package scan pages 1000×20 per request, Telegram tap reads ~6k docs twice, silent truncation >20k; `media-index`/`folder-files` readable by any client and `?sync=1` lets non-admins trigger bucket sweeps.

## P3

- Client Brain approve/inject/LLM-generate not admin-gated (in-tenant; lets a client self-satisfy readiness and spend).
- Admin digest routes fall back to home `clientId` on save when omitted.
- `createDraftPostOnce` returns an existing row without a clientId check (32-bit hash ids).
- Analyzers ignore `include.*` toggles (pay for hidden sections); empty `includeKeys` preview dropped; `runAndSend` passes `force=1` (CLAUDE.md says it keeps the 6 h skip — doc drift).
- Manual-tagged delivery record blocks sweep reclaim; status/retry blind to manual records.
- `hiresPending` read-modify-write race; `nas.js:356` unordered `limit(500)`; package ids `nas-<sha16>` global across clients; inventory meta doc shared across clients; 500-cap `digest_config` scan.
- `estimateFor(id, {})` in agent refresh cards ignores data sources (shows paid groups as free); watchlist cost text says ScrapeCreators.
- `chat-queue.test.js:147` failure is test drift (post-edit no longer schedules), not a prod bug.

## Scale themes

1. Heavy work packed into single 300 s functions (digest `phase=all`); split into phase calls like `runAndSend`.
2. Full scans per request (inventory 20k, archive command polls) — needs indexed queries.
3. Unordered `limit(N)` windows that stuck rows can fill (media jobs, archive commands, NAS jobs) — order + age cutoff + terminal states.
4. Multiple schedulers for one job (Vercel cron + GitHub Actions) — one owner per job.
5. Paid X calls have three guards (admin, `allowX`, `assertXBudget`) applied inconsistently — centralize at the X client.

## Verified OK (summary)

Tenant record isolation (`getSocialPost`, package getters/upserts, `requireClient`, agent `invokeAction`, MCP, Telegram bindings, `memoByClient` caches, `?as=` admin-only); pilot/cron fail-closed when env unset; digest Resend idempotency, leases, breaker, scheduled sends LLM-free; analyzer field names match email reads; refresh group ids consistent; daily-loop X step budget-guarded; quote scan keeps last good scan; Arweave kill switch enforced at all enqueue sites in `archive-permanent-archive`.

## Not covered

`runClientPipeline` (Scout/Scribe/Guardian) internals; live Firestore state; Vercel/GitHub run logs beyond workflow status; full `npm test`.

## Suggested fix phases

- **A — stop money/credential leaks:** #5, credentials GET/diagnose, X budget guards centralised, decide on one digest scheduler (#7).
- **B — content lifecycle integrity:** #1, #2, #3, #8.
- **C — silent pipeline breaks:** #4 (with gate), #9, media-reconcile GET, remix/archive command states, refresh-runner skipped, opportunity empty overwrite.
- **D — digest correctness:** #6, video soft-fail, approval roll-up cron, preview `noLlm`.
- **E — P2/P3 data quality + scale.**
