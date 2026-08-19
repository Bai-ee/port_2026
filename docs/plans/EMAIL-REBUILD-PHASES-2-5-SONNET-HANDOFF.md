# Email Rebuild Phases 2–5 — Sonnet Multi-Agent Handoff

**Status:** implementation handoff; Phases 2–5 not started
**Written:** 2026-08-19 by Fable, after completing Phase 0+1 in the working tree
**Parent plan (read first):** [`EMAIL-REBUILD-PLAN.md`](EMAIL-REBUILD-PLAN.md) — diagnosis, locked owner decisions, phase list
**Invariant source:** [`EMAIL-SYSTEM-SIMPLIFICATION-FABLE-HANDOFF.md`](EMAIL-SYSTEM-SIMPLIFICATION-FABLE-HANDOFF.md) §2 (delivery/spend/content/security guarantees — all still binding)
**Behavior reference (historical, partly stale):** `docs/source-of-truth/EMAIL-DIGEST-CARD.md`

---

## 0. Mission for Sonnet

Finish the email rebuild: extract the renderer and section registry out of the 3,540-line route (Phase 2), build real per-client scheduling + honest routes/UI (Phase 3), decouple social publishing and retire the approval-rollup email (Phase 4), then delete the dead weight and rewrite the SSOT (Phase 5).

You are expected to run **multiple agents**. Use them for parallel characterization, parallel per-section extraction, and independent verification — never for parallel *decisions*. One agent (you, the orchestrator) owns sequencing and merges; sub-agents get self-contained work packages from §6 with explicit inputs, outputs, and acceptance checks. Two agents must never edit the same file concurrently.

Work phase by phase. **Stop for user approval at the end of every phase** and at every gate marked ⛔.

---

## 1. Context you must not re-derive (settled facts)

1. **Root cause of the dead daily emails (fixed in Phase 1):** Vercel SSO Deployment Protection (`all_except_custom_domains`) swallowed every cron self-fan-out sub-request — a fetch to `url.origin` landed on the vercel.com login page; the refresh dispatcher stamped that "ok", the send dispatcher stamped "Email provider did not return an id." Scheduled sends had never worked since fan-out shipped. Self-requests now go through `api/_lib/digest-self-origin.cjs` (custom domain, `redirect:'error'`, strict JSON contract). Never reintroduce `url.origin` or `VERCEL_URL` for self-requests or emailed links.
2. **Owner decisions (locked 2026-08-18 interview — do not re-ask):**
   - Daily toggle = the contract: any client toggled ON sends daily.
   - Real per-client send hours (Option B), GitHub-Actions dispatcher, hour precision (~0–30 min late) accepted.
   - Failed refresh ⇒ still send last-good data with a visible stale label.
   - `briefLinkMode` stays the per-client control; `fresh` executes in the refresh phase only.
   - Blank recipient ⇒ send to admin.
   - Approval-rollup email: **retire** (per-digest approval buttons remain).
   - Manual Generate & Send: saved-data default + explicit labeled paid refresh.
3. **Phase 1 rules now enforced in code (keep enforced through every refactor):**
   - Scheduled sends are **zero-LLM and zero-social** — gates live in `api/_lib/digest-send-policy.cjs`; every LLM/social/approval-token call site in the send route sits behind `allowInlineLlm` / `allowSocialSideEffects`.
   - Delivery record is created **before** generation; generation is fenced by `claimGeneration`/`releaseGeneration` (+ `storeRenderedHtml` owner fence); the 5-min sweep reclaims stuck cron occurrences via `reclaimDeliveryId` with identity taken from the stuck record, never the clock.
   - Dispatcher stamps go through `buildRefreshStampEntry`/`buildSendStampEntry` (explicit `ok:true` required; child bodies cannot overwrite trusted fields).
   - `callAnthropic` (`features/scout-intake/_anthropic-client.js`) carries an `AbortSignal` timeout; digest calls pass `timeoutMs: 60_000`.
