# Email Rebuild — Diagnosis & Simplification Plan (v2)

**Status:** Phase 0+1 IMPLEMENTED + review-hardened in the working tree (2026-08-19, tests 2661/2661 + build green) — awaiting commit and deploy approval. Second-review fixes landed: targeted reclaim (`reclaimDeliveryId`, identity from the stuck record — never the clock), fenced generation lease (`claimGeneration`/`releaseGeneration` + `storeRenderedHtml` owner fence, pre-upload and in-transaction), scheduled sends now zero-social as well as zero-LLM (`digest-send-policy.cjs` gates every social-queue/approval-token/publish/LLM call site), and strict fan-out stamp contracts (`buildRefreshStampEntry` requires explicit `ok:true`; child bodies can't overwrite trusted fields). The fix reaches production only after deploy; the exit gate (two consecutive automatic inbox mornings) starts then.
**Date:** 2026-08-18 (v2 same day, after external review), verified against prod commit `fbb6bc60`, live prod Firestore telemetry (read-only), Vercel project settings, and external probes of the production hosts
**Supersedes for direction:** `EMAIL-SYSTEM-SIMPLIFICATION-FABLE-HANDOFF.md` (its invariants still apply; this doc adds the proven root cause and a smaller path)
**v2 changes:** root cause upgraded from "suspected generation timeout" to **proven: Vercel SSO Deployment Protection swallows every cron self-fan-out sub-request**; incorporates all four P1 review findings (no inline LLM on scheduled sends at all; `callAnthropic` is raw fetch, fix there; generation-stage recovery path required; refresh-stamp contradiction resolved — the stamp was fabricated from an SSO login page).

---

## 1. Why you are not getting daily emails — proven root cause

### 1a. The one-sentence version

The daily crons fan out by having the route **fetch itself once per client**; in production those self-requests hit a **Vercel-SSO-protected origin**, get redirected to `vercel.com/login` (HTTP 200, HTML), and never execute — the refresh dispatcher misreads that login page as **"ok"**, the send dispatcher records it as **"Email provider did not return an id."**, and no email, Scout run, or delivery record is ever produced. Manual Generate & Send works because your browser talks to `hitloop.agency` directly.

### 1b. The evidence chain (all verified live today)

1. **Project protection setting:** `ssoProtection: { enabled: true, deploymentType: "all_except_custom_domains" }`. Only `hitloop.agency` is exempt; every `*.vercel.app` host of this project is protected.
2. **Probe:** `GET https://port-2026-baiees-projects.vercel.app/api/worker/pre-digest-refresh` → `302` to `https://vercel.com/sso-api?...` → following redirects (which `fetch()` does by default) ends at **`200 text/html`** on `vercel.com/login`. The same path on `hitloop.agency` → the app's own `401 {"error":"Unauthorized."}` (route reachable, auth working).
3. **Cron invocations themselves run** (Vercel signs/bypasses protection for the cron request): today's stamps exist — `lastCronRefresh 12:39:05 ok`, `lastCronSend 13:45:50 failed`. Both sit seconds after plausible Hobby-plan cron fire times (drift up to ~45 min observed).
4. **But the children never ran.** The dispatchers re-enter the route at `url.origin` — the protected host the cron carried. The child gets the SSO page:
   - Refresh dispatcher validates `res.ok && body?.ok !== false` → a 200 HTML page parses to `{}` → **stamped `ok`, reason null** — exactly today's stamp, with **zero** side effects: no `brief_runs` entry today (newest is yesterday's manual run), no delivery record — even though `refreshDigestClient()` provably creates the day's delivery record before any paid work (route line ~926). The "ok" was fabricated from a login page.
   - Send dispatcher requires `body.email.id` and falls back to the literal string `'Email provider did not return an id.'` — exactly today's stamp. **Not a Resend error; Resend was never called.**
