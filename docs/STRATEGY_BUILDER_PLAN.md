# Strategy Builder — Source of Truth Plan

Last updated: 2026-05-18
Status: ALL 5 PHASES IMPLEMENTED AND VERIFIED WORKING. Build + logic +
localhost smoke + real end-to-end (real Claude generation → real
social-posting queue insertion) all pass for dog-walker and restaurant
verticals. A real bug was fixed during E2E: build-strategy.js MAX_TOKENS
4096 → 16384 (4096 truncated 30-day plan JSON). Live Twitter posting
(processDuePosts→postToTwitter) intentionally not triggered — schedulePost
is the auto-poster feed boundary and the cron is pre-existing/unchanged.

This is the frozen source-of-truth document for the Strategy Builder workstream.
Read this first. Do not drift to older plans.

---

## 1. Objective

Turn every piece of data the pipeline has generated for a client into a
daily / weekly / 30-day social post strategy that feeds the installed Twitter/X
auto-poster. The user composes a strategy by toggling **data sources** (cards
that already produced data) and **external signals** (Local Weather, Local
Events, Industry Holidays). The engine builds a baseline cadence plus ramp arcs
toward the next legitimate vertical-relevant event, and pushes scheduled posts
into the auto-poster queue.

Concrete behavior the user expects:

- Dog-walker client: toggle Weather + Holidays → daily baseline posts, a ramp
  campaign toward National Dog Walker Appreciation Day, weather-aware posts.
- Restaurant client: toggle Holidays → baseline (specials, closed days) plus a
  ramp campaign building excitement toward Cinco de Mayo.
- Always: responsible baseline (closed days, weekly specials, day-to-day), while
  always working toward the next capitalizable anchor.

---

## 2. Current architecture (what already exists and works)

The scaffold is mature, not stubs. Do **not** rebuild these.

| Component | File | State |
|---|---|---|
| Strategy engine (Claude call + validation + retry) | `features/strategy-builder/build-strategy.js` | Functional |
| Prompt builder (baseline/ramp/closure/special rules) | `features/strategy-builder/prompt.js` | Functional |
| Type contracts | `features/strategy-builder/schemas.js` | Functional |
| Holiday map (per-vertical, fixed + moveable) | `features/strategy-builder/holidays-vertical-map.js` | Functional, rich |
| Holiday resolver | `features/strategy-builder/signal-providers/holidays.js` | Functional |
| Generate route (aggregate → Claude → save) | `app/api/dashboard/strategy-builder/generate/route.js` | Functional but shallow (see gaps) |
| Config save route | `app/api/dashboard/strategy-builder/config/route.js` | Functional |
| Push route (feed auto-poster) | `app/api/dashboard/strategy-builder/push/route.js` | Functional |
| Card shell + tabs (INPUTS/CALENDAR/PUSH) | `components/dashboard/StrategyBuilderCard.jsx` | Functional |
| Inputs / Calendar / Push / SignalToggles / PacingStrip panes | `components/dashboard/strategy-builder/*` | Functional, incomplete UI |
| Card registration + modal mount | `DashboardPage.jsx:68, 102, 4508, 7813` | Wired |
| Twitter auto-poster + cron (every 15 min) | `features/social-posting/twitter-service.js`, `app/api/social-posting/*`, `vercel.json` | Functional |

Auto-poster contract (already satisfied by the push route):
`POST /api/social-posting` `{ action:'schedule', content, scheduledAt, source }`.
Cron `/api/social-posting/process-due` posts items where `scheduledAt <= now`.

---

## 3. Gaps — this is the actual work

### GAP 1 — Data aggregation is shallow and reads the wrong brief path (HIGH)
`generate/route.js` builds `StrategyContext` from only:
`leadgen`, `snapshot.visualIdentity`, `snapshot.scribe.brief`, `analyzer`.

