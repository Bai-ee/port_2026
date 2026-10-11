# Content Management — owner-pilot launch hardening

Date: 2026-10-11. Status: implementation plan; no production activation authorized.

## Launch definition

Publicly demonstrate the working concept while operating it for one authorized owner/account. This is not open customer enrollment. Finish normalization first, then harden its integrated result. Do not delay a narrow pilot for a complete multi-tenant rewrite or broad code cleanup.

Two gates:
- **Owner pilot:** reliable, restricted, production-verified owner workflow; public demo may describe the concept accurately.
- **Customer access:** independently verified tenant isolation, membership/roles, client-scoped inventory and per-client strategy/operations. Remains disabled until that gate passes.

## Phase 0 — pin the handoff base

Inspect final normalization HEAD, outstanding edits, SSOT, build log and UI integration. At inspection phase 4 was committed as b3c02794 and phase 5 was uncommitted. Do not assume that remains current. Use an isolated worktree from the completed integrated branch; preserve existing work. Establish targeted/full-suite baseline and explain known failures. Record authoritative branch/revision, exact startup commands and configured production paths.

## Phase 1 — restrict the pilot and prove access boundaries

Inventory every content-management read/write route, chat tool, upload path and background entry point. Enforce the authenticated owner/client allowlist server-side through a shared capability check. Never trust a request body clientId, selected-client UI state or model-supplied identity. Public marketing/demo pages must not expose real dashboard data.

Customer enrollment and non-owner use remain explicitly unavailable. Block attempts to select/read another client through routes or tools. Preserve intentionally public approval-token behavior only with token/post/client binding, expiration and existing authorization semantics. Do not put a blanket owner gate on routes intentionally serving existing clients without auditing the impact; restrict the new pilot feature at its boundary.

Global inventory can remain for the single-owner pilot only when every consumer is restricted and clearly documented. Add tests proving wrong-client reads, writes and late responses fail. Create a separate customer-access checklist rather than claiming the pilot is multi-tenant ready.

Gate: unauthenticated/non-owner/wrong-client requests cannot access pilot content or execute its actions; allowed owner flow and intentional public-token flows remain working.

## Phase 2 — atomic scheduling and revision-safe edits

Replace read-then-write collision enforcement with transactional package/slot reservations or an equivalent shared serialization mechanism used by web, records automation and all other relevant schedulers. Account for caps/spacing across affected time windows; transaction scope must prevent two different slots from violating spacing, not merely duplicate exact timestamps. Define reservation release on rejection, unschedule, reschedule, expiration and terminal delivery.

Add optimistic revision checks to material edits and approvals. approveAndSchedule must not restore an old whole document over a concurrent edit. Use an atomic state transition where possible; external work stays outside transactions. Approval must bind exact content/media/reply target and intended schedule policy. Retryable requests return existing results without repeating business transitions.

On ambiguous platform outcomes, keep needs_review; never blindly retry publishing. Internal claims prevent concurrent sends, but do not guarantee exactly-once external delivery after a timeout. Document reconciliation by platform ID/outcome.

Gate: race tests for two schedulers, web edit during approval, reschedule reservation release, failure/crash recovery, and repeated action. No live platform writes in tests.

## Phase 3 — remove lifecycle and plan loopholes for the pilot

Audit all post producers and delivery paths (draft, schedule, post-now, token approval, digest, records, daily loop, Strategy Builder push). New pilot posts use the shared lifecycle consistently. Recheck clearance, approval, reply semantics and expiry at scheduling/delivery as appropriate. Unsupported reply publishing remains blocked/manual; never silently post it as an original.

For existing owner rows, produce a dry-run migration report. Identify legacy scheduled/queued/reply records that bypass protections. Prefer parking unsafe rows for review and additive lifecycle adoption over deleting data. Any live migration or cancellation requires owner authorization after the report is reviewable. Preserve legacy behavior for unrelated accounts until a separate rollout is planned.

Ensure shared plan enforcement for all pilot scheduling paths, including Strategy Builder push. Resolve whether manual scheduling may override caps/spacing: default enforces the plan; if an override is retained, make it explicit, authorized, audited and visible. Do not silently call an advisory warning enforcement.

Gate: each producer reaches the same queue and protections; material edits invalidate approval/schedule; expired/uncleared content cannot publish; plan exceptions are explicit and tested.

## Phase 4 — operator UX and actionable failures

Complete desktop and phone-width authenticated walkthroughs: context → recommendation → edit → save → approve/schedule → calendar → status/results. Exercise actual owner flows; do not call SSR rendering a browser acceptance test.

Fix modal focus trap/restore and dangerous single-key publish/approve shortcuts. Show all relevant statuses, including awaiting_approval and needs_review. Ensure stale cards cannot apply obsolete edits. Explain partial inputs, plain-voice fallback, unsupported channels/replies and approval vs scheduling.

Failures must preserve reviewed work and tell the operator what to do next. A missing queue read must not silently generate conflicting recommendations; choose explicit degraded/read-only behavior. No silent zero metrics or false worker-online claims.

Gate: keyboard and narrow-screen review, safe error/retry behavior, no cross-client response leakage, actual integrated owner walkthrough recorded.

## Phase 5 — production operations and deploy candidate

Document the smallest real production setup: environment names (never values), storage access, model configuration/limits, local scan/refresh worker, durable queues, publisher sweep, secrets, timezone and alerting. Verify registry support: X is live; do not market other channels as working until their adapters pass acceptance.

Select and document one publishing cadence. Inspect configured/enabled workflows and cron rather than assuming code means activation. Verify current worker behavior and how the operator recognizes stale jobs; add minimal job heartbeat/health if required. Establish model spend caps and usage visibility. Check deployment bundling/static corpus fallback, authenticated asset access and required database indexes.

Prepare deployment/rollback steps and a dry-run representative post. Do not expose secrets in logs or previews. Use existing deploy instructions/tools, checking applicable skills during implementation. Run relevant build checks without disrupting a running dev server.

Gate: launch candidate passes appropriate tests/build and staging-like smoke checks; dependencies/failure recovery known; rollback is concrete. Deployment and external writes require explicit authorization.

## Phase 6 — authorized owner launch and customer gate

After owner authorizes deployment, verify the deployed authenticated flow, fresh-data path, storage/media access, scheduler and results. Obtain explicit approval for one posting batch before live X writes. Record platform IDs and verify outcomes; failed/ambiguous actions stay reviewable. Observe normal operation with concise failure alerts, not continual manual polling.

Public demo shows owner operation and accurately states prototype limits, manual worker dependencies and supported channels. Keep enrollment disabled.

Customer-access prerequisites (not owner-pilot scope): client-scoped library/config, membership/role enforcement across every service/tool/worker, no default-owner corpus leakage, per-client quotas, privacy/deletion behavior, cross-tenant tests, independently reviewed onboarding, and operational capacity evidence. Do not unlock customers based only on pilot success.

## Code-review handoff and efficiency

Deliver a concise architecture map: context loader, plan store, intake/library, post lifecycle, allocator/reservations, publisher, UI actions and their authoritative stores. Include exact HEAD, startup/test commands, known failures, required services and reviewed limitations.

Large files are a maintainability concern, not an automatic launch blocker. Extract only boundaries needed for lifecycle/concurrency/access work; avoid broad cosmetic decomposition or changing tested behavior to meet file-size targets. Keep an incremental build log; use focused tests for actual risks, review consequential patches and run the integrated suite once stabilized.

Completion before external activation: verified local launch candidate, owner restrictions, substantive race/approval fixes, production runbook, migration dry run and exact remaining authorized checks. Do not claim deployed/production-ready solely from local tests.
