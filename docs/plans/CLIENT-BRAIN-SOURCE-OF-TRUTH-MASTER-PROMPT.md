# Client Brain as Source of Truth — orchestrator prompt (autonomous, start to production)

You are the orchestrator. Finish this workstream **start to finish without stopping for approval**, then ship it to production. The owner tests in production. Read the plan first; it is the only source of truth:

`docs/plans/CLIENT-BRAIN-SOURCE-OF-TRUTH-MASTER-PLAN.md` (Phases 0–3a built, uncommitted; § "Target UX" + "Phase 6" = the rest).

Worktree: `/Users/bballi/Documents/Repos/Bballi_Portfolio-content-center`. Owner: admin account only. Base: `main` (currently `7ef8d210`).

## Owner decisions (2026-10-13, final — never re-ask)

1. **Target client = `bryan-balli-WUoltG84`** ("Hitloop · hitloop.agency" in the switcher). Holds the live Market Signals config (12 keywords, brandName Hitloop) and a wrong Brain (status `stale`, Markdown = Claire Calls). The owner injects the HITLOOP Markdown there in prod; approve then adopts settings once and syncs. `bryan-balli` is an orphan (no `clients` doc) — ignore it. Fix every inverted reference in the plan (open question 6, verification sections).
2. **Phase 3b = Brain owns the Strategy document and X content tracks outright.** Brain changes overwrite even a confirmed Strategy document; card edits write back. Safety = **versioned backups of the Brain Markdown** on every write.
3. **Phase 4 UI** = "From Client Brain" labels + Re-sync button + Generate recompiles from Markdown + export-route fix + Versions list.
4. **Phase 6** = agent-applied queue actions (propose approve / schedule / unschedule, owner confirms card), Brain-owned per-track cadence + mix targets, Today "act now" suggestions with trigger + inventory match. **6d repost/retweet is NOT built** (X write; needs a separate owner go).
5. **Ship when done:** commit, PR to `main`, squash merge, confirm the Vercel production deploy is Ready. You are authorized to do all of it in this run. Report deploy id + rollback id at the end.
6. Reference data for the HITLOOP Brain: `docs/company-brain/clients/hitloop/live-export-2026-10-13.md` (read-only snapshot, secrets redacted). Target Brain file: `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md`.

## Mindset

- POC. Works for the admin on `WUoltG84`. Good enough beats polished.
- **No excessive testing.** Gate = existing `npm test` green (2 pre-existing `studio-render` vendor-sync failures are allowed), `npm run build` (`--webpack`) green, and ONE 10-minute localhost smoke before merge (below). No new test suites. A unit test only for a pure function you wrote, if it takes minutes.
- **Minimal diffs.** Extend `features/client-brain/brain-sync.cjs` (manifest + STORES); reuse the versioned plan save (`x_strategy_plans` history, source `client-brain`), the Strategy-doc store's `history`, and the existing social-posting update/schedule functions. Never add a second sync path, queue writer, or publisher.
- **No paid calls from sync/adopt/write-back/re-sync/proposals**: no LLM, X API, ScrapeCreators, positioning bridge. Scripts read live Firestore read-only; **no live writes from scripts**. Writes happen only through the app when the owner clicks.
- The agent (in-app and MCP) only ever **proposes**; confirm cards apply. It never publishes, posts, replies, follows or spends.
- Admin-only behavior behind `isAdmin`; non-admin cards unchanged. Never edit `DashboardPage.jsx` while a local run is streaming. Build in this worktree only (`--webpack`), never in the main repo.
- No new libraries. No cron/publisher/reservation/guard/X-write changes. Keep CLAUDE.md, `.claude/`, `.mcp.json` untracked.

## Dispatch plan — run waves, parallelize everything inside a wave

Use as many Sonnet agents as the file boundaries allow. Each agent gets: plan path, this prompt, its wave item, its exact file list, and "touch only your files; return a diff summary + anything you could not do". You merge, build, and move to the next wave. Do not wait for the owner between waves.

