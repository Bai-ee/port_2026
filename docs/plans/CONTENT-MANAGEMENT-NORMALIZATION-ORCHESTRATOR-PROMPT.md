# Content Management normalization — orchestrator prompt (Sonnet)

Supersedes the kickoff line "Read and execute CONTENT-MANAGEMENT-NORMALIZATION-SONNET-PROMPT.md". That file and the master plan stay binding; this prompt adds base-reconciliation steps and stricter guardrails. Where this is stricter, it wins.

You are the Sonnet orchestrator. Run Stages A → B → C below **start to finish without stopping for approval**. Make routine and design decisions yourself, using the rules here, and log each one in the build log. Stop early only for the hard-stop conditions at the end of this file.

**Execution style**
- Maximize parallel Sonnet sub-agents. Every phase is split into tracks with disjoint file ownership and run concurrently. Sequence only true dependencies.
- You (the orchestrator) own: shared contracts, routes, the posting service (`twitter-service.js`), the context loader, the UI shell (`XContentEngineCard.jsx`), and all merges/integration. Sub-agents never edit those.
- **Good-enough code, code first.** Aim for a working, readable, tested implementation of the plan, not polish:
  - small adapters over existing modules
  - no speculative abstractions
  - docs kept short and as-built
  - an item that isn't essential to the 8 acceptance checks in master plan Phase 6 can be simplified or deferred (log it as a limit)

## Read first (in order)

1. `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/plans/CONTENT-MANAGEMENT-NORMALIZATION-MASTER-PLAN.md`: the plan (Phases 0–6).
2. `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/plans/CONTENT-MANAGEMENT-NORMALIZATION-SONNET-PROMPT.md`: the assignment.
3. `~/.claude/CLAUDE.md` and the repo `CLAUDE.md` in the main checkout: X API spend gate, Vercel Hobby, DOM-id rule, mobile width, styled-jsx scope trap.
4. In the daily-loop worktree:
   - `docs/source-of-truth/{X-STRATEGY-TAB,X-GROWTH-SYSTEM,X-API-AND-PROFILE-OPERATIONS,SOCIAL-AUTO-PUBLISH,COPYWRITER-CARD,VERCEL-HOBBY-DEPLOYMENT,DAILY-CONTENT-LOOP}.md`
   - `docs/plans/x-strategy-build-log.md` (Handoff section)
   - `docs/plans/content-engine-ui-gate-log.md`
   - `docs/plans/content-engine-ui-audit.md`
   - `docs/plans/ACTIVE-CONTENT-SYSTEM-PLAN.md`

## Known state (verify every item; don't trust it)

| Worktree | Branch | State |
|---|---|---|
| `~/Documents/Repos/Bballi_Portfolio-daily-loop` | `feat/daily-content-loop` @ `6012feec` | Integrated base: daily loop + X Strategy T0–T7 + Content Engine UI U0–U4 (fast-forwarded), screenshots stripped. Clean. Never pushed. |
| `~/Documents/Repos/Bballi_Portfolio-ce-ui` | `feat/content-engine-ui` @ `c3f0515d` | Fully merged into the base. Don't use it. |
| `~/Documents/Repos/Bballi_Portfolio-calendar` | `feat/content-calendar-month` | Social-archive commit `6eb9dfd8` = the social-archive timeline commit (FB/X/IG adapters, timeline store, Timeline tab; touches `x-content-inventory/{schema,store,search-index}.js`). WIP commit `80e4c201`: month calendar (`MonthCalendarPanel.jsx`, `PostSheet.jsx`, `calendar-bits.jsx`, `month-calendar.js`); **deletes `CalendarPanel.jsx`**; edits `twitter-service.js`, `app/api/social-posting/route.js`, `week-calendar.js`, `XContentEngineCard.jsx`, `quote-targets/route.js`. |
| `~/Documents/Repos/Bballi_Portfolio-content-system` | `fix/nas-job-status-labels` | Same base `6eb9dfd8`. WIP commit `38f38a38`: Discogs panel + `features/discogs-ingest/actions.js`, NAS edits, social-archive ingest tweaks. |
| `~/Documents/Repos/Bballi_Portfolio` | `codex/wip/archive-x-localhost-test` | Main checkout, with unrelated uncommitted media changes. Never edit it. |

**Never edit, commit in, reset, stash or run servers from any worktree except the one you create in Stage A.** Read-only git inspection of the others is fine.

## Stage A — confirm the WIP snapshots, then create your worktree

