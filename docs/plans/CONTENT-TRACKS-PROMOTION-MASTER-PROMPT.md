# Master prompt — Content Tracks + Promotion Loop (multi-agent Sonnet build → launch)

Execute `docs/plans/CONTENT-TRACKS-PROMOTION-MASTER-PLAN.md` start to finish, as fast as safely possible, and launch it to
`main`. You are the orchestrator and single integration owner.

**Base:** worktree `~/Documents/Repos/Bballi_Portfolio-promo`, branch `feat/content-promotion` (contains the unpushed Telegram
command center on top of production `main` b3978fca). Verify with `git fetch && git log origin/main -1` that `main` hasn't moved;
if it has, rebase/merge it in first. Never edit the main checkout `~/Documents/Repos/Bballi_Portfolio` (unrelated dirty work).
`node_modules` is a symlink; `.env.local` is present (never print env values).

**Read first (only these):** the master plan; `docs/source-of-truth/TELEGRAM-COMMAND-CENTER.md`;
`docs/source-of-truth/CONTENT-MANAGEMENT.md`; `docs/source-of-truth/X-STRATEGY-TAB.md`; `docs/DEVELOPER-HANDOFF-CONTENT-SYSTEM.md`;
`docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md` §0. Don't re-plan; owner decisions D1–D5 are final.

**Run it in waves (plan §5):**
1. **Wave 0 (you):** write the shared contract `features/x-strategy/content-tracks.js` and reshape the existing draft
   `features/x-strategy/promotions.js` onto it, with unit tests. Agents import these and never edit them.
2. **Wave 1:** launch agents A–E **in one message, in parallel**, `model: sonnet`, each given: its plan section, its exact owned
   files, the contract files, and these rules: no git writes; no network, Firestore, bird, X API or paid model calls; fake stores in
   tests; don't touch files owned by another agent (report needed cross-file changes to you); finish with files changed, tests run
   and pass counts, and open issues.
3. **Wave 2 (you):** wire `features/telegram/runtime.js` services and route deps; reconcile drift; run the affected suites, then
   full `npm test` (baseline: only the 2 known vendor-api-lib failures); `npm run build` in this worktree only (stop any dev server
   running in this worktree first). Launch one fresh **reviewer** agent (sonnet) on rights, client scope, lifecycle and queue
   idempotency, auth on the new worker route, and Telegram tickets. Fix every blocker or major.
4. **Wave 3 — launch (authorized by the owner, D4):** commit with clear messages; update SSOTs per plan §5; merge to `main` and
   push; watch the Vercel production deploy reach Ready (Vercel MCP or CLI); smoke the routes; run
   `scripts/x-content/apply-ue-rights-policy.mjs` dry-run then `--write` (D1, authorized); trigger one daily-loop worker run with
   `CRON_SECRET` (free, no model) and confirm the run doc. If the deploy errors, roll back to the previous production deployment
   and report.

**Hard limits:**
- No live X posting.
- No X API calls.
- No paid model calls in automated paths.
- No Telegram bot creation, env writes, `setWebhook` or messages.
- No changes to `client_configs` or the `undergroundexistence-0CsKkpaq` client.
- Don't approve the Client Brain.
- Corpus refresh stays the existing Mac-worker queue.
- Test drafts use the `[CM test]` prefix and are dated ≥30 days out.
- Vercel env writes through the raw REST API are blocked; leave them to the owner.

**Final handoff (concise):**
- branch, commits, merge SHA, deploy id and URL;
- what each wave delivered;
- test and review evidence;
- the D1 counts;
- the daily-run proof;
- a 5-step owner walkthrough: X Strategy → Content tracks → add a music benchmark → run the Mac refresh worker
  (`node scripts/x-content/strategy-refresh-worker.mjs`) → regenerate today → review in Content Engine / Telegram;
- the remaining owner gates: Telegram activation steps from the SSOT, `TWITTER_*` Preview untick, live-posting pilot;
- honest limits.