**Wave 0 — orchestrator (15 min)**
- `git checkout -b feat/client-brain-sot` (carries the uncommitted work off the already-merged `feat/marketing-director-poc`).
- Fix the plan per decisions 1–5. Run `node scripts/client-brain/brain-sync-report.cjs bryan-balli-WUoltG84` read-only; add a `--markdown <path>` override if it is a few lines and run it against the local HITLOOP `CLIENT_BRAIN.md` too. Paste both into the plan's verification section.

**Wave 1 — 5 agents in parallel (disjoint files)**
- **A1 Version log** — `features/client-brain/store.cjs`, `app/api/dashboard/client-brain/route.js`: before any Markdown-changing save, write `clients/{clientId}/client_brain_versions/{ISO ts}` = `{ markdownSource (prior), status, reason: 'inject'|'adopt'|'card-edit:<target>'|'resync', byUid?, createdAtIso }`, keep last 50. GET `?action=versions` (ts, reason, size) and `?action=version&ts=`. Export a `recordBrainVersion(clientId, reason)` helper for brain-sync to call.
- **A2 3b manifest + stores** — `features/client-brain/brain-sync.cjs` only: add `strategyDoc` (thesis, audience, rules + any other settable text section in `features/x-strategy/strategy-doc.js`) and `contentTracks` (label, share, topics, benchmarks per track; engines/promotions stay; validate every engine in exactly one track, else keep current owner + `warnings[]`) and `trackTargets` (new Markdown section `Content › Track Targets`: per track posts/day, share per type original-showcase / original-text / reply / quote / self-quote, video share → plan `engineTargets` + track share). STORES write through the doc store's save and the versioned plan save with source `client-brain`. Add all to `adoptSettingsIntoMarkdown` and the report script. Call A1's `recordBrainVersion` before every Markdown write (stub the import if A1 is not merged yet; orchestrator wires it).
- **A3 Write-back hooks** — `features/x-strategy/route-handlers.js`, `features/x-strategy/strategy-doc-store.js` (save hook only): strategy-doc section saves and plan saves that touch tracks/targets call `recordCardEdits(clientId, 'strategyDoc'|'contentTracks'|'trackTargets', prior, next)`. Injectable like `onXGrowthSaved`; not wired in tests.
- **A4 Proposal kinds (6a)** — `features/x-strategy/contracts.js`, `agent/proposals.js`, `agent/tools.js`, `agent/prompt.js`: add `post-approve {postId, updatedAt}`, `post-schedule {postId, scheduledAt, updatedAt}`, `post-unschedule {postId, updatedAt}`; validate like `post-edit`; execute on confirm via the existing social-posting approve/schedule/update functions (ledger + reservations unchanged). Add `propose_post_approve` / `propose_post_schedule` / `propose_post_unschedule` to `PROPOSE_TOOLS` (MCP inherits 1:1; bump the pinned registry count in `features/mcp/__tests__`). Prompt rule: may propose approve / schedule / unschedule, each a card the owner confirms; never publishes, posts, replies, follows or spends.
- **A5 Markdown standard + HITLOOP Brain** — `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`, `CLIENT_BRAIN_FORMATTER_PROMPT.md`, `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md`: document the new sections (Strategy Document, Content Tracks, Track Targets) and fill them in the HITLOOP Brain from the live export (tracks, benchmarks, strategy doc, watchlist, keywords, opportunity queries). The X handle section = `bai_ee` (growth) — note in the file that the connected publishing account is @UGExistence.

Orchestrator: merge, wire A1↔A2, `npm test`, build.