- `snapshot.scribe.brief` is empty for Marketing-Brief clients. Per
  `docs/MARKETING_BRIEF_HANDOFF.md`, the rich brief lives at
  `dashboard_state.marketingBrief` (`headline`, `scoutBrief.humanBrief`,
  `scoutBrief.agentData` = brandMentions / kolActivity / categoryTrends /
  competitorIntel / viralOpportunities, `content`, `contentOpportunities`,
  `guardianFlags`). None of this reaches the strategy prompt today.
- Not surfaced at all: Visual DNA, Brand Guide v2, design evaluation,
  `leadgen.generation`, `seoAudit`. The explicit ask is "leverage ALL the
  available data any card has generated."

Required: a single canonical aggregator that reads every known
`dashboard_state` / `client_configs` namespace, gated by a per-source enable
map (`config.sources.{key}.enabled`) so the user's UI toggles actually change
what the model sees.

### GAP 2 — Weather provider is a mock stub (MED)
`signal-providers/weather.js:42` returns fabricated forecast. Real Open-Meteo
call is commented in at lines 28–40 (no API key needed). Must use real data,
honor the enable flag and require `lat/lng`.

### GAP 3 — Events provider returns empty (MED)
`signal-providers/events.js:17` never loads anything. Its own comment specifies
the source: `dashboard_state/{clientId}.strategyBuilder.events`. Needs the
provider to read that path plus a UI to add/edit events.

### GAP 4 — UI is missing the explicit ask: source line-items + toggles (HIGH)
`InputsPane.jsx` has 3 read-only chips + 3 signal toggles. The requested UI is a
**Data Sources** list: one line item per data-generating card, each showing
presence/readiness, a link/affordance to open that card's modal, and an on/off
toggle that flows into `config.sources` and is honored server-side by the
aggregator (GAP 1). Must match the existing dashboard "Nothing" template.

### GAP 5 — Vertical taxonomy mismatch (HIGH, silent failure)
Lead-gen seeds snake_case (`pet_services`, `home_services`, `real_estate`).
Holiday map + `InputsPane` VERTICALS use kebab (`pet-services`,
`home-services`, `real-estate`). Result: pre-fill `<select>` does not match,
and `getHolidaysForVertical(vertical)` returns nothing for seeded clients.
Needs one normalizer (snake/space → kebab + alias map) applied at the InputsPane
default and in `generate/route.js` before `getHolidays`.

### GAP 6 — Push payload + robustness (LOW)
`push/route.js:86` sends `agents: []`. Confirm the social-posting service
treats an empty array as "run server-side agents" vs. "no optimization";
prefer omitting `agents` so `runPostingAgents()` runs, or pass strategy
hashtags through. Sequential self-fetch of 30+ items to `VERCEL_URL` is slow
but acceptable for v1 — flag a future batch endpoint, do not build it now.

### GAP 7 — Rolling "always toward the next event" (LOW)
Ramp arcs exist in the prompt. Enhancement: when the nearest legitimate anchor
is beyond the window, still seed a forward teaser so the calendar always points
at the next capitalizable event. Weekly-cadence shaping for the "weekly"
strategy view. Lower priority.

---

## 4. Canonical data contract

`StrategyContext` (see `schemas.js`) must be extended. The aggregator reads
server-side only (never trust client-supplied strategy data) and applies the
per-source enable map. Add to context:

```
brief:        from dashboard_state.marketingBrief (preferred) else snapshot.scribe.brief
intelligence: marketingBrief.scoutBrief.agentData (brandMentions, kolActivity,
              categoryTrends, competitorIntel, viralOpportunities),
              marketingBrief.contentOpportunities
brand:        snapshot.visualIdentity (+ brandSnapshotOverrides.styleGuide),
              brand guide v2 if present
visualDna:    leadgen_prospects.visualDna.masterPromptBlock (media hints only)
seo:          dashboard_state.seoAudit (headline gaps / topics)
cardFindings: dashboard_state.analyzer (unchanged)
sources:      { [sourceKey]: { enabled: boolean } }  ← drives inclusion
```

Each source key is independently switchable. A disabled source must be excluded
from the prompt (not just hidden in the UI).

