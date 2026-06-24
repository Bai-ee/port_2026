# Strategy Builder — Master Implementation Prompt

Hand this prompt to the implementing agent. It is self-contained.

---

## Role

You are the implementer for the Strategy Builder workstream in this Next.js
multi-tenant marketing dashboard. Build only what the approved phase covers.
Stop after each phase for approval.

## Source of truth

Read `docs/STRATEGY_BUILDER_PLAN.md` first and follow it exactly. Do not drift
to older plans. If the plan and the code disagree, trust the current code and
flag the discrepancy before changing anything.

## Hard constraints

- Phase discipline: implement only the approved phase; do not start later
  phases; do not "clean up adjacent things" unless required by the phase.
- Minimal diffs. Preserve established patterns, desktop behavior, and the
  existing tab/modal system. Do not introduce new libraries.
- The scaffold is mature — do NOT rebuild the engine, routes, holiday map, or
  card shell. The work is the gaps in section 3 of the plan.
- Server-side only for data aggregation. Never trust client-supplied strategy
  data; read Firestore in the route.
- Signals are non-fatal: weather/events/holidays failures must not break
  generation (match existing try/catch in `generate/route.js`).
- Every edited or new container gets a stable kebab-case DOM id naming by
  function (e.g. `strategy-builder-source-row-marketing-brief`). No generic
  names (container/wrapper/box).
- Report in the repo's compact format: Files changed / Behavior changed / Left
  untouched / Verification run / Manual test next / Risks.

## Design directives (UI phases only — Phase 2+)

- Invoke `/redesign-skill` and `/nothing-design` before writing UI, and apply
  them to the EXISTING dashboard tokens — do not invent a new palette:
  accent `#4ade80`; surfaces `rgba(255,255,255,0.04–0.12)`; text
  `#e5e5e5 / #888 / #666 / #555`; monospace; uppercase labels at `0.08em`.
- Reuse existing `tile-detail-tab` classes and the established modal. Match
  `SignalToggles.jsx` / `InputsPane.jsx` structural patterns for visual
  consistency. The result must look native to the current dashboard.

---

## Phase 1 — Data foundation (NO UI)

Files: `features/strategy-builder/signal-providers/{weather,events}.js`,
`app/api/dashboard/strategy-builder/generate/route.js`,
`features/strategy-builder/{prompt,schemas}.js`, new
`features/strategy-builder/normalize-vertical.js`.

1. Create `normalize-vertical.js`: lowercase, `_`/space → `-`, then the alias
   map in plan §5. Export `normalizeVertical(raw)`.
2. In `generate/route.js`: normalize `vertical` before `getHolidays` and before
   building context.
3. Extend the aggregator in `generate/route.js`:
   - `brief` from `dsData.marketingBrief` (headline, scoutBrief.humanBrief)
     with fallback to `snapshot.scribe.brief`.
   - Add `intelligence` from `dsData.marketingBrief.scoutBrief.agentData`
     (brandMentions, kolActivity, categoryTrends, competitorIntel,
     viralOpportunities) + `contentOpportunities`.
   - Resolve the lead-gen prospect link (placeId) to read
     `visualDna.masterPromptBlock` (media hints only) and brand guide if
     present.
   - Build `sources` enable map from `body.config.sources`; exclude any
     disabled source's data from the context object entirely.
4. `weather.js`: replace the mock with the commented-in Open-Meteo call; keep
   the enable + lat/lng guards; fail soft to `{ enabled:false, forecast:[] }`.
5. `events.js`: read `dashboard_state/{clientId}.strategyBuilder.events`
   (accept `{id,name,date}` items) when enabled.
6. Update `prompt.js` to include the new `intelligence` block compactly (cap
   strings, no echo) and `schemas.js` JSDoc for the new fields.

Accept: generating for a Marketing-Brief client yields posts that reflect
`agentData`; a snake-case seeded vertical (`pet_services`) resolves holidays;
toggling a source off in the request body removes it from the prompt. Run
`npm run build`. Stop for approval.

## Phase 2 — Data Sources UI

File: `components/dashboard/strategy-builder/InputsPane.jsx` (+ a small
`SourceRow` if it keeps the file readable).

- Add `strategy-builder-data-sources` section above signal toggles: one row per
  data-generating card (Marketing Brief, Brand Snapshot, Daily/Scout Brief,
  Lead Gen Profile, Visual DNA, SEO Performance). Each row:
  `[toggle] LABEL — readiness chip — ↗ open card`.
- Readiness from presence checks on `bootstrap.dashboardState` (ready/partial/
  empty). `↗` opens that card's modal via the existing tile-modal mechanism
  (reuse however other cards trigger `activeTileModal`; do not invent a new
  router). Toggle writes `config.sources.{key}.enabled`; default enabled when
  data is present.
- Keep existing signal toggles and cadence sliders unchanged.
- Apply the design directives above. Stop for approval.

## Phase 3 — Events UX

File: `InputsPane.jsx`. When Events signal is on, render an add/edit list
(name + date) writing to `config` so the debounced config save persists it; the
Phase 1 events provider already reads
`dashboard_state.strategyBuilder.events`. Wire the config route to persist
events under that path. Stop.

## Phase 4 — Calendar / Push polish

Files: `CalendarPane.jsx`, `PushPane.jsx`,
`app/api/dashboard/strategy-builder/push/route.js`.

- Verify Calendar renders `kind` and anchors; add a daily/weekly grouping
  toggle for the daily/weekly/30-day views.
- Fix the push payload: omit `agents` (so `runPostingAgents()` runs) or pass
  strategy hashtags; confirm against `app/api/social-posting/route.js`.
- End-to-end: generate → push → confirm items in
  `data/social-posting-queue.json` with `source` starting `strategy-builder:`
  and `status` scheduled/queued. Stop.

## Phase 5 — Hardening

- Holiday legitimacy pass; bump `LAST_REVIEWED` in
  `holidays-vertical-map.js` if changed.
- Forward-anchor teaser when the nearest legitimate anchor is beyond the
  window (plan §3 GAP 7).
- `npm run build` + localhost smoke test. Stop.

---

## Do NOT

- Do not rebuild the engine/routes/holiday map/card shell.
- Do not change desktop layout, copy, or unrelated cards.
- Do not add libraries, batch endpoints, or external event APIs (out of scope).
- Do not start a later phase before approval of the current one.
