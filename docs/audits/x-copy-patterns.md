# X copy patterns — what winning posts actually say

Measured 2026-09-20 over four corpora: `@seb__design` (603 authored posts, committed corpus), `@bai_ee` (84 authored), `@moorhaus_` and `@toshioueki` (one timeline page each). Likes-based — a bird timeline carries no view counts.

Companion to [`x-monetization-research.md`](./x-monetization-research.md), which covers *what* to post. This covers *how it is written*.

---

## 1. Length: the "keep it short" rule is wrong as stated

| Band (benchmark, by likes) | Avg chars | Avg lines | lowercase start | has `?` | emoji | link |
|---|---:|---:|---:|---:|---:|---:|
| **Top 30** | **265** | **3.9** | 80% | 7% | 23% | **0%** |
| Next 100 | 186 | 3.3 | 81% | 2% | 40% | 2% |
| Bottom 200 | **102** | **1.9** | 74% | 6% | 16% | 2% |

The bottom of his feed is the *short* end. Top posts are 2.6× longer and carry twice the line breaks.

⚠️ **Correction to [`X-STRATEGY-SEB-MODEL.md`](../plans/X-STRATEGY-SEB-MODEL.md) §7 rule 4 ("keep it short, originals ~117 chars").** That median is real but it describes the *whole* corpus, most of which is filler. Restated correctly:

- **Quote captions stay short** — the borrowed object carries the post. Median 46 chars, and the single best post in the corpus is 39 characters.
- **Original posts that win are longer and structured** — a claim, a line break, then the substance.

Short is not the lever. **Carrying its own weight** is: a caption on someone else's image can be six words because the image is the post; a post with no image has to be worth reading.

Confirmed unchanged: **zero links in the top 30**, and questions are rare in winners (7%) — consistent with audience-question posts underperforming their own baseline.

Casing and emoji are **not levers**. Lowercase starts run 74–81% across every band; emoji are *more* common in the middle band than the top.

---

## 2. Quote-react: one reusable frame

The reach engine's copy, top of corpus:

| Likes | Caption |
|---:|---|
| 1,585 | `japanese graphic design at it again 😮‍💨` |
| 694 | `designers of the pre internet era were so creative` |
| 572 | `japanese designers at it again 😔🙌🏻` |
| 474 | `cause u haven't had your daily dose of japanese designers yet` |
| 472 | `japanese designers are just a different beast` |
| 447 | `the goat is back on x` |
| 226 | `that's so lovely - feels like a real zine ✨` |
| 209 | `holyyy lightsaber - take all my money!!` |

**The formula is `[subject] + [awe verb] + optional emoji`, and he reuses the same frame with a different noun.** Four of the top five are the same sentence. There is no analysis, no explanation, no link, no credit in the post.

Transferable frames, noun swapped: *"chicago house flyers were just a different beast"*, *"the pre-internet era of record sleeves was so creative"*.

⚠️ **Never explain the joke.** Every top caption is a reaction. The moment a caption starts teaching, it stops borrowing the other post's momentum.

---

## 3. Original-showcase: the copy gets out of the way

| Likes | Copy |
|---:|---|
| 1,206 | `some of my favourite designs / animations` + media |
| 993 | `some r-rated slider action` ⏎⏎ `dev by @edo_lunardi for @blinktrade` |
| 457 | `i open figma. i create. i have fun.` |
| 134 | `idk` |
| 118 | `got the design itch and decided to go editorial` |

**When the media is strong the copy is nearly contentless.** "idk" earned 134. This is the opposite of the record-post model below, and the difference is what the artifact is: a motion demo explains itself, a 1994 record does not.

Credits go in the post only when they credit *someone else*; the link goes in the self-reply.

---

## 4. Original-text: confession and structure

| Likes | Opening |
|---:|---|
| 142 | `had to face a hard truth - i've fallen off.` ⏎⏎ … |
| 122 | `Be it branding, web design, motion design, product design etc - always look outside your box.` |
| 110 | `After becoming a full time freelance designer I've realised a couple of things:` ⏎⏎ `- 9 to 5 is a s…` |
| 83 | `hot take: most designers are mediocre because their ego and pride is bigger than their curiosity` |

Two shapes only: **the admission** ("i've fallen off", "the biggest phobia a designer can have") and **the list** ("a couple of things:" + line-broken items). Both open with the claim in the first line. Neither buries it.

@moorhaus_'s top post is the same species, louder: `like are you fucking kidding me???????? … if you ever hear someone making music like this in 2026 ALWAYS send` — **1,622 likes**, a claim with a rule attached, plus a demand on the reader.

His next four: `longer set times are better for both DJs and dancers` (236), `ID culture is dumb, but digging and discovery is the most beautiful part of music` (123), `if you EVER need an ID from me just reply on the post` (120).

**The pattern across both accounts: state a position on how the craft should work, then back it.** That is C7 (Takes with Receipts), and it is the highest-ceiling format either account has.

---

## 5. The record post — @toshioueki's fixed template

Every post, same structure:

```
[why this record matters — label, remixer, what it did, one personal memory]
⏎⏎
Artist - Title ('YY)
⏎⏎
#vinyl #record #アナログ
[media]
```

Worked example (228 likes, translated): *"Still captivating dance-music fans worldwide — an undeniable Detroit techno classic built by the two gods Mad Mike and Jeff Mills. Overwhelmingly cosmic!"* → `Underground Resistance - Jupiter Jazz ('92)`.

Three things this template does that a photo of a record does not:

1. **Places the record** — label, scene, year, who made it.
2. **Makes one specific claim** — "floor killer", "this is where the movement started", "uplifting in a way he never was again".
3. **Ends with the machine-readable ID** — `Artist - Title ('YY)`, so the post is searchable, quotable and answers the question before it is asked.

His birthday post (124) is the same template with a personal frame: *"I turned 53 today. So here is this track."* **Personal context is an occasion, not a detour.**

⚠️ **He uses hashtags on every record post and performs fine.** That directly contradicts the no-hashtag rule inherited from design-Twitter (0 of 603 on the benchmark). Unresolved: hashtags may function differently for Japanese-language record collectors, where tag search is a discovery path. **Do not copy the hashtags** — the rule stands on the design side where it was measured — but stop treating it as a universal law. Worth one controlled test later.

---

## 6. What to reuse, by series

| Series | Copy shape | Source |
|---|---|---|
| **C1 Record of the Day** | context → claim → `Artist - Title ('YY)` | §5 |
| **C3 Event Archive** | occasion first line, then what actually happened | §4 |
| **C6 Design/Dev** | let the video carry it; one line, no explanation | §3 |
| **C7 Takes with Receipts** | claim in line 1, receipt in line 3 | §4 |
| **C8 Quote-react** | `[subject] + [awe] + emoji`, six words, no analysis | §2 |
| **C9 Self-quote** | name the reason you are re-surfacing it | [`triggers.js`](../../features/x-content-inventory/triggers.js) `selfQuoteWinner` |

---

## 7. Not established

- All likes-based. No views, so nothing here is an engagement rate.
- One account per music model, one page each. The benchmark corpus is the only large sample.
- Language and audience confounds are unresolved — @toshioueki writes Japanese to a Japanese record audience.
- Correlation only. Top posts differ in format *and* subject *and* timing, and this cannot separate them.
