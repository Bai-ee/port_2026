# Sonnet orchestration prompt

Implement the Content Management consolidation described in:
`/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/plans/CONTENT-MANAGEMENT-NORMALIZATION-MASTER-PLAN.md`.

Read that plan, applicable repository instructions, current X Strategy SSOT/build log, daily-loop plans and the completed UI work. Independently verify branch/worktree state. The functional branch reportedly includes T7 through b14196a4; the UI lives in a separate worktree. Choose a safe integrated base, preserve unrelated work, and do not implement on an outdated checkout merely because it is the current directory.

Act as the Sonnet orchestrator. Complete the local implementation start to finish, not just another plan. You may delegate bounded audits and disjoint implementation to subagents using Sonnet where supported. Keep shared contracts, lifecycle, routes and integration under one owner. Use parallel work only where dependencies and files permit it.

The product outcome is one workspace for find → select → draft → review → approve → schedule → track. Existing cards become sources or entry points. Reuse current stores/services. One executable X plan, one durable post queue, one scheduling authority, one shared input context for chat and runner. Recommendations remain separate until saved; all later actions operate on the same post ID.

First produce a bounded ownership audit identifying actual duplicate decisions/write paths and the implementation changes needed. Then execute the master plan phases. Resolve routine choices yourself and keep moving. Do not invent conflicts unsupported by code. Do not introduce broad refactors, duplicate stores or unrelated features.

Pay particular attention to:
- Approved Brain vs current campaign strategy vs executable channel plan.
- Shared freshness/source metadata for chat and runner.
- Client isolation and the current global inventory limitations.
- Package rights/client clearance vs post approval.
- Save-once behavior, approved-edit invalidation and regeneration preserving saved work.
- Records scheduler and pending/scheduled content participating in shared allocation.
- Reply target semantics and timely-opportunity expiry.
- Backlog across weeks and existing evergreen cooldown rules.
- Worker dependency, publisher activation and missing metrics being visible rather than silently assumed.

Adapt the completed UI with Today, Library, Queue & Calendar and Strategy views. Make supported daily actions possible without jumping dashboard cards. Chat uses the same underlying context and selected item/post, proposes mutations for confirmation, and never silently schedules/publishes. Keep old entry points working until equivalents pass acceptance.

Use fixtures/injected services to prove the entire lifecycle without external writes. Run focused tests for each change, review consequential lifecycle/isolation changes, and run the full suite after integration. Establish baseline failures and explain any additional failures. Keep an incremental build log and local commits where policy permits. Update the SSOT and video handoff to describe the final actual behavior.

Do not push, deploy, publish, activate workers/sweepers, make paid calls, approve Brain, change client_configs or mutate live business data for demos. Those are separate external actions; prepare reviewable local results first. Continue all work that does not depend on them and list the exact manual validation remaining.

Final handoff: implementation location/commits, what was consolidated, a very simple operator walkthrough, test/review evidence, production dependencies, remaining limits and precise external activation steps. Never call production ready solely because local tests pass.
