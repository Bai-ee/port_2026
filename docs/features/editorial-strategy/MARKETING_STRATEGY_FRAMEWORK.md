# Marketing Strategy Framework v2.0

Status: established human standard for editorial strategy configs.

## Principle

Cadence is marketing strategy. It should not live in a separate `SCHEDULE_POLICY.json`.

The Marketing Strategy Framework is the client's editorial operating manual:

```text
Client Brain
  -> Marketing Strategy Framework
  -> Campaign Manifests
  -> Strategy Builder
  -> Editorial Strategy Engine
  -> Post Queue
```

## Runtime Artifact

The framework can be documented in Markdown, but Strategy Builder runs on a compiled JSON strategy pack.

- Human standard: this Markdown document defines the strategy model and required fields.
- Client runtime: `docs/company-brain/clients/{client-id}/EDITORIAL_STRATEGY.json`
- Dashboard UX: Strategy Builder > Inputs > Marketing Strategy Pack

Operators should paste/import the JSON pack into Strategy Builder. The app saves it as `strategyBuilder.config.editorial`, normalizes it through the Editorial Strategy Engine, and uses it to seed campaign-first schedules.

Do not treat a long-form Markdown strategy memo as the direct runtime feed. Convert approved campaign strategy into the JSON pack first.

## What It Defines

The framework should contain:

- strategic positioning
- audience and authority territories
- campaign library
- campaign manifests
- editorial formats
- conversation selection rules
- daily adaptation limits
- schedule policy
- approval policy
- success evaluation

## Schedule Policy

Schedule policy defines how Strategy Builder constructs and maintains long-term publishing schedules.

It can define:

- platforms: primary, secondary, tertiary
- publishing cadence by platform
- preferred publishing windows
- campaign allocation
- narrative rotation rules
- editorial format rotation
- asset reuse policy
- daily adaptation limits
- quiet periods
- promotion windows
- fallback rules
- approval policy
- success evaluation metrics

## Runtime Rule

Strategy Builder uses schedule policy to generate the initial calendar.

Editorial Strategy Engine uses daily signals to decide whether to:

- publish the scheduled post unchanged
- adapt the scheduled execution
- swap within the same campaign
- rarely interrupt the campaign

The Editorial Strategy Engine does not replace the strategy. It expresses today's active strategy.

## Bryan Reference Defaults

Bryan's reference pack lives at:

`docs/company-brain/clients/bryan-balli/EDITORIAL_STRATEGY.json`

It includes:

- daily weekday X cadence
- LinkedIn twice per week when professional value exists
- campaign allocation targets
- narrative rotation constraints
- format rotation constraints
- asset reuse after 60 days
- daily adaptation limits
- fallback and approval policy
