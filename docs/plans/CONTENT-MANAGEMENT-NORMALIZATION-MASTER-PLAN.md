# Content Management normalization — master plan

Date: 2026-10-11
Status: implementation assignment; proposed architecture, not an assertion that all integrations exist.

## Outcome

One Content Management workspace lets the operator find, select, draft, review, approve, schedule and track content. Existing scanners, asset ingestion, Brain, Strategy Builder and publisher remain services behind that workflow. Reduce conflicting decisions and duplicate records before adding features.

## Ownership contract

| Concern | Authoritative owner | Other systems do |
|---|---|---|
| Identity, voice, factual claims | Approved Client Brain | Read context; propose changes through existing Brain review |
| Campaign goals | Strategy Builder | Supply goals and constraints, not a competing channel schedule |
| Executable X plan | Existing x_strategy_plans store | Read cadence, type floors/caps and engine allocation |
| Content assets and context | Existing content inventory/buckets | Ingest and enrich; retain stable IDs and rights |
| Raw external signals | Existing scanner stores | Collect evidence with source and timestamps |
| Selected opportunities | Content Management projection over scanner data | Rank, dismiss and match without duplicating raw data |
| Saved post, edits, approval, schedule | Existing social_posts | Producers create/update through one service |
| Delivery | Existing publisher | Claim, upload, publish, retry safely, record outcomes |
| Performance | Existing post results joined to content/opportunities | Provide evidence with freshness and sample caveats |

Recommendation records remain distinct from posts: generation can change recommendations; saving establishes a durable post. A suggestion references its post ID thereafter. Regeneration never replaces reviewed post text or approval.

## Start from verified integrated code

Inspect applicable instructions, active worktrees, status and ancestry. The daily-loop branch reportedly includes T7 through b14196a4; UI work is separate. Verify current HEADs and completion rather than assuming these remain final. Inspect X-STRATEGY-TAB.md, its build log, the daily-loop plan, the Active Content System plan, and UI plans. Preserve unrelated main-checkout media changes and all existing uncommitted work.

Choose an isolated implementation worktree based on the reconciled functional/UI code. Do not start on this older main checkout or merge broad branches without inspecting scope. Bring this plan into the implementation workspace as a task artifact. Do not wait on cosmetic work when adapter/service work can proceed safely, but verify the integrated UI before completion.

## Phase 0 — bounded ownership audit

Trace every producer and consumer for channel plan, opportunity, content package, draft, approval, schedule and metrics. Include Copywriter, Schedule Posts, records scheduler, daily loop, Strategy Builder, X Strategy/chat, quote/reply drafts and NAS/archive adapters. Produce a concise table of actual files, stores, write paths, duplicate decisions and chosen replacements. Distinguish confirmed conflicts from product proposals.

Capture representative existing behaviors before changing them. Find model/network calls and configured sweepers. Record existing test failures from the chosen base. Use fixture inputs for repeatable checks. This phase should resolve implementation choices, not generate another expansive redesign.

## Phase 1 — one executable plan and context

Reuse x_strategy_plans for X cadence, formats and engine targets. Remove/redirect competing controls. Strategy Builder provides campaign intent and constraints; it must not silently override the saved channel plan. Explicit operator overrides win; contradictory campaign constraints produce a visible warning, not a second schedule.

Extract one server-side content context loader used by daily runner and strategy chat. Return approved Brain context, usable Strategy Builder context, executable X plan, corpus evaluation, opportunity references and freshness, bounded inventory access, and available performance evidence. Reuse current modules; do not load the entire library into prompts. Expose bounded tools for details.

Every input carries source, updated/pulled time, usable state and caveats. Exclude stale/off-brand strategy according to existing checks. Never promote an unapproved Brain. Plain-voice/demo fallback must be labeled and must not imply approved brand output.

Gate: chat and runner resolve identical plan/input versions for the same client and time; absent-plan legacy behavior remains compatible; client mismatch and unapproved input tests pass.

## Phase 2 — one post lifecycle and queue

Reuse social_posts and its service. Route all confirmed producers through a common draft creation/update interface, with source references and stable idempotency keys. Existing producer UIs may remain as entry points; they must return the same post ID instead of copying posts.

Lifecycle: draft → approved → scheduled/queued → posting → posted; existing failed/needs-review/expired states stay meaningful. Save Draft is not approval. Approval is not scheduling. Editing approved text must invalidate approval consistently. Changes to rights or client clearance must be rechecked before scheduling/publishing, not just generation. Legacy paths need explicit compatibility, not a blanket bypass for new content.

Keep package clearance (can this material be used?) distinct from post approval (may this exact copy be published?). Ensure replies preserve target semantics and are not published as standalone originals when threaded delivery is unsupported.

Add additive provenance where missing: clientId, packageId, opportunity/source reference, suggestion/run ID, strategy version, channel, media references, review metadata, published platform ID. Preserve old rows without destructive backfill.

