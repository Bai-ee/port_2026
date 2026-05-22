# Brain Phase 4 - Strategy Builder Wiring

## Goal

Expose Knowledge Base retrieval to the frozen Strategy Builder as a toggleable source using source key `knowledge-base`.

This is the only phase allowed to edit Strategy Builder files, and edits must stay minimal.

## Required Reading

- `docs/BRAIN_FEATURE_PLAN.md`
- `docs/STRATEGY_BUILDER_PLAN.md`
- `app/api/dashboard/strategy-builder/generate/route.js`
- `components/dashboard/strategy-builder/InputsPane.jsx`
- `features/strategy-builder/prompt.js`
- `features/strategy-builder/schemas.js`
- `features/knowledge-base/retrieval.js`
- Current Phase 3 search behavior

## Approval Gate

Start only after Phase 3 has been verified and approved.

Do not migrate toggle storage to `client_configs` unless a human explicitly approves that migration as a separate compatibility task. Default: follow current repo behavior under `dashboard_state/{clientId}.strategyBuilder.config.sources`.

## Agent Operating Model

- Lead Agent owns the scoped Strategy Builder patch.
- Explorer Agent may inspect exact prompt/context/source toggle patterns.
- Worker Agent may edit only files listed in this prompt.
- Reviewer Agent verifies minimal diff, toggle behavior, prompt cap, and validation.

## Files In Scope

Edit:

- `app/api/dashboard/strategy-builder/generate/route.js`
- `features/strategy-builder/prompt.js`
- `features/strategy-builder/schemas.js`
- `components/dashboard/strategy-builder/InputsPane.jsx`
- `DashboardPage.jsx` only if card-open routing needs adjustment for `knowledge-base`

Do not edit unrelated Strategy Builder behavior.

## Implementation Requirements

- Add `knowledgeBase` to StrategyContext docs.
- Add `knowledge-base` to `DATA_SOURCES` with card id `knowledge-base`.
- Read source toggle using existing `srcOn('knowledge-base')` semantics.
- If enabled, build a retrieval query from existing server-side context such as:
  - client name
  - vertical
  - brief positioning/audience/objectives
  - campaign objective/guardrails/promotions
  - Marketing Brief headline/human brief where available
- Retrieve top 5 chunks server-side.
- Inject only a compact Knowledge Base block into `features/strategy-builder/prompt.js`.
- Apply a hard character cap before prompt injection.
- If disabled, do not retrieve and do not inject any Knowledge Base block.
- Never inject raw item documents.

## Prompt Behavior

The Knowledge Base block should be factual context for post angles and claims. The prompt should instruct the model to use it as supporting client-owned expertise, not as a source of invented dates, events, or offers.

## Acceptance Criteria

- InputsPane shows Knowledge Base source row with readiness chip and open-card button.
- Toggle on causes generate route to retrieve KB chunks and include compact context.
- Toggle off excludes KB context and avoids retrieval.
- Strategy generation still returns valid structured plan.
- Existing Marketing Brief, SEO, Visual DNA, and signal behavior remain intact.

## Verification

- Run `npm run test` if practical.
- Run `npm run build` if feasible.
- Manually verify generation with Knowledge Base enabled and disabled.
- Inspect generated prompt path or logs only if safe; do not leak sensitive content into committed files.

## Stop Point

When Phase 4 is complete, summarize:

- files changed
- toggle behavior verified
- tests run
- risks or follow-ups

Then stop and wait for approval before Phase 5.
