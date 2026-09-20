# X strategy — modelled on @seb__design, rebuilt for @bai_ee

> **Status:** research complete, strategy proposed. Nothing has been posted, scheduled, or published. No X API write has occurred.
> **Evidence base — the model:** [`docs/audits/seb-design-x-post-database.md`](../audits/seb-design-x-post-database.md) — 782 posts, 65 days (2026-07-07 → 2026-09-10), 150 posts with resolved view counts.
> **Evidence base — your baseline:** [`docs/audits/bai-ee-x-post-database.md`](../audits/bai-ee-x-post-database.md) — @bai_ee over the identical window and method, 246 posts, all 84 authored posts with resolved views.
> **Cost of the research:** 238 ScrapeCreators credits ≈ **$0.45** for both audits. Zero X API spend (repo policy [`X-API-AND-PROFILE-OPERATIONS.md`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) §2c).

---

## 1. Why this account is the right model

@seb__design is a solo freelance designer selling "brands & websites for founders" with a Calendly in the bio — the same shape of offer as yours, one tier smaller. He went from a standing start to **1,549 followers, and his 1,000th follower landed 2026-08-27 with a post saying "and all that in 2 months."** The corpus we captured *is* that growth run, start to finish.

That matters because it means the pattern below is not a survivorship story from an account that got famous elsewhere. It is a repeatable cold-start mechanic, executed in public, in the design niche, in 2026.

**His median post reaches 1.4× his follower count. His top post reached 44×.** The gap between those two numbers is the entire strategy.

---

## 2. The mechanic, in one paragraph

He posts ~12 times a day. Most of it is filler that does nothing. The reach comes from **quote-tweeting other people's visually striking design work with a caption under 50 characters**, which borrows the original poster's audience — and from **short video of his own work**, which converts that borrowed attention into follows. Static images and links are actively harmful. He has never used a hashtag.

---

## 3. What the numbers actually say

### 3a. Format decides reach. Nothing else comes close.

| Post type | n (sampled) | Avg views | Avg likes | Engagement rate |
|---|---:|---:|---:|---:|
| **`quote-react`** (QT + caption ≤90 chars) | 38 | **11,451** | 178.5 | 1.37% |
| `quote-commentary` (QT + longer take) | 12 | 6,535 | 90.7 | 1.47% |
| **`original-showcase`** (own work + media) | 58 | 4,997 | 102.6 | **3.00%** |
| `self-quote` (re-surfacing his own post) | 10 | 4,126 | 79.5 | 2.60% |
| `original-text` (text only) | 29 | 1,998 | 41.3 | 2.39% |
| `reply` | 3 | 95 | 1.3 | 1.71% |

Read that table as two jobs, not one ranking:

- **`quote-react` is the reach engine.** 5.7× the impressions of a text post. It works because you are not broadcasting to your 1,500 followers — you are appearing in front of the 50,000 people already looking at the post you quoted.
- **`original-showcase` is the conversion engine.** Less reach, but **2.2× the engagement rate** of a quote-react. This is where borrowed attention turns into a follow.

Run only quote-reacts and you get impressions that never become an audience. Run only originals and nobody sees them. The mix is the point.

### 3b. Video beats images by 3.6×. Images are worse than no media at all.

| Media | n | Avg views | Avg likes |
|---|---:|---:|---:|
| **video** | 29 | **8,073** | 161.3 |
| none | 83 | 7,058 | 112.1 |
| image | 37 | 2,240 | 49.5 |
| gif | 1 | 105 | 2.0 |

A static image costs you roughly two-thirds of the reach a plain text post would have gotten. If the work moves, post the motion.

### 3c. Topic veins are wildly unequal

