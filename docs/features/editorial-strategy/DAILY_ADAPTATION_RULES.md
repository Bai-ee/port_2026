# Daily Adaptation Rules

Status: implemented as `influenceDecision` in the Editorial Strategy Engine.

## Principle

Daily signals influence execution. They do not redefine strategy.

The system must behave like an Editorial Director:

- stable long-term positioning
- reusable prepared assets
- current-market awareness
- operator approval before publishing

## Influence Levels

| Level | Target Frequency | Action |
| --- | ---: | --- |
| `no-change` | 50% | Publish the originally scheduled content without strategic changes. |
| `adapt` | 30% | Keep the scheduled campaign direction, but update the opening hook, terminology, or example. |
| `swap-within-campaign` | 15% | Replace today's scheduled asset with a stronger prepared asset from the same campaign. |
| `interrupt-campaign` | 5% | Temporarily interrupt the schedule only for an exceptional market event that reinforces approved positioning. |

## Allowed Adaptations

The system may:

- update the opening hook
- reference today's discussion
- reference a current event
- adjust terminology
- swap supporting examples
- adjust platform formatting
- select a stronger prepared asset from the same campaign

## Disallowed Adaptations

The system must not:

- invent a completely different strategy
- abandon campaign positioning
- chase unrelated trends
- publish only because a topic is popular
- overwrite Client Brain decisions without operator approval

## Morning Workflow

```text
Load Client Brain
  -> Load active campaigns
  -> Collect Market Insights and daily signals
  -> Score narrative strength
  -> Score prepared assets
  -> Resolve influence level
  -> Recommend action
  -> Operator approves, edits, or rejects
```

## Learning Loop

If the operator overrides the recommendation, the override should be fed back as structured editorial learning:

- wrong campaign
- wrong narrative
- wrong asset
- weak signal match
- stale prepared asset
- new strategic insight

Only durable strategic insight should update Client Brain.
