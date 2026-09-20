# Archive → X content engine — strategy plan

> **Status: CONCEPT.** Nothing in this document is built. It captures the 2026-09-19 strategy thread and proposes the join between two systems that already exist separately. No schema here is final; §11 is the list of decisions the owner still has to make.

**What this is:** the bridge between the **HITLOOP Archive** (a ~1 TB NAS of 30 years of material becoming a permanent, deduplicated, AI-understood public archive) and the **X growth system** (which already decides what should be posted, when, and in what format, but has no idea what content exists).

**What it is not:** a redesign of either side. The Archive's architecture is owned by [`Bai-ee/assetManager@feat/archive-master-plan` `docs/archive/`](https://github.com/Bai-ee/assetManager/tree/feat/archive-master-plan/docs/archive) (`ARCHITECTURE.md`, `CURRENT_STATE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`). The X side is owned by [`X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) and [`X-STRATEGY-SEB-MODEL.md`](./X-STRATEGY-SEB-MODEL.md). Both win over this doc on their own ground.

---

## 1. The two halves, as they actually stand

Verified 2026-09-19 by reading both repos, not from memory.

### Demand side — already built, and already blank where content goes

`features/x-benchmark/build-calendar.js` generates a calendar from the measured benchmark gap. Every slot it emits looks like this:

```js
{ slot: 'B', timeCT: '13:00', type: 'original-showcase', lane: 'work',
  brief: 'post in your lane',
  copy: null, asset: null, selfReply: null,        // ← the hole
  dynamic: false, guard: {...} }
```

`features/x-quote-targets/day-plan.js` fills **only** `type === 'quote-react'` slots, from the daily `bird` scan. Its own comment says the rest "is copy someone already wrote."

Nobody wrote it. That is the entire bottleneck: the system can say *"13:00, showcase, work lane, video"* every day and has nothing to put in it. `X-GROWTH-SYSTEM.md` §9 states the same conclusion from the other direction — "the bottleneck is cadence, not tooling."

Measured cost of the hole: **1.0 authored post/day against a tier-1 target of 5** (session brief, 14-day window, 2026-09-19).

### Supply side — being built, and structurally ideal for this

From `assetManager` `docs/archive/`:

- **Identity is SHA-256 of bytes**, not path or filename. One `ContentAsset`, many `FileLocation`s.
- **`Entity`** is a generic graph node already typed `PERSON | ARTIST | BRAND | LABEL | PROJECT | EVENT | VENUE | RELEASE | RECORD | CITY | CLIENT`.
- **`Relationship`** is a typed edge with confidence and human-confirmed state.
- **`Observation`** (provider evidence) is separated from **`JevDecision`** (typed taxonomy choice + probability) is separated from **`HumanCorrection`** (never overwrites the machine record) is separated from **`ArchivalRecord`** (the approved current interpretation).
- Review bands: `>0.90 AUTO_CONFIRM · 0.60–0.90 QUICK_REVIEW · <0.60 IDENTIFICATION_REQUIRED`.
- Approved assets get a permanent **Arweave TX** and a public URL that does not depend on HITLOOP or Firebase.

That is a content-addressed, entity-graphed, human-approved, publicly-addressable library. It is a better substrate for a posting engine than anything a social tool would have built for itself.

### The seam nobody has to invent

`port_2026` **is** this repo. The Archive control plane (`app/archive/`, `app/api/archive/*`, `api/_lib/archive-*.cjs`) and the X engine (`features/x-*`, `app/api/dashboard/quote-targets`, Copywriter, `social_posts`) already live in one codebase, one auth model, one Firestore. No integration between products — just a module that reads one and writes the other.

---

## 2. What is missing — three things, in order

1. **A publishing projection.** The Archive answers *what is this, who is in it, is it real, is it permanent*. It does not answer *is this postable, on which platform, in which series, with what call to action, how much work is left*. Those are different questions with different lifecycles and they must not be stuffed into `ContentAsset`.
2. **A matcher.** Given tomorrow's slots (type + lane + hour) and today's signals (quote targets, opportunity signals, anniversaries), pick the best archive item for each hole and draft the post.
3. **A feedback ledger.** What got posted, from which asset, and how it performed — so the engine stops guessing and starts learning which veins of the archive actually earn reach.