| Topic vein | Posts | Avg likes |
|---|---:|---:|
| **japanese / asian design** | 23 | **187.4** |
| retro / analog / pre-internet | 27 | 65.7 |
| motion / animation / web interaction | 88 | 59.6 |
| own work & process | 45 | 47.7 |
| personal vulnerability | 8 | 43.1 |
| client work + credits | 53 | 41.2 |
| editorial / typography | 56 | 39.7 |
| tools (figma, shaders, plugins) | 44 | 38.8 |
| craft advice | 10 | 36.2 |
| anti-AI-slop stance | 19 | 35.2 |
| freelance / business | 80 | 31.9 |
| platform meta (X vs LinkedIn, algo) | 41 | 26.1 |
| industry hot takes | 15 | 25.7 |
| **untagged filler** | **441** | **13.8** |
| audience questions | 14 | 12.6 |

**56% of his posts are filler averaging 13.8 likes.** The whole account is carried by a narrow band of *visual-culture awe* — Japanese design, pre-internet craft, motion. Four of his top seven posts are literally the same move: quote a Japanese design piece, write six words.

Note what does **not** work: audience questions (12.6), platform meta (26.1), hot takes (25.7). The "engagement bait" playbook underperforms his own baseline.

### 3d. Mechanical rules he follows without exception

| Rule | Evidence |
|---|---|
| **Never a hashtag** | 0 of 603 own posts |
| **Never a link in the main post** | 6 of 603 (1.0%). Link posts avg **20.5** likes vs **36.5** without — a 44% penalty |
| **Links and credits go in a self-reply** | 27 threads; the pattern is always `[media + caption]` → reply → `"check it out: <url>"` / `"dev by @…"` |
| **Short** | Original posts median **117 chars**. Quote captions median **46 chars** |
| **Lowercase** | 74.8% start lowercase (avg 41.3 likes vs 23.8 for uppercase starts) |
| **Emoji, sparingly** | 26.2% of posts |

⚠️ The lowercase number is correlation, not proof. Lowercase co-occurs with his casual quote-reacts, which win for other reasons. Treat casing as voice, not as a lever.

### 3e. Timing

All times **CEST (UTC+2)**, his local. Peak hours by average likes, restricted to hours with ≥20 posts:

| CEST | UTC | ET | PT | Posts | Avg likes |
|---|---|---|---|---:|---:|
| 13:00 | 11:00 | 07:00 | 04:00 | 61 | **51.8** |
| 16:00 | 14:00 | 10:00 | 07:00 | 36 | **50.9** |
| 10:00 | 08:00 | 04:00 | 01:00 | 57 | 44.2 |
| 17:00 | 15:00 | 11:00 | 08:00 | 66 | 42.3 |
| 14:00 | 12:00 | 08:00 | 05:00 | 54 | 34.6 |
| 22:00 | 20:00 | 16:00 | 13:00 | 29 | 41.1 |

The pattern is not "his morning." It is **the European afternoon / US morning overlap** — when both design audiences are awake. His dead zones are 23:00 (8.7) and 07:00–08:00 (9.8/10.8) CEST, which are exactly the hours only one continent is up.

Weekdays are close, with a tilt: **Sunday is his best day** (46.5 avg likes across 109 posts), Friday his worst (14.3). Weekend design-scrolling is real.

---

## 4. Where you are stronger than him — and where you are weaker

**Your unfair advantage: he curates, you can generate.**

His reach engine depends on finding someone else's beautiful object every day. Your Studio work *is* the beautiful object, and it is natively video — the exact format that outperforms images by 3.6×:

- **HOLO PAPER / ClothStudio** — cloth sim with grab/fling, rebound, rumple, MP4 export
- **PaintStudio**, shader and WebGPU/TSL work
- **LoopStudio** — audio slicing, SP-16 `.scn` export, EditTrax player
- **Invoice Studio** — three themes, print-correct pagination, a holographic paper layer
- **Video Promo / Mockup Studio** — GPU renders on Cloud Run
- **Site Recreate** — a live site cloned to an exact static mirror
- **Underground Existence** — a rave/music archive nobody else on design X owns

seb has to go looking for content. You have a content generator sitting in your repo.