5. `digest_deliveries` contains exactly two documents, both from yesterday's **manual** flow (the manual send succeeded: provider id `d413f6ee…`, 1 attempt, 2s transport). No cron-created delivery doc exists for 08-17 or 08-18 → the production scheduled path has **never** completed since the fan-out/durable layer shipped.
6. Corollary: the entire reliability layer (immutable snapshot, lease, 6-attempt backoff, GitHub sweep, breaker) never engages on the scheduled path — it sits downstream of a request that dies at the front door.

This also explains "it worked before multi-client": the pre-fan-out cron did the work **in-process**. Self-fan-out was introduced for multi-client and was never exercisable in production.

### 1c. Secondary defects confirmed while verifying (still real, not today's blocker)

- **Inline LLM on the send path, unbounded:** real sends call `generateBriefSummary` (and video-caption generation for clients with video sections on) inline. `callAnthropic()` (`features/scout-intake/_anthropic-client.js`) is a **raw `fetch()` with no timeout and no retries** — not the Anthropic SDK — so a stalled call can ride until the function ceiling kills the request mid-generation. Once the origin bug is fixed, this is the next most likely way to lose a day.
- **The saved summary is ignored:** refresh already writes `briefSummaries['executive-daily']` (shape `{summary, generatedAtIso, runId}`), but the send path re-generates instead of reading it — and the renderer expects `{paragraph, …}`, so reading it needs a small adapter.
- **Unrecoverable early stages:** the delivery state machine has no recovery for work killed in `scheduled`/`refreshing`/`generated` — the sweep only handles `retry-wait` and expired `sending` leases. A killed generation is abandoned until retention.
- **Only one client is enrolled** — `paradice-dbBQCHUX` (recipient bryanballi@gmail.com). Your home client `bryan-balli-WUoltG84` has `schedule.enabled: false`: it sends nothing **by configuration**. Enrolling it is a product decision (a second, separate home digest), not a fix for this bug.
- **Protected-origin leak risk beyond the fan-out (Phase 0 must verify):** `appOrigin()` falls back to `VERCEL_URL` — a protected host under the current setting — before `hitloop.agency`. If `NEXT_PUBLIC_APP_URL` is unset in the prod env, emailed links (Executive Brief, approval buttons) may point at SSO-protected URLs. Verify env + one sent email's links.
- `vercel.json` sets `maxDuration: 120` for all API routes while digest routes export `300`; which wins in prod is unmeasured.

---

## 2. How this got so complicated

It used to work because it was one thing: one admin, one email, one route, one `sendEmail()`. Each addition was reasonable alone; together they buried the send path:

1. **Multi-client** → self-fan-out dispatcher + enrollment scan + per-client config, added inside the same route — and the fan-out mechanism itself is today's proven point of failure.
2. **Custom content** → 33 section toggles + ordering + demo fixtures + per-platform analyzers → collectors, compat shims, and section lists hardcoded in four places.
3. **Social publishing + approvals** → publish side effects and a second email embedded in the send path.
4. **The August missing-email incident** → a genuinely good durable-delivery layer (~1,300 lines: identity, immutable HTML, leases, retries, breaker, sweeps) bolted underneath — but it wraps only transport (the 2 seconds that never fail), while generation and dispatch (the parts that fail) stayed above it.

Net: `daily-digest/route.js` is 3,540 lines doing seven jobs, mode-switched by query params, 49 commits since June; ~8,100 lines total to send one email a day. And the system's telemetry lies at both ends: "refresh ok" can mean "an SSO login page came back," and the send-failure reason names a provider that was never called.

---

## 3. Recommendation: rebuild the pipeline, keep the bricks

Not "patch #50," and not a from-scratch rewrite of everything. The bricks are good; the orchestration and its honesty are the problem.