Gate: repeated save creates one post; reviewed edits survive regeneration; wrong-client access fails; all producers under scope reach the same queue; failed publish is not blindly retried.

## Phase 3 — unified schedule and content reuse

Expose the existing queue/calendar inside Content Management. Scheduling edits the authoritative social_posts record. Records/source-specific schedulers propose slots or use the shared allocation policy; they do not independently violate cadence, engine caps, spacing or occupied slots.

Retain existing explicit automation settings. Do not enable automatic posting merely by consolidating routes. Approved unscheduled posts remain available across weeks; posted evergreen packages obey existing recycle/fatigue/entity rules. Pending/scheduled copies must be considered when selecting the same package again. Timely opportunities need freshness checks at scheduling/delivery or a clear needs-review state when the window closes.

Keep one explicitly selected publishing mechanism; inspect configured workflows rather than assuming enablement. Do not enable or disable external workers/workflows during this implementation without authorization.

Gate: a week view shows the same records as the posting service; two producer schedulers cannot double-book/requeue the same content; approved backlog persists across dates; no live X writes occur in tests.

## Phase 4 — one workspace, contextual chat

Adapt the completed UI instead of replacing it. Target navigation: Today, Library, Queue & Calendar, Strategy. Retain necessary subviews if existing UI names differ. Daily steps must be possible inside Content Management:

inspect recommendation → edit → save draft → approve → choose time → inspect status.

Reuse existing editing/approval/schedule controls or mount their shared components. Old dashboard cards should deep-link to the relevant workspace view where practical. Do not remove working cards until equivalent behavior is verified.

Chat remains available with explicit selected-item/post context. Add bounded read/proposal tools for shared Brain/strategy context, opportunities and queue details; retain confirm-before-write. Chat must distinguish recommendation, saved post and approved/scheduled post. It cannot schedule or publish implicitly from conversational approval.

Add an input-status strip with direct remediation: Brain approval, strategy validity, account-data age, scan freshness and refresh-worker status. Only claim worker online/offline if actual heartbeat evidence exists; otherwise say queued/not completed or status unknown. Keep technical commands in setup/help rather than routine content cards.

Gate: desktop and narrow-screen walkthrough; no cross-client late-response leakage; keyboard-accessible controls; readable statuses; no extra dashboard hops for supported daily actions.

## Phase 5 — results and operational clarity

Join existing stored outcomes to source post/package/opportunity/strategy. Show posted/pending/failed separately from engagement evidence. Missing metrics remain missing, not zero. Do not imply refresh automatically backfills views or measures causal lift. Keep source dates, sample counts and likes-only caveats.

Provide a short production setup/runbook for required environment, authenticated routes, local refresh/scan worker, publishing sweep, accessible assets and model usage logging. Distinguish manual Generate from scheduled daily execution. Consolidation is not authorization to install launchd jobs, activate sweepers or spend on live model validation.

Gate: results trace back to originating inputs; operator can identify stale data and failed delivery from the workspace; deployment dependencies are documented and tested locally where feasible.

## Phase 6 — acceptance and handoff

Demonstrate with scripted fixtures and permitted real reads:

1. Context loader names Brain, campaign, plan, own/benchmark corpora and scans with freshness.
2. A plan change affects recommendations and shared schedule proposals consistently.
3. Recommendation shows why-now, brand fit and supporting content.
4. Save creates one durable draft; approval and scheduling operate on that same ID.
5. Regeneration preserves the saved/edited post; client clearance and post approval are enforced.
6. Next-week view retains unscheduled approved work and shows scheduled work correctly.
7. Mock publisher updates status and package usage; history/results show the join.
8. Operator completes the supported daily flow without leaving Content Management.

Run targeted tests per phase and the full suite at integration. Fresh review of consequential lifecycle/client-scope changes; fix substantive findings. Capture screenshots, behavior evidence and remaining limits. Update SSOT, build log and video handoff to match actual behavior.

## Efficiency and scope

Do not rebuild NAS, scanners, Brain, Strategy Builder, publisher, vector search or a generic workflow engine. Prefer adapters and shared loaders/services over new stores. No destructive migration; additive fields and bounded compatibility first. Focus tests on idempotency, lifecycle gates, isolation and actual integration rather than mirroring implementation.

Independent agents may audit or implement disjoint files, but shared contracts and write-path integration belong to the orchestrator. Keep a single owner for shared routes, posting service and UI shell. Verify each integrated phase before moving on; do not parallelize dependent mutations.

Authorized by this assignment: local implementation, reversible fixture tests, read-only inspection, isolated worktree/branch and local commits where repository policy permits. Not authorized: push, deploy, live publishing, paid calls, client-config/Brain approval or live-data mutations solely for demonstrations. Use injected stores/fixtures for those checks and report exact external acceptance steps needed. Do not stop for routine design choices already covered by this plan.

Completion is a verified integrated local feature, accurate documentation and a concise handoff. Production activation is a separate explicit action.
