# X content engine — build manifest

Everything built in the 2026-09-20 session, where it lives, and how to verify it. For *why* any of it exists, read [`X-CONTENT-ENGINE-HANDOFF.md`](./X-CONTENT-ENGINE-HANDOFF.md) — this file is the inventory, not the reasoning.

**Totals:** 10 new files of code (1,939 lines incl. tests) · 6 new docs · 3 existing docs edited · 1 skill · **184/184 X tests passing** · **$0 spent** · **nothing posted**.

All of it is **uncommitted** on branch `feat/brief-rendered-scrape-phase-1`.

---

## 1. Run it

```bash
node scripts/x-content/session-brief.mjs --days 14                 # where the account stands
node scripts/x-content/session-brief.mjs --benchmark seb__design   # + A/B gap report
node scripts/x-content/session-brief.mjs --handle <anyone>         # profile any account
node scripts/x-content/day-view.mjs --posts 5                      # today's posting plan
node --test 'features/x-*/__tests__/**/*.test.{js,mjs}'            # 184 tests
/x-strategy                                                        # session-boot skill
```

Every one is free, local, read-only, and cannot post.

---

## 2. Code — `features/x-content-inventory/` (new module)

| File | Lines | What it owns |
|---|---:|---|
| `categories.js` | 234 | The 6 pillars · pillar→lane and pillar→topic mapping (decision D1) · 9 series **C1–C9** with cadence, slot type, media requirement, CTA · `DAILY_PLAN` · `PROPOSED_ARCHIVE_TOPICS` (the 7 labels the measurement vocabulary is missing) |
| `schema.js` | 139 | The `ContentPackage` contract · `validatePackage` / `validateInventory`. Errors are structural, warnings are strategic (thin story, still in a video series, anniversary with an unparseable date) |
| `match.js` | 230 | Slot ← package. Rights gate · **showcase-needs-video gate** · effort horizon · anniversary trigger · fatigue window · story weighting · self-quote slots fed from the ledger · **named gaps** ("a VIDEO package from: C1, C2 …") |
| `ledger.js` | 178 | Post history → fatigue by artifact hash + self-quote resurrection candidates. Picks views over likes when view coverage is high, and always reports which basis it used |
| `triggers.js` | 252 | **21 occasions** — why post this today. Each carries strength, detection method, the data it needs. `passing` (a death) is hard-flagged `neverAutomate` |
| `jev-taxonomy.js` | 174 | The 6 questions the Archive's Jev layer should answer so a processed asset arrives as a half-built package. Choices derive from `categories.js` so the two repos cannot drift. `clientWork` is a gate; `entities` is marked blocked |
| `content-packages.json` | — | **The live inventory. 3 rows: 1 real, 2 skeletons.** This is the bottleneck |
| `__tests__/match.test.js` | 96 | 9 tests — rights, media, effort, anniversary, fatigue, gap naming, no-double-use, thin story |
| `__tests__/ledger.test.js` | 85 | 7 tests, incl. a regression guard that view-ranking surfaces the two documented breakout posts |

## 3. Code — `scripts/x-content/` (new scripts)

| File | Lines | What it does |
|---|---:|---|
| `session-brief.mjs` | 337 | The session boot. Pulls a timeline via `bird`, normalizes it with the **same** `x-benchmark` functions the corpora use, prints cadence vs targets, mix deltaed against baseline, mechanical-rule violations, quote-target audit vs watchlist, gap days, and an explicit **NOT MEASURED** block. `--benchmark` adds the A/B gap report; `--json` for machine output |
| `day-view.mjs` | 214 | The daily plan. Builds the calendar from the measured gap report, applies the **adoption floor**, matches inventory + ledger into slots, prints what fills each one and names what is missing |

---

## 4. Docs — new

