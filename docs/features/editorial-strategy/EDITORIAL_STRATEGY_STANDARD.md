# Editorial Strategy Standard

Status: established runtime standard.

## Purpose

The Editorial Strategy Standard defines how HITLOOP turns approved Client Brain intelligence into campaign-first publishing strategy.

The Client Brain decides what is true about the client. The Editorial Strategy layer decides how that truth should be expressed over time through campaigns, schedules, prepared assets, daily signal adaptation, and operator-approved posts.

## Established Files

The locked editorial strategy standard is defined by these files:

- `docs/features/editorial-strategy/MARKETING_STRATEGY_FRAMEWORK.md`
- `docs/features/editorial-strategy/CAMPAIGN_MODEL.md`
- `docs/features/editorial-strategy/CAMPAIGN_MANIFEST.md`
- `docs/features/editorial-strategy/NARRATIVE_MODEL.md`
- `docs/features/editorial-strategy/DAILY_ADAPTATION_RULES.md`
- `docs/company-brain/clients/{client-id}/EDITORIAL_STRATEGY.json`

Bryan's current reference runtime pack is:

`docs/company-brain/clients/bryan-balli/EDITORIAL_STRATEGY.json`

Treat that file as the reference implementation for the current Strategy Builder runtime pack.

## Core Rule

Editorial Strategy is not a post generator.

It is the campaign and scheduling standard that sits between approved Client Brain decisions and daily publishing execution:

```text
CLIENT_BRAIN.md
  -> compiled Client Brain runtime
  -> Marketing Strategy Framework
  -> EDITORIAL_STRATEGY.json
  -> Strategy Builder
  -> Editorial Strategy Engine
  -> 30-day calendar
  -> daily recommendation
  -> operator approval
  -> Post Queue
```

## Source vs Runtime

The standard has two layers:

- Human standard: Markdown docs define the strategy model, editorial rules, required objects, and validation checklist.
- Runtime pack: `EDITORIAL_STRATEGY.json` is the structured artifact Strategy Builder consumes.

Do not upload a long-form Markdown strategy memo as the direct runtime feed. Convert approved strategy into `EDITORIAL_STRATEGY.json`, then manage it in Strategy Builder through:

`Strategy Builder > Inputs > Marketing Strategy Pack`

## Relationship To Client Brain

Client Brain remains upstream and authoritative for:

- positioning
- audience
- proof
- voice
- decision drivers
- discovery keywords
- watchlists
- prohibited claims
- approved strategic constraints

Editorial Strategy consumes those approved decisions and defines:

- long-term campaigns
- campaign allocation
- weekly narrative focus
- prepared assets
- platform cadence
- preferred publishing windows
- narrative rotation
- asset reuse policy
- daily adaptation limits
- fallback rules
- approval policy
- success evaluation

If a daily editorial insight changes strategy, it should suggest a Client Brain or campaign update. It should not silently overwrite approved Client Brain decisions.

## Required Runtime Shape

Every client editorial runtime pack should use:

```json
{
  "enabled": true,
  "frameworkVersion": "2.0",
  "schedulePolicy": {
    "platforms": {
      "primary": ["x"],
      "secondary": ["linkedin"],
      "tertiary": ["website", "newsletter"]
    },
    "publishingCadence": {},
    "preferredPublishingWindows": {},
    "campaignAllocation": {},
    "narrativeRotation": {},
    "editorialFormatRotation": {},
    "assetReusePolicy": {},
    "dailyAdaptationLimits": {},
    "fallbackRules": [],
    "approvalPolicy": [],
    "successEvaluation": []
  },
  "operatorPreferences": {},
  "campaigns": [],
  "recentPublishing": []
}
```

## Campaign Requirements

Each campaign should define:

- `id`
- `name`
- `status`
- `priority`
- `allocationPct`
- `strategicObjective`
- `positioningObjective`
- `targetAudience`
- `supportedClientBrainTopics`
- `supportingProjects`
- `narrativeBuckets`
- `keywords`
- `dailySignalTriggers`
- `editorialFormats`
- `fallback`
- `duration`
- `weeklyFocus`
- `successMetrics`
- `assetLibrary`

## Asset Requirements

Each prepared asset should define:

- `id`
- `title`
- `type`
- `description`
- `narrative`
- `projects`
- `topics`
- `platforms`
- `keywords`
- `clientBrainDecisionRefs`
- `evergreenScore`
- `freshnessScore`
- `preparedCopy`
- `mediaHint`

Assets are reusable content objects. They are not one-time scheduled posts.

## Daily Adaptation Rule

Daily signals may change execution. They must not redefine strategy.

Allowed:

- update hook
- reference current discussion
- reference current event
- adjust terminology
- swap supporting examples
- adjust platform formatting
- select a stronger prepared asset from the same campaign

Disallowed:

- invent a new strategy
- abandon campaign positioning
- chase unrelated trends
- publish only because something is trending
- overwrite Client Brain decisions without operator approval

## Validation Checklist

Before loading a strategy pack:

- `frameworkVersion` is set to `2.0`.
- `enabled` is explicit.
- `schedulePolicy` exists.
- Platform cadence is present for all primary platforms.
- Campaign allocation totals are intentional.
- Campaigns have clear strategic and positioning objectives.
- Campaigns reference approved Client Brain topics where possible.
- Campaigns include narratives, signal triggers, editorial formats, and fallback rules.
- Prepared assets include platform, keyword, topic, and Client Brain decision references.
- Daily adaptation limits are present.
- Fallback and approval policies are present.
- The JSON parses cleanly.
- `normalizeEditorialStrategyConfig()` succeeds.
- Strategy Builder can save the pack through `strategyBuilder.config.editorial`.

## Runtime Consumers

The strategy pack may influence:

- Strategy Builder calendar generation
- Editorial Strategy Engine recommendation scoring
- daily signal influence decisions
- campaign/narrative/asset selection
- Post Me copy context
- Social Posting prompt context
- Market Insights interpretation
- future campaign performance learning

Manual operator choices still win over generated recommendations.

## Non-Goals

The Editorial Strategy Standard does not replace:

- Client Brain
- Knowledge Base
- Marketing Brief
- Market Insights
- Post Queue approval
- Social platform publishing controls

It coordinates those layers into durable campaign-first strategy.
