# Launch Readiness Audit — 2026-07-04

Scope: full codebase + revenue-path review ahead of public launch with **only the Deliverables bucket unlocked**. Method: 4 parallel adversarial code reviews (signup pipeline, payments, gating/cards, security/abuse) + live smoke tests (unit suite, prod build, route smoke, **real end-to-end signup on the production build**).

## Verdict

**The product works. The paywall does not.** The Deliverables pipeline is genuinely launch-grade — proven end-to-end with a real signup. But every expensive run route is gated on login only; the $5/run payment is never enforced server-side, so launching today means launching a free product with real COGS. Fix the entitlement gate (est. 1–2 days of work), add the run-sweeper cron, unhide the Visual Audit card, and you can charge money with confidence.

## What was PROVEN working (live smoke, prod build `next start`)

| Check | Result |
|---|---|
| Unit tests | 607/607 pass |
| `next build` | pass |
| `npm run smoke:routes` | all public routes render; private routes redirect to login |
| **Live signup E2E** (`/login?flow=homepage-create&url=paulgraham.com`) | account created → client `paulgraham-pOyPprwP` provisioned → worker claimed run in 0.4s → 6 browserless captures → Anthropic cover summary ($0.0128 logged) → **Cloud Run GPU video rendered (17s render, mp4 in Storage)** → run `succeeded` in **64s total** → all 6 public cards populated with real content |
| Gating (fresh non-admin) | Deliverables bucket unlocked; all 8 other buckets show locked; locked cards no-op |
| Cost instrumentation | `usage_events` (1 Anthropic row) + `browserless_requests` (6 rows) written |
| Tenant isolation | all 62 dashboard routes scope via `getEffectiveClientContext`; body `clientId` ignored; Firestore rules block cross-tenant reads and self-escalation (`users.clientId`/`role` unwritable by client) |
| Worker/cron/admin routes | all secret- or admins-collection-gated, fail closed in prod |
| Secrets | none committed; `.env.local` untracked |

⚠️ Test residue to clean up: Firebase Auth user `hitloop.smoke.20260704@gmail.com`, client `paulgraham-pOyPprwP` (+ its `brief_runs`, `dashboard_state`, `render_jobs`, Storage files). Left in place deliberately.

## BLOCKERS (revenue)

### 1. Paywall is cosmetic — every run route is free for any logged-in user
- `creative-brief/run`, `marketing-brief/run`, `modules/run`, `studio-render`, `scout-run`, `run-skill`, `recipe-run` etc. check **auth only** — no payment/credit/tier read anywhere (`app/api/dashboard/marketing-brief/run/route.js:47-71`, `creative-brief/run/route.js:38-46`).
- A user can curl the run route with their ID token in a loop: full Scout→Scribe→Guardian + GPU render at $0 to them.

### 2. The $5 payment is never recorded server-side
- `SubscribeModal` → `create-payment-intent` ($5, `purpose:'one-time-brief-run'`) → client-side `stripe.confirmPayment` → **client callback** fires the run. The webhook (`app/api/payments/webhook/route.js:112-131`) handles only `customer.subscription.*`/`invoice.*` — **not** `payment_intent.succeeded`. A successful charge writes nothing; a failed one blocks nothing.
- Corollary: if payment succeeds and the run fetch fails (browser closed, 500), the user paid $5 and is owed nothing recorded anywhere.

### 3. `dashboard_state.tier === 'paid'` is never written by payment code
- The whole client-side gate keys off `tier==='paid'` (`DashboardPage.jsx:7961`), but no server code ever sets it. The webhook writes a `subscriptions` collection **that nothing reads**. Subscribers pay recurring money and get no server-enforced difference.

### 4. Free-tier 30-day cooldown is client-only
- `FREE_TIER_BRIEF_COOLDOWN_SECONDS` computed in the browser; server queues unconditionally.

