# Strategy Builder Editorial Pack

Canonical doc for the gated Strategy Builder marketing strategy pack and JSON upload workflow. If another doc disagrees about the upload shape, hydrated UI fields, or generation path, this one wins.

Last updated: 2026-06-26

## Status

Status: gated feature, locally implemented, build-verified. Not launch-certified for public users.

The Strategy Builder now expects a full `strategyBuilder.config` upload pack for JSON import. Raw editorial-only JSON is no longer the preferred upload artifact because it cannot hydrate every visible Strategy Builder control.

## Where It Lives

| Surface | Location | Status |
| --- | --- | --- |
| Dashboard UI | `components/dashboard/strategy-builder/InputsPane.jsx` | `✓code` JSON paste, file import, pack validation, UI hydration, source badges |
| Signal UI | `components/dashboard/strategy-builder/SignalToggles.jsx` | `✓code` JSON/manual source badge |
| Save API | `app/api/dashboard/strategy-builder/config/route.js` | `✓code` sanitizes and saves config to Firestore |
| Generate API | `app/api/dashboard/strategy-builder/generate/route.js` | `✓code` uses config, sources, signals, campaign controls, editorial strategy |
| Editorial engine | `features/editorial-strategy/engine.js` | `✓code` normalizes campaigns, schedule policy, assets, narrative rules |
| Feature docs | `docs/features/editorial-strategy/README.md` | active feature index |
| Required example pack | `docs/features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json` | upload template |

## Required Upload Shape

The accepted file is a JSON object with this root:

```json
{
  "strategyBuilder": {
    "config": {
      "vertical": "creative-services",
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

Use the example file as the copyable source: `docs/features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json`.

## UI Hydration Contract

When a valid pack is applied or imported, the UI hydrates:

| UI group | Hydrated by JSON |
| --- | --- |
| Marketing Strategy Pack summary | `editorial.frameworkVersion`, `editorial.schedulePolicy`, `editorial.campaigns`, campaign assets, narratives, formats, triggers, fallback |
| JSON-Hydrated Controls | `vertical`, `campaign.objective`, `campaign.ctaText`, `campaign.ctaUrl`, `campaign.postTime`, `campaign.postTime2`, `postsPerDay`, `campaign.emojiPolicy`, `campaign.maxHashtags`, `campaign.guardrails`, `campaign.promotions` |
| Card Evidence Sources | `sources` |
| Signal Inputs | `signals` |
| Local Events | `events` |
| Cadence | `days`, `baselineMixPct`, `rampAggressiveness` |

Green source badges mean the current full config can set or steer that field. Amber/manual badges mean the current field is manual or not present in the pack.

## Runtime Flow

```text
Import JSON file or paste pack
  -> parseStrategyPackJson()
  -> validateStrategyConfigPack()
  -> hydrateConfigFromStrategyPack()
  -> onConfigChange(nextConfig)
  -> Save Config / Generate Strategy
  -> /api/dashboard/strategy-builder/config
  -> dashboard_state/{clientId}.strategyBuilder.config
  -> /api/dashboard/strategy-builder/generate
  -> normalizeEditorialStrategyConfig()
  -> buildDailyEditorialRecommendation()
  -> buildTodayStrategy() / buildStrategy()
  -> dashboard_state/{clientId}.strategyBuilder.lastPlan
```

Firestore persistence shape:

- `dashboard_state/{clientId}.strategyBuilder.config` stores the sanitized visible config and normalized `editorial`.
- `dashboard_state/{clientId}.strategyBuilder.events` stores local event rows used by the events signal provider.
- `dashboard_state/{clientId}.strategyBuilder.lastPlan` stores the generated plan.

## What The JSON Actually Steers

The uploaded JSON does not bypass the server. It hydrates the visible config, then the generate route sanitizes and combines it with server-side Marketing Brief, Client Brain, Knowledge Base, visual, SEO, and signal data.

Generation uses:

- `vertical` to select category-specific holidays and strategy context.
- `sources` to include or exclude Marketing Brief, Client Brain, KB, Visual DNA, SEO, brand snapshot, and related data blocks.
- `signals` and `events` to decide whether weather, holidays, and local event context enters the strategy context.
- `campaign` to constrain objective, CTA, post windows, guardrails, emoji use, hashtags, and active promotions.
- `editorial` to normalize schedule policy, campaigns, assets, narratives, daily signal triggers, fallback rules, and recent publishing memory.

## Validation Notes

The UI rejects incomplete packs before applying them. The save and generate APIs sanitize again server-side, so the UI is not trusted as the final authority.

Hydration silently clamps out-of-range numeric fields rather than rejecting them: `days` to 7–90, `baselineMixPct` to 10–60, `postsPerDay` to 1–5, `maxHashtags` to 0–5, `rampAggressiveness` to 0–1. Values outside these ranges are squashed to the nearest bound, not flagged.

Known constraint: this remains a gated feature. The production launch source of truth still treats Strategy Builder as out of launch scope unless this doc is later upgraded with preview and production smoke results.

