# X Strategy Tab — build log

Autonomous run 2026-10-11. Branch feat/daily-content-loop. Model budget: 30 calls / $2.00 (tally below).

Baseline (09be36e8): full suite 4208 tests, 4206 pass, 2 fail (vendor-api-lib, known).

Model tally: 0 calls, $0.00

## S6 — corpus merge, quote-react floor, copy window, quote-commentary
Gate: targeted suites 442/442; full suite 4244 tests, 4242 pass, 2 fail (known vendor-api-lib) — delta +36 tests vs baseline 4208.
Review findings (fresh reviewer): bug — merge overwrote null/non-metric fields (tags drifted on 60/135 rows, engagementRate nulled); fixed: metrics-only merge (METRIC_FIELDS), derived rate recomputed, 7 new tests. Contract — test re-pins weakened a real-pair claim; fixed: original topic-gap suppression test restored (6/23 shared labels). Nit fixed — floor never converts an adopted slot. Nits left: nextLetter/R collision (unreachable), weak noMedia assertion.
Live check: corpora bai_ee 246→262, seb__design 782→984 rows; rows with views 84→84, 150→150; 0 ids lost, 0 non-metric diffs vs HEAD. day-view shows quote-react slot D. Floor reason text appears only when the gap-report mix drops quote-react (covered by tests).
Caveat: final merge used the incoming files from the earlier real bird pull (bird hit Safari cookie EPERM on retry); merge logic is the shipped code. seb pull ended at 61 days (window slightly short of 65).

## T0 — contracts + spikes
Gate: x-strategy 24/24; full suite 4250 tests, 4248 pass, 2 fail (known) — +6 vs S6.
Review: contract-violation (PROPOSAL_KIND_ACTIONS 'xgrowth-save' invented) → now 'marketing-brief-config' with comment (existing xGrowth save endpoint, not a ROUTE_ACTIONS member). Nits fixed: dead test branch + tier boundary tests 7→1, 8→2; dropped unused TIERS re-export. Open note: plan has no tier-pin field (T1c/T2 resolve: tier is derived from authoredPerDay).
Decision: x-strategy/index.js stays PURE (client-safe). I/O modules (corpus-store, plan-store, ingest, refresh) are exported from features/x-strategy/server.js, never from index.js.
Spikes (docs/plans/x-strategy-t0-spikes.md): (1) ingestHandle split feasible, ~40–55 lines, needs characterization test first; (2) seb pull est. 60–90s (4 rounds), >120s with backoff → refresh ALWAYS async (queued+polled); MEASURED=false — bird returned HTTP 429 on 2026-10-11 (Chrome cookie source; Safari cookies EPERM) so no further bird calls until it clears; (3) bird path resolves from :3003 cwd (~/.local/birdtool), cookie source unset → env X_STRATEGY_BIRD_COOKIE_SOURCE default chrome; detect via resolveBird + `bird --version`, no network.