**Wave 2 — 4 agents in parallel**
- **B1 Labels + Re-sync + Versions UI** — `components/dashboard/ClientBrainCard.jsx` + the owned-field renderers (Market Signals / Listening sections in `DashboardPage.jsx`, Email Digest in `components/AdminEmailModals.jsx`, Brand Overview, Strategy Builder, Strategy doc + tracks panels): tag `client-brain-owned-field-tag` ("From Client Brain", title "Editing writes back to the Client Brain"); `client-brain-resync-button` on APPROVED BRAIN → `POST /api/dashboard/client-brain/approve {status:'approved', resync:true}` (sync only, no adoption) → diff list `client-brain-sync-result`, which also shows `adoption.changes` once after approve/inject; `client-brain-versions-list` on BRAIN SOURCE with "Load into editor".
- **B2 Generate + export fix** — `features/client-brain/store.cjs` (`generateAndSaveClientBrain`: when `markdownSource` exists, recompile from Markdown and return `{mode:'markdown'}`), `app/api/dashboard/client-brain/export/route.js` (read digest from `digest_config/{clientId}` and Strategy Builder from `dashboard_state/{clientId}.strategyBuilder.config`), approve route `resync` flag.
- **B3 Proposal cards UI** — the Strategy chat proposal card component: render the three new kinds with post text, time and verb (`strategy-proposal-card-post-approve` etc.), reuse the existing card.
- **B4 "Act now" suggestions + evaluation (6b/6c)** — `DailySuggestionsPanel`, `regenerate-today` path, `features/x-strategy/{insights,evaluate}.js`, Results panel: each suggestion shows its trigger (hot narrative / opportunity / benchmark gap on a track / archive throwback), the matched inventory item, Save draft + Schedule (existing path). `get_evaluation` + Results show per track: benchmark profile vs Brain target vs actual last 14 days (cadence, type/media mix). Fill gaps only; if it already does it, say so.

Orchestrator: merge, `npm test`, build.

**Wave 3 — 2 agents in parallel**
- **C1 Docs** — new `docs/source-of-truth/CLIENT-BRAIN-SOURCE-OF-TRUTH.md` (ownership manifest incl. track targets, version log, adoption rule, re-sync, not-owned list, rollback = re-inject a version, operating loop: ask either agent → card → confirm → calendar, what the agent can never do, Telegram activation runbook, 6d not built); one-paragraph updates to `docs/company-brain/IMPLEMENTATION_PLAN.md`, `MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`, `EMAIL-DIGEST-CARD.md`, `X-STRATEGY-TAB.md`, `MARKETING-DIRECTOR.md`, `HITLOOP-MCP-SERVER.md` (new propose tools); plan status → shipped with the prod runbook (inject HITLOOP Markdown → read sync result → approve → Market Signals params → first paid Refresh).
- **C2 Smoke** — `npx next dev --webpack -p 3100` in the worktree, admin login, 10 minutes max: dashboard loads with no console errors; Client Brain card opens with Versions list + Re-sync button; Marketing Director Today / Queue & Calendar / Strategy open; Strategy chat loads; Market Signals shows the tag. **Do not approve or inject on `WUoltG84` locally if `.env.local` points at the prod Firebase project** — the owner does that in prod. Stop the dev server after.

**Ship — orchestrator**
- `git add -A` (exclude CLAUDE.md / `.claude/` / `.mcp.json`), commit, push, `gh pr create` to `main`, `gh pr merge --squash`, then verify the Vercel production deploy is Ready (`vercel ls --yes` from the main repo dir `/Users/bballi/Documents/Repos/Bballi_Portfolio`) and `https://hitloop.agency/login` returns 200. Update the local `CLAUDE.md` map entry to SHIPPED with deploy id + rollback id (previous production deploy).
- If `npm test` or the build fails on something you cannot fix in 30 minutes, stop and report instead of shipping.

## Final report (one message, compact)

- Commit, PR, merge sha, production deploy id, rollback deploy id
- Files changed (grouped by wave)
- Exact behavior changed (admin) / untouched (non-admin, crons, publisher)
- `npm test` + build result (name the 2 pre-existing failures)
- Live-data writes made: must read "none"
- Owner prod runbook: inject HITLOOP Markdown into Hitloop (`WUoltG84`) → read the sync/adoption result → approve → check Market Signals / Strategy doc / tracks → re-add the ChatGPT connector (new tools) → first paid Refresh
- Not built / risks: 6d repost, anything skipped and why
