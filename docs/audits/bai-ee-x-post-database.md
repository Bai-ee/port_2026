# @bai_ee — X post audit (2026-07-07 → 2026-09-10)

> Self-audit run on the **same window and same method** as the [@seb__design study](./seb-design-x-post-database.md), so the two are directly comparable.
> Strategy built on this: [`docs/plans/X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md)
> Machine-readable: [`bai-ee-x-corpus.json`](./bai-ee-x-corpus.json) · [`bai-ee-x-corpus.csv`](./bai-ee-x-corpus.csv) · [`bai-ee-x-stats.json`](./bai-ee-x-stats.json)

## 0. Account & provenance

| Field | @bai_ee | @seb__design |
|---|---|---|
| Display name | Bai-ee | seb-astian |
| Bio | Creative Lead @ HITLOOP | Brands & websites for founders that want to stand out |
| Account created | Wed Dec 31 15:58:46 +0000 2008 | Sun Apr 20 2025 |
| **Followers** | **1,725** | 1,549 |
| Following | 1,591 | 648 |
| Lifetime posts | 8,286 | 4,238 |
| Likes given | 22,977 | 10,575 |
| **Blue verified** | **NO** | yes |
| Bio CTA | https://bryanballi.info | Calendly discovery call |

| | |
|---|---|
| Window | 2026-07-07 → 2026-09-10 (65 days, 61 active) |
| Posts captured | **246** |
| View counts resolved | **84** — every authored post in the window (retweets excluded; their views belong to the original author) |
| Timezone | US Central (UTC−5), inferred from git commit offsets — 191 of 200 at `-0500` |
| Collection | `bird` CLI (free) + ScrapeCreators view backfill (85 credits ≈ \$0.16). **Zero X API spend.** |

---

## 1. The headline

You have **1,725 followers — 176 more than seb** — and roughly **1/36th of his engagement per post**.

| Metric | @bai_ee | @seb__design | Gap |
|---|---:|---:|---|
| Followers | **1,725** | 1,549 | **you +176** |
| Posts in window | 246 | 782 | 3.2× fewer |
| Posts / active day | 4.03 | 11.85 | 2.9× fewer |
| Total likes in window | **207** | 21,922 | **111× fewer** |
| Avg likes / post | **0.84** | 28.03 | **35× fewer** |
| **Median post views** | **66.5** | 2,205 | **33× fewer** |
| Median reach vs followers | **0.04×** | 1.42× | **37× fewer** |
| Best post (likes) | 31 | 1,585 | 51× fewer |
| Best post (views) | 4,712 | 67,975 | 14× fewer |

**Your median post is seen by 66.5 people. You have 1,725 followers.** That is 4% of your own audience — the algorithm is not delivering your posts even to the people who already chose to follow you.

---

## 2. The good news — this is a distribution problem, not a content problem

**Your engagement rate is level with his.** Pooled across every post that has a view count — total engagement over total views — you sit at **1.84%** against his **1.91%**. Statistically indistinguishable on this sample size.

| Post type | @bai_ee pooled ER | @seb__design pooled ER | @bai_ee n | @seb n |
|---|---:|---:|---:|---:|
| `quote-react` | **2.07%** ✅ | 1.63% | 26 | 38 |
| `quote-commentary` | **1.90%** ✅ | 1.55% | 14 | 12 |
| `original-showcase` | **1.68%** | 2.30% | 29 | 58 |
| `original-text` | **1.13%** | 2.47% | 10 | 29 |
| **ALL POSTS** | **1.84%** | 1.91% | 84 | 150 |

You lead on both quote formats; he leads on showcase and text. Overall it is a wash.

⚠️ **A correction to an earlier version of this document.** It previously reported that your `original-showcase` engagement rate (3.36%) beat his (3.00%) and concluded your content converts better. Those were *means of per-post ratios*, which a handful of very low-view posts inflate badly — a single like on an 18-view post scores 5.6% and outweighs a 40,000-view post. **75% of your authored posts are under 100 views**, so that metric flattered you far more than it flattered him. Pooled by impressions, the advantage disappears.

The corrected finding is not weaker — it is sharper. **Identical conversion, a thirty-third of the reach.** If your content converted *worse*, reach would be the wrong thing to fix. It doesn't, so it is the right thing to fix.

---

## 3. Why distribution is dead — five measurable causes

### 3a. Two-thirds of your output is retweets

| Type | @bai_ee | share | @seb__design | share |
|---|---:|---:|---:|---:|
| `retweet` | 162 | 65.9% | 179 | 22.9% |
| `original-showcase` | 29 | 11.8% | 155 | 19.8% |
| `quote-react` | 26 | 10.6% | 183 | 23.4% |
| `quote-commentary` | 14 | 5.7% | 48 | 6.1% |
| `original-text` | 10 | 4.1% | 169 | 21.6% |
| `reply` | 4 | 1.6% | 33 | 4.2% |
| `self-quote` | 1 | 0.4% | 15 | 1.9% |

**162 of 246 posts (66%) are retweets.** seb sits at 23%. A retweet produces no authored impression for you — X credits the view to the original author. You are spending two-thirds of your posting budget on content that cannot grow your account.

Authored posts in the window: **you 84, seb 603**. That is the real ratio, and it is 7:1 against you.

### 3b. You reply to almost nobody

**4 replies in 65 days.** seb's visible count is 33 and his true number is far higher (10,575 likes given, 648 following).

Replies are the only mechanism on X that puts you in front of an audience you have not already earned. Zero replies means zero new audience, which is exactly what the reach numbers show.

### 3c. Your quote-tweets borrow from accounts with no audience

The quote-react mechanic works by inheriting the quoted post's viewers. Same format, wildly different result:

| | @bai_ee | @seb__design |
|---|---:|---:|
| Avg views on `quote-react` | **100** | 11,451 |

He quotes accounts whose posts are already going viral (`@rare_jpg`, `@interiorsuckerr`, `@DesignReviewed`, `@jmdsgn`). Your quote targets in this window include `@sheherenow_`, `@kaolti`, `@Peal8888`, `@fintechfrank`, `@RockyRoark` — small or non-visual accounts. **The format is right. The targets are wrong.** This is the single cheapest thing on this list to fix.

### 3d. You are not blue verified, he is

X down-ranks unverified accounts in reply ranking and conversation surfacing. This is the one structural disadvantage on the list that costs money rather than effort, and it is worth noting that his account is 17 years younger than yours and outperforms it 35×.

### 3e. Your feed mixes audiences that repel each other

| Topic | Posts | Avg likes | Avg views |
|---|---:|---:|---:|
| `craft-opinion` | 10 | 3 | 842 |
| `web3-gaming` | 24 | 3.4 | 764 |
| `crypto-finance` | 18 | 2.3 | 244 |
| `music-archive-dj` | 36 | 1.4 | 103 |
| `client-work-status` | 14 | 1.6 | 94 |
| `untagged-riff` | 123 | 0.4 | 91 |
| `personal-life` | 6 | 2.8 | 83 |
| `platform-complaint` | 11 | 0.6 | 81 |
| `design-engineering` | 25 | 1 | 77 |
| `ai-tooling` | 30 | 0.6 | 69 |
| `us-politics` | 4 | 0 | 59 |

US politics: **4 posts, 0 likes, 59 avg views.** Not merely unproductive — posts like these teach the algorithm and your followers that your feed is not a design feed. Crypto/rug content (18 posts) does the same to a creative audience.

Meanwhile `design-engineering` — the thing you are genuinely world-class at — gets **77 avg views across 25 posts**, because you post it as plain text with no media.

---

## 4. What already works for you

Two posts broke out, and both are the same shape: **video + a specific shipped thing + structure.**

| # | Date (CDT) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-08-13 | 08:31 | Thu | original-showcase | video | web3-gaming, craft-opinion | Clones are going live at @crittersquest today!  ⏎ Some great threads are floating around, but the Marketplace is what I want to talk about, and the opportunity to explore a darker theme inside the CQ ecosystem. ⏎ It’s the… | 4,712 | 25 | 8 | 4 | 0.79 | [↗](https://x.com/bai_ee/status/2087894928726610403) |
| 2 | 2026-08-08 | 13:22 | Sat | original-showcase | video | web3-gaming, crypto-finance | "2 years is a long time to be in dev for @crittersquest" ⏎ ☠️ ⏎ •⁠  ⁠Multiplier Collection ⏎ •⁠  ⁠Multiplier Spins ⏎ •⁠  ⁠Quest for Terron (shards) ⏎ •⁠  ⁠Token Bound Master Editions ⏎ •⁠  ⁠Genesis Quest Staking ⏎ •⁠  ⁠The Gatherin… | 1,870 | 31 | 6 | 5 | 2.25 | [↗](https://x.com/bai_ee/status/2086156042614849984) |
| 3 | 2026-08-02 | 18:02 | Sun | original-showcase | image | music-archive-dj | Sorting trax out kinda day... https://t.co/pYOjkVOAiY | 315 | 4 | 0 | 1 | 1.59 | [↗](https://x.com/bai_ee/status/2084052238327005197) |
| 4 | 2026-08-06 | 22:58 | Thu | quote-react | none | untagged-riff | Quest Love **↪ QT @MagicEden:** _Critters on the move 👀_ | 306 | 10 | 0 | 1 | 3.59 | [↗](https://x.com/bai_ee/status/2085576368692056330) |
| 5 | 2026-08-05 | 21:25 | Wed | quote-react | none | untagged-riff | get u a founder that.., **↪ QT @beaniemaxi:** _@RoundyDoodle @enparadice Matt has extracted from himself literally and is all …_ | 303 | 9 | 1 | 0 | 3.3 | [↗](https://x.com/bai_ee/status/2085190465968574669) |
| 6 | 2026-08-17 | 12:04 | Mon | quote-commentary | none | untagged-riff | As a digital nomad, i started in print design and production. It has allowed me to wear many hats on the team. 👀 **↪ QT @crittersquest:** _Oh, hi there... CRITTERS!!! https://t.co/JhbvMHspXY_ | 224 | 5 | 0 | 0 | 2.23 | [↗](https://x.com/bai_ee/status/2089397914648936696) |
| 7 | 2026-08-13 | 13:46 | Thu | quote-react | none | web3-gaming, design-engineering, ai-tooling | directly to the @crittersquest inspo folder **↪ QT @thedzianis:** _Built this INSANE interactive grass scene. ⏎ Made with Fable 5 and @threejs ⏎ 👇 …_ | 195 | 6 | 0 | 1 | 3.59 | [↗](https://x.com/bai_ee/status/2087973973594194177) |
| 8 | 2026-08-10 | 12:16 | Mon | self-quote | video | music-archive-dj | Sorted. Time to...  ⏎ Get some real work done. https://t.co/naCgreSi1M **↪ QT @bai_ee:** _Sorting trax out kinda day... https://t.co/pYOjkVOAiY_ | 190 | 8 | 0 | 0 | 4.21 | [↗](https://x.com/bai_ee/status/2086864279102267892) |
| 9 | 2026-08-12 | 13:04 | Wed | original-showcase | video | web3-gaming, music-archive-dj, client-work-status, crypto-finance | In the loop: ⏎ - CQ Clone Wars Marketplace goes live Thursday ⏎ - CQ Lucky Pick UI Elevations (Trove is at $40K!!) ⏎ - Poke Shop - new client exploration  ⏎ - VIVA &amp; NTR - Client Build Reviews https://t.co/h4E41OmiyS | 188 | 3 | 0 | 0 | 1.6 | [↗](https://x.com/bai_ee/status/2087601054514848095) |
| 10 | 2026-07-17 | 09:33 | Fri | original-showcase | video | web3-gaming, music-archive-dj, client-work-status | Currently in the loop: ⏎ • Promotions for future Web3 Gaming empire ⏎ • Festival Collateral for Chicago-Based Promoter ⏎ • Website refresh for Brooklyn-based Dog Walker ⏎ • Automated Briefs w/ market signals for all *a great co… | 188 | 5 | 0 | 1 | 3.19 | [↗](https://x.com/bai_ee/status/2078126058474221796) |

Format signal, your account:

| Media | Posts | Avg likes | Avg views |
|---|---:|---:|---:|
| video | 26 | 4.9 | 339 |
| none | 47 | 1.4 | 82 |
| image | 10 | 1.1 | 79 |
| gif | 1 | 1 | 44 |

**Video gets 4× the reach of a text post on your account** — the same directional signal as seb's, just at 1/24th the scale. You only posted 26 videos in 65 days despite owning a repo full of tools that emit video.

### Content hygiene — you are already clean here

| Rule | @bai_ee | @seb__design |
|---|---|---|
| Hashtags | 4 of 84 (4.8%) | 0 of 603 |
| Inline links in main post | 4 of 84 (4.8%) | 6 of 603 (1.0%) |
| Median authored post length | **72.5 chars** | 117 chars |

Brevity is not your problem — your posts are *shorter* than his. Drop the four hashtags and you match him on mechanics.

---

## 5. Timing

| Hour (CDT) | Posts | Avg likes |
|---|---:|---:|
| 08:00 | 12 | 2.8 |
| 09:00 | 19 | 0.8 |
| 10:00 | 18 | 0.8 |
| 11:00 | 13 | 0.5 |
| 12:00 | 22 | 1.2 |
| 13:00 | 19 | 2.3 |
| 14:00 | 8 | 0.1 |
| 15:00 | 18 | 0.4 |
| 16:00 | 10 | 0.2 |
| 17:00 | 10 | 0.3 |
| 18:00 | 16 | 0.6 |
| 19:00 | 10 | 0.5 |
| 20:00 | 21 | 0.2 |
| 21:00 | 13 | 1.2 |
| 22:00 | 19 | 0.7 |
| 23:00 | 8 | 0.3 |

| Weekday | Posts | Avg likes |
|---|---:|---:|
| Mon | 39 | 0.9 |
| Tue | 40 | 0.2 |
| Wed | 34 | 0.5 |
| Thu | 42 | 1.5 |
| Fri | 38 | 0.7 |
| Sat | 32 | 1.3 |
| Sun | 21 | 0.6 |

⚠️ **Do not tune your schedule on this table.** At 66 median views the numbers are noise — one lucky post moves an entire hour's average. Timing is a fifth-order concern until reach is fixed. Use seb's timing table (European afternoon / US morning overlap = 07:00–11:00 CDT) as the starting hypothesis and re-measure once your median post clears ~500 views.

---

## 6. Every authored post in the window

All 84 authored posts, ranked by views. Retweets excluded — see the CSV for the full 246-row set.

| # | Date (CDT) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-08-13 | 08:31 | Thu | original-showcase | video | web3-gaming, craft-opinion | Clones are going live at @crittersquest today!  ⏎ Some great threads are floating around, but the Marketplace is what I want to talk about, and the opportunity to explore a darker theme inside the CQ ecosystem. ⏎ It’s the… | 4,712 | 25 | 8 | 4 | 0.79 | [↗](https://x.com/bai_ee/status/2087894928726610403) |
| 2 | 2026-08-08 | 13:22 | Sat | original-showcase | video | web3-gaming, crypto-finance | "2 years is a long time to be in dev for @crittersquest" ⏎ ☠️ ⏎ •⁠  ⁠Multiplier Collection ⏎ •⁠  ⁠Multiplier Spins ⏎ •⁠  ⁠Quest for Terron (shards) ⏎ •⁠  ⁠Token Bound Master Editions ⏎ •⁠  ⁠Genesis Quest Staking ⏎ •⁠  ⁠The Gatherin… | 1,870 | 31 | 6 | 5 | 2.25 | [↗](https://x.com/bai_ee/status/2086156042614849984) |
| 3 | 2026-08-02 | 18:02 | Sun | original-showcase | image | music-archive-dj | Sorting trax out kinda day... https://t.co/pYOjkVOAiY | 315 | 4 | 0 | 1 | 1.59 | [↗](https://x.com/bai_ee/status/2084052238327005197) |
| 4 | 2026-08-06 | 22:58 | Thu | quote-react | none | untagged-riff | Quest Love **↪ QT @MagicEden:** _Critters on the move 👀_ | 306 | 10 | 0 | 1 | 3.59 | [↗](https://x.com/bai_ee/status/2085576368692056330) |
| 5 | 2026-08-05 | 21:25 | Wed | quote-react | none | untagged-riff | get u a founder that.., **↪ QT @beaniemaxi:** _@RoundyDoodle @enparadice Matt has extracted from himself literally and is all …_ | 303 | 9 | 1 | 0 | 3.3 | [↗](https://x.com/bai_ee/status/2085190465968574669) |
| 6 | 2026-08-17 | 12:04 | Mon | quote-commentary | none | untagged-riff | As a digital nomad, i started in print design and production. It has allowed me to wear many hats on the team. 👀 **↪ QT @crittersquest:** _Oh, hi there... CRITTERS!!! https://t.co/JhbvMHspXY_ | 224 | 5 | 0 | 0 | 2.23 | [↗](https://x.com/bai_ee/status/2089397914648936696) |
| 7 | 2026-08-13 | 13:46 | Thu | quote-react | none | web3-gaming, design-engineering, ai-tooling | directly to the @crittersquest inspo folder **↪ QT @thedzianis:** _Built this INSANE interactive grass scene. ⏎ Made with Fable 5 and @threejs ⏎ 👇 …_ | 195 | 6 | 0 | 1 | 3.59 | [↗](https://x.com/bai_ee/status/2087973973594194177) |
| 8 | 2026-08-10 | 12:16 | Mon | self-quote | video | music-archive-dj | Sorted. Time to...  ⏎ Get some real work done. https://t.co/naCgreSi1M **↪ QT @bai_ee:** _Sorting trax out kinda day... https://t.co/pYOjkVOAiY_ | 190 | 8 | 0 | 0 | 4.21 | [↗](https://x.com/bai_ee/status/2086864279102267892) |
| 9 | 2026-08-12 | 13:04 | Wed | original-showcase | video | web3-gaming, music-archive-dj, client-work-status, crypto-finance | In the loop: ⏎ - CQ Clone Wars Marketplace goes live Thursday ⏎ - CQ Lucky Pick UI Elevations (Trove is at $40K!!) ⏎ - Poke Shop - new client exploration  ⏎ - VIVA &amp; NTR - Client Build Reviews https://t.co/h4E41OmiyS | 188 | 3 | 0 | 0 | 1.6 | [↗](https://x.com/bai_ee/status/2087601054514848095) |
| 10 | 2026-07-17 | 09:33 | Fri | original-showcase | video | web3-gaming, music-archive-dj, client-work-status | Currently in the loop: ⏎ • Promotions for future Web3 Gaming empire ⏎ • Festival Collateral for Chicago-Based Promoter ⏎ • Website refresh for Brooklyn-based Dog Walker ⏎ • Automated Briefs w/ market signals for all *a great co… | 188 | 5 | 0 | 1 | 3.19 | [↗](https://x.com/bai_ee/status/2078126058474221796) |
| 11 | 2026-09-07 | 12:49 | Mon | original-showcase | video | design-engineering, music-archive-dj, crypto-finance, platform-complaint, personal-life | I built this warehouse in Blender with my son and ran multiple @edittrax NYE events. Seeing all the three.js love in my feed now I wonder if Spatial was ahead of its time (crypto voxels too). https://t.co/4kW9RA1n3N | 178 | 5 | 1 | 1 | 3.93 | [↗](https://x.com/bai_ee/status/2097019393934782520) |
| 12 | 2026-08-27 | 15:11 | Thu | original-showcase | video | music-archive-dj, client-work-status | In prog at HITLOOP: ⏎ - VTC: I hope @ArweaveEco is a solution for them. New client onboarding. Design &amp; Dev ⏎ - VA/NTR: Ongoing landing page revisions/approvals, final stages! ⏎ - CQ: Continued visual support and product … | 168 | 4 | 0 | 1 | 2.98 | [↗](https://x.com/bai_ee/status/2093068974359498784) |
| 13 | 2026-09-08 | 12:24 | Tue | quote-commentary | video | web3-gaming, music-archive-dj, platform-complaint | Music NFTs. A reminder to be the platform. ⏎ I've been having a lot of fun with V2 of @edittrax. ⏎ There are a lot of distribution parallels here that indie designers/devs vibe-coding open-source tools could benefit from,… **↪ QT @jasondesante:** _Music NFTs https://t.co/Kk0tB1Btvi_ | 158 | 1 | 0 | 0 | 0.63 | [↗](https://x.com/bai_ee/status/2097375611614355736) |
| 14 | 2026-08-13 | 08:32 | Thu | reply | video | web3-gaming | Collecting a clone means manifesting an edition with the same base traits as its Master.  Bringing that to life meant building 1 flexible animation that resolved to thousands of possible trait combinations. ⏎ *developed … | 155 | 5 | 1 | 1 | 4.52 | [↗](https://x.com/bai_ee/status/2087894990101926090) |
| 15 | 2026-08-31 | 11:34 | Mon | original-showcase | video | music-archive-dj | I’m bringing this crunchy old recording back for a release. ⏎ So I built a LOOPER that slices WAV files into different loop lengths and counts with 1 slider. ⏎ I can then quickly explore, arrange, lock lengths, drop them … | 149 | 3 | 1 | 0 | 2.68 | [↗](https://x.com/bai_ee/status/2094463805040255349) |
| 16 | 2026-07-21 | 07:51 | Tue | quote-react | video | client-work-status | WIP. Doing my best ova here 🙌 https://t.co/gdjkoL3fFr **↪ QT @seb__design:** _show me a cooler mobile nav, i'll wait ⏎ dev by @edo_lunardi https://t.co/m4nIZd…_ | 139 | 4 | 0 | 0 | 2.88 | [↗](https://x.com/bai_ee/status/2079549909489844652) |
| 17 | 2026-09-04 | 10:47 | Fri | quote-commentary | none | personal-life | Graphic design has become my morning therapy. Always a lot of fun playing with @iDankyMcgee’s illustrations. Would be cool to get at those mutants... 👀 **↪ QT @crittersquest:** _Explore. Expand. Exploit. Exterminate. 4 days left to climb the leaderboard and…_ | 138 | 8 | 0 | 1 | 6.52 | [↗](https://x.com/bai_ee/status/2095901583628181911) |
| 18 | 2026-09-10 | 09:21 | Thu | quote-react | none | untagged-riff | One of my first hardware purchases. Still hits. Still with me. **↪ QT @ghostradioshow:** _Korg Electribe EM-1の内蔵波形で作ったドラムンベースからしか得られない養分がある ⏎ monotron DELAYを添えて https://t…_ | 130 | 2 | 0 | 0 | 1.54 | [↗](https://x.com/bai_ee/status/2098054149459869793) |
| 19 | 2026-07-31 | 10:16 | Fri | quote-react | none | untagged-riff | Im a backyard designer to escape all hands meetings, this gives me ptsd. **↪ QT @ridd_design:** _officially launching "Backyard Designers" ⏎ draft your design dream team and see…_ | 114 | 2 | 0 | 0 | 1.75 | [↗](https://x.com/bai_ee/status/2083210289101545731) |
| 20 | 2026-08-21 | 18:12 | Fri | quote-react | image | crypto-finance, us-politics, platform-complaint | FUCK TRUMP! JFC CT. https://t.co/llNaKfe0Go **↪ QT @ProofOfEly:** _So the rumor is that a Trump/Trump family launch on Robinhood chain is coming t…_ | 104 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2090940029325525439) |
| 21 | 2026-09-04 | 16:50 | Fri | quote-react | none | untagged-riff | wait for it.... **↪ QT @The_Alex:** _Tell Astra to open Microsoft Paint and try to draw you https://t.co/obVvDKt9Q7_ | 101 | 1 | 0 | 0 | 0.99 | [↗](https://x.com/bai_ee/status/2095992820716785831) |
| 22 | 2026-08-24 | 17:31 | Mon | quote-react | none | crypto-finance | THIS **↪ QT @RealJimChanos:** _So we have $1T in cash on hand and $40T of debt, and are discussing…buybacks?!_ | 97 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2092017029406421182) |
| 23 | 2026-08-15 | 15:45 | Sat | original-showcase | video | music-archive-dj, ai-tooling | This used to take an hour+ on desktop. Now the only time spend is recording the mixes. 🎉 ⏎ 1) Upload new music to AR/update static site with new content 2) Generate  promo vid of mix 3) Deploy to AR/return hash of manif… | 94 | 3 | 1 | 0 | 4.26 | [↗](https://x.com/bai_ee/status/2088728789798805727) |
| 24 | 2026-08-13 | 08:32 | Thu | reply | video | web3-gaming, craft-opinion | Visually, clones are the dark side of an otherwise bright, playful, and optimistic world, hiding a complicated data and state system underneath.  ⏎ Dig into the docs &amp; community posts for strategies &amp; core clone … | 94 | 4 | 0 | 0 | 4.26 | [↗](https://x.com/bai_ee/status/2087894991834087631) |
| 25 | 2026-08-06 | 22:49 | Thu | quote-react | none | untagged-riff | never get(s) old **↪ QT @Peal8888:** _The 90s were so special and nobody knew it at the time... https://t.co/1n6g3N6C…_ | 90 | 2 | 0 | 0 | 2.22 | [↗](https://x.com/bai_ee/status/2085574138790396335) |
| 26 | 2026-08-23 | 09:51 | Sun | quote-react | none | music-archive-dj | Bidet, strt with the bidet **↪ QT @fintechfrank:** _The eight sleep has been life changing for me ⏎ Highly recommend_ | 86 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2091538777281822911) |
| 27 | 2026-08-05 | 21:20 | Wed | quote-react | none | design-engineering | yup **↪ QT @kaolti:** _Mixing video gen with Webgl/3D. ⏎ Videos can be used as textures, blown into pix…_ | 86 | 1 | 0 | 0 | 1.16 | [↗](https://x.com/bai_ee/status/2085189334160830602) |
| 28 | 2026-08-18 | 16:50 | Tue | quote-react | none | ai-tooling | Hurts so good. **↪ QT @RockyRoark:** _I hate to say it but I have to say the thing. ⏎ Talk like this shows how much cl…_ | 83 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2089832428525207928) |
| 29 | 2026-07-15 | 10:51 | Wed | quote-react | none | design-engineering, music-archive-dj, ai-tooling | this goes hard **↪ QT @alex_barashkov:** _Introducing Aval - a new open source format for interactive video on the web. I…_ | 80 | 1 | 0 | 0 | 1.25 | [↗](https://x.com/bai_ee/status/2077420903206375743) |
| 30 | 2026-09-02 | 15:03 | Wed | quote-commentary | none | untagged-riff | Congrats to @BrettFromDJ on the launch. And all the creatives building every-day tools into shareable bits. **↪ QT @BrettFromDJ:** _Playgrnd® beta is live. ⏎ No account. No paywall. 100% free. ⏎ 32 tiny tools for …_ | 78 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2095241222864425344) |
| 31 | 2026-07-31 | 10:19 | Fri | quote-commentary | none | design-engineering, craft-opinion | A lot of design engineering tips point to visual flexibility within systems, and that breaking rules can be ok when mechanical execution feels off. ⏎ visual &gt; mechanical **↪ QT @n___vc:** _💡design engineering tip: when using leading or tracking icons on buttons, do n…_ | 78 | 1 | 0 | 0 | 1.28 | [↗](https://x.com/bai_ee/status/2083211066507407580) |
| 32 | 2026-07-22 | 10:48 | Wed | quote-commentary | none | untagged-riff | Notice how these animations all follow a 1st/2nd read hierarchy. Lots of hero page designs seem to ditch this principal. It was burnt into my head at  @PublicisSapient **↪ QT @nazmijavierl:** _Healthcare Instagram Posts Design https://t.co/MNw19RYKgB_ | 77 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2079956796442124348) |
| 33 | 2026-07-23 | 18:12 | Thu | quote-commentary | none | client-work-status | This was about mobile ad networks pushing to landing pages that werent optimized for small devices. ⏎ We use to up-sell landing pages to help clients like Target, and Lowes, Wal-Mart all solve for this. ⏎ They wanted mobi… **↪ QT @raunofreiberg:** _hot take: mobile-first design was the biggest "well ackshually" scam ever again…_ | 76 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080430792258277742) |
| 34 | 2026-09-05 | 18:11 | Sat | quote-react | none | craft-opinion | i am listening **↪ QT @sheherenow_:** _holygrail: raymarched SDFs and HTML sharing a grid system ⏎ you don't understand…_ | 74 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2096375808638046650) |
| 35 | 2026-07-13 | 18:39 | Mon | quote-react | none | untagged-riff | max size across the page? yes **↪ QT @rahul_twtss:** _@rileycx Why are some designers obsessed with such font sizes? ⏎ 11px is bad UX_ | 73 | 2 | 0 | 0 | 2.74 | [↗](https://x.com/bai_ee/status/2076813757867827255) |
| 36 | 2026-08-24 | 12:00 | Mon | original-showcase | image | untagged-riff | im still faster at many things https://t.co/N3I8VNKoug | 72 | 1 | 0 | 0 | 1.39 | [↗](https://x.com/bai_ee/status/2091933666532286579) |
| 37 | 2026-07-15 | 19:21 | Wed | quote-react | none | design-engineering, ai-tooling | reminds me of building dynamic,  interactive ad units but its video **↪ QT @shivsakhuja:** _We taught Claude to make Video Ads for Meta using pure HTML ⏎ This is a skill /g…_ | 71 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2077549041173303489) |
| 38 | 2026-07-10 | 21:10 | Fri | quote-react | none | ai-tooling | AI doesnt make shit. Its a f*cking tool. **↪ QT @drapzdesigns:** _I bet AI still can't create brand visuals like these. https://t.co/rMbpWtn2L0_ | 70 | 3 | 1 | 0 | 5.71 | [↗](https://x.com/bai_ee/status/2075764559798014291) |
| 39 | 2026-07-12 | 20:07 | Sun | quote-commentary | none | ai-tooling | Not even a little bit? 🤔  ⏎ CLI is the most  efficient way to code alongside LLMs imo. Review, tweak and understand whats happenning as you add features and tweak UI. ⏎ Otherwise I feel like im flying blind. **↪ QT @marty_kausas:** _i'm so sick of using claude code in a terminal ⏎ i'm not coding. who has made a …_ | 69 | 1 | 0 | 1 | 2.9 | [↗](https://x.com/bai_ee/status/2076473475339022539) |
| 40 | 2026-07-16 | 21:16 | Thu | quote-commentary | none | ai-tooling | Hurts my brain to think about how id build a feature like this. Then i remember we have AI now. **↪ QT @measure_plan:** _wanted to learn inverse kinematics so i made a bunch of characters that live on…_ | 67 | 2 | 0 | 0 | 2.99 | [↗](https://x.com/bai_ee/status/2077940446303584500) |
| 41 | 2026-07-15 | 12:31 | Wed | quote-commentary | none | design-engineering | This is a great idea that realigns UI drift against your existing design docs that should have eliminated drift in the first place :D will try. **↪ QT @Ibelick:** _new skill: improve-ui ⏎ built to audit interfaces against their own design langu…_ | 67 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2077445857918554441) |
| 42 | 2026-07-07 | 16:05 | Tue | quote-react | none | design-engineering, music-archive-dj | Been using the hell out of this 💪 **↪ QT @riottersdesign:** _Drop any SVG or GLB in your browser. Get it back as an animated 3D glass object…_ | 67 | 1 | 0 | 0 | 1.49 | [↗](https://x.com/bai_ee/status/2074600733824151959) |
| 43 | 2026-07-13 | 18:37 | Mon | quote-react | none | untagged-riff | but shouldnt they be? smells like your an incremental change canidate. **↪ QT @HaleyforMI:** _I’d like to remind Abdul that aspirational goals aren’t real results. There’s o…_ | 66 | 3 | 0 | 0 | 4.55 | [↗](https://x.com/bai_ee/status/2076813199471784276) |
| 44 | 2026-08-14 | 09:22 | Fri | original-showcase | video | untagged-riff | Friday biz... ⏎ #jeffcraven ⏎ https://t.co/ptrIWCzzTZ https://t.co/ZB87zS9wYC | 65 | 4 | 0 | 0 | 6.15 | [↗](https://x.com/bai_ee/status/2088270067137933448) |
| 45 | 2026-07-27 | 23:43 | Mon | quote-react | none | design-engineering | oh man i have the exact place 👀👀 **↪ QT @YousufSoomroDev:** _I said I might have a problem with carousels. ⏎ Well, now it's your problem too.…_ | 62 | 2 | 0 | 0 | 3.23 | [↗](https://x.com/bai_ee/status/2081963787154837856) |
| 46 | 2026-07-27 | 19:30 | Mon | original-showcase | video | personal-life | Rainstorm knocked internets out this afternoon so I touched some grass 💨 https://t.co/czAqp1UqHi | 58 | 4 | 0 | 1 | 8.62 | [↗](https://x.com/bai_ee/status/2081900029761966274) |
| 47 | 2026-07-20 | 12:40 | Mon | original-showcase | video | untagged-riff | beneath the surface of https://t.co/ttwiBdtj6z | 54 | 4 | 0 | 0 | 7.41 | [↗](https://x.com/bai_ee/status/2079260193020412397) |
| 48 | 2026-07-19 | 22:41 | Sun | quote-commentary | image | music-archive-dj | Thai restaurant in HI, i was in recently that absolutely inspired. Something about the deep red against natural colors, captivating https://t.co/q2ftnM1mX6 **↪ QT @MeganeJon:** _Been exploring a style recently. It's super energetic I think. Wdyt? https://t.…_ | 54 | 2 | 0 | 1 | 5.56 | [↗](https://x.com/bai_ee/status/2079049048573538453) |
| 49 | 2026-07-18 | 13:46 | Sat | original-text | none | music-archive-dj, crypto-finance, platform-complaint | The anti #squarespace narrative rn is giving me f*ck 3rd party platform vibes from early blockchain days. Id still move everybody to @ArweaveEco if theyd listen. | 54 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2078551987944051158) |
| 50 | 2026-07-15 | 09:24 | Wed | original-text | none | platform-complaint | i guess ct wasnt dead just blocked?? such a shit show platform. | 53 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2077398831080112615) |
| 51 | 2026-09-02 | 14:25 | Wed | original-showcase | image | client-work-status | "First Look" Delivery Goals https://t.co/4TKpMbZJno | 52 | 1 | 0 | 0 | 1.92 | [↗](https://x.com/bai_ee/status/2095231536152838339) |
| 52 | 2026-08-08 | 13:29 | Sat | reply | none | untagged-riff | https://t.co/xj86M0XDrd Now on Mainnet ✨ Solana | 52 | 1 | 0 | 0 | 1.92 | [↗](https://x.com/bai_ee/status/2086157892067983867) |
| 53 | 2026-07-19 | 11:46 | Sun | original-showcase | image | design-engineering | line height issue and overcompensating screenshots (?), but if you or I ever have to review these manually again 🏴‍☠️ https://t.co/bFRpHVu6Df | 52 | 3 | 0 | 0 | 5.77 | [↗](https://x.com/bai_ee/status/2078884168184807464) |
| 54 | 2026-07-12 | 16:56 | Sun | original-showcase | video | personal-life | im an obsessive builder but pushing pixels while torching w friends via /remote-control i might haveproblems. https://t.co/OtgwKiARmi | 51 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2076425366953189714) |
| 55 | 2026-09-03 | 10:01 | Thu | quote-react | none | untagged-riff | I should try PAPER finally. **↪ QT @stephenhaney:** _I'm very excited about WebMCP ⏎ Here's Paper in an iframe, being controlled by a…_ | 50 | 1 | 0 | 0 | 2 | [↗](https://x.com/bai_ee/status/2095527578886902155) |
| 56 | 2026-07-18 | 17:46 | Sat | quote-react | none | untagged-riff | immersionmaxxing **↪ QT @Aurelien_Gz:** _obsessed with this portfolio.. ⏎ horizontal cards that warp as you scroll, each …_ | 50 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2078612327134380097) |
| 57 | 2026-07-11 | 17:56 | Sat | original-text | none | craft-opinion | It really is about the design decisions u make to create cohesive, high-impact experiences, over the difficulty level to execute them anymore. | 50 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2076078131967098986) |
| 58 | 2026-08-29 | 10:41 | Sat | original-text | none | music-archive-dj, crypto-finance | It took me UNDER 5 minutes to put $10 into the pump app and get rugged by @MartinShkreli last night lol. 👋 ⏎ #QUANT Personal record. | 49 | 2 | 0 | 0 | 4.08 | [↗](https://x.com/bai_ee/status/2093725774985445559) |
| 59 | 2026-07-25 | 13:28 | Sat | original-showcase | video | client-work-status | Saturday wip https://t.co/qtGcpLLIJ7 | 48 | 3 | 0 | 0 | 6.25 | [↗](https://x.com/bai_ee/status/2081084074890830021) |
| 60 | 2026-07-23 | 20:39 | Thu | quote-commentary | image | us-politics | Watch this murderous pos shapechanger Ted Cruz morph into the enemy, as he happily votes away all our tax dollars to another country. ⏎ Or is this Randy Fine? IDK Why do they all look like penguins. Its a fuckin takeover… **↪ QT @Acyn:** _Andreone: The NDAA passed with Section 219. This streamlines the process of sor…_ | 48 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080467876033564744) |
| 61 | 2026-07-10 | 22:21 | Fri | original-text | none | untagged-riff | muugfgdxkkkjjjjjjjjjhhhkkkkkkkkkkkkkllllllllllngs.                ⏎ ?))))!!!!? | 48 | 0 | 0 | 1 | 2.08 | [↗](https://x.com/bai_ee/status/2075782477113930017) |
| 62 | 2026-09-03 | 17:06 | Thu | original-showcase | video | music-archive-dj, client-work-status | In the loop this week: I love instant connections when onboarding to a new team (my UX Lead is from Oahu).... She's also skilled, focused on data, and I really look forward to building out the #VTC product experience wi… | 46 | 3 | 0 | 0 | 6.52 | [↗](https://x.com/bai_ee/status/2095634572666974715) |
| 63 | 2026-07-28 | 19:40 | Tue | original-text | none | untagged-riff | visual &gt; mechanical | 46 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2082264901595152438) |
| 64 | 2026-07-28 | 15:36 | Tue | original-showcase | gif | design-engineering | Please tell me whats more fun than  translating chinese labeled package dielines, from crease layers in a file called: 105x85x130 盲盒+10个装外盒 530x174x133 卡纸 吴锐.pdf ?? ⏎ amuse me https://t.co/HjbchZNI4v | 44 | 1 | 0 | 0 | 2.27 | [↗](https://x.com/bai_ee/status/2082203631256743973) |
| 65 | 2026-07-09 | 03:18 | Thu | quote-react | none | client-work-status, crypto-finance, ai-tooling | zzz **↪ QT @the_cyw:** _I built a skill to let my Claude Code build premium landing pages like this in …_ | 44 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2075132393229627416) |
| 66 | 2026-09-07 | 22:21 | Mon | original-showcase | video | music-archive-dj, personal-life | Home team sesh today @arcmusicfest https://t.co/JxsDhVg6hP | 42 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2097163381060825276) |
| 67 | 2026-07-17 | 20:41 | Fri | original-text | none | music-archive-dj, ai-tooling | Prob faster to generate a video loop based on the still of a static frame, vs requesting/finding that video, editing it etc. | 42 | 1 | 0 | 0 | 2.38 | [↗](https://x.com/bai_ee/status/2078294071899038177) |
| 68 | 2026-07-30 | 19:09 | Thu | original-text | none | web3-gaming, design-engineering, platform-complaint | all i see on my feed are interactive nfts anymore. | 41 | 1 | 0 | 0 | 2.44 | [↗](https://x.com/bai_ee/status/2082982010310545627) |
| 69 | 2026-07-24 | 10:57 | Fri | quote-commentary | none | client-work-status, craft-opinion, ai-tooling | This is the direction most advanced creators will likely go in, custom tooling that fits our process/aesthetic ...its just like, who are we gonna be making it for, clients or ourselves? Clients now sure... **↪ QT @cerspense:** _I don't think i can go back to regular software anymore ⏎ exploring a crazy comb…_ | 41 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080683875030769973) |
| 70 | 2026-07-10 | 13:09 | Fri | quote-react | none | client-work-status, ai-tooling | this **↪ QT @0xCharlota:** _honestly, if a potential client asked me “what can you deliver that Claude can’…_ | 39 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2075643589108150504) |
| 71 | 2026-07-29 | 09:05 | Wed | original-showcase | video | music-archive-dj | I have hundreds of old ⏎ mix-tapes from throwing and attending parties. ⏎ They needed a forever home. ⏎ All mixes pulled from @ArweaveEco all video clips pulled from my camera roll, all editing automated within the cloud, d… | 38 | 3 | 0 | 0 | 7.89 | [↗](https://x.com/bai_ee/status/2082467493457559696) |
| 72 | 2026-09-03 | 09:10 | Thu | quote-commentary | none | web3-gaming, crypto-finance | Great back and forth here on gaming in web3. Personally, for anything w/ a database blockchain offers a real differentiator. Experience genres though, tough sell. **↪ QT @ChrisJourdan:** _https://t.co/wztoeb6f9f_ | 36 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2095514832724267037) |
| 73 | 2026-07-31 | 09:43 | Fri | original-showcase | video | untagged-riff | Still dialing this in for a homepage https://t.co/WEspTEvLWB | 36 | 1 | 0 | 0 | 2.78 | [↗](https://x.com/bai_ee/status/2083201993351246075) |
| 74 | 2026-07-22 | 15:21 | Wed | original-showcase | image | design-engineering, music-archive-dj, ai-tooling | Part of what makes Claude cool is that it builds almost any FE concept out from a set of technically solid templates. The jagged section break is one of them. I saw 3 websites with this same seam today. ⏎ The Design work… | 36 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080025348373164219) |
| 75 | 2026-07-15 | 19:03 | Wed | original-text | none | crypto-finance, platform-complaint, ai-tooling | I wonder how much ai gained and crypto lost when ct was so casually forgotten from the algo, as noone could see anyone they were here to follow in the space. 🤔 | 35 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2077544517704536429) |
| 76 | 2026-07-23 | 12:47 | Thu | original-showcase | image | personal-life | Hello, it's production. We got your tape. ⏎ *I really talk to myself like this. https://t.co/fuVuwiJnTZ | 32 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080349219638882633) |
| 77 | 2026-07-10 | 13:00 | Fri | quote-react | none | crypto-finance | not today devil **↪ QT @haydenzadams:** _Robinhood chain is going absolutely crazy ⏎ $500m in 24hr volume on Uniswap - th…_ | 32 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2075641218143592898) |
| 78 | 2026-09-03 | 09:37 | Thu | original-text | none | music-archive-dj, platform-complaint | Lots of 3rd party platforms would rather you build things like this on their property. Ultimately many creatives will want to decentralize. https://t.co/qIIDD4A9ID | 26 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2095521597436137757) |
| 79 | 2026-07-24 | 09:04 | Fri | original-showcase | video | music-archive-dj | Computer, id like to start my day with mateo &amp; matos the selective styles ep circa 98 https://t.co/sr84xGVRnZ | 26 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2080655240982827379) |
| 80 | 2026-07-18 | 12:25 | Sat | original-showcase | video | design-engineering | Interaction // Concept ⏎ Below the surface... https://t.co/R295zIjEhN | 25 | 2 | 0 | 0 | 8 | [↗](https://x.com/bai_ee/status/2078531561855582700) |
| 81 | 2026-07-13 | 18:14 | Mon | original-showcase | image | us-politics | OK this mf needs to go too. all of them, kamala, booker, this is a litmus test. ⏎ LG didnt give a fuck about the average american let alone human life around the world, and so, its easy to not give af about him. https://… | 24 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2076807554370584612) |
| 82 | 2026-07-19 | 20:52 | Sun | original-showcase | video | untagged-riff | music is always part of the process https://t.co/inXGFBUehY | 22 | 2 | 0 | 0 | 9.09 | [↗](https://x.com/bai_ee/status/2079021544827760747) |
| 83 | 2026-07-13 | 13:49 | Mon | original-showcase | video | untagged-riff | you cant tell me she doesnt eat children https://t.co/j3lSvSpzjW | 19 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2076740941172576607) |
| 84 | 2026-07-11 | 17:57 | Sat | reply | none | untagged-riff | KIDS &lt;3 | 18 | 0 | 0 | 0 | 0 | [↗](https://x.com/bai_ee/status/2076078392466886755) |

---

## 7. Limits of this audit

1. **Replies are under-sampled** on both accounts — X's profile timeline hides most of them. Your 4 is a floor. But given 1,591 following and 22,977 lifetime likes against 4 visible replies in 65 days, the qualitative conclusion holds.
2. **Retweet views are unmeasurable.** X attributes them to the original author, so the 162 retweets contribute nothing to the view figures here. That is exactly the argument against posting them.
3. **Views are as-of 2026-09-10.** Recent posts have had less time to accumulate.
4. **Follower attribution is invisible.** We cannot see which posts won or lost followers — X shows that to nobody.
5. **Your window is the same 65 days as seb's**, but your corpus went back further (382 posts to 2026-03-07) before being trimmed for comparability. Low volume, not a pagination limit.