4. **Refresh phase now owns:** the digest email summary (`refreshDigestEmailSummary` → `dashboard_state.digestSummary`) and the fresh hosted-brief publish (`publishFreshDigestBrief`), both in `app/api/worker/pre-digest-refresh/route.js`.
5. **Prod facts:** Vercel Hobby — crons are daily-only and the deployment must stay within the 12-function packaging cap (`docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md` — read before adding any route or cron). Hobby cron fire times drift up to ~45 min. Runtime logs expire in ~1 h — durable state is the only trustworthy telemetry. The GH workflow `.github/workflows/digest-delivery-sweep.yml` pings the sweep every 5 min at `hitloop.agency` and is ACTIVE (its own header comment claiming otherwise is stale — Phase 5 cleans it).
6. **Only enrolled client today:** `paradice-dbBQCHUX` → bryanballi@gmail.com. `system_flags/digest_optin_v1` migration already ran.

## 2. As-built file map after Phase 0+1

| File | Role |
|---|---|
| `app/api/admin/daily-digest/route.js` (~3,600 lines) | Still the monolith: per-client send, fan-out, collectors, renderer (`buildEmailHtml` + `RENDER` map + `DT` tokens), social enqueue fns, approval rollup. Phase 2/3/4 shrink it; Phase 5 deletes it. |
| `app/api/worker/pre-digest-refresh/route.js` | Dispatcher + per-client refresh incl. digest summary + fresh-brief publish |
| `app/api/worker/digest-delivery-sweep/route.js` | Transport retry sweep + stale-generation reclaim (≤2/tick) |
| `api/_lib/digest-delivery.cjs` | Identity, stages, snapshot, send lease, generation lease, retries, reclaim helpers, retention (uninvoked) |
| `api/_lib/digest-self-origin.cjs` | Self-origin + `fetchWorkerJson` + stamp builders |
| `api/_lib/digest-send-policy.cjs` | `resolveSendPolicy` — the zero-LLM/zero-social gates |
| `api/_lib/resend-transport.cjs` / `digest-refresh-preflight.cjs` / `digest-circuit-breaker.cjs` | Keep as-is |
| `features/intelligence/_digest-config.js` | Config schema/normalization, enrollment scan, cron stamps |
| `components/AdminEmailModals.jsx` | Card UI (SETTINGS + EMAIL PREVIEW, `runAndSend`) |
| Tests | `api/_lib/__tests__/digest-{delivery,self-origin,send-policy,generation-reclaim,circuit-breaker,refresh-preflight}.test.js`, `features/scout-intake/__tests__/anthropic-client-timeout.test.js` — run via `node --test`, fakes in `api/_lib/__tests__/fake-firestore.cjs` |

## 3. ⛔ Standing gates (every agent, every phase)

- **No deploy, no real email, no paid Anthropic/X/ScrapeCreators call, no GH-workflow or `vercel.json` cron change, no Firestore prod write, no enrollment change** without explicit user approval for that specific action. Local `.env.local` holds live prod creds — a locally-run worker script SPENDS REAL MONEY and writes prod state (`worker-routes-unauthenticated-locally` memory). Never "verify" by executing a worker path against prod.
- Preserve the user's unrelated dirty-worktree edits (`HeroHeadline.jsx`, `StackedSlidesSection.jsx`, their `EMAIL-DIGEST-CARD.md` edit). Never bundle them into a rebuild commit.
- Commit only with user approval, on a branch they approve. Suggested: land Phase 0+1 first (user-gated), then one branch per phase.
- Full gate per phase: `npm test` (2,661+ green; the studio seeded-texture test is a known flake under full-suite load — rerun standalone before blaming your diff) + `npm run build` + the phase's own acceptance checks.
- The X-API spend gate (`docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`) binds every agent.

## 4. Phase specs

### Phase 2 — extract renderer + section registry (pure, byte-identical)

