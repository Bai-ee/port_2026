You are continuing the client platform implementation in this repository.

Before doing any work:

1. Read the source-of-truth plan:
   - `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`
2. Review the Phase 1 implementation that is already complete.

## Your task

Execute **Phase 2 — Refactor runtime to generic client engine** only.

Do not start Phase 3.

## Objective

Replace the current one-off `not-the-rug` runtime assumptions with a generic, client-config-driven runtime that can later support:

- multiple clients
- multiple providers
- per-client configuration
- server-owned execution

## Required deliverables

1. Remove hardcoded single-client assumptions from the portable brief runtime.
2. Introduce a config-driven runtime contract based on:
   - `clientId`
   - `client_configs/{clientId}`
   - provider abstraction
3. Preserve local development compatibility.
4. Keep the runtime usable by the future worker path.

## Acceptance criteria

- runtime can execute against any client config
- no code path assumes `clientId = not-the-rug`
- provider selection is abstracted behind a stable interface
- local development still works without the full production worker being present

## Hard constraints

- Do not build recurring reruns yet
- Do not build the admin UI yet
- Do not add end-user run buttons
- Do not couple the dashboard to runtime internals
- Do not proceed into worker orchestration

## Implementation guidance

- Preserve useful pieces from `features/not-the-rug-brief`
- Generalize the runtime instead of deleting everything
- Introduce a runtime surface that the worker can call later
- If you need a compatibility shim for the current Not The Rug flow, keep it temporary but explicit

## Expected output when you stop

1. files changed
2. runtime entrypoints introduced or changed
3. config contract introduced
4. provider abstraction shape
5. anything still blocking Phase 3

Stop after Phase 2 and wait for review.
