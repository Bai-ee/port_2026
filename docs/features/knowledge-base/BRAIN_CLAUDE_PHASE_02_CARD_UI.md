# Brain Phase 2 - Card UI

## Goal

Build the Knowledge Base dashboard card and modal UI so users can add pasted text, add URLs, list items, see status/counts, and delete items.

Do not add embeddings, PDF ingest, or Strategy Builder wiring in this phase.

## Required Reading

- `docs/BRAIN_FEATURE_PLAN.md`
- `DashboardPage.jsx`
- `components/dashboard/StrategyBuilderCard.jsx`
- `components/dashboard/strategy-builder/InputsPane.jsx`
- Existing dashboard card/modal patterns in `DashboardPage.jsx`
- Existing dashboard design tokens and `tile-detail-tab` classes in `DashboardPage.jsx`

## Agent Operating Model

- Lead Agent owns UI integration and final patch.
- Explorer Agent may inspect card/modal patterns and report exact insertion points.
- Worker Agent may edit only files listed in this prompt.
- Reviewer Agent verifies DOM IDs, visual consistency, and API wiring.

## Files In Scope

Create:

- `components/dashboard/KnowledgeBaseCard.jsx`
- `components/dashboard/knowledge-base/AddItemPanel.jsx`
- `components/dashboard/knowledge-base/ItemsList.jsx`

Edit:

- `DashboardPage.jsx`

Do not edit Strategy Builder files yet.

## Implementation Requirements

- Add a `knowledge-base` dashboard capability card.
- Dynamically import `components/dashboard/KnowledgeBaseCard.jsx`.
- Include card in onboarding/capability flow only if consistent with existing `ONBOARDING_CARD_IDS` behavior.
- Card must fetch its own item list through Phase 1 APIs.
- Add item modes:
  - pasted text
  - URL
- Delete must call Phase 1 delete API and refresh list.
- Use stable kebab-case DOM IDs prefixed with `kb-`.
- Follow existing visual system:
  - accent `#4ade80`
  - glass/surface rgba values already used in dashboard
  - text colors `#e5e5e5`, `#888`, `#666`
  - monospace labels
  - uppercase labels with existing letter-spacing conventions
  - existing `tile-detail-tab` classes for mode tabs
- Do not put cards inside cards.
- Keep UI compact and tool-like, not a marketing panel.

## Suggested DOM IDs

- `kb-card-shell`
- `kb-tab-bar`
- `kb-tab-text`
- `kb-tab-url`
- `kb-add-panel`
- `kb-title-input`
- `kb-text-input`
- `kb-url-input`
- `kb-submit`
- `kb-items-list`
- `kb-item-{itemId}`
- `kb-delete-{itemId}`
- `kb-empty-state`
- `kb-error-banner`

## Acceptance Criteria

- Knowledge Base card opens from dashboard.
- User can add pasted text.
- User can add URL.
- User can see items with type, status, chunk count, and created date.
- User can delete an item.
- UI handles loading, empty, and error states.
- DOM IDs are stable and `kb-*`.
- No dependency additions.

## Verification

- Run `npm run build` if feasible after UI integration.
- Use browser verification to open the dashboard and inspect the card if auth/local setup allows.
- At minimum, statically inspect JSX for stable IDs and no Strategy Builder changes.

## Stop Point

When Phase 2 is complete, summarize:

- files changed
- UI behavior added
- tests/build/browser checks run
- any risks or follow-ups

Then stop and wait for approval before Phase 3.