**Goal:** `features/email-digest/sections.js` (ONE explicit section-definition array + pure per-section renderers) and `features/email-digest/render.js` (`renderDigestHtml(inputs, config) → { html, subject, bytes }`, no Firestore/network/auth). The route becomes a caller.

- Registry rows: `{ key, label, group, defaultOn, render, emptyText }` for all 33 `INCLUDE_KEYS`. Derive from it: UI rows (`SECTION_GROUPS` in `AdminEmailModals.jsx`), include/order normalization allowlists (`_digest-config.js`), group membership, renderer dispatch, empty states. Kill the four hardcoded lists; `COMPAT_INCLUDE_KEYS` in the route dies (fold into normalization).
- **Characterization FIRST:** before moving anything, snapshot `buildEmailHtml` output (fixture inputs × config matrix: default, all-on, all-off, legacy coarse include, custom order, demo groups, stale summary note) to fixture files; after extraction, a test proves byte-identical output. Only the freshness token/timestamp may need injection to be deterministic — inject, don't strip.
- Keep: `DT` design tokens, `EMAIL_CAPS`, Gmail-clip warning, mobile-width email idioms, every empty state, `staleNote` rendering.
- Parallelizable: per-section-group extraction by different agents into one registry file **only after** the characterization fixtures exist and one agent owns the registry skeleton.
- **Danger:** the route is live production. Extraction must be move-and-reexport (route imports from the new module) — zero behavior edits in this phase. ⚠️ Never edit `DashboardPage.jsx`/card files while a dashboard run is active (Fast-Refresh mid-run trap).

**Accept:** byte-identical fixtures; `npm test` + build green; grep proves no section key literal remains duplicated outside the registry.

### Phase 3 — per-client scheduling + honest routes/UI

**Goal:** each toggled-on client sends at their `sendHour`/`weekday`/`timezone`, hour precision; routes become explicit; UI stops lying.

- **Scheduler:** `computeNextRunAt(schedule, now)` (pure, DST-correct via `Intl`, daily + weekly + disabled; test spring-forward/fall-back/weekly-wrap). Persist `nextRunAt` on `digest_config`. New dispatch route (worker-auth) claims due clients **atomically** (transaction: claim iff `nextRunAt <= now`, immediately advance `nextRunAt` — two racing dispatchers claim disjoint sets) then runs refresh→send per claimed client. Dispatcher trigger = a GH Actions workflow every 30 min ⛔ (write the file; user commits/enables it — same pattern as `digest-delivery-sweep.yml`, secret `HITLOOP_CRON_SECRET`, target `hitloop.agency`). Existing daily Vercel crons stay as fallback until canary passes, then are re-pointed ⛔.
- Missed-run recovery: a `nextRunAt` more than one full period in the past fires ONCE, then advances to the next future occurrence (never a backlog burst).
- **Routes:** POST-only `app/api/admin/email-digest/route.js` (preview / send-now / retry / status / config) replacing `GET ?send=1` and the digest-config action grab-bag; worker dispatch route as above. Mind the 12-function cap — reuse/merge route files rather than adding many. Temporary GET compat shim logs its use; Phase 5 removes it.
- **UI (`AdminEmailModals.jsx`):** send-hour picker becomes real (shows computed `nextRunAt` + "arrives within ~30 min after"); timezone label dynamic (`CT` or correct `CST`/`CDT` — never hardcoded `CST`); Manual Generate & Send defaults to **saved data** (render + send only), with a separate clearly-labeled "Refresh intelligence (paid)" action that runs the refresh phases (keeps `allowX` semantics); live preview defaults to `noLlm=1` (free), paid preview generation only via the explicit refresh action.
- Operator panel on the card (data already durable): last refresh/send result + age, delivery stage, attempts, `nextRetryAt`, provider id, breaker state, `Retry stored email`, `Reset breaker`.

