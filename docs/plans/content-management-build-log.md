# Content Management normalization — build log

Worktree `~/Documents/Repos/Bballi_Portfolio-content-mgmt`, branch `feat/content-management` (from `feat/daily-content-loop` @ 6012feec). Dev server `:3005`.

## Stage A (2026-10-11)
- Calendar + content-system worktrees verified clean at WIP commits `80e4c201` / `38f38a38`. Not touched.
- Baseline `npm test`: 4522 tests, 2 failures (the 2 known vendor-api-lib tests). Matches expectation.

## Stage B — merge `6eb9dfd8` (social-archive timeline)
- Conflicts: `quote-targets/route.js` (kept both import sets + both action branches), `XContentEngineCard.jsx` (kept U2 shell; `timeline` tab id added to `MORE_TABS` + `MOBILE_MORE_TABS`; both CSS blocks kept).
- Decision: `__fixtures__/x/**` are gitignored by the repo-wide `data/` rule and were never committed in `6eb9dfd8`, so 6 X-adapter tests failed. Copied the synthetic fixtures read-only from the content-system worktree and `git add -f`'d them (24K, "Fixture User", example.invalid URLs).
- Tests after: 4621 total; social-archive 95/95. Full-suite run showed 2 additional load-flaky failures (`ffprobe validation…`, `proof-render-worker`) that pass in isolation (worker 29/29) — environmental, not caused by the merge.
- Fresh reviewer on the resolution: no findings.
- ⚠️ Live check on :3005 NOT DONE: dashboard redirects to `/login`; agent may not enter credentials. Needs the owner to sign in once at http://localhost:3005 (Chrome session) — then rerun the live gate. Marked NOT VERIFIED until then.

## Phase 0 — audit + characterization
- Audit: `docs/plans/content-management-audit.md` (5 parallel read-only agents; table + behaviour-change list).
- Month-calendar WIP `80e4c201`: **ADOPT UI ONLY** (decision + reasons in the audit). Agent note: it ran `git cherry-pick -n` then `--abort`/`reset --hard` in this worktree to test applicability; tree was fully committed beforehand so nothing was lost (verified HEAD 882d5582 clean, `.env.local` intact). Process lapse logged; future agent briefs forbid git writes.
- Characterization tests (committed BEFORE any behaviour change; unmodified production code): 10 files, ~159 tests — lifecycle (31), copywriter/schedule-posts/approval-token+route/auto-publish row (65), item-actions/daily-loop-review/discogs-scheduler/engine-quota+slots/plan-inputs (63). Known gaps pinned as `CURRENT (known gap): …` — when a phase fixes one, the pinned test is updated deliberately in the same commit and called out.
- Full suite: 4779 tests, only the 2 known vendor-api-lib failures.
- Limit: `findDraft` in quote-targets route is a closure; characterized via its caller only.