| File | Owns |
|---|---|
| [`X-CONTENT-ENGINE-HANDOFF.md`](./X-CONTENT-ENGINE-HANDOFF.md) | **Start here.** Continuity doc — resume commands, ownership map, 7 decisions with evidence, open decisions, blockers, next actions, Company Brain filing |
| [`ARCHIVE-X-CONTENT-ENGINE-PLAN.md`](./ARCHIVE-X-CONTENT-ENGINE-PLAN.md) | The architecture. Content reserve, six pillars, `ContentPackage`, matcher, ledger, 5 triggers, rights gate, media manufacture, 7 decisions. **§4b = the as-implemented archive schema and the open Jev seam** |
| [`../source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md`](../source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md) | How to run a strategy conversation — boot, read-path cost table, guardrails, what is already decided, the moves menu |
| [`../audits/x-monetization-research.md`](../audits/x-monetization-research.md) | @toshioueki genre buckets · @moorhaus_ engine · @KerriChandler as a dead end · the 54-account scene graph · **promo underperforms on every account measured** |
| [`../audits/x-copy-patterns.md`](../audits/x-copy-patterns.md) | How winning posts are written, by type, with real examples and the length correction |
| [`../audits/x-music-scene-graph.json`](../audits/x-music-scene-graph.json) | 54 music accounts from @moorhaus_'s following, role-tagged (34 enthusiasts / 11 artists / 9 venues), ready to become a watchlist |

## 5. Docs — edited

| File | Change |
|---|---|
| [`X-STRATEGY-SEB-MODEL.md`](./X-STRATEGY-SEB-MODEL.md) §7 | **Rule 4 struck through and restated** (top posts average 265 chars, not 117) · **rule 1 scope-corrected** (no-hashtags is a design-lane rule) · **rule 8 added** (promo is not a post type) |
| [`../source-of-truth/X-GROWTH-SYSTEM.md`](../source-of-truth/X-GROWTH-SYSTEM.md) | Header now lists four docs, not three · **new §8c** — the content layer and the three problems it found in the layers above it |
| `CLAUDE.md` (local, gitignored) | X bullet points at the handoff doc and the boot command |

## 6. Skill

`.claude/skills/x-strategy/SKILL.md` — project-scoped, gitignored, **live now**. Boots a strategy session: runs the brief, names the read order, fixes the first-reply format, loads the guardrails (including that `bird tweet/reply/follow` are live account writes), maps asks → commands.

## 7. Outside this repo

`~/Documents/Repos/assetManager` — cloned at branch `feat/archive-master-plan`.

- **`.gitignore` was an empty file.** `.env`, `node_modules`, `.next` and the worker's SQLite state were all trackable. Written properly; `.env.archive.example` explicitly preserved.
- `.env.local` created from the template, `chmod 600`, verified ignored. **Needs `TWELVELABS_API_KEY` *and* `TWELVELABS_INDEX_ID`** — the adapter's check is `Boolean(apiKey && indexId)`, so a key alone silently no-ops.

---

## 8. Not built

| | Phase | Blocked on |
|---|---|---|
| Copy drafting | P3 | inventory (it drafts from `story`) |
| Publish path | P4 | Hobby cron is once daily; X API write credits unknown |
| Still → video render | P5 | nothing — this is what unlocks the archive for showcase slots |
| Pillar lift reporting | P6 | 60 days of ledger data |
| Card UI for the day view | — | nothing; `day-view.mjs` is terminal-only today |
| Entity-fed triggers (artist playing, venue news, reissue) | — | the Archive has **no entity table**; these are the strongest occasions in the catalog |

## 9. Three findings that changed the build

1. **A showcase slot needs video, always** — caught by a test. A still reaches less than plain text, so the matcher refuses rather than filling the slot badly. Most of the archive is stills, which is why P5 matters more than first ranked.
2. **Rank resurrections on views, not likes** — likes-ranking buried both documented breakout posts (4,712 and 1,870 views) under a 4-like post 60 people saw.
3. **A high-lift, low-share type cannot enter the plan** — mix moves are damped on purpose *and* gap analysis is share-based, so self-quote (benchmark's best type at 1.67× lift, 2.49% share) is invisible to both. The adoption floor lives in `day-view.mjs` as a **proposed** change to `build-calendar.js`, not a silent edit of it.