**Keep (proven, small, clean):** `resend-transport.cjs`; `digest-delivery.cjs` core (identity, snapshot, lease, retry, breaker); `_digest-config.js` normalization; `buildEmailHtml` + section renderers (move, don't rewrite); the refresh phase functions; the GitHub sweep.

**Rebuild** the orchestration under five dumb rules:

1. **Scheduled sends make zero generation calls. None.** No summary LLM, no caption LLM, no fresh-brief run, no search, no social publish — including fallbacks. Missing saved content renders an honest empty/stale state. All paid/slow work lives in the refresh phase, which writes saved artifacts; the send reads them, renders, snapshots, sends. Target <30s, deterministic.
2. **No blind self-fetch.** Any dispatcher→worker hop targets an explicit, verified-unprotected origin, sets `redirect: 'error'`, and requires `content-type: application/json` plus an explicit response contract before believing anything. A login page must be a loud failure, never an "ok". (In the rebuild, prefer in-process per-client work for the <30s send path — the fan-out exists only because sends used to be slow.)
3. **Durability starts first.** The delivery record is created at the top of the occurrence, and every stage a worker can die in has a recovery path: stale pre-transport stages (`refreshing`/`generating`/`generated` with old `updatedAt`) are reclaimable by the sweep, which re-enters generation from saved data (free) — transport retries keep using stored HTML. Per-step timeline (step + elapsed ms) written durably as it goes.
4. **Every external call is timeout-bounded** — starting with `AbortSignal.timeout` inside the shared `callAnthropic()` (raw fetch — SDK-style options do nothing here).
5. **Stamps tell the truth**: sub-request HTTP status + delivery id on send stamps; per-phase outcome (scout ran/skipped/why) on refresh stamps.

Plus, kept from the Fable handoff: one **section registry array** (drives UI rows, include/order normalization, render dispatch, empty states) and **social publishing out of the send path**.

**Schedule decision (owner-decided 2026-08-18): Option B — real per-client hours, hour precision.** Each toggled-on client sends at their configured `sendHour`/`weekday`/`timezone`. Dispatcher = a GitHub Action firing every 30–60 min (Vercel Hobby crons are daily-only) hitting a dispatch route that atomically claims due clients; an email lands within ~0–30 min after the chosen hour, which the owner accepted. Built as its own phase (Phase 3) — Phase 1 first restores delivery at the current global cron time.

---

## 4. Target shape

```text
features/email-digest/
  sections.js     ONE section registry array + pure renderers (moved from route)
  collect.js      read saved data + cheap collectors (all timeout-bounded) → DigestInputs
  render.js       renderDigestHtml(inputs, config) → { html, subject, bytes }  (pure, no I/O)
  send.js         occurrence: create delivery FIRST → collect → render → snapshot → transport
  refresh.js      existing phases + executive summary + captions + fresh-brief moved IN here

app/api/admin/email-digest/route.js    POST: preview (free, saved-data) / send-now / retry / status
app/api/worker/email-digest/route.js   cron: per-client sends in-process (<30s each) + stale-stage reclaim
```

Old route stays live untouched until the new path is canaried; crons flip last; then the old route + dead layers are deleted. Send path target ~400 lines; subsystem roughly halves.

---

## 5. Phase order

### Phase 0 — verify + instrument (no behavior change)

- Confirm the cron-request origin theory from the inside: log `url.origin` + sub-request status/content-type in both dispatchers (one deploy, read next morning's stamps/logs).
- Verify prod env: `NEXT_PUBLIC_APP_URL` (protected-origin leak into emailed links), `CRON_SECRET`, effective `maxDuration` (120 vs 300).
- Characterization tests freezing render output for current configs; capture the `executive-daily` saved shape.
- Resolve any remaining telemetry gaps **before** trusting any "ok" stamp again.

### Phase 1 — make dailies arrive this week (minimal diff to the existing route)

1. **Fix the fan-out origin** (both dispatchers): self-requests target the custom production domain (explicit env, `hitloop.agency` fallback), `redirect: 'error'`, and strict response validation — JSON content-type + explicit `ok` contract; anything else stamps `failed` with `sub-request returned HTTP <status> (<content-type>)`.
2. **Scheduled sends: zero LLM.** Real sends read the saved `executive-daily` summary through a small shape adapter (`{summary,generatedAtIso,runId}` → renderer input), validated for **ownership (clientId) and freshness** — stale content renders with a visible "generated <date>" label. No fallback summary call, no caption generation on the scheduled path (captions come from saved refresh output or render an honest fallback). Fresh-brief link on cron resolves as `latest`; the fresh publish moves to the refresh phase.
3. **`AbortSignal.timeout(60_000)` inside `callAnthropic()`** — protects the manual path and every other consumer.
4. **Early delivery record + scoped recovery:** `getOrCreateDelivery` moves to the top of the real-send path, and the existing sweep gains one bounded rule: a same-day delivery stuck in a pre-transport stage with `updatedAt` older than 15 min may be re-entered (regenerate from saved data → same deterministic identity → same idempotency guarantees). No new collections, no new cron.
5. **Honest stamps** as in rule 5.

**Exit gate (all required, two consecutive automatic mornings):** delivery record exists for the correct client + local date; exactly one provider email id per occurrence; inbox receipt matches the stored snapshot; freshness evidence (same-day `brief_runs` + `digestFreshness`) or a visible stale label; **zero Anthropic calls attributable to the scheduled send** (usage ledger checked); stamps agree with the delivery record.

### Phase 2 — section registry + pure renderer extraction (byte-identical vs characterization fixtures)

### Phase 3 — per-client scheduling + thin routes
Real per-client `sendHour`/`weekday`/`timezone` via a GitHub-Actions dispatcher (30–60 min cadence, atomic due-claims, `nextRunAt` shown in the card); POST send (kill `GET ?send=1`); in-process worker sends; Manual Generate & Send defaults to saved data with an explicit labeled "Refresh intelligence (paid)" action; free-by-default preview.

### Phase 4 — decouple social; retire the approval-rollup email (owner-decided — each client digest already carries its own approval buttons)

### Phase 5 — delete old route, compat shims, dead controls; schedule retention purge; replace the 1,000-line SSOT with a short as-built doc

Stop for approval after every phase. Phases 0+1 ship as one reviewed diff.

---

## 6. Risks

- **Phase 1 touches the live route** — mitigated: characterization tests first; manual G&S path untouched; each change is small and independently revertable.
- **Origin fix vs version skew:** self-requests to `hitloop.agency` may hit a newer deployment than the cron's own build during a deploy window. Accepted — worst case is one client refreshed on the adjacent build; the alternative (protected origin) is 100% failure. The Phase 3 in-process worker removes the hop entirely.
- **Disabling SSO protection instead** would also "fix" it but exposes every preview deployment publicly — not recommended; keep protection, route around it.
- **Cron drift on Hobby** (~45 min observed) — accepted, documented in UI copy.
- **Refresh may still exceed its ceiling on cold days** — Phase 1 makes the send immune (saved data + stale label + honest stamp); phase-split for the cron refresh is Phase 3 scope.
- **Fable handoff invariants** (idempotency, leases, spend gates, cross-client scoping) — preserved via the kept delivery/preflight core; the Phase 1 reclaim rule reuses the existing deterministic identity, so replays cannot double-send.

---

## 7. Owner decisions — LOCKED (interview, 2026-08-18)

1. **Enrollment contract:** the per-client daily toggle IS the contract — any client toggled ON sends daily, reliably. No fixed client list.
2. **Schedule:** real per-client hours (Option B), GitHub-Actions dispatcher, hour precision (~0–30 min after the chosen hour) accepted. Phase 3.
3. **Stale policy:** on a failed refresh the email still sends from last saved data with a visible "generated <date>" stale label.
4. **Brief link:** the existing per-client `briefLinkMode` setting stays the sole control; the only change is that `fresh` executes during the refresh phase, never inside the send request.
5. **Blank recipient:** keeps meaning "send to admin."
6. **Approval rollup email:** retire it (per-digest approval buttons remain).
7. **Manual Generate & Send:** defaults to saved data; paid Scout/X refresh becomes an explicit labeled action. Phase 3 (UI).
8. **Scope:** Phase 0+1 approved 2026-08-18 as one reviewed diff — no deploy, no real send, no paid calls without separate approval.
