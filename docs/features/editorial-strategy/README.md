# Editorial Strategy Engine

Editorial Strategy is HITLOOP's campaign-first publishing strategy layer.

The committed architecture is:

```text
CLIENT_BRAIN.md
  -> compiled Client Brain runtime
  -> Marketing Strategy Framework
  -> EDITORIAL_STRATEGY.json
  -> Strategy Builder
  -> Editorial Strategy Engine
  -> Calendar / Daily Recommendation / Post Queue
```

Status: established runtime standard, integrated into Strategy Builder. No scheduling behavior was removed.

Framework: HITLOOP Marketing Strategy Framework v2.0.

## Start Here

Read in this order:

1. `EDITORIAL_STRATEGY_STANDARD.md` — locked editorial strategy standard and validation checklist.
2. `MARKETING_STRATEGY_FRAMEWORK.md` — the human-readable strategy model and schedule policy standard.
3. `CAMPAIGN_MODEL.md` — campaign-first planning model.
4. `CAMPAIGN_MANIFEST.md` — the campaign object Strategy Builder schedules.
5. `NARRATIVE_MODEL.md` — narrative buckets and daily narrative strength scoring.
6. `DAILY_ADAPTATION_RULES.md` — allowed/disallowed daily signal adaptations.

## Current Runtime

Canonical runtime pack:

- `docs/company-brain/clients/{client-id}/EDITORIAL_STRATEGY.json`

Required Strategy Builder upload pack:

- `docs/features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json`

Canonical feature tracking doc:

- `docs/source-of-truth/STRATEGY-BUILDER-EDITORIAL-PACK.md`

Bryan reference runtime pack:

- `docs/company-brain/clients/bryan-balli/EDITORIAL_STRATEGY.json`

Dashboard mirror:

- `dashboard_state/{clientId}.strategyBuilder.config.editorial`

Dashboard UX:

- `Strategy Builder > Inputs > Marketing Strategy Pack`

## Primary Files

- Locked standard: `docs/features/editorial-strategy/EDITORIAL_STRATEGY_STANDARD.md`
- Framework standard: `docs/features/editorial-strategy/MARKETING_STRATEGY_FRAMEWORK.md`
- Engine: `features/editorial-strategy/engine.js`
- Tests: `features/editorial-strategy/__tests__/engine.test.js`
- Strategy Builder config route: `app/api/dashboard/strategy-builder/config/route.js`
- Strategy Builder generate route: `app/api/dashboard/strategy-builder/generate/route.js`
- Strategy Builder input UX: `components/dashboard/strategy-builder/InputsPane.jsx`
- Strategy Builder prompts: `features/strategy-builder/prompt.js`
- Strategy Builder schemas: `features/strategy-builder/schemas.js`

## Runtime Artifact

Markdown defines the standard. JSON feeds the system.

Use the Markdown docs to design and validate strategy. Use `EDITORIAL_STRATEGY.json` to load the strategy into Strategy Builder.

The dashboard upload expects a full `strategyBuilder.config` JSON pack, not a raw editorial-only object. The full pack includes vertical, cadence, signal toggles, source toggles, events, campaign controls, and `editorial`. The app saves `strategyBuilder.config.editorial`, normalizes it through `normalizeEditorialStrategyConfig()`, and uses the complete config to hydrate the Strategy Builder UI before generation.

The operational upload template is `STRATEGY_BUILDER_CONFIG_PACK.example.json`. It is intentionally broader than the canonical `EDITORIAL_STRATEGY.json` runtime file because the dashboard needs enough data to hydrate every visible Strategy Builder control, not only the editorial engine.

## Strategy Builder Upload Pack

Required root:

```json
{
  "strategyBuilder": {
    "config": {
      "vertical": "",
      "days": 30,
      "postsPerDay": 1,
      "baselineMixPct": 40,
      "rampAggressiveness": 0.5,
      "signals": {},
      "sources": {},
      "events": [],
      "campaign": {},
      "editorial": {}
    }
  }
}
```

Required `campaign` fields:

- `objective`
- `ctaText`
- `ctaUrl`
- `postTime`
- `postTime2`
- `guardrails`
- `emojiPolicy`
- `maxHashtags`
- `promotions`

Hydrated UI groups:

- Marketing Strategy Pack summary and impact rows
- JSON-Hydrated Controls
- Card Evidence Sources
- Signal Inputs
- Local Events
- Cadence controls

For the complete implementation map and tracking status, use `docs/source-of-truth/STRATEGY-BUILDER-EDITORIAL-PACK.md`.

## Purpose

HITLOOP should behave like an Editorial Director:

- campaigns remain stable
- prepared assets remain reusable
- daily market signals influence which prepared story is recommended today
- posts remain operator-approved before publishing

The planning unit is a campaign, not a post.

## Architecture

