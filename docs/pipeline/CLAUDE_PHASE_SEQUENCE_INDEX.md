# Claude Phase Prompt Index

Use these prompts in order. Each one assumes the previous phase is already complete and reviewed.

## Source of truth

- `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`

## Prompts

1. Master / Phase 1
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_MASTER_PROMPT_CLIENT_PLATFORM.md`

2. Phase 2
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_PHASE_02_GENERIC_RUNTIME.md`

3. Phase 3
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_PHASE_03_WORKER_EXECUTION.md`

4. Phase 4
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_PHASE_04_DASHBOARD_STATE.md`

5. Phase 5
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_PHASE_05_ADMIN_CONTROL_PLANE.md`

6. Phase 6
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLAUDE_PHASE_06_NEXTJS_MIGRATION.md`

## Usage rule

After each phase:

- stop
- review output against the reference plan
- explicitly approve the next phase before handing Claude the next prompt

Do not skip ahead unless the architecture plan itself is intentionally revised.
