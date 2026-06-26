# Client Brain Completion

Client Brain completion is an informational score. It does not block cards from running.

The score helps operators see which decisions are missing, stale, low-trust, or under-approved.

## Domains

Completion is calculated for:

- Identity
- Authority
- Market
- Discovery
- Content
- Opportunity

Each domain has deterministic required fields. A field is complete when its compiled `DecisionValue.value` is non-empty.

## Signals

The score considers:

- Required field coverage
- Approved decisions
- Enabled source coverage
- Source trust
- Source freshness
- Contradictions
- High-priority missing data

## Runtime Shape

```ts
completion: {
  score: number;
  informationalOnly: true;
  domains: {
    [domain: string]: {
      score: number;
      completeFields: Array<{ path: string; label: string }>;
      missingFields: Array<{ path: string; label: string }>;
      approvedCount: number;
      requiredCount: number;
      sourceScore: number;
      trustScore: number;
      freshnessScore: number;
      conflictPenalty: number;
    };
  };
}
```

The runtime also stores `missingDecisionQueue`, sorted by priority.

## Missing Decision Queue

The queue turns gaps into operator actions.

Example:

```json
{
  "priority": "high",
  "domain": "discovery",
  "field": "decisions.intelligence.discovery.watchLists",
  "label": "Watchlists",
  "action": "Define watchlists for discovery intelligence."
}
```

The queue is a roadmap, not a validation gate.