---

## 3. The content reserve — the vocabulary the matcher needs

Captured from the 2026-09-19 thread. This is the owner's own taxonomy and it is the demand-side language the Archive's entities must map to.

### Six pillars

| # | Pillar | What it is |
|---|---|---|
| 1 | **I was there** | Housepit CHI, Chicago, San Francisco, flyers, parties, DJs, scene history |
| 2 | **I made this** | Records, tracks, performances, designs, websites, creative systems |
| 3 | **I found this** | Rare records, forgotten mixes, producers, labels, obscure artifacts |
| 4 | **Here is how it was made** | Production, pressing, design, animation, programming, archival work |
| 5 | **Here is what 30 years taught me** | Career, changing tech, agency life, creative judgment, surviving shifts |
| 6 | **Here is what I'm building now** | HITLOOP, EditTrax, releases, archive infrastructure, experiments |

⚠️ These are **not** the same as the X system's existing `lane` vocabulary (`work | craft | music | infra | casino | politics | meta`) in `features/x-content-guard/rules.js`, nor the 21-label topic taxonomy in `features/x-benchmark/taxonomy.js`. Three vocabularies now exist for the same material. Decision **D1** in §11.

### Source material → brand → strategic value

| Source material | Recurring content | Best home | Strategic value |
|---|---|---|---|
| Thousands of records | Rare Trax, needle drops, B-sides, label stories | Underground Existence | Taste and historical authority |
| Tracks you produced | Original Trax, old vs new, unreleased, production stories | Bai-ee / Secret Studio | Artist discovery, catalog sales |
| Making music on the PA | Hardware jams, loop development, mistakes, results | Bai-ee / Secret Studio | Performance and process |
| Housepit CHI archive | Live sets, crowd clips, residents, flyers, photos, booking stories | Housepit CHI | Proof you built a scene |
| Underground Existence mixes | Mix excerpts, track IDs, DJ features, recovered recordings | Underground Existence | Archive growth, DJ discovery |
| Secret Studio releases | Test pressings, manufacturing, sleeves, collaborators | Secret Studio | Record sales, collector interest |
| AudioJazz catalog | Retrospectives, collaborators, jazz-house history | Underground Existence / Bai-ee | Catalog rediscovery |
| Viva Acid | Panels, workshops, parties, artist conversations | Underground Existence | Cultural credibility |
| Graphic design archive | Flyers, covers, logos, sites, ads, abandoned concepts | Bryan / HITLOOP | 30 years of visual proof |
| Career history | Greystripe, ValueClick, Conversant, Publicis | Bryan / HITLOOP | Authority, personal narrative |
| Critters Quest work | UI, motion, campaigns, game systems | HITLOOP | Modern case studies |
| EditTrax | Players, remix experiments, ownership, infrastructure | HITLOOP / EditTrax | Product + technical credibility |
| Old websites / Flash | Rich media, early web, recovered files | HITLOOP | Design-history content |
| Work in progress | Screens, prototypes, failures, shipped versions | HITLOOP | Active practice |
| Personal scene stories | Chicago, SF, record stores, parties, crews | Bryan / Underground Existence | Makes the archive personal |

⚠️ **Critters and client work need a rights flag.** See §8 — this is a gate, not a field.

### One artifact → a content package

A single Housepit flyer is: the flyer image · the date and lineup · the booking story · a crowd clip · a live-set excerpt · a where-are-they-now on an artist · design commentary · an Underground Existence archive entry · an anniversary post · a HITLOOP post about preserving event history.

A record you produced is: turntable clip · production story · studio recreation · sleeve artwork · collaborator feature · test-pressing story · DJ footage · release retrospective · purchase link.

**This multiplication is the actual product.** One approved `ContentAsset` should generate *many* `ContentPackage` rows over years, not one post.

### Platform roles

X: short opinions, discoveries, stories, career observations, archive fragments. IG/TikTok/Shorts: turntable footage, PA performance, flyers, event clips. YouTube: full mixes, long record stories, design retrospectives. UndergroundExistence.info: the permanent record. Bandcamp/direct: records, editions, merch. LinkedIn/HITLOOP: professional history, case studies. Email: the audience you own.

