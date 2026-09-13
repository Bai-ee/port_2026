# @seb__design — X post database (2026-07-07 → 2026-09-10)

> Research dataset built to reverse-engineer a working small-account X growth pattern in the design/creative-services niche. Companion strategy doc: [`docs/plans/X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md).
> Machine-readable siblings: [`seb-design-x-corpus.json`](./seb-design-x-corpus.json) · [`seb-design-x-corpus.csv`](./seb-design-x-corpus.csv)

## 0. Provenance & honesty notes

| Field | Value |
|---|---|
| Account | **@seb__design** — "seb-astian", id `1914023754730274816` |
| Bio | Brands & websites for founders that want to stand out \| Worked with @redbull @realoverheardla @buildnexio @blinktrade \| https://t.co/h5TiftXktp \| Booking Q3👇🏻 |
| Account created | Sun Apr 20 18:30:10 +0000 2025 |
| Followers / Following | **1,549** / 648 |
| Lifetime posts | 4,238 |
| Likes given | 10,575 |
| Blue verified | yes |
| CTA in bio | https://calendly.com/seb-astian/discovery-call |
| Corpus pulled | 2026-09-10T20:46:16.205Z |
| Posts captured | **782** across **65 days** (66 active days) |
| View counts resolved | 150 posts |

**Collection method.** Timeline pulled through the `bird` CLI (X web GraphQL, cookie auth — no API spend), cursor-chained to X's timeline depth limit. View counts backfilled through ScrapeCreators `/v1/twitter/tweet` (1 credit/post). Per repo policy ([`X-API-AND-PROFILE-OPERATIONS.md`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) §2c) **no paid X API call was made** — reads go through the cheap path only. Total spend: **153 ScrapeCreators credits ≈ \$0.29**.

**Four limits you should know before trusting a number:**
1. **Window is 65 days, not 90.** X's profile timeline stops paginating around 800 posts; his volume is high enough that this capped us at 2026-07-07. Everything here is Jul–Sep 2026.
2. **Replies are under-sampled.** The profile timeline surfaces only 33 replies. His 10,575 likes given and reply-heavy style imply the real number is far higher. Treat reply volume in this doc as a floor, not a measurement.
3. **Views exist for 150 of 782 posts** — the top ~100 by likes plus a random control sample. View-based averages are therefore biased upward and are only safe for *comparing within* the sampled set.
4. **Likes/views are as-of pull date.** Recent posts have had less time to accumulate.

---

## 1. Cadence — what and how often

**11.85 posts per active day**, every day, no off days in the window.

| Type | Posts | Share | Avg likes | Avg replies | Avg reposts | Avg views (sampled) |
|---|---:|---:|---:|---:|---:|---:|
| `quote-react` | 183 | 23.4% | 46.6 | 1.2 | 1.5 | 11,451 |
| `retweet` | 179 | 22.9% | 0.0 | 0.0 | 1146.2 | — |
| `original-text` | 169 | 21.6% | 18.3 | 3.7 | 0.4 | 1,998 |
| `original-showcase` | 155 | 19.8% | 49.7 | 4.5 | 1.9 | 4,997 |
| `quote-commentary` | 48 | 6.1% | 34.2 | 3.4 | 1.5 | 6,535 |
| `reply` | 33 | 4.2% | 1.3 | 0.2 | 0.0 | 95 |
| `self-quote` | 15 | 1.9% | 60.8 | 4.7 | 1.6 | 4,126 |

### Weekly volume (own posts, retweets excluded)

| Week of | Own posts | Total likes | Avg likes/post |
|---|---:|---:|---:|
| 2026-07-06 | 88 | 3,637 | 41.3 |
| 2026-07-13 | 112 | 4,084 | 36.5 |
| 2026-07-20 | 83 | 2,325 | 28.0 |
| 2026-07-27 | 39 | 927 | 23.8 |
| 2026-08-03 | 43 | 667 | 15.5 |
| 2026-08-10 | 60 | 1,657 | 27.6 |
| 2026-08-17 | 41 | 1,394 | 34.0 |
| 2026-08-24 | 55 | 4,015 | 73.0 |
| 2026-08-31 | 51 | 2,203 | 43.2 |
| 2026-09-07 | 31 | 1,013 | 32.7 |

---

## 2. When he posts — hour and weekday

All times **CEST (UTC+2)** — inferred from his posting envelope and German-language artifacts in his content.

| Hour | Posts | Avg likes |
|---|---:|---:|
| 00:00 | 11 | 10.4 |
| 01:00 | 1 | 0 |
| 05:00 | 2 | 11.5 |
| 06:00 | 10 | 29.9 |
| 07:00 | 26 | 9.8 |
| 08:00 | 22 | 10.8 |
| 09:00 | 33 | 25.3 |
| 10:00 | 57 | 44.2 |
| 11:00 | 42 | 32.5 |
| 12:00 | 47 | 14.1 |
| 13:00 | 61 | 51.8 |
| 14:00 | 54 | 34.6 |
| 15:00 | 52 | 15.6 |
| 16:00 | 36 | 50.9 |
| 17:00 | 66 | 42.3 |
| 18:00 | 55 | 18 |
| 19:00 | 46 | 15.3 |
| 20:00 | 46 | 26.4 |
| 21:00 | 50 | 14.7 |
| 22:00 | 29 | 41.1 |
| 23:00 | 36 | 8.7 |

**Peak-performance hours (by avg likes, min 20 posts):** `13:00` (51.8) · `16:00` (50.9) · `10:00` (44.2) · `17:00` (42.3) · `22:00` (41.1) · `14:00` (34.6)

| Weekday | Posts | Total likes | Avg likes |
|---|---:|---:|---:|
| Mon | 110 | 2,094 | 19.0 |
| Tue | 113 | 2,084 | 18.4 |
| Wed | 130 | 4,001 | 30.8 |
| Thu | 131 | 3,835 | 29.3 |
| Fri | 109 | 1,564 | 14.3 |
| Sat | 80 | 3,277 | 41.0 |
| Sun | 109 | 5,067 | 46.5 |

---

## 3. What he posts about

Topics are multi-label; a post can carry several. Matched against the caption **and** the quoted post, because his quote captions average 46 characters — the subject lives in what he is quoting.

| Topic | Posts | Avg likes | Avg replies | Avg reposts |
|---|---:|---:|---:|---:|
| `japanese-asian-design` | 23 | 187.4 | 1.6 | 53.7 |
| `retro-analog-preinternet` | 27 | 65.7 | 2.3 | 27.9 |
| `motion-animation-web` | 88 | 59.6 | 3.8 | 22.7 |
| `own-work-process` | 45 | 47.7 | 5.1 | 2.6 |
| `personal-vulnerability` | 8 | 43.1 | 10.4 | 15.8 |
| `client-work-credit` | 53 | 41.2 | 3.5 | 2.9 |
| `editorial-typography` | 56 | 39.7 | 3.8 | 9.3 |
| `tools` | 44 | 38.8 | 4 | 2.2 |
| `craft-advice` | 10 | 36.2 | 4.9 | 3.4 |
| `anti-ai-slop` | 19 | 35.2 | 3.6 | 4.3 |
| `freelance-business` | 80 | 31.9 | 3 | 37.5 |
| `growth-milestone` | 10 | 29.3 | 7.7 | 0.2 |
| `platform-meta` | 41 | 26.1 | 3.1 | 3.3 |
| `industry-hot-take` | 15 | 25.7 | 3.5 | 1.1 |
| `untagged-riff` | 441 | 13.8 | 1.7 | 450.6 |
| `audience-question` | 14 | 12.6 | 3.6 | 0.1 |

### Format signals

| Signal | Value |
|---|---|
| Media mix (own posts) | none: 428 posts @ 31.4 avg likes · video: 61 posts @ 89.3 avg likes · image: 108 posts @ 27.5 avg likes · gif: 6 posts @ 7.5 avg likes |
| Hashtags | **0 posts out of 603** — he never uses them |
| Inline links in the main post | **6 of 603 (1.0%)** — avg 20.5 likes vs **36.5** without |
| Starts lowercase | 451 of 603 (74.8%) — avg 41.3 likes vs 23.8 for uppercase starts |
| Emoji | 158 of 603 (26.2%) |
| Original post length | median **117 chars** (p25 73 · p75 212 · p95 567) |
| Quote caption length | median **46 chars** |
| Multi-post threads detected | 27 conversations |

---

## 4. Top 25 posts by views (sampled set)

| # | Date (CEST) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-08-26 | 16:20 | Wed | quote-react | none | platform-meta | the goat is back on x **↪ QT @jesper_alpacka:** _Last year my main acc with 7k+ followers got hacked. Decided to create a new one. I'm Jes…_ | 67,975 | 447 | 8 | 5 | 0.68 | [↗](https://x.com/seb__design/status/2092618212987003017) |
| 2 | 2026-07-18 | 17:35 | Sat | original-showcase | video | motion-animation-web, client-work-credit, freelance-business | some r-rated slider action ⏎ dev by @edo_lunardi for @blinktrade https://t.co/r8z3zolbjR | 61,342 | 993 | 45 | 31 | 1.74 | [↗](https://x.com/seb__design/status/2078503933232992395) |
| 3 | 2026-07-12 | 13:25 | Sun | quote-react | none | japanese-asian-design | japanese graphic design at it again 😮‍💨 **↪ QT @rare_jpg:** _https://t.co/paIRxhhpUD_ | 58,129 | 1,585 | 43 | 5 | 2.81 | [↗](https://x.com/seb__design/status/2076266620943737097) |
| 4 | 2026-08-27 | 10:18 | Thu | original-showcase | video | motion-animation-web | some of my favourite designs / animations https://t.co/SRpxHYn14U | 38,874 | 1,206 | 72 | 24 | 3.35 | [↗](https://x.com/seb__design/status/2092889394835497447) |
| 5 | 2026-07-12 | 13:41 | Sun | quote-react | none | japanese-asian-design | japanese designers are just a different beast **↪ QT @rhytkm:** _先週末、gggにて開催された「井口皓太 モーショングラフィックス クロージングセッション」のグラフィック、ASCII表現をベースとした動的なビジュアルを生成するツールを作成しまし…_ | 36,309 | 472 | 28 | 4 | 1.39 | [↗](https://x.com/seb__design/status/2076270757890728008) |
| 6 | 2026-08-15 | 16:48 | Sat | original-showcase | video | own-work-process, tools | i open figma. i create. i have fun. https://t.co/X5PJibyjAB | 34,726 | 457 | 25 | 29 | 1.47 | [↗](https://x.com/seb__design/status/2088638894283935780) |
| 7 | 2026-07-18 | 11:54 | Sat | quote-react | none | japanese-asian-design | japanese designers at it again 😔🙌🏻 **↪ QT @butter91138:** _今こんな感じ https://t.co/rQiRHCdtgF_ | 33,901 | 572 | 25 | 1 | 1.76 | [↗](https://x.com/seb__design/status/2078418049338953869) |
| 8 | 2026-08-26 | 22:18 | Wed | quote-react | none | editorial-typography | jamie be cooking w her editorial designs - go give her a follow 🔥 **↪ QT @jmdsgn:** _Editorial layout https://t.co/dBu5C5MA7M_ | 31,160 | 422 | 4 | 2 | 1.37 | [↗](https://x.com/seb__design/status/2092708211694715019) |
| 9 | 2026-07-12 | 14:29 | Sun | quote-react | none | japanese-asian-design, retro-analog-preinternet | designers of the pre internet era were so creative **↪ QT @interiorsuckerr:** _VTG 60's Desk Globe Calendar, Japan https://t.co/DvnB9DnQua_ | 30,501 | 694 | 40 | 1 | 2.41 | [↗](https://x.com/seb__design/status/2076282909850562676) |
| 10 | 2026-07-22 | 14:42 | Wed | original-showcase | video | motion-animation-web | because you loved ma lil slider so much here are the animated graphics in one view ⏎ thanks to everyone for liking and engaging w that ma lil baby. means a lot to me! https://t.co/dvt7s4Tozf | 26,198 | 536 | 22 | 16 | 2.19 | [↗](https://x.com/seb__design/status/2079909906367623428) |
| 11 | 2026-09-03 | 22:12 | Thu | quote-react | none | japanese-asian-design | cause u haven’t had your daily dose of japanese designers yet **↪ QT @tndhjm:** _Kankyo Records( @kankyorecords )さんが主催する「音楽と読書: Listening &amp; Reading」のモーションデザインをしました。 ⏎ …_ | 20,062 | 474 | 13 | 3 | 2.44 | [↗](https://x.com/seb__design/status/2095605864925397056) |
| 12 | 2026-08-27 | 06:51 | Thu | quote-react | none | editorial-typography | that’s so lovely - feels like a real zine ✨ **↪ QT @iDID_team:** _#今日のブクマ🟥 ⏎ 🔸赤さんのポートフォリオサイト、折り紙が重なるようなUIの操作性が良い。 ⏎ イラストレーターの「仕事」と「個人制作」が並行かつシームレスに見れるようになっ…_ | 19,198 | 226 | 9 | 0 | 1.22 | [↗](https://x.com/seb__design/status/2092837396966719766) |
| 13 | 2026-07-15 | 13:45 | Wed | quote-react | none | untagged-riff | holyyy lightsaber - take all my money!! **↪ QT @interiorsuckerr:** _The Oops Lamp by Alberto Essesi featuring a glowing cord instead of a glowing bulb https:…_ | 18,208 | 209 | 13 | 1 | 1.22 | [↗](https://x.com/seb__design/status/2077358912437981460) |
| 14 | 2026-07-19 | 16:31 | Sun | quote-react | none | untagged-riff | if i'm rich i won't tell nobody but there'll be signs **↪ QT @interiorsuckerr:** _Wood and tile flooring https://t.co/HHs1QLw6Rc_ | 16,942 | 272 | 40 | 1 | 1.85 | [↗](https://x.com/seb__design/status/2078850219786342860) |
| 15 | 2026-08-26 | 17:47 | Wed | quote-commentary | none | retro-analog-preinternet, editorial-typography, motion-animation-web, own-work-process | I saw that one coming. ⏎ When Chat GPT came out 2022 I’ve talked a lot w my artist and designer friends.  ⏎ While many were afraid my prediction was that traditional human made art will be shoved more into the spotlight a… **↪ QT @applefiles_:** _The handcrafted magic behind Apple's new Mac mini introduction https://t.co/hIF30E70Rg_ | 13,517 | 130 | 11 | 11 | 1.12 | [↗](https://x.com/seb__design/status/2092640035661291628) |
| 16 | 2026-08-27 | 10:42 | Thu | quote-react | none | editorial-typography | this is called: dope ass shii 🔥🙂‍↕️ **↪ QT @xiaoxiaodong01:** _这种图叫做： ⏎ Swiss / International Typographic Style（瑞士国际主义平面）+ Bauhaus / Constructivism（包豪斯、构成…_ | 13,506 | 123 | 3 | 2 | 0.95 | [↗](https://x.com/seb__design/status/2092895461191598486) |
| 17 | 2026-07-26 | 20:31 | Sun | quote-commentary | none | retro-analog-preinternet | where did we lose the haptical and inventive design language? now things are so polished and "efficient" that everything looks the same (esp phones) **↪ QT @interiorsuckerr:** _70s Panasonic Toot-A-Loop Portable Radio https://t.co/XNi5UTj8UP_ | 13,331 | 140 | 5 | 1 | 1.1 | [↗](https://x.com/seb__design/status/2081447279756710174) |
| 18 | 2026-08-30 | 11:58 | Sun | quote-commentary | none | motion-animation-web | love these little solutions! seeing people come up w ideas how to solve a problem in a cool way is why i love design so much **↪ QT @AnatoleOis:** _Portfolio's been updated for a bit now but I never shared this interaction here. https://…_ | 13,121 | 228 | 11 | 1 | 1.83 | [↗](https://x.com/seb__design/status/2094001790773764424) |
| 19 | 2026-08-20 | 10:44 | Thu | quote-commentary | none | retro-analog-preinternet, freelance-business, personal-vulnerability | I disagree. The best time to be a designer was during mid 2010 to 2020. ⏎ design was still more niche yet w the raise of silicon valley it became a respectable pursuit. ⏎ back then it also seemed that many agencies really… **↪ QT @cameronmoll:** _This AI era is the 2nd best time to be a designer. ⏎ The 1st best time was the late 90s / …_ | 11,925 | 119 | 6 | 12 | 1.15 | [↗](https://x.com/seb__design/status/2090359356454027312) |
| 20 | 2026-07-25 | 11:31 | Sat | quote-react | none | retro-analog-preinternet | immediate buy **↪ QT @interiorsuckerr:** _70s style Bubble Wall Clock https://t.co/08qoGnha53_ | 11,732 | 57 | 2 | 0 | 0.5 | [↗](https://x.com/seb__design/status/2080949015202632061) |
| 21 | 2026-08-25 | 20:50 | Tue | self-quote | none | motion-animation-web, own-work-process, tools | cause we had so many bad design takes lately, imma just binge watch my lil animation again 🙂‍↕️ **↪ QT @seb__design:** _i open figma. i create. i have fun. https://t.co/X5PJibyjAB_ | 10,547 | 199 | 9 | 6 | 2.03 | [↗](https://x.com/seb__design/status/2092323735667908665) |
| 22 | 2026-07-29 | 17:24 | Wed | quote-commentary | none | retro-analog-preinternet, anti-ai-slop | These pre-AI designs are just sooo satisfying.  ⏎ If you look at designs today all that "ohh just use AI" made everything look uglier **↪ QT @DesignReviewed:** _Collected matchbox labels from a collection of 6,000 in the design archive. https://t.co/…_ | 10,296 | 301 | 24 | 0 | 3.16 | [↗](https://x.com/seb__design/status/2082487521771233415) |
| 23 | 2026-07-20 | 18:00 | Mon | quote-react | none | tools | he the goated dev out there **↪ QT @edo_lunardi:** _I called this "Ringwriter" ⏎ A phrase coiled across spinning rings. Cursor melts the glyph…_ | 9,992 | 103 | 1 | 2 | 1.06 | [↗](https://x.com/seb__design/status/2079234980769931708) |
| 24 | 2026-08-18 | 09:56 | Tue | quote-react | none | japanese-asian-design | These japanese designers don’t stop surprising me. like lit these designs are so fire 😭🔥 **↪ QT @neybell_:** _何を考えて作ってたかわからない情報量過多シリーズまた作りたい https://t.co/FGT6xgVfCA_ | 9,106 | 151 | 4 | 3 | 1.74 | [↗](https://x.com/seb__design/status/2089622553119850697) |
| 25 | 2026-07-17 | 18:59 | Fri | original-showcase | image | own-work-process, growth-milestone, tools | I just saw a post about the scammer Nico. He wanted 250 for a full website (designed and build in framer) in 2 weeks.  ⏎ Please. Never. Ever. Accept. That 😭 ⏎ A full website is at the very minimum worth 5k but that is re… | 8,796 | 65 | 0 | 18 | 0.94 | [↗](https://x.com/seb__design/status/2078162570226319372) |

---

## 5. Top 60 posts by likes

| # | Date (CEST) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-07-12 | 13:25 | Sun | quote-react | none | japanese-asian-design | japanese graphic design at it again 😮‍💨 **↪ QT @rare_jpg:** _https://t.co/paIRxhhpUD_ | 58,129 | 1,585 | 43 | 5 | 2.81 | [↗](https://x.com/seb__design/status/2076266620943737097) |
| 2 | 2026-08-27 | 10:18 | Thu | original-showcase | video | motion-animation-web | some of my favourite designs / animations https://t.co/SRpxHYn14U | 38,874 | 1,206 | 72 | 24 | 3.35 | [↗](https://x.com/seb__design/status/2092889394835497447) |
| 3 | 2026-07-18 | 17:35 | Sat | original-showcase | video | motion-animation-web, client-work-credit, freelance-business | some r-rated slider action ⏎ dev by @edo_lunardi for @blinktrade https://t.co/r8z3zolbjR | 61,342 | 993 | 45 | 31 | 1.74 | [↗](https://x.com/seb__design/status/2078503933232992395) |
| 4 | 2026-07-12 | 14:29 | Sun | quote-react | none | japanese-asian-design, retro-analog-preinternet | designers of the pre internet era were so creative **↪ QT @interiorsuckerr:** _VTG 60's Desk Globe Calendar, Japan https://t.co/DvnB9DnQua_ | 30,501 | 694 | 40 | 1 | 2.41 | [↗](https://x.com/seb__design/status/2076282909850562676) |
| 5 | 2026-07-18 | 11:54 | Sat | quote-react | none | japanese-asian-design | japanese designers at it again 😔🙌🏻 **↪ QT @butter91138:** _今こんな感じ https://t.co/rQiRHCdtgF_ | 33,901 | 572 | 25 | 1 | 1.76 | [↗](https://x.com/seb__design/status/2078418049338953869) |
| 6 | 2026-07-22 | 14:42 | Wed | original-showcase | video | motion-animation-web | because you loved ma lil slider so much here are the animated graphics in one view ⏎ thanks to everyone for liking and engaging w that ma lil baby. means a lot to me! https://t.co/dvt7s4Tozf | 26,198 | 536 | 22 | 16 | 2.19 | [↗](https://x.com/seb__design/status/2079909906367623428) |
| 7 | 2026-09-03 | 22:12 | Thu | quote-react | none | japanese-asian-design | cause u haven’t had your daily dose of japanese designers yet **↪ QT @tndhjm:** _Kankyo Records( @kankyorecords )さんが主催する「音楽と読書: Listening &amp; Reading」のモーションデザインをしました。 ⏎ …_ | 20,062 | 474 | 13 | 3 | 2.44 | [↗](https://x.com/seb__design/status/2095605864925397056) |
| 8 | 2026-07-12 | 13:41 | Sun | quote-react | none | japanese-asian-design | japanese designers are just a different beast **↪ QT @rhytkm:** _先週末、gggにて開催された「井口皓太 モーショングラフィックス クロージングセッション」のグラフィック、ASCII表現をベースとした動的なビジュアルを生成するツールを作成しまし…_ | 36,309 | 472 | 28 | 4 | 1.39 | [↗](https://x.com/seb__design/status/2076270757890728008) |
| 9 | 2026-08-15 | 16:48 | Sat | original-showcase | video | own-work-process, tools | i open figma. i create. i have fun. https://t.co/X5PJibyjAB | 34,726 | 457 | 25 | 29 | 1.47 | [↗](https://x.com/seb__design/status/2088638894283935780) |
| 10 | 2026-08-26 | 16:20 | Wed | quote-react | none | platform-meta | the goat is back on x **↪ QT @jesper_alpacka:** _Last year my main acc with 7k+ followers got hacked. Decided to create a new one. I'm Jes…_ | 67,975 | 447 | 8 | 5 | 0.68 | [↗](https://x.com/seb__design/status/2092618212987003017) |
| 11 | 2026-08-26 | 22:18 | Wed | quote-react | none | editorial-typography | jamie be cooking w her editorial designs - go give her a follow 🔥 **↪ QT @jmdsgn:** _Editorial layout https://t.co/dBu5C5MA7M_ | 31,160 | 422 | 4 | 2 | 1.37 | [↗](https://x.com/seb__design/status/2092708211694715019) |
| 12 | 2026-07-29 | 17:24 | Wed | quote-commentary | none | retro-analog-preinternet, anti-ai-slop | These pre-AI designs are just sooo satisfying.  ⏎ If you look at designs today all that "ohh just use AI" made everything look uglier **↪ QT @DesignReviewed:** _Collected matchbox labels from a collection of 6,000 in the design archive. https://t.co/…_ | 10,296 | 301 | 24 | 0 | 3.16 | [↗](https://x.com/seb__design/status/2082487521771233415) |
| 13 | 2026-07-19 | 16:31 | Sun | quote-react | none | untagged-riff | if i'm rich i won't tell nobody but there'll be signs **↪ QT @interiorsuckerr:** _Wood and tile flooring https://t.co/HHs1QLw6Rc_ | 16,942 | 272 | 40 | 1 | 1.85 | [↗](https://x.com/seb__design/status/2078850219786342860) |
| 14 | 2026-08-30 | 11:58 | Sun | quote-commentary | none | motion-animation-web | love these little solutions! seeing people come up w ideas how to solve a problem in a cool way is why i love design so much **↪ QT @AnatoleOis:** _Portfolio's been updated for a bit now but I never shared this interaction here. https://…_ | 13,121 | 228 | 11 | 1 | 1.83 | [↗](https://x.com/seb__design/status/2094001790773764424) |
| 15 | 2026-08-27 | 06:51 | Thu | quote-react | none | editorial-typography | that’s so lovely - feels like a real zine ✨ **↪ QT @iDID_team:** _#今日のブクマ🟥 ⏎ 🔸赤さんのポートフォリオサイト、折り紙が重なるようなUIの操作性が良い。 ⏎ イラストレーターの「仕事」と「個人制作」が並行かつシームレスに見れるようになっ…_ | 19,198 | 226 | 9 | 0 | 1.22 | [↗](https://x.com/seb__design/status/2092837396966719766) |
| 16 | 2026-07-15 | 13:45 | Wed | quote-react | none | untagged-riff | holyyy lightsaber - take all my money!! **↪ QT @interiorsuckerr:** _The Oops Lamp by Alberto Essesi featuring a glowing cord instead of a glowing bulb https:…_ | 18,208 | 209 | 13 | 1 | 1.22 | [↗](https://x.com/seb__design/status/2077358912437981460) |
| 17 | 2026-08-25 | 20:50 | Tue | self-quote | none | motion-animation-web, own-work-process, tools | cause we had so many bad design takes lately, imma just binge watch my lil animation again 🙂‍↕️ **↪ QT @seb__design:** _i open figma. i create. i have fun. https://t.co/X5PJibyjAB_ | 10,547 | 199 | 9 | 6 | 2.03 | [↗](https://x.com/seb__design/status/2092323735667908665) |
| 18 | 2026-08-18 | 09:56 | Tue | quote-react | none | japanese-asian-design | These japanese designers don’t stop surprising me. like lit these designs are so fire 😭🔥 **↪ QT @neybell_:** _何を考えて作ってたかわからない情報量過多シリーズまた作りたい https://t.co/FGT6xgVfCA_ | 9,106 | 151 | 4 | 3 | 1.74 | [↗](https://x.com/seb__design/status/2089622553119850697) |
| 19 | 2026-07-13 | 20:48 | Mon | quote-react | none | japanese-asian-design | let me be reborn as a japanese designer please **↪ QT @rare_jpg:** _https://t.co/q6ueuq3JoY_ | 3,859 | 146 | 2 | 2 | 3.89 | [↗](https://x.com/seb__design/status/2076740670849679577) |
| 20 | 2026-08-04 | 21:31 | Tue | original-text | none | editorial-typography, motion-animation-web, own-work-process, freelance-business, personal-vulnerability, tools | had to face a hard truth - i’ve fallen off.  ⏎ when i first started out as a designer i was soo eager and so hyped to just try things. i was checking awwwards daily and used elements i liked in designs we made at the fir… | 8,438 | 142 | 2 | 37 | 2.15 | [↗](https://x.com/seb__design/status/2084723881269686568) |
| 21 | 2026-07-26 | 20:31 | Sun | quote-commentary | none | retro-analog-preinternet | where did we lose the haptical and inventive design language? now things are so polished and "efficient" that everything looks the same (esp phones) **↪ QT @interiorsuckerr:** _70s Panasonic Toot-A-Loop Portable Radio https://t.co/XNi5UTj8UP_ | 13,331 | 140 | 5 | 1 | 1.1 | [↗](https://x.com/seb__design/status/2081447279756710174) |
| 22 | 2026-08-20 | 17:46 | Thu | original-showcase | video | untagged-riff | idk https://t.co/UYsJU8cFNU | 4,450 | 134 | 4 | 16 | 3.46 | [↗](https://x.com/seb__design/status/2090465548014674226) |
| 23 | 2026-09-05 | 10:58 | Sat | quote-react | none | untagged-riff | looove seeing creative and whimsical stuff like this! **↪ QT @csidearchives:** _portfolio footer update (inspired by the many daiso craft hole punchers i used to use as …_ | 5,822 | 130 | 1 | 2 | 2.28 | [↗](https://x.com/seb__design/status/2096160925950906417) |
| 24 | 2026-08-26 | 17:47 | Wed | quote-commentary | none | retro-analog-preinternet, editorial-typography, motion-animation-web, own-work-process | I saw that one coming. ⏎ When Chat GPT came out 2022 I’ve talked a lot w my artist and designer friends.  ⏎ While many were afraid my prediction was that traditional human made art will be shoved more into the spotlight a… **↪ QT @applefiles_:** _The handcrafted magic behind Apple's new Mac mini introduction https://t.co/hIF30E70Rg_ | 13,517 | 130 | 11 | 11 | 1.12 | [↗](https://x.com/seb__design/status/2092640035661291628) |
| 25 | 2026-07-09 | 16:25 | Thu | original-showcase | image | untagged-riff | the amount of cool stuff i see on ig is unreal https://t.co/uOsFuNyysc | 4,664 | 127 | 5 | 3 | 2.89 | [↗](https://x.com/seb__design/status/2075224812168081702) |
| 26 | 2026-08-27 | 10:42 | Thu | quote-react | none | editorial-typography | this is called: dope ass shii 🔥🙂‍↕️ **↪ QT @xiaoxiaodong01:** _这种图叫做： ⏎ Swiss / International Typographic Style（瑞士国际主义平面）+ Bauhaus / Constructivism（包豪斯、构成…_ | 13,506 | 123 | 3 | 2 | 0.95 | [↗](https://x.com/seb__design/status/2092895461191598486) |
| 27 | 2026-09-04 | 10:01 | Fri | original-text | none | motion-animation-web, craft-advice | Be it branding, web design, motion design, product design etc - always look outside your box. ⏎ If you just look at websites for your web design project, or motion videos for your motion project you'll only have a limite… | 2,885 | 122 | 10 | 19 | 5.23 | [↗](https://x.com/seb__design/status/2095784207465566477) |
| 28 | 2026-08-20 | 10:44 | Thu | quote-commentary | none | retro-analog-preinternet, freelance-business, personal-vulnerability | I disagree. The best time to be a designer was during mid 2010 to 2020. ⏎ design was still more niche yet w the raise of silicon valley it became a respectable pursuit. ⏎ back then it also seemed that many agencies really… **↪ QT @cameronmoll:** _This AI era is the 2nd best time to be a designer. ⏎ The 1st best time was the late 90s / …_ | 11,925 | 119 | 6 | 12 | 1.15 | [↗](https://x.com/seb__design/status/2090359356454027312) |
| 29 | 2026-09-09 | 21:10 | Wed | original-showcase | image | editorial-typography | got the design itch and decided to go editorial https://t.co/LRb9eJ19EG | 3,972 | 118 | 9 | 10 | 3.45 | [↗](https://x.com/seb__design/status/2097764696690684010) |
| 30 | 2026-07-17 | 19:06 | Fri | original-text | none | own-work-process, client-work-credit, freelance-business, industry-hot-take | After becoming a full time freelance designer I've realised a couple of things: ⏎ - 9 to 5 is a scam. I mostly work 4-6hrs per day ⏎ - failure doesn't make you a bad person ⏎ - how much you earn is based on how much you valu… | 4,840 | 110 | 3 | 10 | 2.54 | [↗](https://x.com/seb__design/status/2078164542962778290) |
| 31 | 2026-08-31 | 10:48 | Mon | original-showcase | video | motion-animation-web, own-work-process | scroll animation from an unreleased project https://t.co/nSwI8dV7Sl | 2,995 | 108 | 2 | 17 | 4.24 | [↗](https://x.com/seb__design/status/2094346522569929032) |
| 32 | 2026-08-22 | 16:40 | Sat | quote-react | video | editorial-typography | that's the font i've used for nexio 👀 https://t.co/UhMx9fcGa6 **↪ QT @ggsimm:** _this font and website is my roman empire this week, so good. ⏎ https://t.co/HPm0E4x4Dz htt…_ | 5,347 | 107 | 1 | 6 | 2.13 | [↗](https://x.com/seb__design/status/2091173697839366153) |
| 33 | 2026-09-09 | 09:15 | Wed | self-quote | image | client-work-credit | some more visuals from the brandwall for @blinktrade https://t.co/sOVwSfS6E9 **↪ QT @seb__design:** _When all crypto brands keep doing it the same way, we went the other way with @blinktrade…_ | 2,470 | 105 | 3 | 23 | 5.3 | [↗](https://x.com/seb__design/status/2097584589493682261) |
| 34 | 2026-07-20 | 18:00 | Mon | quote-react | none | tools | he the goated dev out there **↪ QT @edo_lunardi:** _I called this "Ringwriter" ⏎ A phrase coiled across spinning rings. Cursor melts the glyph…_ | 9,992 | 103 | 1 | 2 | 1.06 | [↗](https://x.com/seb__design/status/2079234980769931708) |
| 35 | 2026-07-18 | 18:38 | Sat | quote-react | none | editorial-typography | that silver blue gradient uff - goes too hard **↪ QT @abduzeedo:** _Swiss-Inspired Laboratory Branding for Covalent ⏎ Explore the Swiss-inspired laboratory br…_ | 5,139 | 99 | 3 | 2 | 2.02 | [↗](https://x.com/seb__design/status/2078519716034052444) |
| 36 | 2026-07-29 | 15:00 | Wed | self-quote | video | motion-animation-web, own-work-process, tools | As many of you requested - here's the tutorial (or let's say bts) of the 2nd and 3rd animation 👀🔥 ⏎ The preview inside figma looks bit laggy prob cause i was recording so pardon that. ⏎ In essence all the animations are… **↪ QT @seb__design:** _because you loved ma lil slider so much here are the animated graphics in one view ⏎ thank…_ | 5,761 | 97 | 4 | 5 | 1.84 | [↗](https://x.com/seb__design/status/2082451231302443100) |
| 37 | 2026-09-03 | 12:59 | Thu | original-showcase | image | untagged-riff | lol don't wanna brag but the first on https://t.co/GXSQJ9NYaA https://t.co/dPOvfuCID6 | 5,940 | 87 | 0 | 19 | 1.78 | [↗](https://x.com/seb__design/status/2095466770106839318) |
| 38 | 2026-07-26 | 20:29 | Sun | quote-react | none | untagged-riff | that's some fine ass gradients sir **↪ QT @its_sslvr:** _cosmic+wind+ https://t.co/e5InTaPhtT_ | 6,126 | 85 | 0 | 2 | 1.42 | [↗](https://x.com/seb__design/status/2081446881637642305) |
| 39 | 2026-08-31 | 17:22 | Mon | original-text | none | industry-hot-take | hot take: most designers are mediocre because their ego and pride is bigger than their curiosity and desire to become better. | 3,034 | 83 | 2 | 8 | 3.07 | [↗](https://x.com/seb__design/status/2094445778836304260) |
| 40 | 2026-07-20 | 17:41 | Mon | original-showcase | video | own-work-process, client-work-credit | some more nsfw process section action ⏎ dev by @edo_lunardi for @blinktrade  ⏎ illus by @designsbycayo https://t.co/whWxSKNjAQ | 6,383 | 83 | 4 | 6 | 1.46 | [↗](https://x.com/seb__design/status/2079230314799604012) |
| 41 | 2026-08-31 | 17:18 | Mon | original-showcase | image | own-work-process, craft-advice, tools | if your finished figma file don't look like that, go back and clean up your mess 🗿 https://t.co/L3fn3xJlAp | 4,563 | 81 | 0 | 12 | 2.04 | [↗](https://x.com/seb__design/status/2094444825391268114) |
| 42 | 2026-07-19 | 17:34 | Sun | original-text | none | craft-advice | if you're starting out w web design or feel like you've hit a plateau i recommend doing some of these or all: ⏎ - go on awwwards, take one site and rebuild it - you'll learn soo much ⏎ - learn the principles of design - sp… | 3,307 | 80 | 6 | 3 | 2.69 | [↗](https://x.com/seb__design/status/2078866179301818545) |
| 43 | 2026-08-18 | 19:45 | Tue | self-quote | video | motion-animation-web, own-work-process, tools | lots of people loved that animation so i've made a tutorial 👀 ⏎ the animation itself is pretty simple - it just uses masking, scale and position changes.  ⏎ what makes it "complex" or i'd say beautiful is how all the ele… **↪ QT @seb__design:** _i open figma. i create. i have fun. https://t.co/X5PJibyjAB_ | 6,468 | 78 | 1 | 7 | 1.33 | [↗](https://x.com/seb__design/status/2089770619986674128) |
| 44 | 2026-09-01 | 10:58 | Tue | quote-react | none | motion-animation-web | micro animations like this is soul food for my creative mind ✨ **↪ QT @nitishkmrk:** _tree menu interaction ⎯⟡° https://t.co/kU0Vf2Csai_ | 3,475 | 76 | 0 | 1 | 2.22 | [↗](https://x.com/seb__design/status/2094711554298245545) |
| 45 | 2026-08-26 | 20:59 | Wed | original-showcase | image | untagged-riff | trying something 👀 https://t.co/OoVg2WVYns | 2,251 | 76 | 1 | 9 | 3.82 | [↗](https://x.com/seb__design/status/2092688384775057488) |
| 46 | 2026-07-20 | 09:49 | Mon | self-quote | none | motion-animation-web, client-work-credit, freelance-business | wild how this one lil slider went viral **↪ QT @seb__design:** _some r-rated slider action ⏎ dev by @edo_lunardi for @blinktrade https://t.co/r8z3zolbjR_ | 4,697 | 75 | 1 | 2 | 1.66 | [↗](https://x.com/seb__design/status/2079111435326820743) |
| 47 | 2026-07-15 | 16:36 | Wed | original-showcase | image | own-work-process | concept design for a nature based symbiotic llm https://t.co/h1pxcjJO9y | 1,407 | 74 | 4 | 4 | 5.83 | [↗](https://x.com/seb__design/status/2077401951378215337) |
| 48 | 2026-08-02 | 19:32 | Sun | original-showcase | image | editorial-typography, anti-ai-slop | good design is all about experimenting - i especially love editorial inspired layouts  ⏎ completely ai free ✨ https://t.co/NpT91dXuWK | 2,242 | 73 | 4 | 3 | 3.57 | [↗](https://x.com/seb__design/status/2083969282011246931) |
| 49 | 2026-07-19 | 16:25 | Sun | original-showcase | video | client-work-credit | lil graffiti easter egg never hurt nobody. sound on for full experience  ⏎ dev by @edo_lunardi https://t.co/skERj63Gdz | 6,323 | 70 | 3 | 6 | 1.25 | [↗](https://x.com/seb__design/status/2078848616404586919) |
| 50 | 2026-07-14 | 13:07 | Tue | original-showcase | image | untagged-riff | can't get enough of it. feels so good to design cool stuff https://t.co/r66wYDG9rv | 1,716 | 70 | 2 | 8 | 4.66 | [↗](https://x.com/seb__design/status/2076986942617731215) |
| 51 | 2026-08-27 | 15:27 | Thu | original-showcase | video | growth-milestone | Wuhuu! We got the holy number 1000! 🚀 ⏎ Thanks everyone for the support and following ma journey!  ⏎ Let's keep on growing! https://t.co/f3n9pfDnqk | 3,090 | 69 | 0 | 24 | 3.01 | [↗](https://x.com/seb__design/status/2092967201339019356) |
| 52 | 2026-07-26 | 20:33 | Sun | self-quote | none | motion-animation-web, audience-question | gonna do a tutorial of the animations. i will show 2. which one would you wanna see? 👀 **↪ QT @seb__design:** _because you loved ma lil slider so much here are the animated graphics in one view ⏎ thank…_ | 4,250 | 69 | 1 | 4 | 1.74 | [↗](https://x.com/seb__design/status/2081447720532029457) |
| 53 | 2026-08-23 | 11:57 | Sun | original-showcase | image | editorial-typography | can't stop exploring that design haha - i feel i uncovered a new design direction -&gt; goth (swiss) design 🧛🏻 https://t.co/8rjNMwKtGS | 1,637 | 68 | 2 | 8 | 4.76 | [↗](https://x.com/seb__design/status/2091464741072125987) |
| 54 | 2026-09-02 | 08:35 | Wed | original-showcase | video | retro-analog-preinternet | fully mechanical calendar from the 70s - found that beauty in a flea market  ⏎ arlac dati perpetual calendar designed by hans halm made in germany https://t.co/kSuPZsHxHi | 1,245 | 67 | 1 | 12 | 6.43 | [↗](https://x.com/seb__design/status/2095037905404329994) |
| 55 | 2026-08-28 | 09:34 | Fri | quote-react | none | untagged-riff | damnn this is beyond beautiful 😮‍💨🔥 bring back ornamentation **↪ QT @nono_ai_archive:** _AI로 패키지 목업 만들 때 알아두면 좋은   ⏎ 기본적인 후가공 4가지   ⏎ 1.도무송/다이컷 ( Die-cutting)  ⏎ 2.금박 (Gold Foil Stamp…_ | 4,527 | 67 | 1 | 1 | 1.52 | [↗](https://x.com/seb__design/status/2093240701719081077) |
| 56 | 2026-07-11 | 21:59 | Sat | original-showcase | video | untagged-riff | haven't seen a site as cool as this in a long time 👀 ⏎ by @_pxpush https://t.co/4tMnLohOYM | 3,142 | 67 | 4 | 4 | 2.39 | [↗](https://x.com/seb__design/status/2076033535841013831) |
| 57 | 2026-09-08 | 10:09 | Tue | original-text | none | untagged-riff | The biggest phobia a designer can have is getting a project, realising you can’t produce a certain style/element cause it’s outside your skillset, and then panicking cause the deadline gets shorter every day. 🪦 | 2,792 | 66 | 1 | 8 | 2.69 | [↗](https://x.com/seb__design/status/2097235989840404842) |
| 58 | 2026-07-17 | 18:59 | Fri | original-showcase | image | own-work-process, growth-milestone, tools | I just saw a post about the scammer Nico. He wanted 250 for a full website (designed and build in framer) in 2 weeks.  ⏎ Please. Never. Ever. Accept. That 😭 ⏎ A full website is at the very minimum worth 5k but that is re… | 8,796 | 65 | 0 | 18 | 0.94 | [↗](https://x.com/seb__design/status/2078162570226319372) |
| 59 | 2026-07-13 | 13:57 | Mon | original-showcase | image | japanese-asian-design | just been sharing dope japanese graphic designs and it's getting viral lol https://t.co/p6lJGPMXE8 | 2,766 | 65 | 0 | 2 | 2.42 | [↗](https://x.com/seb__design/status/2076637207604150383) |
| 60 | 2026-08-31 | 09:31 | Mon | quote-commentary | none | editorial-typography, motion-animation-web, anti-ai-slop, personal-vulnerability | idk how this got 1.5k likes - just look at the type indicator. this looks soo bad. ai slop at its finest ✨😭 **↪ QT @motion_so:** _Introducing Apple for product launches. ⏎ Paste your website URL. ⏎ Motion turns it into a …_ | 7,447 | 63 | 1 | 27 | 1.22 | [↗](https://x.com/seb__design/status/2094327194814443840) |

---

## 6. Bottom 25 by likes — what does not work

| # | Date (CEST) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 2026-09-09 | 14:06 | Wed | reply | none | untagged-riff | @blinktrade check it out: https://t.co/177TdHYtDt | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2097657865716822254) |
| 2 | 2026-09-08 | 15:12 | Tue | reply | none | untagged-riff | Check it out -&gt; https://t.co/5G1Us31Nia ⏎ If your team plans to raise the bar as well, let's have a chat -&gt; https://t.co/ftY63i2Yzo | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2097312009310310462) |
| 3 | 2026-09-08 | 15:08 | Tue | reply | none | freelance-business | @blinktrade Check it out -&gt; https://t.co/5G1Us31Nia ⏎ And if your business is planning to raise the bar as well, let's have a chat -&gt; https://t.co/ftY63i2Yzo | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2097311000362160280) |
| 4 | 2026-09-05 | 12:16 | Sat | reply | none | audience-question | In case you use a form is it better to have just a message field or a "choose budget" field too? | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2096180682997539311) |
| 5 | 2026-08-27 | 15:37 | Thu | reply | none | motion-animation-web, tools | for the bg video  ⏎ - i've got some random cloud video, ⏎ - changed the fps to 12 in davinci (just used h.264 quick export), ⏎ -  imported it to figma to add the halftone effect and used "color adjust" shader to match colors ⏎ … | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2092969668927700992) |
| 6 | 2026-08-24 | 16:40 | Mon | reply | none | untagged-riff | @BrikInfo54121 here's the tool -&gt; https://t.co/ZnyTxdoZV9 | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2091898380947751374) |
| 7 | 2026-08-19 | 07:50 | Wed | quote-react | none | freelance-business | good read! **↪ QT @RockyRoark:** _I hate to say it but I have to say the thing. ⏎ Talk like this shows how much closer to th…_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2089953046331826211) |
| 8 | 2026-08-03 | 13:06 | Mon | quote-commentary | none | freelance-business | love they take the street food culture to integrate it in their designs ⏎ (street food stands mostly have simple metal or plastic tables where u can sit) **↪ QT @creative_i_p:** _ベトナムの家具ブランド、かわいい。 https://t.co/LrPZzd81Wa_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2084234462364368984) |
| 9 | 2026-08-02 | 19:33 | Sun | reply | image | untagged-riff | kinda reminds me of these german books by reclam https://t.co/3pKIZ4wGun | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2083969541525418005) |
| 10 | 2026-08-01 | 18:07 | Sat | quote-react | none | untagged-riff | lol **↪ QT @pingu4ll:** _this slow burn apocalypse vibe is fucking crazy_ | — | 0 | 0 | 1 | — | [↗](https://x.com/seb__design/status/2083585542277779812) |
| 11 | 2026-07-27 | 13:43 | Mon | reply | none | untagged-riff | hahaha i got one comment notification for this post. 😭 | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2081707025290141825) |
| 12 | 2026-07-24 | 20:27 | Fri | reply | none | motion-animation-web | btw @studio__aaa you know why it glitches when i animate the orb offset?  ⏎ from that yt tutorial https://t.co/psetM6nHDc | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2080721446431801616) |
| 13 | 2026-07-19 | 17:15 | Sun | original-text | none | personal-vulnerability | sometimes i miss autumn just so i have an excuse to drink tea and get gobbled up by my blanket | — | 0 | 0 | 1 | — | [↗](https://x.com/seb__design/status/2078861172024148399) |
| 14 | 2026-07-17 | 14:00 | Fri | quote-react | none | untagged-riff | 👀👀 **↪ QT @benjaminbardou:** _Ꙅᗡ⅃ƎIꟻ ЯƎͶͶI https://t.co/D6uY0rdzyw_ | 232 | 0 | 0 | 0 | 0 | [↗](https://x.com/seb__design/status/2078087342116712880) |
| 15 | 2026-07-14 | 18:06 | Tue | reply | none | motion-animation-web, tools | Check it out: https://t.co/KpAnt1k9UP    ⏎ Illustrations &amp; Animation: David Gomez, Andy Velasquez, Geordan Espinoza Built in Framer | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2077062101034782721) |
| 16 | 2026-07-14 | 15:02 | Tue | quote-react | none | untagged-riff | yes please **↪ QT @canekzapata:** _https://t.co/JzTMz5C4tL_ | 114 | 0 | 0 | 0 | 0 | [↗](https://x.com/seb__design/status/2077015972561793277) |
| 17 | 2026-07-14 | 14:23 | Tue | original-showcase | image | untagged-riff | channeling the 2000s energy https://t.co/QJfQnGV7K9 | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2077005992286716413) |
| 18 | 2026-07-14 | 13:04 | Tue | original-text | none | untagged-riff | Lately I wake up and feel tired - have to get some balance in life | 81 | 0 | 0 | 0 | 0 | [↗](https://x.com/seb__design/status/2076986169846563313) |
| 19 | 2026-07-13 | 17:55 | Mon | quote-react | none | untagged-riff | need that **↪ QT @neomechanica:** _https://t.co/yB2AaWRCKr_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2076697053321937307) |
| 20 | 2026-07-13 | 14:20 | Mon | quote-react | none | client-work-credit, freelance-business | me when i don’t question my client’s questionable feedback **↪ QT @randomrecruiter:** _How life starts to feel when you stop taking work so seriously https://t.co/SYMBacTrkl_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2076642896464470173) |
| 21 | 2026-07-13 | 13:40 | Mon | original-text | none | untagged-riff | It’s Monday and it’s a wonderful day again to be creative | 110 | 0 | 0 | 0 | 0 | [↗](https://x.com/seb__design/status/2076632978508423506) |
| 22 | 2026-07-10 | 20:15 | Fri | original-text | none | untagged-riff | fr fr bro | 118 | 0 | 0 | 0 | 0 | [↗](https://x.com/seb__design/status/2075645109321040189) |
| 23 | 2026-07-10 | 12:33 | Fri | reply | none | untagged-riff | follow me on ig -&gt; https://t.co/UIIDkUrARu | — | 0 | 0 | 1 | — | [↗](https://x.com/seb__design/status/2075528755288916162) |
| 24 | 2026-07-09 | 23:41 | Thu | quote-react | none | own-work-process, platform-meta, tools | such a fun idea! **↪ QT @karenxcheng:** _i hooked up a rotary phone from the 1920s to an AI agent, that replies on a mechanical di…_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2075334478147600738) |
| 25 | 2026-07-09 | 23:32 | Thu | quote-react | none | platform-meta | me watching all the cool designs and creations on x **↪ QT @madaomoshiroi:** _追いかけることもせず、ただただ蝶を眺めるのほほん猫ちゃん https://t.co/o37HboXqOH_ | — | 0 | 0 | 0 | — | [↗](https://x.com/seb__design/status/2075332184152719814) |

---

## 7. Full database

Full 782-row dataset with every field is in the machine-readable siblings:

- [`seb-design-x-corpus.csv`](./seb-design-x-corpus.csv) — spreadsheet-ready, one row per post
- [`seb-design-x-corpus.json`](./seb-design-x-corpus.json) — normalized objects

Columns: `id, url, utc, dateLocal, timeLocal, weekday, type, media, topics, chars, lines, likes, reposts, replies, views, engagement, engagementRate, quotedAuthor, text`.

### Accounts he quote-tweets most

- **@seb__design** — 15 quotes
- **@interiorsuckerr** — 7 quotes
- **@figma** — 6 quotes
- **@rare_jpg** — 6 quotes
- **@RaminNasibov** — 5 quotes
- **@thatguybg** — 4 quotes
- **@vanschneider** — 3 quotes
- **@benjitaylor** — 2 quotes
- **@thedankoe** — 2 quotes
- **@jacob__titus** — 2 quotes
- **@moepwellington** — 2 quotes
- **@ObsoleteSony** — 2 quotes
- **@michaelmicasso** — 2 quotes
- **@DesignReviewed** — 2 quotes
- **@markovurnek_** — 2 quotes
- **@nostalgia_** — 2 quotes
- **@marcelkargul** — 2 quotes
- **@invinciDesigns** — 2 quotes
- **@joki_hirooka** — 2 quotes
- **@sirini_cha** — 1 quote