---

## 5. Vertical taxonomy (canonical = kebab-case)

Canonical set is the kebab keys already used by `holidays-vertical-map.js` and
`InputsPane` VERTICALS:
`restaurant, bar, cafe, dog-walker, pet-services, fitness, wellness, salon,
beauty, real-estate, retail, e-commerce, healthcare, clinic, auto, repair,
legal, accounting, home-services, hvac`.

Normalizer rules: lowercase, `_`/space → `-`, then alias map
(`pet_services→pet-services`, `home_services→home-services`,
`real_estate→real-estate`, `gym_fitness→fitness`, `med_spa→beauty`,
`auto_repair→repair`, `auto_shop→auto`, `dog walk*→dog-walker`,
`restaurant/food/eatery→restaurant`, etc.). Apply at InputsPane default and in
`generate/route.js` before signal resolution.

---

## 6. UI specification

Reuse the established dashboard template and tab system (the card is already
mounted in the tile-detail modal). Apply `/redesign-skill` and `/nothing-design`
during the UI phase to the established tokens already in the codebase — do not
invent a new palette:

- Accent: `#4ade80`; surfaces `rgba(255,255,255,0.04–0.12)`; text
  `#e5e5e5 / #888 / #666 / #555`; mono font; uppercase labels, `0.08em`.
- Tabs use existing `tile-detail-tab` classes (already in the card shell).
- Every edited container gets a stable kebab DOM id (repo rule), e.g.
  `strategy-builder-data-sources`, `strategy-builder-source-row-marketing-brief`.

**INPUTS pane** becomes three stacked sections:

1. `strategy-builder-data-sources` — line item per data-generating card:
   `[toggle] LABEL — readiness chip — ↗ open card`. Cards: Marketing Brief,
   Brand Snapshot, Daily/Scout Brief, Lead Gen Profile, Visual DNA, SEO
   Performance (extend as cards are added). Readiness chip = ready / partial /
   empty from presence checks. The `↗` opens that card's modal via the existing
   tile-modal mechanism. Toggle writes `config.sources.{key}.enabled`.
2. `strategy-builder-signal-toggles` — existing Weather / Events / Holidays
   (keep), plus an Events editor row when Events is on (GAP 3).
3. `strategy-builder-cadence-sliders` — existing length / posts-per-day /
   baseline mix / ramp aggressiveness (keep).

CALENDAR and PUSH panes: verify they render `kind` (baseline/ramp/event/
closure/special) and anchors; add daily vs weekly grouping toggle for the
"daily / weekly / 30-day" views.

---

## 7. Phased build order (stop for approval after each phase)

**Phase 1 — Data foundation (no UI).**
Vertical normalizer; canonical aggregator (add `marketingBrief` + intelligence
+ all namespaces + per-source enable map honored in the prompt); real
Open-Meteo weather; Firestore-backed events provider.
Accept: a Marketing-Brief client's plan visibly reflects `agentData`; holidays
resolve for a snake-case seeded vertical; disabling a source removes it from the
prompt.

**Phase 2 — Data Sources UI.**
Rebuild INPUTS "Data Sources" line-item list with readiness + open-card link +
toggles, wired to `config.sources`. Apply `/redesign-skill` + `/nothing-design`
against existing tokens. Stop.

**Phase 3 — Events UX.**
Add/edit events UI feeding `strategyBuilder.events`; provider already reads it
after Phase 1. Stop.

**Phase 4 — Calendar / Push polish.**
Verify kind/anchor rendering; daily/weekly grouping; fix push `agents` payload;
end-to-end verify items land in `social-posting-queue.json` and cron posts.
Stop.

**Phase 5 — Hardening.**
Holiday legitimacy review pass (`LAST_REVIEWED`), forward-anchor teaser when
nearest anchor is beyond window, `npm run build` + smoke test. Stop.

---

## 8. Risks / not verified

- `social-posting` behavior for `agents: []` not yet confirmed (Phase 4 checks).
- Open-Meteo availability/latency in prod — provider must fail soft (signals are
  already non-fatal in `generate/route.js`).
