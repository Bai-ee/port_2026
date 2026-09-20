# X content engine — session handoff

> **Pick up here.** This is the continuity doc for the X growth + archive-content workstream. It owns no findings — it says what exists, what was decided, what is blocked, and what to do next. Every claim links to the doc or module that owns it.

**Last updated:** 2026-09-20 (P0–P3 complete + the day-view card, 202 X tests passing) · **Branch:** `feat/brief-rendered-scrape-phase-1`

---

## 0. Resume in one minute

```bash
/x-strategy                                             # the skill: loads docs, verifies read path, pulls state
node scripts/x-content/session-brief.mjs --days 14      # where the account stands now
node scripts/x-content/day-view.mjs --posts 5           # today's plan: slots, matched content, named gaps
#                                                      # ...or open the X Content Engine card (same plan, same builder, read-only)
node scripts/x-content/draft-day.mjs                     # draft the copy (dry run, free)
node --test 'features/x-*/__tests__/**/*.test.{js,mjs}' # 192 tests, all passing as of this doc
```

All three are free, local, read-only, and cannot post.

---

## 1. What this workstream is

Two halves being joined:

- **Demand** — the X system already decides *when* to post, *what type*, and *in which lane*, from a measured benchmark gap. It emits slots with `copy: null, asset: null` because nothing knows what content exists.
- **Supply** — 30 years of records, flyers, productions, design work and career history, being processed into a permanent archive by [`Bai-ee/assetManager@feat/archive-master-plan`](https://github.com/Bai-ee/assetManager/tree/feat/archive-master-plan/docs/archive).

The join is an inventory, a matcher, and a ledger. Architecture: [`ARCHIVE-X-CONTENT-ENGINE-PLAN.md`](./ARCHIVE-X-CONTENT-ENGINE-PLAN.md).

**The goal in one line:** log in each morning, see the day's posts with content matched and copy drafted, approve, done — while the account grows into three monetization paths (DJ bookings, record sales, design/dev leads) from **one** feed.

---

## 2. Map — who owns what

| Layer | Where | Status |
|---|---|---|
| Session boot + protocol | `scripts/x-content/session-brief.mjs`, [`X-STRATEGY-SESSION-PROTOCOL.md`](../source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md), `.claude/skills/x-strategy/` | ✅ |
| The X system map | [`X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) | ✅ pre-existing |
| Strategy + tiers + targets | [`X-STRATEGY-SEB-MODEL.md`](./X-STRATEGY-SEB-MODEL.md) | ✅ pre-existing — **§7 rules 1/4 corrected, rule 8 added 2026-09-20** |
| Spend gate | [`X-API-AND-PROFILE-OPERATIONS.md`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) | ✅ pre-existing |
| Categories, pillars, vocabulary map | `features/x-content-inventory/categories.js` | ✅ P0 |
| `ContentPackage` schema + validator | `features/x-content-inventory/schema.js` | ✅ P0 |
| The inventory itself | `features/x-content-inventory/content-packages.json` | ⚠️ **3 rows — the bottleneck** |
| Occasion catalog ("why post this today") | `features/x-content-inventory/triggers.js` | ✅ 21 triggers; 2 wired (anniversary, self-quote) |
| Matcher | `features/x-content-inventory/match.js` + 9 tests | ✅ P1 (+ ledger-fed self-quote slots) |
| Daily plan view | `scripts/x-content/day-view.mjs` | ✅ P1 (+ gap report, + adoption floor) |
| Daily plan card (dashboard) | `features/x-content-inventory/day-plan-projection.js` + 10 tests, `app/api/dashboard/x-content/route.js`, `DashboardPage.jsx` card `x-content-day`, `styles/dashboard/12-x-content.css` | ✅ read-only, admin-only, **cannot post or draft** |
| Competitive + monetization research | [`x-monetization-research.md`](../audits/x-monetization-research.md), [`x-music-scene-graph.json`](../audits/x-music-scene-graph.json) | ✅ |
| Copy patterns | [`x-copy-patterns.md`](../audits/x-copy-patterns.md) | ✅ |
| Post ledger + resurrection | `features/x-content-inventory/ledger.js` + 7 tests | ✅ P2, **backfilled from the corpus** |
| Jev question set (archive ⇄ engine seam) | `features/x-content-inventory/jev-taxonomy.js` | ✅ data; worker must vendor the JSON export |
| Copy drafting | `features/x-content-inventory/draft.js` + 8 tests, `scripts/x-content/draft-day.mjs` | ✅ P3 |
| Shared day-plan builder | `features/x-content-inventory/plan-day.js` | ✅ (day-view and draft-day share it) |
| Publish path | — | ❌ P4, **blocked** (§5) |
| Still → video render | — | ❌ P5 |
| Pillar lift reporting | — | ❌ P6 |

---

## 3. Decided — do not relitigate without new data

| # | Decision | Why |
|---|---|---|
| 1 | **One account, not six.** Brands (Housepit, Secret Studio, Underground Existence, HITLOOP) are *endpoints*, not feeds. | Volume is the entire measured gap; splitting divides it. Six accounts is six cold starts and abandons 1,725 existing followers. |
| 2 | **Links in the first self-reply, never the post.** | 44% engagement penalty measured; also lets one feed carry four different CTAs without fragmenting. |
| 3 | **A showcase slot requires video, always.** Stills route to text slots until P5 exists. | A static image reaches *less* than plain text; video beats image 3.4× within a type. Caught by a test during P1. |
| 4 | **Promo is not a post type.** Releases and gigs live in the self-reply and the bio. | Measured on three separate accounts: promo is the worst-performing thing each publishes (16–26 vs 100–235 on @toshioueki). |
| 5 | **D1 — three vocabularies, one mapping table.** Pillars (human) → lanes (guard) → topics (measurement). | Unmapped vocabularies silently classify everything `unknown`; the first two corpora shared 1 topic label of 28. |
| 6 | **Rights is a gate, not a field.** Client-touching material defaults to `client-approval-needed`. | Automating the wrong asset once costs a client relationship. |
| 7 | **Publishing stays behind an explicit human action.** | `bird tweet/reply/follow` are live account writes, same as the API. Spend gate §0. |

---

### Two findings from P2 that change the engine's shape

**1. Rank resurrections on VIEWS, not likes, when views exist.** This corpus has backfilled views for all 84 authored posts. Likes-ranking buried both documented breakouts (4,712 and 1,870 views) under a 4-like post that 60 people saw; view-ranking surfaced them as the top two candidates. Elsewhere in the system `lift` is likes-based and that stays correct — a bird timeline carries no views at all. `ledger.js` decides the basis per set and always reports which it used. Regression-guarded in `__tests__/ledger.test.js`.

**2. ⚠️ PROPOSED CHANGE TO `build-calendar.js` — the adoption floor.** A high-lift type the account never posts **cannot enter the plan**, because two individually-correct mechanisms hide it:

- `compareToBenchmark` damps mix moves on purpose (blind mix-matching scored 0.84× on the real pair), so a 0%-share type is nudged to ~1% and never wins a slot.
- Gap analysis is **share**-based, so it cannot flag a type the benchmark *also* posts rarely.

Self-quote is exactly that: the benchmark runs it at **2.49% share but 1.67× lift — its highest-lift type** — and `@bai_ee` has posted one in 84. No share comparison will ever surface it. The reason to adopt it is lift.

The floor (benchmark lift ≥1.3, benchmark n ≥8, own share <3% → one slot/day, borrowed from the most over-allocated type) is implemented **in `day-view.mjs`, deliberately not in `build-calendar.js`**, because that module is shared and tested. It should move there once someone agrees with it.

## 4. Open decisions

- **D1b — extend the topic vocabulary.** `PROPOSED_ARCHIVE_TOPICS` in `categories.js` lists 7 labels (chicago-house-history, record-digging, label-catalog, event-archive, dj-performance, hardware-performance, career-history). Until they land in `features/x-benchmark/taxonomy.js`, everything musical reads as one label and **"which vein earns reach" is uncomputable.** Applying them re-tags the committed corpora and moves regression fixtures — its own test-gated change.
- **D7 — who writes the story.** The one field no provider can produce. Recommended capture point is *archive review time*, while the artifact is already on screen.
- **Hashtags.** The no-hashtag rule was measured on design-Twitter (0 of 603). @toshioueki uses them on every record post and performs. Unresolved; do not copy blindly, worth one controlled test.

---

## 5. Blocked, and on what

1. **The inventory is 3 rows.** Everything downstream works and has nothing to work on. Needs ~20 artifacts with one sentence of story each. **Only the owner has this.**
2. **Publishing cadence.** Vercel Hobby cron is once daily; 10 posts/day is unschedulable. Options: local launchd publisher (the 06:30 scan already proves the pattern), or Vercel Pro.
3. **X API write credits.** Unknown balance, console-only, invisible to the Operating Cost card, and the account has already hit `CreditsDepleted` once. ~300 writes/month at tier 2.
4. **External-event triggers** (artist playing, venue news, reissue) are the *strongest* occasions in `triggers.js` and nothing feeds them. A gig/release feed keyed to the entity graph would be the single biggest upgrade to post quality.

---

## 6. Corrections made to existing docs

- **"Keep it short" is wrong as stated.** Top-30 benchmark posts average 265 chars / 3.9 lines; the bottom 200 average 102 / 1.9. Short applies to *quote captions*, not to originals. See [`x-copy-patterns.md`](../audits/x-copy-patterns.md) §1. `X-STRATEGY-SEB-MODEL.md` §7 rule 4 has not been edited yet.
- **2000s peak-hour house is not the viral bucket** it was assumed to be — it is the weakest record bucket measured (~54 avg likes vs ~145 for '92–'00 canon). Recognition beats rarity.
- **@moorhaus_'s cluster is minimal/hypnotic/tech-house heads, not classic-house heads.** The bridge into it is digging and history, not shared taste in records.

---

## 7. Next actions, in order

1. **Fill the inventory.** 10 records, 5 flyers, 5 productions → rows in `content-packages.json`. Validate with `validateInventory`. **This is the only blocker on everything else.** The card's **Gaps** tab names what is missing per slot and its **Inventory** tab lists every row that fails or warns, so the shortfall is now visible without running anything.
2. ~~P2 — the ledger.~~ ✅ done, and backfilled: self-quote slots propose real past winners today, with no new content and no new posts.
3. ~~P3 — copy drafting.~~ ✅ done. Shapes per series, refuses an empty story, guard + score on every draft, `--execute` instrumented through `logAnthropicCall`. **Does not write to `social_posts` yet** — that is the first step of P4.
4. **P4 — publish path**, after the owner answers §5.2 and §5.3.
5. **P5 — still → video**, which is what unlocks the archive for showcase slots at all.

---

## 8. For the Company Brain

The reusable voice material from this workstream belongs in `CLIENT_BRAIN.md` under `Content Intelligence`:

- **Voice Pillars** ← the six pillars in `categories.js`
- **Example Posts** ← the copy shapes in [`x-copy-patterns.md`](../audits/x-copy-patterns.md) §6, once real posts exist to quote
- **Formatting Rules** ← no hashtags (design lane), no inline links, claim in line 1, ID line last on record posts

⚠️ Do not paste the *benchmark's* posts in as examples — few-shot examples teach voice, and those are someone else's voice. Wait for the account's own winners and pull them from the ledger.