**Smallest safe fix (order):**
1. Webhook: handle `payment_intent.succeeded` → transactional `run_credits/{clientId}` increment.
2. Run routes: after `getEffectiveClientContext`, require active tier OR atomically consume a credit in `runTransaction`; else HTTP 402. (Copy the webhook's `claimEventForProcessing` transaction pattern.)
3. Webhook subscription handlers: resolve client by email → set/clear `dashboard_state.tier`.
4. Enforce the 30-day free cooldown server-side from the last succeeded run.
5. Per-uid/per-clientId `checkRateLimit` (helper exists in `api/_lib/rate-limit.cjs`) on the 17 un-limited expensive routes.

## MAJOR (reliability / product)

1. **No sweeper for stuck runs.** The first run rides one fire-and-forget trigger (`provision/route.js:85-118`). If it drops (WORKER_SECRET mismatch, deploy race, Vercel protection), the run sits `queued` forever; UI polls forever with no timeout/CTA; `admin/requeue` refuses `queued` runs. Worker death mid-run similarly strands `running` (nothing calls `requeueStaleRun`). **Fix: cron POST `/api/worker/run-brief` (no runId — `findNextQueuedRun` already exists) + stale-`running` reclaim.** Converts every permanent hang into a bounded delay.
2. **Visual Audit (`style-guide`) invisible to non-admins** — in the allowlist but `category:'content'` with no `extraCategories:['deliverables']` (`DashboardPage.jsx:10651`), so the public grid shows 6 cards, not the 8 the SSOT lists. Also decide explicitly: is Executive Brief (`marketing-brief`) in or out of the public surface (currently deliberately locked).
3. **Dashboard loader takes 60–100s** while every API answers <2s (measured: bootstrap 887ms, worst 1.8s). Reveal gates on `bgReady` (three.js first frame) + `dashboardContentReady` (`app/dashboard/page.jsx:93`, `DashboardPage.jsx:5070`). A paying user stares at "LOADING YOUR DASHBOARD" for over a minute. Instrument which gate is late and cap the loader.
4. **False failure copy.** "Retry is pending — this will run automatically" (no auto-retry exists) and "Our team has been notified" (observability is console-only). `run-lifecycle.cjs:446-448`, `DashboardPage.jsx:2568`.
5. **Video Promo failure is invisible** — render failure writes nothing the card reads; tile reverts to pristine empty after 10 min (`studio-render-core.cjs:38`). (Success path verified working; tile hydrates on next bootstrap — the empty tile right after run completion self-resolved.)
6. **Fresh accounts show red "STATUS: Holding you back" badges** on healthy unrun cards (badge enrichment maps 'Ready'/'Rendering…' → `critical`, `DashboardPage.jsx:12426-12453`). Day-zero looks broken.
7. **Env fragility matrix**: missing `WORKER_SECRET` = silent permanent queue; missing `BROWSERLESS_TOKEN` = run "succeeds" imageless; missing `ANTHROPIC_API_KEY` = silent cover fallback. Only Firebase admin creds fail loud. Add a boot-time env assertion for the launch-critical set.
8. **Partial provisioning failure** leaves a permanently run-less workspace (`alreadyProvisioned` early-returns skip run creation; `client-provisioning.cjs:282-317`) and the reseed recovery route uses the dropped-invocation pattern provision explicitly fixed (`reseed-intake/route.js:88-110`, no `after()`).

## MINOR (post-launch)

- `#brief-fullscreen-overlay` violates the mobile-width standard (~290px content on 375px phones) — most of what a mobile client sees.
- Creative Brief tile carousel cycles a marketing-brief cover reading "NOT YET RUN" on fresh accounts (correct data, confusing next to STATUS: PASSED).
- Rate limiter fails closed at signup (Firestore blip → 429 → user signed out); 8/hr/IP breaks shared-IP cohorts during a launch push.
- No admin/ops surface reads `render_jobs` (queue health invisible).
- `?open=post-me` deep link bypasses the non-admin modal guard (intentional but undocumented).
- Direct `/login` has no sign-up toggle — signup only reachable via homepage flow param. Confirm intentional.
- No `storage.rules` in repo — confirm Storage rules deployed (only isolation surface not verifiable from the tree).
- GPU render seconds have no cost line in `usage-logger` RATES — Operating Cost card undercounts true COGS.
- Admin `?as=` impersonation works for any existing client regardless of `adminDashboards` allowlist (`client-provisioning.cjs:137-144`) — fine if all admins are global operators; confirm.

## Unit economics (verified from code)

$5/run vs COGS ≈ $0.30–1.00 metered (Haiku scout + Sonnet scribe + 3×web_search + browserless) + GPU seconds (unmetered). **5–15× margin — pricing is sane once enforcement exists.** The observed smoke run logged $0.013 LLM + 6 browserless + 17s GPU.

## `⚠ops` still on the operator (cannot verify from repo)

- Stripe **live** keys + price IDs (`STRIPE_PRICE_ID_*`) + webhook secret in Vercel prod; run one real $5 test payment.
- `STUDIO_RENDER_URL`/`STUDIO_RENDER_SECRET`, `WORKER_SECRET`, `CRON_SECRET`, `BROWSERLESS_TOKEN`, `ANTHROPIC_API_KEY` in Vercel prod.
- Firebase Storage rules deployed.
- Repeat the signup smoke once on the production domain after deploy.

## Launch sequence (recommended)

1. Entitlement gate (blockers 1–4) — the only true launch gate.
2. Run-sweeper cron + stale-run reclaim.
3. `style-guide` → `extraCategories:['deliverables']` + decide Executive Brief in/out.
4. Fix false retry/notified copy; write render-failure state the Video Promo card can show.
5. Loader instrumentation/cap + fresh-account badge mapping.
6. Ops checklist above on the live system; delete the smoke-test account.