- Sequential push of 30+ posts is slow; acceptable v1, not re-architected here.
- Brand Guide v2 / Visual DNA live on `leadgen_prospects` keyed by `placeId`,
  not `clientId` — Phase 1 must resolve the prospect link before reading them.

---

## 8b. Market Category feed (added 2026-05-18)

The **Market Category** card (`id: 'industry'`) is now editable: auto-detects
from `snapshot.brandOverview.industry`, user override saved via
`/api/dashboard/market-category/config` → `dashboard_state.marketCategory`.
Strategy Builder vertical resolves: per-strategy override → `marketCategory`
→ `brandOverview.industry` → `leadgen.vertical`, normalized. InputsPane notes
the category is changed in the Market Category card. Added `gambling` and
`e-games` to the canonical taxonomy + holiday anchors (Big Game Sunday,
Black Friday/Cyber Monday promos). Verified: build + normalizer/holiday logic
+ real gambling E2E (industry string → vertical → plan → queue) all pass.

## 8c. Campaign Setup (added 2026-05-18)

InputsPane "Campaign Setup" section: objective, primary CTA + URL, preferred
posting time(s), emoji policy, max hashtags, free-text content guardrails
(hard constraints), and an active-promotions editor. Persisted under
`strategyBuilder.config.campaign`; sanitized server-side in both config and
generate routes; surfaced to the model via a CAMPAIGN block + prompt rules
13–16 (guardrails absolute, objective-biased CTAs, posting-window scheduling,
promotions as time-bound kind='special' ramps). No dynamic "reviews/trending"
source was added — `briefing_database` does not exist; the freshest pipeline
data already flows through the Marketing Brief source. Verified: build +
real E2E (gambling + guardrails/objective/postTime/promotion → plan respects
hashtag cap, no emoji, no guaranteed-win, CTA + promo ramps, queued).

## 8d. Market Category RUN (agent classify) — added 2026-05-18

`POST /api/dashboard/market-category/analyze` gathers evidence from
`dashboard_state.siteMeta` (Social Preview / OG title+description — strongest
signal), `snapshot.brandOverview`, `snapshot.scribe.brief`, `marketingBrief`,
`leadgen`, and `client_configs.sourceInputs`, then calls Claude
(createAnthropicClient) to return `{category,confidence,rationale,evidence}`.
The agent's term is kept verbatim (cleanLabel tidies formatting only) — it is
NOT coerced to the canonical list; the list is the human fallback. Saved to
`dashboard_state.marketCategory` with `source:'agent'`. Downstream the Strategy
Builder still applies `normalizeVertical` for holiday-bucket matching (e.g.
"poker" -> gambling), so a specific label and correct holiday targeting
coexist. MarketCategoryPanel has a "Run analysis" button (confidence/why/
evidence); the card also has an on-tile RUN (footerAction, next to Details,
like other cards) via a shared handler. Insufficient evidence -> `enough:false`
and the card opens for manual selection. Verified: build + real agent test —
OG "POKER GAME" -> "poker" @0.99 (not e-games/gambling); cantina ->
"mexican-restaurant".

## 9. Files involved

Engine: `features/strategy-builder/{build-strategy,prompt,schemas}.js`,
`features/strategy-builder/holidays-vertical-map.js`,
`features/strategy-builder/signal-providers/{weather,events,holidays}.js`
Routes: `app/api/dashboard/strategy-builder/{generate,config,push}/route.js`
UI: `components/dashboard/StrategyBuilderCard.jsx`,
`components/dashboard/strategy-builder/{InputsPane,SignalToggles,CalendarPane,PushPane,PacingStrip}.jsx`
Wiring: `DashboardPage.jsx` (68, 102, 4508, 7813 — already done)
Poster contract: `app/api/social-posting/route.js`,
`features/social-posting/twitter-service.js`, `vercel.json`
Reference: `docs/MARKETING_BRIEF_HANDOFF.md`