**Your weakness: he posts 12× a day and you are building a platform.** Volume is his moat and it is the hardest part of this to copy. Section 6 handles that honestly.

**Second weakness: your veins are narrower than "Japanese design."** Generative art and music hardware have smaller audiences than "beautiful poster." Section 5 picks veins that are adjacent to the big ones rather than niche-locked.

### Measured baseline — what @bai_ee actually looks like today

Full audit: [`docs/audits/bai-ee-x-post-database.md`](../audits/bai-ee-x-post-database.md). Same 65-day window, same method.

| | @bai_ee | @seb__design |
|---|---:|---:|
| Followers | **1,725** | 1,549 |
| Posts in window | 246 | 782 |
| Authored posts (non-RT) | **84** | 603 |
| Retweet share | **66%** | 23% |
| Replies (visible) | **4** | 33 |
| Median post views | **67** | 2,242 |
| Median reach vs followers | **0.04×** | 1.45× |
| Avg likes/post | **0.84** | 28.03 |
| `original-showcase` engagement rate | **3.36%** | 3.00% |

**You have more followers than him and 1/36th the engagement.** But the last row is the one that matters: when your work is actually seen, it converts *better* than his. **This is a distribution problem, not a content problem** — which means the strategy below is aimed at the right target, and the five fixes in §4b come before anything else in this document.

### 4b. Fix these five before optimising anything else

Ordered by leverage per unit of effort:

1. **Stop retweeting; quote-react instead.** 162 of your 246 posts were retweets. A retweet earns you no impression — X credits the view to the original author. The same click as a quote-tweet with a six-word caption produces an authored post that can reach.
2. **Fix your quote targets.** Your quote-reacts average **100 views**; his average **11,451**. Identical format. The difference is entirely who you quote — he picks accounts whose posts are already going viral, you picked `@sheherenow_`, `@kaolti`, `@Peal8888`. This is the cheapest fix on the list.
3. **Reply 10× a day.** Four replies in 65 days is the single clearest cause of zero new audience. Replies are the only mechanism that reaches people who do not already follow you.
4. **Cut politics and crypto-rug content.** 4 political posts, 0 likes, 59 avg views — and they teach both the algorithm and your followers that this is not a design feed. 18 crypto/rug posts do the same. Post them from a different account or not at all.
5. **Post video.** Video gets **4× the reach** of text on your account (339 vs 82 avg views) and you posted 26 videos in 65 days while owning a repo that emits video on demand.

Blue verification is a sixth item, and the only one that costs money rather than habit. His account is 17 years younger than yours and outperforms it 35×; verification is part of that gap.

---

## 5. Your content pillars

Mapped one-to-one onto what actually performs, ordered by expected return.

### P1 — Curation-react *(your reach engine — the `quote-react` slot)*
Quote-tweet visually striking work with a caption under 50 characters. **This is the single highest-leverage habit in the whole document** and it costs you five minutes a day.

Veins to work, chosen because they inherit the audiences that already perform:
- generative / shader / demoscene art
- mechanical and analog objects — synths, drum machines, film cameras, transit signage
- rave, club and record-sleeve design (your archive makes you credible here, not a tourist)
- Swiss / editorial print and typography
- Japanese design — the highest-performing vein on X design, and open to anyone

Template: `[six-word reaction] 😮‍💨` and nothing else. Do not explain. Do not add your own link.

### P2 — Tool artifacts *(your conversion engine — `original-showcase`, video only)*
Short screen-captured video of something you built doing something satisfying. No voiceover, no intro card, no logo. Under 15 seconds.

- cloth grabbed and released, showing real Verlet rebound
- paper crumpling, then flattening
- a break sliced into 16 pads, dropped onto hardware
- an invoice rendering onto simulated paper
- a site cloned live, side by side with the original

Credits and links go in the **first self-reply**, never the post.