> X builds reach; its real job is directing attention to things you control — music, records, services, archives, and an email list. **The engine must therefore optimise for the self-reply CTA, not just the post.**

---

### P0 as-built (2026-09-20)

The vocabulary and the categories are now code, not prose, so the matcher imports them instead of re-deriving them:

| File | Owns |
|---|---|
| `features/x-content-inventory/categories.js` | the 6 pillars, the **pillar→lane** and **pillar→topic** mapping (decision D1), the 9 series C1–C9 with cadence/slot-type/media/CTA, `DAILY_PLAN` (10 authored posts + 10 replies) |
| `features/x-content-inventory/schema.js` | the `ContentPackage` contract, `validatePackage`, `validateInventory` — errors are structural, warnings are strategic |
| `features/x-content-inventory/content-packages.json` | the live inventory (1 worked row + 2 skeletons at time of writing) |
| [`../audits/x-monetization-research.md`](../audits/x-monetization-research.md) | the measured evidence behind C1 and C7, and the scene graph |
| [`../audits/x-music-scene-graph.json`](../audits/x-music-scene-graph.json) | 54 music accounts derived from @moorhaus_'s following, role-tagged |

⚠️ **D1 is decided but only half-applied.** `PILLAR_TO_TOPICS` maps onto the existing 21-label vocabulary, which has **one** label (`music-audio`) for records, Housepit, label history, DJ sets and 30 years of Chicago house. `PROPOSED_ARCHIVE_TOPICS` lists the seven labels that would fix it. Applying them re-tags the committed corpora and moves the regression fixtures, so it is its own test-gated change — until it lands, "which vein earns reach" is uncomputable for the most differentiated half of the archive.

## 4. Proposed join — one projection, one matcher, one ledger

```
Archive (assetManager worker + Arweave)          X engine (this repo)
  ContentAsset ──sha256──┐                        buildCalendar → slots {type, lane, copy:null, asset:null}
  ArchivalRecord         │                        day-plan → fills quote-react only
  Entity / Relationship  │                        scan-quote-targets → live candidates
  Arweave TX + public URL│                        opportunity-signals → live narratives
                         ▼
              ┌─────────────────────┐
              │  ContentPackage     │  ← NEW. the publishing projection (§5)
              │  (HITLOOP/Firestore)│
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Matcher            │  ← NEW. slot demand × package supply × triggers (§6,§7)
              └──────────┬──────────┘
                         ▼
        guardXPost → scoreXPost → social_posts draft → Copywriter → human posts
                         │
                         ▼
              ┌─────────────────────┐
              │  Post ledger        │  ← NEW. sha256 → postedAt/platform/performance (§9)
              └─────────────────────┘
```

Everything downstream of the matcher already exists and is tested. The three new boxes are the whole build.

---

## 4b. The archive schema AS IMPLEMENTED — and the seam that is still open

Read from the code, not the doc, on 2026-09-20 (`Bai-ee/assetManager@feat/archive-master-plan`, `lib/archive/database.ts`, `types.ts`, `schema/asset-state.ts`, `jev/service.ts`).

**Six tables exist:** `sources` · `collection_jobs` · `content_assets` · `file_locations` · `observations` · `jev_decisions`.

**These do NOT exist in code yet**, though `DATA_MODEL.md` describes them: `Entity`, `Relationship`, `ArchivalRecord`, `ProviderUsage`, `ArweaveRecord`. (`HumanCorrection` is implemented differently and better — `jev_decisions.human_value` sits *beside* `selected_value`, so the machine record is preserved rather than overwritten.)

### What the engine can consume today

| Engine need | Archive source | Status |
|---|---|---|
| `assetRefs`, ledger key | `content_assets.sha256` | ✅ implemented |
| `mediaState` | `AssetState.mediaType` (`video/image/audio/document/other`) | ✅ — note it gives *type*, not "is this a postable video" |
| weak `eraYear` / `eventDate` evidence | `file_locations.modified_at_ms`, `relative_path` | ✅ but evidence only — a file mtime is not when the party happened |
| `pillar`, `series`, era, topics | `jev_decisions.selected_value` + `confidence` + review band | ⚠️ **schema ready, questions undefined** |
| `entities` (artist, venue, label, release) | — | ❌ **not in the schema** |
| permanent public URL | — | ❌ `ArweaveRecord` not in the schema |

