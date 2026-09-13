# X growth system — SSOT

How the X work fits together: what measures the account, what decides a post, and what publishes it.

Built 2026-09-10. The account is **@bai_ee** (`bryan-balli-WUoltG84`). The goal is creative enquiries into HITLOOP.

> Three docs own different slices and none of them repeat each other:
> - **This doc** — the map, the strategy, the guard, the calendar. Start here.
> - [`X-MONITOR-CARD.md`](./X-MONITOR-CARD.md) — the live measurement card. Owns its own data model, cost model and traps.
> - [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) — **the spend gate.** Read §0 before anything that writes.

---

## 1. The three layers

| Layer | Question | Where it lives | Status |
|---|---|---|---|
| **Measure** | Is the account growing, and what worked? | `x-monitor` card (live, forward) + the research corpora (one-off, backward) | card built, **never synced**; corpora complete |
| **Decide** | Should this post go out, and is it any good? | `features/x-content-guard/` + `features/x-growth/` | built, tested, **not wired** |
| **Publish** | Getting it onto the timeline | 15-day calendar → `social_posts` drafts → Copywriter card → manual Post Now | drafts seeded, posting **manual** |

Nothing in the Decide or Publish layer is automated. That is deliberate — see §7.

---

## 2. Why this exists — the finding

@bai_ee has **1,725 followers against the model account's 1,549**, and roughly **1/36th the engagement per post**. Measured over the same 65 days (2026-07-07 → 2026-09-10):

| | @bai_ee | @seb__design |
|---|---:|---:|
| Median post views | **66.5** | 2,205 |
| Median reach vs followers | **0.04×** | 1.45× |
| Authored posts (non-RT) | **84** | 603 |
| **Posts able to reach a non-follower** | **80** | **570** |
| Retweet share | 66% | 23% |
| Replies in 65 days | 4 | 33 |
| Pooled engagement rate | **1.84%** | 1.91% |

The last row is the whole argument: **conversion is level, reach is not.** This is a distribution problem, not a content problem — which is why the system optimises for volume of stranger-eligible posts rather than for better copy.

⚠️ **An earlier version of this analysis claimed @bai_ee's engagement rate *beat* the model's.** That used a mean of per-post ratios, which low-view posts inflate badly (1 like on 18 views = 5.6%). 75% of @bai_ee's authored posts are under 100 views, so the metric flattered it. Pooled by impressions the advantage disappears. Use pooled rates.

---

## 3. The strategy — "the work" vs "the casino"

The governing rule, and the one most likely to be got wrong by someone reading the topic labels instead of the posts.

**Bryan's web3 client work is his best content.** `work` lane = **514 avg views**, top of every lane. Both breakout posts (4,712 and 1,870 views) are Critters Quest design posts. Speculation chatter is dead (49 avg views).

- **The work** — marketplace UI, collection visuals, game economy design, token art direction, the EditTrax player. Design problems that happen to sit in web3. Post more of it.
- **The casino** — price, tickers as subject, rug stories, politics. Dead, and it blurs the author embedding the retrieval tower uses to surface you.

Two tests for any draft: *would this still be interesting if the client were a bank?* and *am I posting the artifact, or my affiliation?*

**Music is design output, not lifestyle.** `music-archive-dj` underperforms (103 avg views) because it is posted as mood — "sorting trax out kinda day". Sleeves, flyers, visualisers, SP-16 scenes and the slicer UI are artifacts a design audience reacts to.