### P3 — Build-in-public *(`original-showcase` / `original-text`)*
The specific, weird decision — not the roadmap. "I put a cloth simulation in my invoice generator" is a post. "Excited to share our latest update" is not.

### P4 — Craft advice *(`original-text`, occasionally video)*
Design-engineering specifics only you can write: browser print pagination, why a WebGPU scene reads cheap, deterministic render vs browser capture, cloth-sim stability. Concrete, numbered, no throat-clearing.

### P5 — Craft-vs-slop *(`original-text`)*
The anti-AI-slop vein performs (35.2 avg) and you are unusually credible in it: you build AI tooling *and* hand-build graphics. That tension is the post. Do not become the guy who only posts this — 19 posts over 65 days is his rate, and it is about right.

### P6 — Music-tech crossover *(`original-showcase`, video)*
Loops, SP-16, EditTrax, the Arweave archive. Lowest reach ceiling, highest differentiation. This is what makes you *not* another design-twitter account. Run it at low volume and let it compound.

**Deliberately excluded:** audience questions (12.6 avg), platform meta (26.1), generic hot takes (25.7). All three underperform his own baseline. Skip them.

---

## 6. Cadence — three tiers, pick one and hold it

His mix, normalised per day: `quote-react 2.8 · retweet 2.7 · original-text 2.6 · original-showcase 2.3 · quote-commentary 0.7 · reply 0.5 · self-quote 0.2`.

Do not start at 12 a day. You will stop in nine days and the account will read as abandoned. Consistency beats volume — his one bad stretch (2026-08-03 week, 43 posts, 15.5 avg likes) recovered only when volume came back.

| | **Tier 1 — Sustainable** | **Tier 2 — Competitive** | **Tier 3 — Full seb** |
|---|---|---|---|
| Posts/day | **5** | **8** | **12** |
| quote-react (P1) | 2 | 3 | 4 |
| original-showcase (P2/P6) | 1 | 2 | 2 |
| original-text (P3/P4/P5) | 1 | 2 | 3 |
| retweet | 1 | 1 | 2 |
| replies to others | ≥5 | ≥10 | ≥15 |
| Realistic effort | ~25 min/day | ~45 min/day | ~90 min/day |

**Start at Tier 1 for two weeks.** Move up only after you have held it without a gap.

**On replies:** our corpus shows only 33, but X's profile timeline hides most replies — his 10,575 likes given and 648 following say the real number is far higher. Replies are almost certainly a larger part of his engine than this dataset can prove. Treat the reply row as a floor, and note that it is the one number in this document we could not measure.

### Density — do not ration posts per hour

Measured, because the intuitive rule here is wrong:

| | @seb__design | @bai_ee |
|---|---:|---:|
| Posts per **occupied** hour | **1.96** | 1.31 |
| Occupied hours containing 2+ posts | **47.5%** | 23.4% |
| Share of posts landing in a doubled-up hour | **73.3%** | 41.5% |
| Most posts in a single hour | **11** | 5 |

**He doubles up constantly and it does not hurt him.** X's Author Diversity rule decays same-author posts inside *one ranked session*, not inside a clock hour — two posts sixty minutes apart are mostly competing for different sessions, and when they do share one, the second is discounted rather than dropped. It still reaches every viewer whose session missed the first.

So the shape to copy is **~2 posts per active hour, and more hours as volume grows** — not a spacing rule. At Tier 2, 8 posts across 4–5 hours matches his density.

⚠️ Note the trap: his "6.0 distinct hours per day" against your 3.1 is mostly an artifact of posting 3.2× more, not a separate discipline. Normalised per occupied hour he is *denser* than you. Don't read the hour count as a cause.

### Daily slots

Anchor to the **European-afternoon / US-morning overlap**, which is where his performance concentrates. Adjust the local column to your own timezone:

| Slot | UTC | ET | PT | Content |
|---|---|---|---|---|
| A | 11:00 | 07:00 | 04:00 | quote-react |
| B | 14:00 | 10:00 | 07:00 | **original-showcase (video)** — your best slot, best content |
| C | 15:00 | 11:00 | 08:00 | quote-react |
| D | 20:00 | 16:00 | 13:00 | original-text |
| E | flexible | | | retweet |

Sundays get the strongest asset of the week. Fridays are worth the least — schedule your weakest post there or skip.

---

## 7. Mechanical rules — non-negotiable

1. **No hashtags. Ever.** He used zero in 603 posts.
   ⚠️ **Scope corrected 2026-09-20:** measured on design-Twitter only. `@toshioueki` tags every record post (`#vinyl #record #アナログ`) and performs fine, so this is a design-lane rule, not a law of the platform. Unresolved for the music lane — see [`x-copy-patterns.md`](../audits/x-copy-patterns.md) §5.
2. **No link in the main post.** Put it in the first self-reply. Costs you 44% of engagement otherwise.
3. **Video over image, always.** A static image performs worse than posting nothing but text.
4. ~~**Keep it short.** Originals ~117 characters, quote captions ~46.~~
   ⚠️ **CORRECTED 2026-09-20 — this was wrong as stated.** Ranked by likes, his **top 30 average 265 chars / 3.9 lines**; the **bottom 200 average 102 / 1.9**. Short is the *losing* end. The 117-char median describes the whole corpus, most of which is filler.
   **Restated:** *quote captions* stay short (median 46 — the borrowed object carries the post), and *originals that win are longer and structured* — claim, line break, substance. Full table: [`x-copy-patterns.md`](../audits/x-copy-patterns.md) §1.
5. **Credits go in the reply**, with the post staying clean.
6. **Post every day.** Gaps cost more than any single post gains.
7. **Never explain the joke.** His best post is six words over someone else's image.
8. **Promo is not a post type.** Added 2026-09-20: across three accounts, event and release announcements are the worst-performing thing each publishes (`@toshioueki` 16–26 vs 100–235 for records; `@moorhaus_` ~60 vs 1,622). Gigs and releases belong in the self-reply and the bio. [`x-monetization-research.md`](../audits/x-monetization-research.md) §1–2.

---

## 8. Draft scoring — what the repo's own model says

Every draft below was scored through `scoreXPost` from [`features/x-growth/`](../../features/x-growth/) (deterministic, no LLM, no cost) against the `x-2026-05-15` algorithm profile.

| Score | Type | Draft |
|---:|---|---|
| 0.255 | build-in-public / video | shipped a cloth simulation into my invoice generator because i could not stop thinking about it |
| 0.253 | tool-artifact / video | sliced a break into 16 pads and dumped it straight to an SP-16 scene file. no daw involved |
| 0.238 | tool-artifact / video | grabbed the cloth and let go. the rebound is real verlet physics, not an easing curve |
| 0.238 | tool-artifact / video | every invoice i send now renders on simulated paper. absolutely nobody asked for this |
| 0.238 | craft-advice / video | print pagination in the browser is a nightmare nobody warns you about. here is what actually works |
| 0.233 | hot-take / text | hot take: most "AI design tools" are just a worse figma with a text box glued on |
| 0.220 | personal / text | i build design tools all day and still open figma to think. the tool you reach for first tells you what you actually trust |
| 0.208 | craft-advice / text | if your webgl scene feels cheap it is almost always the lighting, not the geometry. three things that fixed mine: |
| 0.203 | quote-react / text | the mechanical engineering in this is unreal 😮‍💨 |
| 0.199 | ⚠️ hashtag control / image | new project drop 🚀 #design #webgl #creativecoding #threejs |
| 0.160 | ⚠️ link control / text | check out my new studio tool here https://… it does cloth simulation and more |

The two deliberately-bad controls land last, which is the scorer working. But note the important disagreement:

