You are continuing the client platform implementation in this repository.

Before doing any work:

1. Read:
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`
2. Review the completed Phase 1 through Phase 4 implementation.

## Your task

Execute **Phase 5 — Admin control plane** only.

Do not start Phase 6.

## Objective

Provide internal admins with the minimum operational visibility and controls needed to manage client onboarding and brief execution without directly editing Firestore.

## Required deliverables

1. Admin client list
2. Run queue list
3. Failed run inspection
4. Retry trigger
5. Limited client config inspection

## Acceptance criteria

- internal admins can inspect clients and runs
- admins can identify failures and retries
- operational actions remain admin-only
- no end-user access to cross-client data

## Hard constraints

- Do not expose admin controls to non-admin users
- Do not build a full client config editor unless strictly needed
- Do not weaken security rules or role separation for convenience

## Implementation guidance

- Keep the admin surface practical and minimal
- Build only what operations needs now
- Preserve the normalized data contracts from earlier phases

## Expected output when you stop

1. files changed
2. admin routes/pages/components introduced
3. admin authorization behavior
4. retry mechanics
5. anything still blocking Phase 6

Stop after Phase 5 and wait for review.