### ⚠️ The entity graph is the dependency nobody has flagged

Four of the strongest triggers in [`triggers.js`](../../features/x-content-inventory/triggers.js) — `artistPlaying`, `venueNews`, `reissue`, `idRequest` — key off **entities**, and entities are exactly the part of `DATA_MODEL.md` that has no table. T2 quote-pairing needs them too: pairing a live post about Chicago house to your flyer *is* an entity join.

So the engine's ceiling is set by whether the Archive builds the entity graph, not by the matcher. That is worth saying out loud to whoever is building the Archive, because from inside that project entities look like a nice-to-have.

### The seam that is still open, and should be closed on purpose

`JevDecisionService.decide(assetState, question, choices)` takes **the question and the candidate choices from its caller**. Nobody has defined them yet. That means the taxonomy Jev answers is free to shape — and it should be shaped to emit this engine's vocabulary directly:

| Jev question | `choices[]` from | Fills |
|---|---|---|
| "which pillar does this belong to?" | `PILLARS` (6) | `ContentPackage.pillar` |
| "which series could post this?" | `SERIES` keys (C1–C9) | `ContentPackage.series` |
| "what era is this from?" | decade buckets | `eraYear` |
| "is this client work?" | yes / no / unclear | seeds the **rights gate** — anything `yes` defaults to `client-approval-needed` |
| "who or what is named in it?" | entity candidates | `entities` (needs the graph) |

Do that and a processed asset arrives as a **half-built `ContentPackage`** with confidence scores and review bands already attached — and the Archive's existing three-band human review becomes the package approval flow, at no extra build cost. `AUTO_CONFIRM > 0.90` packages can go straight to `status:'idea'`; anything lower lands in review, which is where a human is already looking.

What it still cannot produce is `story`. That stays §5's problem and the owner's.

## 5. `ContentPackage` — the publishing projection

One row per **thing you could post**, referencing (not duplicating) the archival record.

| Field | Why it cannot live on `ContentAsset` |
|---|---|
| `assetSha256[]` | a package can span several assets (flyer + crowd clip + set excerpt) |
| `pillar` | a publishing decision, not a fact about the bytes |
| `lane` / `topics` | must match the X vocabularies, which evolve independently |
| `series` | "Rare Trax Friday" is a schedule, not provenance |
| `eraYear` / `eventDate` | the archive knows `mtime`/`birthtime` and may infer an event date; the *anniversary* is a publishing trigger |
| `story` | the human memory. **The one thing no provider can produce** |
| `mediaReady` | `none · still · video · audio · needs-capture` — decides which slot types it can fill |
| `effort` | `ready · 10-min · needs-shoot · needs-edit` — the scheduler must not queue a shoot for 13:00 today |
| `rightsStatus` | `owned · cleared · client-approval-needed · never-public` (§8) |
| `platforms[]` | X / IG / YT / site / email |
| `cta` / `monetizationPath` | the reason the post exists at all |
| `status` | `idea · drafted · scheduled · posted · retired` |
| `lastPostedAt` / `postCount` | fatigue control (§9) |

**Where it lives:** HITLOOP Firestore, next to the rest of the dashboard state, because it is edited constantly and is not part of the permanent record. The Arweave manifest stays the immutable archive; `ContentPackage` is the mutable working layer on top. Putting publishing state on-chain would be a mistake — the archive's own invariant is that the *archival interpretation can evolve while observations stay traceable*, and posting state evolves fastest of all.

**How rows get created:** three ways, in increasing automation — (a) the owner writes one while reviewing a collection, (b) a template expands one approved asset into its N standard packages (the flyer → 10 posts above), (c) Jev proposes packages from entities/relationships and they land in the same review band model the Archive already uses. **(c) must never auto-publish** — it produces `status:'idea'` and nothing else.

---

## 6. The matcher

Pure function, no network, in the shape the repo already prefers (`features/x-benchmark/` is the precedent):

```
matchPackagesToSlots({ slots, packages, signals, ledger, today })
  → slots with { asset, copy, selfReply, matchReason, confidence }
```

Rules that fall directly out of measured findings:

