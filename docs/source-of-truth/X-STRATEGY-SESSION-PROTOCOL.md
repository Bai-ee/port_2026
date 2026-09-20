# X strategy session — protocol

How to start a **conversation** about X strategy with an agent: what to load, how to read the account for free, what is already decided, and what costs money.

This doc is the session contract. It owns no findings of its own — the evidence lives in the docs below and the live numbers come from a script. If something here contradicts them, they win.

| Doc | Owns |
|---|---|
| [`X-GROWTH-SYSTEM.md`](./X-GROWTH-SYSTEM.md) | The map: measure / decide / publish, the guard, the calendar, the per-client benchmark layer |
| [`../plans/X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md) | The strategy: format table, veins, cadence tiers, daily slots, 30-day targets |
| [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) | **The spend gate.** §0 before anything that writes |
| [`X-MONITOR-CARD.md`](./X-MONITOR-CARD.md) | The live measurement card and its traps |
| [`../audits/x-algo-review.md`](../audits/x-algo-review.md) + `features/x-growth/algorithm-profiles/x-2026-05-15.json` | The algorithm model — Phoenix actions, 9 assumptions with confidence labels |
| [`../plans/X-GROWTH-PRODUCTIZATION-PLAN.md`](../plans/X-GROWTH-PRODUCTIZATION-PLAN.md) | Why the analysis is functions (`features/x-benchmark/`) and not prose |

---

## 1. Boot — three commands, zero cost

```bash
bird whoami                                                        # ~/.local/birdtool/node_modules/.bin/bird
node scripts/x-content/session-brief.mjs --days 14                 # where the account stands now
node scripts/x-content/session-brief.mjs --benchmark seb__design   # + the A/B gap report
```

`session-brief.mjs` is read-only and free. It pulls one timeline page through `bird`, normalizes it with the **same** `features/x-benchmark/` functions the committed corpora were built with, and prints:

- **cadence** vs the tier targets, plus gap days (today excluded — the day is still in progress)
- **mix** by post type with `lift`, each type deltaed against the committed baseline corpus
- **rule check** — hashtags, inline links, image-only posts, over-long quote captions, guard hard-blocks, casino/politics lane
- **quote targets** — who got quoted and whether they are on the derived watchlist
- **A/B gap report** against any benchmark handle (`--benchmark`), via `compareToBenchmark`
- **what is not measured**, named explicitly so nothing gets filled in from memory

`--json` for the machine-readable payload. `--handle <account>` briefs any public account, not just `@bai_ee`.

⚠️ It is a **snapshot, not a re-baseline.** One page, no cursor chaining. To move the baseline itself:

```bash
node scripts/x-content/ingest-corpus.mjs --handle bai_ee --days 65 --write
```

---

## 2. Read paths and what each one costs

| Need | Path | Cost | Notes |
|---|---|---|---|
| Any account's recent timeline | `bird user-tweets` | **free** | browser cookies, local only, never serverless |
| A post, its thread, its replies | `bird read` / `thread` / `replies` | **free** | |
| Search X | `bird search` | **free** | |
| Followers / following of an account | `bird followers` / `following` | **free** | |
| X timelines via ScrapeCreators | — | — | **does not work at this account size.** Returns `{success:true, tweets:[]}`, verified 2026-09-12 |
| Views / impressions | `scripts/x-content/research/backfill-views.mjs` | 1 ScrapeCreators credit per post (~$0.0012) | hard-capped by `MAX_CREDITS` |
| Follower delta, who followed/unfollowed, private post metrics | `x-monitor` card **Sync now** | **≈3 X API calls**, spend-gated | invisible to the Operating Cost card |
| Any write (post, reply, follow, profile edit) | X API or `bird tweet`/`reply`/`follow` | irreversible + metered | see §3 |

---

## 3. Guardrails — non-negotiable in a session

1. **No writes without a fresh, explicit, per-batch approval.** This includes `bird tweet`, `bird reply`, `bird follow`, `bird unfollow` — `bird` is authenticated as the real `@bai_ee`, so its write commands are as live as the API's. Read commands only, by default. Full protocol: [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) §0.
2. **Never quote a number the session did not measure.** Views, replies and follower deltas are not on a bird timeline. If a claim needs one, say what it would cost to get it.
3. **Pooled engagement rate, never a mean of per-post ratios.** The averaged version flattered `@bai_ee` into "beating the benchmark"; pooled, the advantage disappears. Every `lift` in the system is likes-based for the same reason.
4. **`scoreXPost` is for originals.** It models engagement per impression and has no concept of borrowed reach, so it ranks quote-reacts — the highest-reach format measured — near the bottom.
5. **A share delta is not a recommendation.** Copying the benchmark's raw type mix scored **0.84×** on the real pair. Act on gaps carrying `increase`/`decrease`; `hold` and `investigate` carry no impact on purpose.
6. **Hard-blocks stay narrow.** A broad crypto regex produced ~50% false positives, including the 1,870-view portfolio post. `scripts/x-content/research/replay-guard.mjs` over all 246 real posts is the gate, not the unit fixtures.
7. **Topic labels are per-tagger.** Cross-account topic comparison is suppressed below 30% vocabulary overlap. Do not read a "0% of your output" topic as a finding without checking the taggers matched.

---

## 4. Already decided — do not relitigate without new evidence

Each of these was measured. Re-opening one costs the session its momentum; bring data instead.

- **"The work" vs "the casino."** Web3 *client design work* is the account's best lane (514 avg views). Speculation chatter is dead (49). The rule is subject matter, not industry.
- **No hashtags. No link in the main post** — link and credits go in the first self-reply.
- **Video over image.** A static image reaches *less* than plain text.
- **Quote-react, never retweet.** A retweet earns the account no impression at all.
- **Self-quote your winners.** The benchmark's highest-performing type; `@bai_ee` used it once in 65 days.
- **Density is not a lever.** The benchmark doubles up in an hour constantly. Author Diversity decays same-author posts within one ranked session, not within a clock hour. Volume is the lever.
- **Cadence tiers:** 5/day sustainable → 8/day competitive → 12/day full. Start at tier 1 and hold it before moving up.
- **The five fixes, in order:** stop retweeting · fix quote targets · reply daily · cut politics/rug content · post video. [`X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md) §4b.
- **Reach before followers.** At double-digit median views there is no mechanism by which followers can move. Day-30 targets are in §9 of the same doc.

