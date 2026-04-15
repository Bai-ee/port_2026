# Analyzers

Layer-A card analyzers. Each dashboard card has exactly one analyzer entry in
`../card-contract.js`. Swap an analyzer impl by adding a module here and
registering it in `index.js` — runner and normalize don't change.

## Interface

Every analyzer module exports a single async `run(input)` function:

```js
// input:
{
  card,            // entry from card-contract.js
  sharedResults,   // { intake, styleGuide, styleGuideCost, siteMeta, pagespeed }
  userContext,     // from user-context.js (may be null)
  evidence,        // SiteEvidence from site-fetcher.js
}

// output:
{
  status,          // 'ok' | 'empty' | 'skip' | 'error'
  confidence,      // 'high' | 'medium' | 'low' | null
  signals,         // { ... } | null — analyzer-specific payload (Scribe reads)
  notes,           // string | null — short human-readable note / error
  runCostData,     // null | { model, inputTokens, outputTokens, estimatedCostUsd }
}
```

## Current impls

| impl                      | Purpose                                                     |
|---------------------------|-------------------------------------------------------------|
| `runtime`                 | UI chrome cards (e.g. Intake Terminal). Always returns skip.|
| `passthrough`             | Reads `card.sourceField` from `sharedResults.intake`.       |
| `design-system-extractor` | Echoes the already-extracted styleGuide from sharedResults. |
| `pagespeed`               | Stub — returns empty until PageSpeed is wired into intake.  |

## Shared pre-computes

Heavy work runs once in `runner.js` before `runAnalyzers`:
- **Synth call** → `sharedResults.intake` (fans out to 7 passthrough cards)
- **Design system extract** → `sharedResults.styleGuide`

Analyzers never trigger LLM calls themselves — they read from the
pre-computed sharedResults. Adding a real analyzer with its own LLM call is
fine; just do the work inside the analyzer module and return runCostData.