- **Type gates media.** `original-showcase` needs `mediaReady: video` — a still is *worse than text* on reach (measured). A still-only package can only fill `original-text`, or route to §10 to be turned into video.
- **Effort gates time.** Only `effort: ready` can fill a slot inside 24h. `needs-shoot` becomes a capture task, not a post.
- **Lane must match the slot's lane**, which comes from the client's own profile.
- **Rights gate before anything else** (§8).
- **Fatigue check against the ledger** (§9).
- **Never fill a `quote-react` slot with an archive asset alone** — that slot's value is borrowed reach and belongs to `day-plan.js`. But see the pairing trigger below, which is the most interesting idea in this doc.

---

## 7. Trigger taxonomy — five ways a post gets chosen

| # | Trigger | Input it needs | Example |
|---|---|---|---|
| T1 | **Anniversary** | `eventDate` / `eraYear` on the package | "this party was 10 years ago today" — the archive's dated flyers make this free and infinite |
| T2 | **Quote pairing** | live quote candidate (scan) + package with matching entity/topic | someone posts about Chicago house; you quote it **with your own flyer from that scene attached**. Borrowed reach *and* proof, in one post |
| T3 | **Narrative** | Opportunity/Market Signals narrative + package topics | a thread about AI slop in design → the 1996 Flash file that took three weeks by hand |
| T4 | **Series** | `series` + a recurring calendar slot | Rare Trax Friday, Test Pressing Tuesday. Series is what makes a habit survivable |
| T5 | **Self-quote resurrection** | post ledger + `x_monitor` post metrics | your own winner from 6 months ago, re-surfaced. The benchmark's **highest-performing type**; you have used it once |

T2 is the one that does not exist anywhere else. Quote-react is the measured reach engine (11,451 avg views on the benchmark) and its weakness is that it is somebody else's content. Pairing it with an archive artifact converts borrowed attention into proof of your own — and X composes a quote tweet as `caption + trailing status URL`, which the guard already exempts, so **a quote tweet can carry your own media**. Nobody with a normal content library can do this. You have 30 years of it.

---

## 8. The rights gate

`rightsStatus` is a **gate the matcher checks first**, not a field it reports. Client work (Critters Quest, Greystripe-era, agency work) can be NDA-bound, embargoed, or owned by someone else. A posting engine that automates the wrong asset once costs a client relationship, and no amount of reach pays that back.

Rules:
- Default for anything touched by a `CLIENT` entity is **`client-approval-needed`**, not `owned`.
- `never-public` assets are filtered before the matcher sees them, not shown and skipped.
- The Archive's `HumanCorrection` model is the right precedent: a machine guess about rights is evidence, never permission.
- The permanent Arweave archive is **public by definition** (D011), so rights are resolved *before* archival approval, not at post time. The posting engine inherits that decision rather than re-litigating it — but it must still respect `never-public` for material that was archived privately or not archived at all.

---

## 9. The post ledger — and why sha256 is the unlock

Keyed on **content hash**, not post id or filename:

```
content_posts/{sha256} → [{ platform, postId, postedAt, packageId, performance }]
```

Because the Archive identifies content by bytes, the engine gets exact answers to questions every other social tool guesses at:

- Have I posted this exact flyer before? (fatigue)
- Did I post it on IG and forget X? (cross-platform coverage)
- Which *pillar* actually earns reach on this account — not which post, which **vein of the archive**? (this is the compounding part)

That last one closes the loop with the existing measurement layer: `features/x-benchmark/summarize.js` already computes lift by type, media and topic. Add `pillar` and `packageId` to the corpus row and the same machinery answers "I was there" vs "I made this" with the account's own data. **After ~60 days it stops being my opinion about your archive and becomes your measured lane ranking.**

---

## 10. Manufacturing media — the stills problem

Measured: **a static image reaches less than plain text**; video out-reaches image 3.4× within the same post type. Most of a 30-year archive is stills — flyers, sleeves, screenshots, scans. Posted as-is, the single largest part of the library is the *worst* performing format on the platform.

This repo already contains the fix, in surfaces built for other reasons:

| Asset shape | Existing tool | Output |
|---|---|---|
| Flyer / sleeve / poster still | **HoloPaper / ClothStudio** (`app/dashboard/studio/`) — cloth sim, grab/fling, MP4 export | the still, on simulated paper, moving |
| A mix or track | **LoopStudio / EditTrax player** | slicer UI, player, SP-16 scene |
| Any site or page | **Site Recreate** + **Video Promo** (Cloud Run studio render) | a scroll/dive video of the artifact |
| Source clips | **Video Remix** ⇄ EditVideos bridge | rendered short-form |

That turns "I have 4,000 flyers" into "I have 4,000 video posts". It is the highest-leverage unbuilt connection in this document, and it needs no new rendering technology — only a job that takes a package with `mediaReady: still` and emits `mediaReady: video`.

⚠️ Do not automate the *choice* of which still to render. Render on request, from a package the owner approved. Cloud Run render minutes are real money and 4,000 speculative renders is a bill, not a strategy.

---

## 11. Decisions the owner has to make

- **D1 — One vocabulary or three?** Pillars (6) vs X lanes (7) vs the benchmark topic taxonomy (21). Recommendation: keep pillars as the human-facing label, map them to lanes in one table, and let `taxonomy.js` stay the measurement vocabulary. Do not merge all three; do not let them drift unmapped.
- **D2 — Where does `ContentPackage` live?** Recommendation: HITLOOP Firestore (mutable), referencing `sha256` (immutable). Not on Arweave.
- **D3 — Does Jev propose packages, or only classify assets?** Recommendation: propose, at `status:'idea'`, inside the existing review-band model. Never straight to draft.
- **D4 — Does the Archive block the X work?** No. `ContentPackage` rows can be written by hand today for a handful of artifacts and the matcher will work. **The engine should be provable on 20 packages before 1 TB is processed.**
- **D5 — Rights default.** Recommendation: anything touching a `CLIENT` entity defaults to `client-approval-needed`.
- **D6 — Multi-platform now or X first?** Recommendation: X first, but design `ContentPackage.platforms[]` in from the start, because the ledger's cross-platform answer is worth more than the scheduling.
- **D7 — Who writes the story?** The one field no model can produce. Recommendation: a capture flow at *archive review time*, when the owner is already looking at the artifact — not a separate content chore later.

---

## 12. Sequencing (proposed, not approved)

1. **Hand-write 20 `ContentPackage` rows** across 3 pillars. No Archive dependency. Proves the schema against real material.
2. **Matcher v1** — pure function, fills `original-showcase` / `original-text` / `self-quote` slots from those 20. T1 (anniversary) + T4 (series) only.
3. **Ledger** — `content_posts/{sha256}`, written when Copywriter posts. Fatigue control immediately becomes real.
4. **T2 quote pairing** — the differentiated move; needs the scan and the packages in the same view.
5. **Archive → package proposal** — only once the Archive POC's §110 gaps close and real `ArchivalRecord`s exist.
6. **Still → video job** — on request, per package.
7. **Pillar lift reporting** — after ~60 days of ledger data, extend `summarizeCorpus` to rank pillars.

Steps 1–4 need nothing from the Archive build. That is deliberate: the X account's problem is **today**, and the Archive's timeline is measured in months of NAS processing.

---

## 13. Related

- Archive: [`assetManager@feat/archive-master-plan` `docs/archive/`](https://github.com/Bai-ee/assetManager/tree/feat/archive-master-plan/docs/archive) — `ARCHITECTURE.md`, `CURRENT_STATE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `TEST_PLAN.md`, `CONTROL_PLANE.md`
- Archive control plane in this repo: branch `feat/archive-jev-poc` — `app/archive/`, `app/api/archive/*`, `api/_lib/archive-*.cjs`, `public/archive-viewer/index.html`
- X system: [`X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) · [`X-STRATEGY-SEB-MODEL.md`](./X-STRATEGY-SEB-MODEL.md) · [`X-STRATEGY-SESSION-PROTOCOL.md`](../source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md) · [`X-GROWTH-PRODUCTIZATION-PLAN.md`](./X-GROWTH-PRODUCTIZATION-PLAN.md)
- Existing Arweave precedent: `Bai-ee/arweave-video-generator`, and [`ARCHIVE-PUBLISHING-CARD.md`](../source-of-truth/ARCHIVE-PUBLISHING-CARD.md) (the shipped EditVideos-bridge archive card — **a different, older surface than the Archive POC**; do not confuse them)