Full strategy, campaigns, reply playbook and the algorithm ledger: [`docs/plans/X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md).

### Mechanics, all measured

| Rule | Evidence |
|---|---|
| No hashtags | 0 of 603 of the model's authored posts |
| No link in the main post | 6 of 603 (1.0%); link posts avg **20.5** likes vs **36.5** |
| Video over image | video out-reaches image **3.4×** *within the same post type* |
| Quote-react, not retweet | `OONRetweetReplyFilter` removes retweets for non-followers |
| Self-quote your winners | the model's **highest** type at 60.8 avg likes; @bai_ee used it once in 65 days |
| Don't ration posts per hour | the model puts **73%** of posts in an hour that already has one |

⚠️ **"Never post twice in an hour" was wrong and has been removed.** It was inferred from the confirmed Author Diversity rule and never checked against behaviour. Author Diversity decays same-author posts inside *one ranked session*, not inside a clock hour.

---

## 4. The guard — `features/x-content-guard/`

ESM, pure, zero network, never throws. Contract deliberately mirrors `features/not-the-rug-brief/guardian.js`.

```js
import { guardXPost } from '../features/x-content-guard/index.js';
guardXPost({ text, type, media, quotedText })
// -> { readyToPublish, hardBlock, lane, laneConfidence, needsLaneReview,
//      xGrowthScore, concerns[], flags[], reviewRequired, note }
```

`lane` ∈ `work | craft | music | infra | casino | politics | meta | unknown`.

| File | Role |
|---|---|
| `rules.js` | Rule tables. **The strategy is encoded here**, with the reasoning in comments. |
| `guard.js` | `guardXPost`, `classifyLane`. Five checks + the verdict. |
| `__tests__/guard.test.js` | 16 tests. Fixtures are **verbatim real posts** — see the trap below. |
| `scripts/x-content/research/replay-guard.mjs` | Replays all 246 real posts. **This is the real test.** |

### ⚠️ The trap: hard-blocks must stay narrow

A broad crypto regex produced **~50% false positives** — it flagged a freelance-pricing retweet and, worse, the **1,870-view Critters Quest portfolio post**, because `$QUEST Pre-mine` is a *line item in a list of shipped features*. `pre-mine`, `tokenomics`, `staking`, `airdrop`, `market cap` are therefore `AMBIGUOUS_CASINO` → major flag, **never a block**.

A second false positive: `PRICE_CONTEXT_RE` allowed bare `long|short|up|down` with an optional digit, so **"2 years is a long time to be in dev"** matched as price framing. Every branch now requires a number, a `%`, or an unambiguous trading phrase.

**A truncated unit-test fixture hid the first one.** The replay harness caught what the shortened test could not — keep fixtures verbatim, and treat the replay as the gate.

The *"is the subject the artifact or the asset?"* judgment **cannot be done with regex.** It is exposed as `needsLaneReview` for a model pass that is not built.

**Current replay: 6 hard-blocks / 246, 0 false positives, 94.3% needs lane review.** That last number is high because 179 posts classify `unknown` — mostly short-text retweets. It matters less for calendar drafts, which arrive with a known lane.

---

## 5. The calendar and seeder

`docs/audits/x-calendar-15day.json` — 15 days, 120 slots, every slot carrying `type`, `lane`, `copy`, `brief`/`asset`/`selfReply`, a `score` and a `guard` verdict.

Verified: 0 over 280 chars, 0 hashtags, 0 inline links, 0 hard-blocks, 8 distinct hours/day, mean score 0.228. Lane split craft 42 / work 36 / music 24 / infra 18. **7 self-quote slots.**

```bash
node scripts/x-content/seed-calendar-drafts.mjs                                    # dry run
node scripts/x-content/seed-calendar-drafts.mjs --client bryan-balli-WUoltG84 --execute --days 7
```

**Safety properties — preserve these:**
- Writes `status:'draft'`, `scheduledAt:null`. The sweep only picks up `scheduled|queued|failed`, so **a seeded draft can never auto-publish**.
- **Zero X API calls.** Firestore only.
- Dry-run default; `--execute` required; refuses to run without `--client` rather than guessing a tenant.
- Re-guards every post at seed time even though the calendar was guarded at build time, because the file is hand-editable.

⚠️ `createSocialPost` enforces **280 characters**. Two fields have no home in `social_posts` and stay in the calendar JSON: **`selfReply`** (credits/links) and **`asset`** (what to film). Keep the JSON open while posting.

⚠️ The seeder must `require('features/not-the-rug-brief/load-env')` **before** importing `twitter-service.js`, or firebase-admin falls back to application-default credentials and every write fails.

---

## 5b. The dynamic calendar — `x-calendar` card

The static calendar cannot fill its own quote-react slots: the post you quote has to exist *today*. This layer scans for it.

| File | Role |
|---|---|
| `features/x-quote-targets/watchlist.js` | 39 accounts, vein-tagged. **Derived, not invented** — the accounts the model account actually quoted, weighted by likes earned. |
| `features/x-quote-targets/rank.js` | Pure ranking: velocity 40%, reach 22%, media 20%, freshness 10%, vein 8%. |
| `features/x-quote-targets/day-plan.js` | Merges live candidates into the static calendar's quote-react slots. |
| `scripts/x-content/scan-quote-targets.mjs` | The scan. Local, free, dry-run default. |
| `scripts/x-content/install-scan-schedule.sh` | launchd job, 06:30 daily. |
| `app/api/dashboard/quote-targets/route.js` | GET free; POST `draft-quote` / `dismiss`. **Never calls the X API.** |
| `components/dashboard/XCalendarCard.jsx` | The panel. |

### ⚠️ Why the scan runs on a Mac and not on Vercel

`bird` authenticates with browser cookies, so it cannot run serverless. It is also the **only** path that sees fresh posts:

| Path | Fresh? | Cost | Serverless? |
|---|---|---|---|
| `bird` | ✅ chronological | **free** | ❌ cookies |
| ScrapeCreators | ❌ **0 posts <24h** for @rare_jpg — serves X's "most popular" module | $0.06/day | ✅ |
| X API `fetchHandleTimelines` | ✅ | **2 metered calls/handle**, untracked | ✅ |

So the scan runs locally and pushes to `dashboard_state/{clientId}.marketingBrief.quoteTargets`. **The dashboard only ever reads.**

### ⚠️ The quote window is 36h, not the 6h reply window

Measured across **216 real quote-reacts**: median target age **17.8h**, p75 24.4h, p90 36.7h — only **13% within 6h**. A reply needs a live conversation; a quote only needs a post still being read. Reusing `replyEarlyWindow`'s 6h would discard 87% of what works. Freshness is also a *weak* predictor (best quotes span 1.7h–268h), which is why velocity carries 40% of the score and raw age only 10%.

### ⚠️ Rate limits cap the scan at ~15 accounts

A 39-account sweep returned **HTTP 429 on 32 of them**, even paced at 4s. `--max-accounts` defaults to **15**, proven accounts first, with `--offset` to rotate the rest across days. A 429 triggers a 90s backoff and one retry, then reports as `rateLimited` (distinct from `failures`).

⚠️ **Not yet verified at full scale.** The pacing and tiering fixes are in, but X's limit was still exhausted from development when they landed, so a clean 15-account run has not been observed. Run it once manually before trusting the launchd job.

### Quote tweets are composed, not linked

`caption + "\n\n" + https://x.com/<user>/status/<id>` is how X builds a quote tweet. The guard exempts a **trailing** status URL from its inline-link flag (a mid-text link is still flagged), and both the route and `day-plan` truncate **the caption, never the URL**, to stay inside 280.

Slot `status`: `planned` (non-quote slot) · `ready` (candidate matched, **no draft yet**) · `needs-candidate` (nothing usable).

---

## 6. The research layer

One-off, backward-looking. Free except view backfill. Full runbook: [`scripts/x-content/research/README.md`](../../scripts/x-content/research/README.md).

| Artifact | What |
|---|---|
| `docs/audits/{seb-design,bai-ee}-x-corpus.{json,csv}` | 782 + 246 normalized posts |
| `docs/audits/{seb-design,bai-ee}-x-post-database.md` | The readable audits |
| `docs/audits/x-dashboard.html` | Self-contained visual dashboard. Rebuild with `build-dashboard-html.mjs` — **edit the template, not the page** |
| `docs/audits/x-dashboard-data.json` · `x-strategy-pack.json` · `x-audience-graph.json` | The three payloads it inlines |
| `docs/audits/x-guard-replay.json` | Guard replay output |

⚠️ **Timelines come from the `bird` CLI (browser cookie auth, free), not ScrapeCreators** — ScrapeCreators `/v1/twitter/user-tweets` returns **0 posts** for small accounts. Views backfill at 1 credit/post. Total research spend to date: **238 credits ≈ $0.45**, zero X API.

⚠️ **seb's views are a top-weighted sample** (150 of 782). Safe for comparison within that set, biased upward outside it. His daily/rolling *views* must never be charted as a time series — use likes, which are complete for all 1,028 posts.

---

## 7. What is deliberately not built

| Not built | Blocked on |
|---|---|
| Scribe (LLM elevation toward the model's shapes) | not started; ~$0.001/post |
| Guard wired into `app/api/social-posting/route.js` | not started |
| Dashboard panel for the calendar | not started |
| **Auto-posting** | **two gates — see below** |
| Merging the quote watchlist into `marketingBriefConfig.kols` | deliberate: `kols` drives Market Signals' mentions analysis for *all* clients — a different purpose and a shared surface |
| Video attach via Studio → `attach-media` | `attach-media` exists at `route.js:241` with **no UI caller** |

### ⚠️ Auto-posting has two independent blockers

1. **The spend gate.** Writes to @bai_ee are irreversible, credit-metered, and **invisible to the Operating Cost card**. X-API-write trigger points: `twitter-service.js:565,599,608` and `adapters/x.js:45,47,64`.
2. **The cron cannot run this calendar.** `vercel.json:22-25` is **`40 13 * * *` — once daily** (Vercel Hobby limit). An 8-posts-a-day schedule is unschedulable on current infrastructure. Options: Vercel Pro, an external trigger (GitHub Actions / Cloud Run, patterns already in this repo), or batching.

⚠️ **CLAUDE.md documents this cron as `*/30 * * * *` with a 12h staleness guard. That is wrong** — it is daily, with a **26h** guard (`twitter-service.js:270`).

---

## 8. Neighbouring surfaces — who owns what

| Card | Owns | Does NOT |
|---|---|---|
| `x-monitor` | Reading growth, audience identities, post metrics | post, reply, follow, edit profile |
| `copywriter` | Drafting, scoring, enhancing, **manual Post Now**. Lists saved drafts — this is where seeded calendar drafts appear. | schedule at scale |
| `x-profile` (Social Accounts) | Account connection, OAuth, bookmarks | draft or schedule |

`scoreXPost` (`features/x-growth/`) is shared by the Copywriter card, the guard, and Strategy Builder.

⚠️ **`scoreXPost` structurally undervalues quote-reacts** — it models engagement per impression and has no concept of borrowed reach, so it ranks the highest-reach format near the bottom. Use it on originals; do not use it to decide whether to quote-tweet.

---

## 9. Current state (2026-09-10)

- Research complete; dashboard published; strategy documented.
- Guard built and tested, **not wired**.
- **52 drafts seeded** (days 1–7) to `bryan-balli-WUoltG84`, source `calendar-15day`. Days 8–15 are in the file, unseeded.
- X Monitor card built but **never synced** — growth history only starts accruing from the first sync.
- Next step is a **7-day manual run**, then re-pull the corpus and check whether the thesis held before building anything else.

The bottleneck is cadence, not tooling. 84 authored posts in 65 days needs to become ~7/day. Everything unbuilt in §7 is scaffolding for a habit that does not exist yet.