1. The idle uncommitted work in both worktrees was saved on 2026-10-11 as WIP commits on their own branches (unreviewed, untested):
   - calendar: `80e4c201` on `feat/content-calendar-month` (parent `6eb9dfd8`)
   - content-system: `38f38a38` on `fix/nas-job-status-labels` (parent `6eb9dfd8`)
   Verify both worktrees show a clean `git status`. If either has NEW uncommitted changes, someone is working there again: stop and report. Don't touch it.
2. A dev server from the content-system worktree runs on :3002. Leave it alone.
3. Create your worktree from the integrated base:
   `git -C ~/Documents/Repos/Bballi_Portfolio-daily-loop worktree add ~/Documents/Repos/Bballi_Portfolio-content-mgmt -b feat/content-management feat/daily-content-loop`
   - Copy `.env.local` from the daily-loop worktree; never commit it.
   - Copy in the master plan, the assignment, and this prompt (into `docs/plans/`); commit them first.
   - `npm install` if needed. Dev server: `npm run dev -- -p 3005`.
4. Record the baseline (step 3's worktree): `npm test` counts and failures (expected: 4522 tests, only the 2 known vendor-api-lib failures; verify).

## Stage B — merge the committed social-archive work (exact commit only)

1. In your worktree: `git merge 6eb9dfd8` (the commit, NOT a branch tip, so no WIP comes along).
2. Expected conflicts:
   - `app/api/dashboard/quote-targets/route.js`: keep all actions from both sides; strategy-* + daily-run + social-archive.
   - `components/dashboard/XContentEngineCard.jsx`: keep the U2 shell (tab row, More menu, phone bottom nav, Today segmented). Add social-archive's Timeline tab as a new tab id inside **More** on desktop and phone, following the shell's existing tab-mapping pattern.
   - Keep all ids from both sides.
3. Gate:
   - `npm test`: baseline + social-archive tests, with only the 2 known failures.
   - a fresh Sonnet reviewer on the merge resolution
   - live check on :3005: all tabs incl. Timeline render at 1280px and 400px, zero console errors
   Commit the merge.
4. Don't merge either WIP branch here. The Discogs/NAS WIP (content-system) is **excluded** from this workstream (merge later; keep edits to `XContentEngineCard.jsx`, `quote-targets/route.js`, `BucketsPanel.jsx`, `SourcePanel.jsx`, `nas.js` minimal and note conflicts for it in the handoff).

## Stage C — execute the normalization master plan (Phases 0–6)

### Phase 0: audit + characterization (no stop)
Run the bounded ownership audit per the master plan with parallel read-only sub-agents. Then write `docs/plans/content-management-audit.md` with the table
`| concern | producers | consumers | store | write path | duplicate? | chosen owner | change needed | risk |`
plus:
- every behaviour change to existing production paths
- baseline failures
- model/network calls and configured crons/sweepers

Also in Phase 0:
- **Characterization tests** for every production path under guardrails, written and committed BEFORE any behaviour change. These are the safety net that replaces owner review.
- The records scheduler is `features/discogs-ingest/scheduler.js`.
- **Month-calendar WIP decision.** Make it yourself with this rule. Inspect `80e4c201` read-only (`git diff 6eb9dfd8..80e4c201`).
  - **Adopt fully** if its `twitter-service.js` / `social-posting/route.js` edits are additive (new read/update functions or actions) and the characterization tests stay green with it applied. In that case, cherry-pick or merge it in Phase 3 as the calendar implementation and restyle it to the U3d calendar language.
  - **Adopt UI only** if those edits change existing publish/claim/approval behaviour. Take `MonthCalendarPanel`/`PostSheet`/`month-calendar.js`, re-implement any needed server change through the shared service under the guardrails, and leave the rest.
  - **Drop** if adopting costs more than extending the restyled `CalendarPanel.jsx` to meet master plan Phase 3. Keep `CalendarPanel.jsx`.
  - Log the decision and the reasons.

### Phases 1–6: run straight through
Run each per the master plan with the gate below. Parallelize each phase's disjoint tracks; integrate and gate; commit; move on.

## Production-path guardrails (non-negotiable)

- These behave exactly as today for existing rows and flows, proven by the Phase 0 characterization tests:
  - `twitter-service.js` publish/claim (`claimDuePost`, `process-due`)
  - the approval gate
  - Social Auto-Publish (`api/_lib/social-approval.cjs` + the approval token routes)
  - Copywriter `score`/`update`/`enhance`
  - Schedule Posts
  - the daily-digest auto-publish row
  - `createDraftPostOnce`
- New lifecycle rules (approved-edit invalidation, clearance recheck, reply-target enforcement, expiry) apply through the shared service, with explicit compatibility for legacy rows. No blanket bypass; no change to what the cron publishes.
- Vercel Hobby: **no new route files**; no `vercel.json`/cron/`.vercelignore`/`maxDuration` changes. New actions go on existing routes.
- No X API calls, no ScrapeCreators. bird reads are OK. Publish functions are only ever called through an injected mock publisher in tests.

## Authorizations

- Local commits per stage/phase on `feat/content-management` after its gate passes. No push, merge into other branches, rebase of shared branches, or deploy.
- Firestore: reads OK. Writes only:
  - (a) draft posts through existing UI save actions: `status:'draft'`, `scheduledAt:null`, text prefixed `[CM test]`, client `bryan-balli-WUoltG84`, **max 5 rows**, each listed in the build log for the owner to delete
  - (b) `x_strategy_*` for that client
  - Approve, schedule, publish, clearance and package-usage flows are proved with injected stores/fixtures only.
  - No `client_configs` writes, no Brain approval, no live `x_content_packages` writes.
- Model calls: **max 15 calls / $1.00 total** for chat-tool verification (`claude-sonnet-4-6`, logged via `logAnthropicCall`, tallied in the build log). Daily-loop generation in live checks: model copy OFF.
- No launchd installs; no enabling or disabling workers, sweepers or GitHub workflows.

## Verification gate (Stage B and every Phase 1–6; you run it, don't trust agent reports)

1. New tests with real failure cases:
   - idempotent save
   - wrong client / late cross-client response
   - unapproved or wrong-client Brain
   - stale input
   - approved-edit invalidation
   - clearance revoked before schedule
   - reply without threading support
   - double-booking by two schedulers
   - expired opportunity → needs-review
   - missing metrics shown as missing, not 0
   - absent plan doc → legacy behaviour
   Characterization tests stay green.
2. `npm test`: baseline failures only; record the delta.
3. A fresh Sonnet reviewer on the phase diff vs the master plan + guardrails. Fix every bug, guardrail breach or isolation issue, then re-run the gate.
4. Live check on :3005 (browser tool; load all tools in one ToolSearch call), scoped to the phase. Phase 4 must walk inspect → edit → save → approve → choose time → status at 1280px and 400px, keyboard-reachable. Save is live under (a); approve/schedule use fixture-backed mode or stop at the confirm, whichever the code supports. Keep screenshots in a scratch dir (don't commit images) and list their paths.
5. Append to `docs/plans/content-management-build-log.md`, then commit.

After 3 failed fix attempts on an item: cut it cleanly (no half-wired UI or paths), mark it BLOCKED with evidence, continue.

## Docs

- New `docs/source-of-truth/CONTENT-MANAGEMENT.md` (as-built: owner table, lifecycle states, write paths, workspace views, chat tools, input-status strip, runbook).
- Pointers from `X-GROWTH-SYSTEM.md` and `X-STRATEGY-TAB.md`.
- The assignment's "video handoff" requirement: **skip**. No such file exists; note it in the handoff.
- Give a ready-to-paste repo-map line for the main checkout's `CLAUDE.md` in the final reply (don't edit the main checkout).

## Final handoff (compact)

- Commits by stage/phase on `feat/content-management`.
- The owner table, before vs after.
- Month-calendar decision and outcome.
- A 6-step operator walkthrough.
- Test counts per phase and review findings fixed.
- The `[CM test]` rows to delete.
- Model spend.
- Production dependencies.
- Exact external activation steps.
- Remaining limits; the conflicts expected when the Discogs/NAS WIP merges later.
- The repo-map line.

Never call it production-ready on local tests alone.

## Hard stops (the ONLY reasons to stop before the final handoff)

1. Stage A finds new uncommitted changes in the calendar or content-system worktree (someone is working there).
2. Finishing an item would require breaking a guardrail or exceeding an authorization (X API, publishing, push/deploy, client_configs, Brain approval, budget). Skip that item, mark it BLOCKED, and keep going. Stop only if nothing else remains.
3. A characterization test of a production path fails and can't be fixed without changing that path's existing behaviour. Revert the offending change, mark it BLOCKED, keep going.

Everything else (design choices, ambiguous plan wording, flaky tests, failed sub-agents, merge conflicts): decide, log the decision in the build log, continue. Re-spawn a failed sub-agent once with a tighter brief before cutting its item.
