You are continuing the client platform implementation in this repository.

Before doing any work:

1. Read:
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`
2. Review the completed Phase 1 and Phase 2 implementation.

## Your task

Execute **Phase 3 — Worker execution path** only.

Do not start Phase 4.

## Objective

Turn queued `brief_runs` into a reliable execution flow with claim/lease semantics, retries, and stable writes into normalized state.

## Required deliverables

1. A worker or runner path that can claim queued runs safely.
2. Queue status lifecycle:
   - `queued`
   - `running`
   - `succeeded`
   - `failed`
   - optional `cancelled`
3. Retry/failure handling fields on runs.
4. Writes to:
   - `brief_runs/{runId}`
   - `dashboard_state/{clientId}`
5. A safe execution contract for admin-triggered or automated runs.

## Acceptance criteria

- queued run can move to `running`
- run completes as `succeeded` or `failed`
- retries do not duplicate final state
- failed runs expose admin-visible status without leaking internal detail to end users

## Hard constraints

- Do not build the full admin UI yet
- Do not expose manual run controls to clients
- Do not bypass queue semantics
- Do not use local filesystem artifacts as the production source of truth

## Implementation guidance

- Use lease/claim semantics so two workers cannot run the same job
- Make all write paths idempotent where possible
- If execution is too heavy for direct Vercel request/response, still define the correct contract and introduce the safest temporary worker bridge
- Keep the dashboard reading normalized state, not raw pipeline outputs

## Expected output when you stop

1. files changed
2. worker/runner endpoints or services introduced
3. run lifecycle semantics
4. retry/lease behavior
5. anything still blocking Phase 4

Stop after Phase 3 and wait for review.
