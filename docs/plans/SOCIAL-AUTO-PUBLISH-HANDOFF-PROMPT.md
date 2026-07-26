# Master handoff prompt — Social Auto-Publish

Paste the block below into a fresh implementer thread.

---

You are the implementer for the **Social Auto-Publish** feature in this repo. The plan is already approved. Do not re-plan it, do not propose alternatives, do not widen scope.

## Read first, in this order
1. `docs/plans/SOCIAL-AUTO-PUBLISH-PLAN.md` — **the approved plan. It is the source of truth. If anything else conflicts with it, it wins.**
2. `docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md` — §0 spend gate is binding on you.
3. `docs/source-of-truth/EMAIL-DIGEST-CARD.md` — how the digest config, toggles, and send terminal work.
4. `CLAUDE.md` (repo root) — repo map, DOM naming rule, phase discipline.

## What you are building
A per-client, per-platform social publishing layer. Each client's automatically-generated daily video publishes to **that client's own** social account under one of three modes: `off` (default), `auto` (publishes at digest send), `approval` (a **Post to X** button rides in the email and nothing publishes until it is clicked). Admin can select any client and edit its accounts + mode, and receives one roll-up email aggregating every client's pending video.

X is adapter #1. **Instagram is adapter #2 — build the registry, config, UI rows, and token layer platform-generic from day one.** Adding Instagram later must be a registry entry plus an adapter file, never a refactor. Ship the Instagram adapter as a registered stub that throws `not-implemented`, and render its UI row disabled.

## Hard rules
- **Do not touch the existing `autoPostX` feature.** That is the separate *text* suggested-post enqueue (`daily-digest/route.js:1918`). Leave it byte-identical. Your new key is `autoPublish`.
- **Default `off` for every platform, every client.** No existing client's behavior may change without an explicit toggle. This is the acceptance bar for every phase.
- **Publishing never happens on a GET.** Email scanners prefetch links. The email button lands on a public page; only an explicit POST publishes. A GET on the approve API returns 405.
- **Never publish a stale video.** Hard-gate on `!videoItems.remix.stale`.
- **Do not add the `process-due` cron without the 12h staleness guard in the same commit.** Without it the first run flushes the entire historical backlog of never-sent scheduled posts to a live account.
- **X API writes cost real money on a live public account and are invisible to the Operating Cost card.** Anything that posts must be behind an explicit toggle that is off by default. Do not run a live post as a test without asking first.
- Copy the HMAC token shape from `api/_lib/calendar-oauth.cjs:44` — do not invent one.
- Copy the `enqueueDigestSuggestedPost` pattern (`daily-digest/route.js:1918`) for the new enqueue — same `step()` terminal grammar, same never-throw discipline.
- Every element you meaningfully edit gets a stable kebab-case `id` named by function (`#social-accounts-panel`, `#digest-autopublish-x-row`, `#post-approval-action-shell`). No `container` / `wrapper` / `box`.
- Preserve desktop behavior. Card modals follow the mobile-width standard — mount in the standard containers, don't add your own large horizontal padding on mobile.
- Do not add libraries. `twitter-api-v2@1.29.0` is already installed and has `v2.uploadMedia`.
- Never edit `DashboardPage.jsx` while a dashboard terminal run is active (Fast Refresh kills the run).

## Execution
Work the plan's phases **P1 → P8 in order**. After each phase: run `npm test` and `npm run build`, and report in this format —

- **Files changed**
- **Exact behavior changed**
- **What stayed untouched**
- **Verification run**
- **Manual test next**
- **Risks / not verified**

Keep it compact. No essays, no architecture recap.

**Stop for approval after P5 (approval infrastructure) and again after P8.** Do not start a later phase early.

If you hit something the plan did not anticipate: finish everything that does not depend on it, then state the blocker and your recommended resolution in one short paragraph. Do not silently pick a different architecture.