---

## 5. The moves — what a session can actually do

| Move | Command / path | Cost |
|---|---|---|
| Where do I stand today | `session-brief.mjs --days 14` | free |
| **What do I post today** | `node scripts/x-content/day-view.mjs --posts 5` | free |
| What content do I own | `features/x-content-inventory/content-packages.json` + `validateInventory` | free |
| Why post this today | `features/x-content-inventory/triggers.js` (21 occasions) | free |
| What should I re-surface | `ledger.js` `pickResurrectionCandidates` — backfilled from post history | free |
| A/B against any account | `session-brief.mjs --benchmark <handle>` | free |
| Profile a competitor from scratch | `session-brief.mjs --handle <handle> --days 30` | free |
| Fix the quote targets | brief's QUOTE TARGETS block + `features/x-quote-targets/watchlist.js` | free |
| What is worth quoting right now | `node scripts/x-content/scan-quote-targets.mjs --limit 12` | free |
| Re-baseline the corpus | `node scripts/x-content/ingest-corpus.mjs --handle bai_ee --days 65 --write` | free |
| Derive a watchlist from a benchmark | `deriveWatchlist` (`features/x-benchmark/derive-watchlist.js`) | free |
| Score a draft | `scoreXPost` (`features/x-growth/`) — originals only | free |
| Guard a draft | `guardXPost` (`features/x-content-guard/`) | free |
| Interrogate the algorithm model | [`../audits/x-algo-review.md`](../audits/x-algo-review.md) + the profile JSON | free |
| Get view counts | `backfill-views.mjs` with `MAX_CREDITS` | ~$0.0012/post |
| Get follower/audience truth | `x-monitor` card → Sync now | ≈3 X API calls, **approval** |
| Post anything | Copywriter card → Post Now | **approval, irreversible** |

---

## 6. What the research still cannot see

State these rather than estimating around them.

1. **True reply volume** — X hides most replies on a profile timeline. This sits on the tactic most likely to matter.
2. **Follower attribution** — which post converted a follow is exposed to nobody but the account owner.
3. **Views on a bird corpus** — none carried; backfill is metered.
4. **Off-platform conversion** — reach is not enquiries. Everything here optimises reach.

---

## 7. Closing a session

If the session produced a decision, write it where the next one will find it:

- a change of **strategy** → [`X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md)
- a change of **rule the guard enforces** → `features/x-content-guard/rules.js`, then re-run `replay-guard.mjs`
- a change of **watchlist** → `features/x-quote-targets/watchlist.js` (or re-derive it)
- a change to **what a session loads** → this doc
- a fresh **baseline** → re-run `ingest-corpus.mjs --write` and note the date

Leave the numbers where they were measured. This doc stays a protocol, not a second copy of the findings.
