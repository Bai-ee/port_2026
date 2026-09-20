# X monetization research — what audio accounts actually do

Pulled 2026-09-20, free, via the `bird` CLI. Zero X API spend, zero ScrapeCreators credits.

> ⚠️ **Read the limits before the findings.** All of this is **likes-based** — a bird timeline carries no view counts, so nothing here is an impression or an engagement rate. Sample sizes are one timeline page per account (95–106 posts). These are hypotheses about *your* audience, not laws; the ledger in [`ARCHIVE-X-CONTENT-ENGINE-PLAN.md`](../plans/ARCHIVE-X-CONTENT-ENGINE-PLAN.md) §9 is what settles them on your own data.
>
> ⚠️ **Monetization itself is not measurable on X, by anyone.** Follower attribution is owner-only; no tool can see which post produced a booking or a sale. The honest instrumentation is **on your side of the click** — tagged self-reply links → GA4 / Bandcamp. Everything below measures *attention*, which is the input to money, not money.

---

## 1. @toshioueki — the archivist model

95 posts over 20 days. **4.75 posts/day, ~0 gap days.** Avg 27.5 likes, median 4 (top-heavy).

Every post is the same shape: one record, the label, why it matters, a remix note, a personal memory, `Artist - Title` at the end. Roughly half carry media. He never needs a quote target — his catalog *is* the content.

### Genre buckets, by average likes

| Bucket | Examples | Avg likes |
|---|---|---:|
| Big-remixer crossover | Hatiras *Spaced Invader* (Darren Emerson rmx) | **235** |
| Trance / prog '96–'00 | Andrew McLauchlan (Devilfish rmx) 177, Vincent De Moor *Flowtation* '96 140 | ~158 |
| Detroit / early-90s canon | UR *Jupiter Jazz* '92 228, Paperclip People *Throw* '94 147, Slam *Positive Education* '95 115, Drax '94 86 | ~145 |
| Disco / vocal house | Morales *Needin' U* '98 115, Basia (Roger Sanchez) 83, Jon Secada rmx 66 | ~88 |
| Filter / funky house '00s | Olav Basoski 98, DJ Sneak *Get Up* 90, Santos *Pump It Up* '05 60 | ~83 |
| **Hard house / peak-hour '99–'05** | UK Gold 71, Untidy Dubs 65, Coburn 40, Choci 39 | **~54** |
| **His own event promo** | "DANCEDEVICE meets PLANET LOVE" posts | **16–26** |

**Findings**

1. **2000s peak-hour is his weakest record bucket**, not his strongest. Disco house sits mid. This contradicts the going assumption.
2. **Genre is not the real axis — canon is.** The top eight are all '89–'01 records that a lot of people have a personal memory of. The engine is *recognition plus a detail you didn't know*, not rarity. "I know this one" → "I didn't know that."
3. **His own event promo underperforms his record posts 5–10×.**

---

## 2. @moorhaus_ — the practitioner model

100 posts over 30 days. **1.82 posts/day, 12 gap days of 29.** Avg 48.8 likes, median 22, top post 1,622.

Low volume, dense audience. He wins on **stance about scene norms**, not on gigs.

| Post | Likes |
|---|---:|
| Self-quoted rant ("are you fucking kidding me…") | **1,622** |
| "longer set times are better for both DJs and dancers" (QT) | 236 |
| "ID culture is dumb, but digging and discovery is the most beautiful part of music" (QT) | 123 |
| "if you EVER need an ID from me just reply on the post or toss me a message" | 120 |
| Gig announcements (Spybar, Smartbar, ARC) | ~56–102 |

**Findings**

1. **His audience rewards opinions about the culture, ~20× over his own bookings.** Same pattern as @toshioueki's promo posts. Promo is the worst-performing thing either account publishes.
2. **His `quote-commentary` lift is 5.22×** — his people are there for discourse.
3. **He is beatable on mechanics:** in 30 days, 5 image-only posts, 2 inline links, 1 hashtag. All three measurably cost reach.
4. **He publicly invites ID requests and values digging over ID culture.** That is a stated, repeated opening for someone with a deeper catalog.

---

## 3. @KerriChandler — what "arrived" looks like

43k followers. 1.48 posts/day, **18 gap days of 44**, 96% `original-showcase`, 14 of 25 authored posts break a mechanical rule.

**Finding: an established artist is not a growth model.** He does not need X — the bookings exist regardless, and the account is a broadcast channel with a booking email in the bio. Useful as proof of the *endpoint* (bio CTA is the conversion surface), useless as a playbook for getting there. Do not copy the cadence or the rule-breaking of anyone who was already famous before the account mattered.

---

## 4. The scene graph — @moorhaus_'s following

Pulled 252 accounts, keyword-filtered to **54 music-relevant**. Machine-readable: [`x-music-scene-graph.json`](./x-music-scene-graph.json).

| Cut | Count |
|---|---:|
| Enthusiasts ("house music enjoyer", "dance music enjoyer") | **34** |
| Artists / DJs / producers | 11 |
| Venues, promoters, festivals | 9 |
| Chicago-tagged | 7 |
| Booking contact in bio | 3 |
| >10k followers | 5 |
| 1k–10k | 20 |
| <1k | **29** |

**Findings**

1. **This is a fan community, not an industry list.** Two thirds are enthusiasts in the 100–3,000 follower band. The people who will actually engage you are heads, not headliners — which is good news, because heads reward depth and headliners reward fame.
2. **The genre center is minimal / hypnotic / rolling tech house**, not Chicago classics, disco or acid. Bios repeat "minimal/deep/tech", "hypnotic techno", "rolling tech house".
   ⚠️ **So the genre overlap with a classic-house archive is partial.** The bridge into this cluster is **digging, discovery and history** — which @moorhaus_ explicitly names as what he values — not "we like the same records."
3. **The Chicago venue/promoter accounts are the booking path**: `@PRYSMChicago`, `@AurisPresents`, `@serumchicago`, plus `@arcmusicfest` (13k) as the festival anchor.
4. **The monetization pattern across the cluster is the bio, not the posts.** Booking emails and link-in-bio; nobody sells in the timeline. Consistent with promo posts underperforming everywhere in this dataset.

---

## 5. What this implies for the plan

- **C1 (Record of the Day)** should lead with **canon plus a story**, not rarities, and skew '89–'01. Test the assumption on your own audience rather than inheriting a Japanese-language account's era bias.
- **C7 (Takes with Receipts)** is higher value than it looks. It is @moorhaus_'s entire engine, and the differentiator available to you is that he has opinions while you have opinions *plus* evidence.
- **Promo gets its own rule:** event and release announcements measure worst on every account here. They belong in the self-reply CTA and in the bio, not as posts.
- **The bio is a conversion surface** and nothing in the current plan addresses it. Worth a pass of its own.
- **The reply quota should aim at the 1k–10k enthusiast band** of the scene graph, not the 5 accounts over 10k.

## 6. Not established

1. Whether any of this transfers to an English-language, design-adjacent audience.
2. Views, impressions, profile clicks, link clicks — none of it is in a bird timeline. Your own are one `x-monitor` sync away (≈3 metered X API calls); other accounts' are owner-only forever.
3. Whether @moorhaus_'s cluster converts to bookings at all, or is a listening audience with no buying power.
4. Any causal claim. Everything here is correlation on one page of one timeline per account.
