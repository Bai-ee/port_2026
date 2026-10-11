# Telegram UX implementation assignment

Superseded execution order: use `docs/plans/TELEGRAM-DAILY-COMMAND-CENTER-CLAUDE-PROMPT.md` and the master plan's updated daily-command-center section. Briefing/calendar/timed manual handoff now precede uploads. Reuse the latest hardened release base; the historical normalization/race notes below require revalidation.

Read and implement `docs/plans/TELEGRAM-CONTENT-UX-MASTER-PLAN.md` from the main Bballi_Portfolio checkout. It defines Telegram as a streamlined interface to the normalized HITLOOP system, not another content engine.

First verify final normalization progress. At planning time phases 1–3 were committed on feat/content-management and phase 4 was actively modified. Do not overwrite that work or build on outdated daily-loop code. Select an isolated worktree after shared contracts stabilize; preserve existing edits. Read applicable instructions, normalization SSOT/build log and actual upload/storage/lifecycle code.

Orchestrate the local feature through all build phases and acceptance tests. Delegate disjoint tasks when useful, retaining one owner for shared contracts/routes/lifecycle. Reuse shared content context, library/storage, durable draft queue, approval service, allocator and publisher. Do not duplicate strategy, Brain, queues or AI policy. Use fixtures/injected transport until external pilot authorization exists.

UX: link account → share photos/video → supply essential context → save library item → request prepared post → inspect/edit preview → explicit approve-and-schedule → concise updates. One client per private chat initially; roles restrict approval; uploaded material is not permission to publish. Large videos use a scoped web upload continuation. No automatic remix on upload.

Before scheduling from Telegram, fix shared concurrent reservation and revision-safe action handling; current normalization checks can race and rollback may overwrite concurrent changes. Enforce client isolation: global inventory/admin-only tools are not safe customer bot APIs. Owner pilot may remain expressly scoped, with limitations documented.

Deliver implementation, connection settings, secure/deduplicated webhook, shared intake, version-bound review actions, durable processing/outbox, quiet notification UX, focused tests, review fixes, SSOT/runbook and pilot/demo instructions. Test web and Telegram operating on the same post and assets. Do not claim completion from mocked messaging alone.

No push/deploy, bot activation, external messaging, paid calls or live publishing without explicit authorization. Prepare all local work first and list exact activation steps/prerequisites. Report completed stages, evidence, remaining external checks and known limits plainly.
