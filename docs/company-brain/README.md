# Client Brain

Client Brain is the reusable strategic context layer for HITLOOP clients. It replaces the Bryan-only "Company Brain" idea with a client-scoped system that normalizes sources, exposes source controls, and generates a compact `CLIENT_CONTEXT` pack for downstream AI cards.

Status: gated/admin feature. Not launch-certified.

## Runtime Shape

`activeClientId -> source refs -> toggles/use-for controls -> generated Client Brain -> CLIENT_CONTEXT -> downstream cards`

Canonical storage:

- `clients/{clientId}/client_brain/current`
- Compact dashboard mirror: `dashboard_state/{clientId}.clientBrain`

The raw Knowledge Base remains the document/source library. Client Brain sits above it as the strategic aggregate.

## Current Implementation

- Dashboard card: `client-brain`
- API namespace: `/api/dashboard/client-brain`
- Feature helpers: `features/client-brain/store.cjs`
- First downstream consumer: Strategy Builder, optional and backwards compatible

