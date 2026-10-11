# X Strategy T0 spikes (2026-10-11)

No X API / ScrapeCreators / model / Firestore / bird calls were made. Spike 2 is code-derived only.

## Contracts
`features/x-strategy/contracts.js` (exported via `index.js`). Defaults derived, not copied: `authoredPerDay` = `DEFAULT_ENGINE_CONFIG.authored.targetPerDay` (4); `typeFloors` = slots.js `DEFAULT_TYPE_FLOORS` (imported, direction clean: x-strategy -> daily-loop, no cycle); slot types = `Object.keys(STRATEGY_PRIORITY)` (7).
Note: `tier` uses new `tierForAuthoredPerDay` (tier the cadence sits in; 4/day -> 1), NOT `resolveTier`, which returns the next step up (4/day -> 2) and would misplace the default plan. Test pins both.

## Spike 1 - split `main` into `ingestHandle`: YES, ~40-55 changed lines, no CLI change
Entangled in `main` (ingest-corpus.mjs:111-196):

| Concern | Where | Handling |
|---|---|---|
| argv | `parseArgs(process.argv)` | stays in CLI wrapper |
| `process.exit(1)` x3 | no handle, bad `--source`, zero posts | wrapper maps thrown/returned errors to exit 1; core throws `Error` |
| `process.stderr.write` progress | main + `pullTimeline` (per-round, failures) | inject `log(line)`; CLI passes stderr writer |
| `process.stdout.write` summary | after stats | stays in wrapper, formats from returned `{rows, stats, watchlist, meta}` |
| file write `--out` | `writeFileSync` | stays in wrapper |
| `--write` -> `saveCorpus` (dynamic import, Firestore) | end | stays in wrapper (strategy path writes via corpus-store instead) |
| bird resolution + `execFileSync` | `resolveBird`, `pullTimeline` | inject `runBird(args) -> stdout string`; default impl = current resolveBird+execFileSync |
| clock `Date.now()` for `since` | main | pass `now` or compute `since` in wrapper |

Proposed boundary (new `features/x-strategy/ingest.js`, ESM; script becomes a thin caller):
```js
export async function ingestHandle({ handle, tz = 0, days = 65, since, rounds = 12, lanes = [], runBird, log = () => {}, now = Date.now() })
  // -> { rows, dropped, stats, watchlist, meta, since }   throws on empty handle / zero posts
```
Moves into it: `pullTimeline` (paging loop, JSON sniff, dedupe, cutoff) parameterised on `runBird`, plus normalize -> summarize -> deriveWatchlist -> meta build. Stays in script: argv, `--source` check, `resolveBird`/default `runBird`, console summary, `--out`, `--write`, exit codes. Risk: pullTimeline's `break`-on-error semantics (partial results kept) must be preserved - characterize with a fake `runBird` before moving. Caveat: `rounds` arg exists (`--rounds`), MAX_ROUNDS=12 is the default.

## Spike 2 - seb__design pull time (MEASURED=false; measurement pending until bird 429 clears)
Formula: `T = rounds_used x (pages x delay + pages x t_req) + inter-round overhead`, with `delay` applied between pages.

| Input | Value (source) |
|---|---|
| MAX_ROUNDS | 12 (ingest-corpus.mjs:41) |
| `--max-pages` | 10 per round (line ~81) |
| `--delay` | 1200 ms between pages |
| `-n` | 200 posts per round |
| posts to cover | 782 posts in window per research -> ~4 rounds at <=200/round (matches plan's "4 bird rounds") |
| t_req (assumed, UNMEASURED) | 0.3-1.0 s/page |

Per round: 10 x 1.2 s = 12 s delay + 10 x (0.3-1.0) = 3-10 s -> ~15-22 s. 4 rounds -> ~60-90 s; worst case 12 rounds -> ~180-265 s. Note `-n 200` with 10 pages may stop earlier than 10 pages (bird pages ~20/page, so 200 posts ~10 pages), so ~10 pages is the realistic figure.
Conclusion: estimate is borderline (60-90 s typical, >120 s whenever more than ~5 rounds or any 429 backoff) and exceeds the Vercel/route-friendly bound with retries. Per the plan rule and for safety: **refresh is always async (queued + polled), even on localhost.** Re-measure with one real pull once the 429 clears; update this table.

## Spike 3 - bird detection from the Next server (:3003)
| Check | Result |
|---|---|
| Listener | `next-server (v16.2.9)` PID 78504, parent 78502, user bballi |
| cwd | `/Users/bballi/Documents/Repos/Bballi_Portfolio-daily-loop` |
| HOME / PATH of that process | NOT VERIFIED: `ps eww` returned no environment in this agent shell. Same user as the shell, so `HOME` is almost certainly `/Users/bballi` |
| `resolveBird` candidate 1 `$HOME/.local/birdtool/node_modules/.bin/bird` | EXISTS (symlink -> `@steipete/bird/dist/cli.js`) |
| candidate 2 `cwd/node_modules/.bin/bird` | absent (daily-loop worktree and main repo) |
| `process.env.BIRD` | not set in this shell; server env unverified |
| bird config files | none: no `~/.config/bird/config.json5`, no `./.birdrc.json5`, no `~/.birdrc*`; no `BIRD_*` env in this shell |
| cookie source passed by repo code | none: `ingest-corpus.mjs` and all x-content scripts pass no `--cookie-source` |

Cookie-source risk: with no flag, env, or config, bird uses its built-in browser order (Safari/Chrome/Firefox via sweet-cookie; exact default order not verified). Safari cookies (`~/Library/Cookies/Cookies.binarycookies`) fail with EPERM for processes lacking Full Disk Access; Chrome cookies work from the shell with `--cookie-source chrome`. A Next server started from a terminal inherits that terminal's permissions, but one started by launchd/another parent may not, and Chrome keychain access may prompt. So a server-spawned bird can hit the same EPERM as Safari if Safari is tried first.
Recommendation:
- Detection (no network): `resolveBird()` path exists, then `execFile(bird, ['--version'])` with ~5 s timeout; do NOT use `whoami` (network). Report `{available, path, version}`; optionally a separate explicit "check auth" that is user-triggered.
- Cookie source: read `X_STRATEGY_BIRD_COOKIE_SOURCE` (default `chrome`) and append `--cookie-source <v>` in the server-side `runBird`; also allow `BIRD` path override (already supported). Document in the env section. Do not alter the existing CLI behaviour.
- Treat EPERM / 429 stderr as typed refresh failures (`cookie-access`, `rate-limited`) surfaced in the UI, and queue to the Mac worker.
