You are continuing the client platform implementation in this repository.

Before doing any work:

1. Read:
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`
2. Review the completed Phase 1 through Phase 5 implementation.

## Your task

Execute **Phase 6 — Optional Next.js migration completion** only.

This phase should only happen after explicit approval from the user.

## Objective

Unify the platform stack under a coherent full-stack architecture if that is still the best move after Phases 1–5 are complete.

## Required deliverables

1. Final framework structure
2. Routing migration
3. Environment handling normalization
4. Deployment normalization
5. Stable auth/dashboard/admin/backend execution in the unified stack

## Acceptance criteria

- production runtime and app stack are coherent
- no split-brain between Vite client app and server platform
- existing public UX is preserved or intentionally migrated with parity

## Hard constraints

- Do not perform a destructive rewrite without preserving working behavior
- Do not lose auth, tenant, queue, or dashboard state contracts established in earlier phases
- Do not change product behavior unless required by the migration

## Implementation guidance

- Migrate deliberately
- prefer structural clarity over rushed parity
- preserve URLs and deployability where possible
- if the marketing/public site and dashboard/admin should be separated, document the exact boundary

## Expected output when you stop

1. files changed
2. migration approach used
3. deployment/runtime changes
4. parity notes
5. remaining follow-up work

Stop after Phase 6 and wait for review.
