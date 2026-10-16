# Track Lists → Daily Signals — orchestration handoff (2026-10-15)

Status: approved for build. Orchestrator = Opus. Executors = Sonnet, one per phase. Owner = Bryan (approves each phase, performs every deploy).

## 1. Goal

Clients attach X lists to their content tracks in the Client Brain, the same way they attach benchmark handles. A free local pull turns those lists into ranked, track-tagged posts that feed three day-to-day surfaces: Today narratives, quote targets, reply targets.

## 2. Verified facts (2026-10-15, do not re-verify)

- `bird list-timeline <list-url-or-id> -n 100 --json` works with `--cookie-source chrome`. Returns 100 posts in one call. Cost $0. Shape per row: `{id,text,createdAt,replyCount,retweetCount,likeCount,conversationId,author:{username,name},authorId,media[]}`.
- `bird lists` (enumerate own lists) is BROKEN in bird 0.8.0 (`strato DecodeException`); 0.8.0 is latest. Clients therefore paste list URLs. Never depend on `bird lists`.
- bird binary: `~/.local/birdtool/node_modules/.bin/bird` (resolution already in `scripts/x-content/scan-quote-targets.mjs`).
- Owner's test lists (home client `bryan-balli-WUoltG84`):
  - `1299069903333285888` design/UI craft (22 authors, 66/100 inside 36h)
  - `1275110927726239748` AI builders (13 authors, 77/100 inside 36h)
  - `2097419339653595640` dance music (9 authors, 61% one aggregator, 17/100 inside 36h)
  - `16909` hip-hop/community (median likes 0; owner may drop)
- Sample pulls saved at the session scratchpad `lists/<id>.json` (may be gone; re-pull is free).
- The X API is NOT involved anywhere in this feature. ScrapeCreators is NOT involved.

## 3. As-built anchors (read before each phase)

| Concern | File |
|---|---|
| Track contract | `features/x-strategy/content-tracks.js` (`ContentTrack`, `normalizeContentTracks`, MAX_* caps) |
| Brain markdown rows | `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md` § Strategy Document, Content Tracks and Track Targets |
| Brain form | `features/client-brain/form-schema.js` (`content.contentTracks`, rowFormat pipe) |
| Brain ↔ settings sync, Brain-wins adoption | `features/client-brain/brain-sync.cjs` + `__tests__/brain-sync.test.js` |
| Track save (plan) | `features/x-strategy/plan-state.js` (calls `normalizeContentTracks`), `strategy-plan-apply` route — tracks live in `x_strategy_plans/{clientId}.plan.contentTracks`, NOT in `marketingBriefConfig.xGrowth` |
| Per-client watchlist | `features/x-quote-targets/client-watchlist.js` |
| Scan (local, launchd) | `scripts/x-content/scan-quote-targets.mjs`, `scripts/x-content/install-scan-schedule.sh`, `features/x-quote-targets/scan-plan.js` (15-fetch budget) |
| Ranking | `features/x-quote-targets/day-plan.js` (veins, 36h window, `dismissed`, `STALE_SCAN_HOURS`) |
| Readers (change together) | `app/api/dashboard/quote-targets/route.js`, `features/mcp/readers.js` |
| Narrative prompt section pattern | `features/content-context/market-signals.js`, `load-content-context.js` |
| Reply pool | `app/api/dashboard/recipe-run/route.js` (`contentKind:'reply-pool'`) |
| Config UI | `components/dashboard/x-content/ContentTracksPanel.jsx` (mounted via `StrategyPanel` → `StrategyDocumentCard`) |
| SSOTs to update | `docs/source-of-truth/CONTENT-TRACKS.md`, `docs/source-of-truth/X-GROWTH-SYSTEM.md`, `docs/source-of-truth/CLIENT-BRAIN-SOURCE-OF-TRUTH.md` |

> Amended 2026-10-15 (owner-approved): tracks save through the plan, not `marketing-brief/config`; UI is `ContentTracksPanel.jsx`.

## 4. Contract (frozen)