**Accept:** scheduler unit matrix (DST, weekly, disabled, missed-run, racing dispatchers → disjoint claims); policy tests still green; UI states only true things; no new function-count regression (`docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md` check).

### Phase 4 — decouple social; retire approval rollup

- Social publishing becomes its own idempotent job: `social_publish_jobs/{clientId}__{dateKey}` (mirror `digest_deliveries` mechanics: create-only identity, claim, terminal states). Manual sends and (later) a social schedule create jobs; **email code only reads job state** to render buttons/status. Email retry can never touch social state; social retry can never send email. Approval tokens keep single-use redemption (`api/_lib/social-approval.cjs` unchanged).
- Retire `mode=approval-rollup` in the digest route + its cron (`vercel.json` `20 13 * * *` if present — check) ⛔ cron edits are user-gated. Per-digest approval buttons remain the approval surface.
- Read `docs/source-of-truth/SOCIAL-AUTO-PUBLISH.md` + `X-API-AND-PROFILE-OPERATIONS.md` §0/§2e first. No enrolled client uses auto-publish today — verify that is still true before changing defaults (read-only Firestore check ⛔ if in doubt).

**Accept:** tests prove — email generation reads social state without publishing; email retry creates no social write; social job replay publishes at most once.

### Phase 5 — delete + retention + docs

- Delete: old GET send contract + shim, `COMPAT_INCLUDE_KEYS` remnants, dead `sendHour`-ignoring code paths, the rollup mode, stale comments (incl. the sweep workflow header + `EMAIL-DIGEST-CARD.md` contradictions), any now-orphaned exports (`sendEmail()` legacy path).
- Schedule the retention purge (`purgeDeliveriesOlderThan`, 14 d) into an existing daily worker tick — not a new cron (Hobby budget).
- Replace `EMAIL-DIGEST-CARD.md` with a short as-built SSOT (~200 lines: contract, file map, schedule truth, operator runbook, spend map). Update `CLAUDE.md` pointers; archive the old doc to `docs/archive/`.

**Accept:** grep-clean for deleted symbols; suite + build green; new SSOT reviewed by user.

## 5. What Sonnet must NOT do

- Rewrite `digest-delivery.cjs` mechanics, the transport classifier, or `_digest-config.js` normalization semantics (extend, don't rework).
- Add an event bus, DI container, plugin framework, or generic workflow engine (Fable-handoff rule 8 stands).
- Touch Studio, Site Recreate, Market Signals card internals, or any non-email surface.
- Weaken any §3 gate to "make progress" — blocked means report and stop.
- Trust `EMAIL-DIGEST-CARD.md` prose over code — verify every claim in source.

## 6. Suggested agent topology (adapt, don't worship)

- **Phase 2:** 1 fixture agent (characterization matrix) → barrier → 1 registry-skeleton agent → N parallel section-move agents (disjoint section groups, same registry via sequenced merges) → 1 byte-compare verifier + 1 grep auditor.
- **Phase 3:** scheduler agent (pure fn + tests) ∥ routes agent ∥ UI agent — after a shared 1-page interface contract is written down; then an adversarial verifier attacking the due-claim race and DST matrix.
- **Phase 4:** job-store agent → integration agent → adversarial verifier (retry-replay attacks).
- **Phase 5:** deletion agent + docs agent ∥ final full-suite verifier.
- Every phase ends with a reviewer agent checking against THIS doc + `EMAIL-REBUILD-PLAN.md` for scope drift before the user is asked to approve.

## 7. First deliverable before any Phase 2 code

Return to the user: (1) confirmation Phase 0+1 is committed/deployed or explicitly being skipped past (it gates nothing in Phase 2 except honesty about prod state); (2) the characterization fixture list; (3) the registry row schema; (4) the Phase 3 interface contract (scheduler fn signature, dispatch route contract, `nextRunAt` semantics); (5) any contradiction found between this doc and the code. Then wait for approval.
