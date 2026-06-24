You are continuing the client platform implementation in this repository.

Before doing any work:

1. Read:
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`
2. Review the completed Phase 1 through Phase 3 implementation.

## Your task

Execute **Phase 4 — Dashboard data contract** only.

Do not start Phase 5.

## Objective

Make the dashboard consume only normalized `dashboard_state/{clientId}` and stable bootstrap data instead of raw runtime or queue internals.

## Required deliverables

1. A normalized dashboard state read path.
2. Provisioning UX state.
3. Retry-pending UX state.
4. Stable loading/error handling.
5. Clear separation between:
   - internal operational data
   - client-visible dashboard data

## Acceptance criteria

- dashboard does not depend on raw brief artifact structure
- provisioning users see correct status
- client dashboard remains stable even if pipeline internals change

## Hard constraints

- Do not build full admin operations UI yet
- Do not expose system internals to end users
- Do not let the dashboard read directly from worker implementation details

## Implementation guidance

- Keep the current dashboard design language unless the data contract requires targeted changes
- Prioritize stable data shape over more UI polish
- Make loading and error states clear but minimal

## Expected output when you stop

1. files changed
2. dashboard state fields consumed
3. client-visible states supported
4. anything still blocking Phase 5

Stop after Phase 4 and wait for review.
