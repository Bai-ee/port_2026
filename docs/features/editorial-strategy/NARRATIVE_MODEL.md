# Narrative Model

Status: implemented as narrative buckets and daily narrative strength scoring.

## Principle

A narrative is a reusable editorial lens. It is not a one-off post idea.

Campaigns can contain multiple narratives. Daily signals help decide which narrative is strongest today, but they should not redefine the campaign.

## Example

Campaign: Creative Systems

Narratives:

- AI Workflow Integration
- Brand Translation
- Creative Operations
- Cross-Medium Design

Daily signal: Teams are debating AI-assisted product design workflow.

Result: `AI Workflow Integration` becomes the strongest narrative for the day. The campaign remains `Creative Systems`.

## Narrative Strength

The engine scores each campaign narrative against daily signals. Each narrative receives:

- `score`: 0 to 100
- `strength`: `weak`, `medium`, or `strong`
- `matchedSignals`: the signals and terms that explain the score

This lets downstream cards explain why HITLOOP chose a narrative instead of making the recommendation feel magical.

## Runtime Use

Narrative strength is included in the editorial recommendation and prompt context:

```text
Narrative strength:
AI Workflow Integration 94/100 strong
Brand Translation 42/100 weak
```

## Operator Rule

If a daily signal reveals a durable new narrative, the system should suggest a Client Brain or campaign update. It should not silently rewrite the campaign.