```text
Client Brain
  -> Marketing Strategy Framework
  -> Campaign Manifests
  -> Strategy Builder
  -> Editorial Strategy Engine
  -> 30 Day Calendar
  -> Daily Signal Evaluation
  -> Editorial Recommendation
  -> Post Queue
```

Strategy Builder still owns the calendar. It schedules from Campaign Manifests and the embedded Schedule Policy. The Editorial Strategy Engine decides whether today's market context should leave scheduled content alone, adapt it, swap in a stronger prepared asset, or rarely interrupt the schedule.

## Hierarchy

```text
Annual Positioning
  -> Quarterly Themes
  -> Monthly Campaigns
  -> Campaign Library
  -> Weekly Narrative Focus
  -> Prepared Assets
  -> Daily Signals
  -> Narrative Strength
  -> Opportunity Ranking
  -> Editorial Recommendation
  -> Operator Approval
  -> Publish
```

## Runtime Objects

Implemented in `features/editorial-strategy/engine.js`:

- `Campaign`
- `Asset Library`
- `Narrative`
- `Signal Trigger`
- `Opportunity Score`
- `Editorial Recommendation`
- `Narrative Strength`
- `Influence Decision`
- `Schedule Policy`
- `Campaign Manifest`

## Campaign Shape

Each campaign acts as a Campaign Manifest. It can define:

- strategic objective
- positioning objective
- allocation percentage
- target audience
- supported Client Brain topics
- supporting projects
- asset library
- narrative buckets
- keywords
- daily signal triggers
- editorial formats
- fallback
- campaign duration
- weekly focus
- success metrics

## Schedule Policy

Schedule policy is a first-class section inside the Marketing Strategy Framework, not a separate file. Cadence, publishing windows, channel mix, campaign allocation, rotation, reuse, promotion limits, quiet periods, fallback behavior, and approval rules are marketing strategy.

The Strategy Builder uses these defaults to construct the initial calendar. The Editorial Strategy Engine may adapt execution daily while respecting the constraints.

## Asset Shape

Each reusable asset can define:

- type: `screenshot`, `video`, `image`, `design-file`, `case-study`, `story`, `thread`, `quote`, `historic-work`, or `current-work`
- campaign
- narrative
- projects
- topics
- platforms
- keywords
- associated Client Brain decisions
- evergreen score
- freshness score
- prepared copy
- media hint

## Daily Engine

The engine evaluates daily signals from:

- Market Insights / Marketing Brief
- KOL activity
- competitor activity
- category trends
- brand mentions
- viral opportunities
- local events
- holidays / seasonality

It then scores prepared assets by:

- campaign priority
- narrative alignment
- signal relevance
- asset readiness
- platform fit
- recent publishing penalty
- operator preferences

It also scores narrative strength so the system can explain which narrative is strongest today before it recommends an asset.

## Influence Levels

Daily signals do not automatically rewrite the calendar. The engine assigns one influence level:

| Level | Target Frequency | Meaning |
| --- | ---: | --- |
| `no-change` | 50% | Publish the originally scheduled content without strategic changes. |
| `adapt` | 30% | Keep the scheduled campaign direction, but update hook, terminology, or example. |
| `swap-within-campaign` | 15% | Replace today's scheduled asset with a stronger prepared asset from the same campaign. |
| `interrupt-campaign` | 5% | Temporarily interrupt the schedule only for an exceptional market event that reinforces approved positioning. |

## Strategy Builder Integration

The layer is optional and sits above the existing Strategy Builder schedule.

Flow:

```text
strategyBuilder.config.editorial
  -> normalizeEditorialStrategyConfig()
  -> schedulePolicy + campaign manifests
  -> buildDailyEditorialRecommendation()
  -> prompt context
  -> plan.editorialRecommendation
  -> existing calendar / push flow
```

Existing scheduling remains intact. If no campaign/asset aligns with the daily signal environment, the engine returns `mode: "fallback"` and Strategy Builder uses the originally scheduled/default content direction.

## Rules

- Do not chase unrelated trends.
- Do not abandon campaign positioning because a different topic is temporarily popular.
- Do not invent a new strategy from daily signals.
- Daily signals may change hooks, examples, terminology, media hints, or platform formatting.
- Daily signals must not redefine the campaign.

## Docs

- `README.md` — this index and current status.
- `STRATEGY_BUILDER_CONFIG_PACK.example.json` — required upload example for full UI hydration.
- `EDITORIAL_STRATEGY_STANDARD.md` — established runtime standard.
- `MARKETING_STRATEGY_FRAMEWORK.md` — campaign, schedule, approval, and evaluation framework.
- `CAMPAIGN_MODEL.md` — campaign-first planning model.
- `CAMPAIGN_MANIFEST.md` — active scheduling object inside the strategy pack.
- `NARRATIVE_MODEL.md` — reusable editorial lenses and daily narrative strength.
- `DAILY_ADAPTATION_RULES.md` — rules for daily market signal adaptation.