> ⚠️ **`scoreXPost` ranks quote-reacts near the bottom (0.203) while the data ranks them first (11,451 avg views).** The scorer measures engagement *per impression*; it has no model of borrowed reach, so it structurally undervalues short captions on someone else's post. Use it to sanity-check your originals. **Do not use it to decide whether to quote-tweet.** This is a real gap in `features/x-growth/` worth noting if that module is ever revisited.

---

## 9. First 30 days

**Week 1–2 — Tier 1, build the habit.** 5 posts/day. Assemble a list of 30–40 accounts worth quoting across the P1 veins (start from his: `@rare_jpg`, `@interiorsuckerr`, `@DesignReviewed`, `@csidearchives`, `@jmdsgn`, `@figma`, `@RaminNasibov`). Capture 10 short videos from Studio in one sitting so slot B is never blocked on you having something to post.

**Week 3–4 — Tier 2, find your vein.** 8 posts/day. By now you will have ~50 posts of your own data. Rank them the way we ranked his: which vein is *your* Japanese-design? Cut everything below your own median and double the top two.

**Ongoing.** Re-run the collection scripts against `@bai_ee` monthly and compare against this baseline.

**Success measures at day 30** — reach first, followers second, because reach precedes follows. Baselines are your real measured numbers, not targets invented for the doc:

| Measure | Today | Day 30 target | seb |
|---|---:|---:|---:|
| Median post views | **67** | **≥ 400** (6×) | 2,242 |
| Median reach vs followers | 0.04× | ≥ 0.25× | 1.45× |
| Authored posts / week | **9** | ≥ 35 | 65 |
| Retweet share | **66%** | ≤ 25% | 23% |
| Replies / week | **0.4** | ≥ 35 | 3.6 (floor) |
| `original-showcase` ER | **3.36%** | hold ≥ 3.0% | 3.00% |
| Gap days | 4 of 65 | 0 | 0 |

Do not target followers at day 30. At 67 median views there is no mechanism by which followers can move; reach has to come first, and every row above is a lever on reach. If median views clear 400 and engagement rate holds at 3%, followers follow on their own.

⚠️ Hold `original-showcase` ER at 3%+ as you scale volume. It is the one number where you already beat him, and the most likely thing to break when you start posting 5× more.

---

## 10. What this research could not establish

Stated plainly so nothing here is over-trusted:

1. **True reply volume.** X's profile timeline hides most replies. This is the largest measurement gap and it sits on the tactic most likely to matter.
2. **Follower attribution.** We know his follower count now and that he crossed 1,000 on 2026-08-27. We cannot see which posts converted — X exposes that to nobody but the account owner.
3. **A 90-day window.** X stopped paginating at 65 days for this account. Everything is Jul–Sep 2026.
4. **Views on the full corpus.** Resolved for 150 of 782 posts — the top ~100 plus a random control. View averages are safe for comparison *within* that set and biased upward outside it. Backfilling all 782 would cost ~630 more credits ≈ **$1.20**.
5. **Off-platform effects.** We cannot see whether the Calendly in his bio actually converts. Reach is not revenue, and this document optimises reach.

---

## 11. Reproducing / extending this

The full pipeline is committed at [`scripts/x-content/research/`](../../scripts/x-content/research/) with setup, cost policy and per-script notes in its [README](../../scripts/x-content/research/README.md).

```bash
cd scripts/x-content/research
node pull-timeline.mjs @handle 2026-06-10T00:00:00Z   # free — bird CLI, browser cookie auth
MAX_CREDITS=150 node backfill-views.mjs               # only script that spends; hard-capped
node analyze-corpus.mjs                               # -> docs/audits/*.json + *.csv
node build-database-doc.mjs                           # -> docs/audits/*.md
node score-drafts.mjs                                 # free, deterministic
```

**To baseline yourself:** change `HANDLE` / `TZ_OFFSET_HOURS` / output filenames at the top of `analyze-corpus.mjs` and `build-database-doc.mjs`, point them at `@bai_ee`, and diff against this document monthly.