- Track gains `lists: [{ id: string(digits), label: string }]`. Max 3 lists per track, max 8 distinct across tracks. `id` parsed from `https://x.com/i/lists/<digits>` or bare digits.
- Brain row: `- label: Design | share: 50 | topics: a; b | benchmarks: h1; h2 | lists: 1299069903333285888=Design craft; 1275110927726239748=AI builders`. `lists` optional. Round trip must be lossless.
- Scan output: `dashboard_state/{clientId}.marketingBrief.listSignals = { generatedAt, method:'bird list-timeline (local, free)', byTrack: { [trackId]: { lists: [{id,label,fetchedAt,count}], posts: [...candidate shape...] } } }`. Trim at write: posts ≤36h old, ≤30 per list, ≤40% of a list's kept posts from one author.
- Candidate shape = the existing quote-target candidate shape plus `trackId`, `listId`, `source:'list'`.
- Day-plan: list candidates merge with handle candidates, vein = owning track, dedupe by post id, `dismissed` honored, stale when `generatedAt` older than `STALE_SCAN_HOURS`.
- Narrative: `features/content-context/list-signals.js` exporting `shapeListSignals`, `listSignalsPromptSection`, `LIST_SIGNALS_MAX_CHARS = 1500`, trigger label `From your lists`. Wired through `loadContentContext`.
- Reply pool: list posts appended with `ageHours`, `velocityPerHour`, `replyWindowOpen` computed the same way as today.
- Scan budget: a list counts as 1 fetch; lists fetched before handles; the existing 15-fetch budget remains the ceiling.

## 5. Phases

| # | Scope | Done when |
|---|---|---|
| P1 | Contract + Brain: `content-tracks.js` (plan save picks it up via `plan-state.js`), `form-schema.js`, `brain-sync.cjs`, markdown standard | normalize/parse/round-trip/adoption tests green; `npm test` no new failures; nothing reads `lists` yet |
| P2 | Collector: scan script list pass, `scan-plan.js` budget, write `listSignals` with trims, stale flag | `node scripts/x-content/scan-quote-targets.mjs --client bryan-balli-WUoltG84 --dry-run` prints per-list counts; real run writes the doc for home only after owner OK |
| P3 | Consumers: `day-plan.js`, both readers, `list-signals.js` + `loadContentContext`, reply pool | unit tests for merge/dedupe/dismissed/stale, prompt-section cap, reply enrichment; Today/quote-targets/reply pool show list posts on localhost against home |
| P4 | UI: per-track list chips in `ContentTracksPanel.jsx`, saves via the existing plan save (`strategy-plan-apply`, `changes.contentTracks`), syncs to Brain | add/remove chip round-trips to Brain markdown; stable DOM ids (`id="track-lists-config-row"`, `id="track-lists-chip-<trackId>"`) |
| P5 | Docs + owner test: SSOT updates, CLAUDE.md map entry paste block, owner runs the 3 lists on home | owner says pass |

## 6. Rules for every agent

- Work in a git worktree on branch `feat/track-lists-signals` off `main`. Never build in the main checkout while the owner's dev server runs.
- Never edit `DashboardPage.jsx`. Never add a library. Never call the X API or ScrapeCreators. Never write to X.
- No commits, pushes, deploys, env edits, launchd installs, or prod Firestore writes without the owner's explicit OK for that specific action. Dry runs first.
- Local `:3002` dev pattern talks to PRODUCTION Firestore. Do not touch `:3000`/`:3001`.
- `/api/worker/*` is unauthenticated locally. Never curl one as a compile check.
- Restart `npm run dev` after editing any `.cjs`.
- Keep established patterns: inline `style` props, mobile width standard, `id` on every edited container.
- Run only the test files you touched during a phase, then `npm test` once at the end of the phase. Report the counts.
- Stop after each phase. Report: files changed, exact behavior changed, what stayed untouched, verification run, manual test next, risks.

## 7. Owner checklist after P5

1. Brain Builder: add the 3 lists to `design` / `music` rows, save, confirm Brain markdown shows `lists:`.
2. Run the scan once by hand; confirm `listSignals` doc for home.
3. Open Today: a draft carries trigger "From your lists".
4. Quote targets: list posts appear with the track vein; dismiss one, confirm it stays dismissed.
5. Reply targets: run the recipe, confirm list posts are in the pool.
6. Decide: keep list `16909` or drop it.
