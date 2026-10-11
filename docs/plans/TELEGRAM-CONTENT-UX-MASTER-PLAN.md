# Telegram Content UX — implementation master plan

Date: 2026-10-11. Status: updated implementation plan; verify current bot status before building.

## Updated priority: Telegram daily command center

This section supersedes the earlier upload-first phase order. The first milestone is daily briefing, calendar and timed post handoff using existing content. Upload intake follows. Telegram distills HITLOOP's actionable information; it does not create another strategy, analysis or publishing system.

### Daily navigation

Main buttons: **What's happening?**, **Today's posts**, **Calendar**, **Upload content**, **Settings**.

What's happening? reads the same available structured digest/email-brief data, market insights, relevant leading tweets, opportunities and outstanding decisions as HITLOOP. Give a concise overview, then Market insights / Conversations to join / Needs review / More detail. Include source links, freshness and brand relevance. Distinguish historical benchmarks from current conversations. Do not scrape email screenshots or fabricate missing data. Reading the briefing never silently starts paid analysis.

Today's posts shows strategy slots, saved posts, suggestions and content gaps. Clearly distinguish proposed from scheduled. Calendar offers today's agenda, this week and next actions with local timezone; detailed web calendar remains optional. Daily review, revisions and ordinary rescheduling should be possible in chat.

### Timed post handoff

At a configured lead time and/or manual posting time, send the current image/video preview or attachment, exact copy in a separate easy-to-copy message, destination account/channel, local time, short strategy explanation and authoritative status.

Default **Manual handoff** actions: Send assets / Revise / Post myself / Skip or reschedule. Post myself atomically claims manual delivery and removes/holds any automatic schedule through the shared service BEFORE handing over content that might otherwise auto-publish. Merely receiving a notification does not cancel scheduling. If auto delivery has already begun, refuse takeover and explain status.

A separate **I've posted it** action records user-reported completion, optionally accepting a permalink/platform ID. Distinguish self-reported from verified delivery; do not invent platform IDs or metrics. Update shared post state/reservations/package usage appropriately and prevent a later auto sweep from publishing it. Design the additive manual-delivery states explicitly across queue, calendar, results and sweepers.

Optional **HITLOOP delivery** offers explicitly named **Approve & schedule** or **Approve & post now**, with time/account displayed. Use hardened lifecycle, revision/clearance/expiry/plan checks and existing publisher; no bot-specific X adapter. Already-approved scheduled posts receive a status reminder, not redundant approval. Unapproved overdue posts stay unsent and offer rescheduling. Unsupported threaded replies get manual assets/copy/target links, never standalone automatic posting.

Web and Telegram act on the same post ID. Revision, media, schedule, permission or binding changes invalidate obsolete buttons. Manual claim and automatic publisher claim must be mutually exclusive under concurrent execution.

### Notification infrastructure

Durable due-time jobs reference client/post/revision/action. Use real queued/scheduled processing, not ephemeral request timers. Document dispatch frequency and maximum expected delay. Deduplicate updates/callbacks; bounded outbox retries handle 429/timeouts without repeating business actions. Re-read current state before sending; retire superseded cards on edit/reschedule/rejection/manual completion/publication.

Settings: review lead time, briefing time, timezone, quiet hours, actionable failures and optional grouped success summaries. Do not silently move posting times due to quiet hours. A failed Telegram send leaves the task visible in web. Pause notifications is distinct from pause publishing. Briefings and reminders avoid duplicate nags for the same unchanged task.

### Current implementation base

Latest review inspected hardened `release/content-system` at 0898d614: owner allowlists, transactional reservations, revision-bound approvals and reconciliation exist. Verify final HEAD and service behavior before implementation. Reuse those protections rather than rebuilding based on the older normalization checkpoint below. Broader customer isolation and real external activation remain separate gates.

### Revised phases

T0: verify integrated base; audit digest/brief readers, shared lifecycle, manual-delivery states and processing infrastructure.
T1: secure owner linking, webhook/inbox/outbox and menu with fake transport.
T2: What's happening?, insights/conversations, Today and Calendar from existing data with freshness.
T3: timed media/copy bundle, revisions, manual claim/completion and notification settings. First usable owner demo; existing library is sufficient, no uploads or live publishing required.
T4: optional approve/schedule/post-now, rescheduling, automatic/manual exclusion and failure/reconciliation actions through hardened services.
T5: shared photo/video/album upload and factual context, with large-file web continuation (retain intake requirements below).
T6: authorized private-bot pilot, phone/web walkthrough, tests/review, SSOT/runbook and accurate short demo handoff. Messaging authorization and publishing authorization are separate.

### Additional acceptance

- Briefing corresponds to HITLOOP/email source data without paid calls on read.
- Calendar mirrors plan/queue and labels proposed, approved, scheduled, manual and posted states.
- Due post arrives with usable media, exact copy, target and local time.
- Old cards/jobs cannot apply after edit/reschedule; manual-auto races cannot double-deliver.
- Self-reported completion remains identifiable; missed approval never causes surprise late publishing.
- Daily operations work in private Telegram chat and stay synchronized with web.

Existing architecture/auth/media constraints below still apply; revised T0–T6 replaces the earlier build order.

## Product outcome

Business owners and personal-account users share photos/video from their phones, add a little context, and review prepared posts in Telegram. HITLOOP manages content and distribution behind the conversation. Web remains available for setup, bulk organization, full calendar and analysis.

Telegram is another interface to the same library, context, post queue and lifecycle. It must not create a second strategy engine, posting queue, approval policy or publisher.

First pilot: one business/owner, private bot conversation, X publishing through the existing service. Do not advertise Instagram publishing while its registry entry remains non-live. The intake feature can store assets independently of the selected publishing channel.

## Verified normalization checkpoint

Inspected `Bballi_Portfolio-content-mgmt`, branch `feat/content-management`, on 2026-10-11:
- Phase 1 shared context/plan: 93198b4a.
- Phase 2 lifecycle/idempotent draft services: d62f8712.
- Phase 3 shared allocator/month calendar: 1200fd5b.
- Phase 4 in progress: modified chat/panel/tool/route files plus untracked InputStatusStrip.
- Build log reports phase-3 full suite 4863 tests with two known vendor failures; browser integration remains NOT VERIFIED behind login.

Do not merge or overwrite the active phase-4 work. Implement after the normalized service contracts stabilize; independently verify final HEAD and the UI gate before choosing the feature base.

Current limitations relevant to this feature: global inventory, admin-oriented tools, read-then-write scheduling collisions, legacy lifecycle bypasses, local refresh worker, and Strategy Builder's separate push path. Telegram cannot amplify these into cross-client or concurrent-write bugs. The pilot is explicitly owner-scoped; a business-client rollout requires isolation first.

## UX contract

### Connect

Authenticated HITLOOP settings → Connect Telegram → short-lived one-time bot link → user opens bot → confirm account name in HITLOOP → linked.

Use Telegram numeric user/chat IDs, not usernames, for identity. Binding requires a HITLOOP membership check. One selected client per private conversation initially. Switching clients pauses active intake and requires explicit selection; old cards stay attached to their original account and cannot execute under a new selection.

Default roles: submitter may upload/contextualize; approver may approve/schedule within existing HITLOOP permissions. Pilot owner may have both. Disconnect revokes actions and future delivery; retain business records according to existing retention policy.

### Capture

User shares photos/video and caption: “Finished this installation today.”
Bot: “Received 3 photos for [Business]. Saving them…”
Bot after durable ingest: “Saved to your library. What should customers know about this?” only if essential context is missing.

Group Telegram albums by media_group_id. Wait briefly for arrival, then show “3 photos received” with Finish/Add more/Split controls. Separate unrelated messages must not silently merge. Late album items update the activity safely or request confirmation after it is finalized.

One activity can hold several assets. Follow existing package variants/media limits; do not assume an album publishes as one X post. Retain asset-level IDs and provenance.

### Prepare

After intake: Prepare a post / Keep in library / Open in HITLOOP.
No automatic remix, vision analysis, paid draft generation or publishing on upload. Use the normalized shared context and existing draft/check pipeline when preparation is requested. Model work uses existing cost logging and explicit account settings/budget; support deterministic preview in development.

Ask one focused question at a time about essential facts, rights or client permission. Uploaded text/captions are facts to verify, not instructions to bypass policy. Do not infer that possession means clearance. Unconfirmed material remains library-only/ineligible.

### Review

Send media preview + exact proposed caption + destination handle/channel + date/time/timezone + brief why-picked explanation.
Buttons: Request changes / Approve & schedule / Skip / Open in HITLOOP.
Submitters instead see Send for approval; only approvers get executable approval buttons. Acknowledgment of receipt is never posting approval.

Reply to the preview with an instruction to request a revision. Tie replies to message/post IDs; if ambiguous, ask which item. Show revised copy and replace/invalidate the old approval card. The web and Telegram display the same post state.

Approve & schedule calls the shared lifecycle and allocator, never a platform API. Check current membership, post revision, clearance, eligibility, schedule and expiry at execution. If no valid slot exists, leave a durable approved backlog item only through an explicit separate action; otherwise return a useful scheduling error. Do not falsely claim scheduled.

Skip archives/dismisses the proposal according to existing semantics, not deleting uploaded assets. Replies with unsupported threaded publishing remain manual-only and are labeled accordingly.

### Notify

Default: one review briefing at the user-selected local time; actionable processing/publishing failures; optional grouped success summary. Quiet hours and pause affect notifications, not silently canceling scheduled posts. Explain that distinction. Provide separate, explicit posting-pause control only if supported by shared services.

No repeated nudges while nothing changes. Avoid duplicate per-post alerts when a briefing already covers them. If Telegram delivery fails, keep the task visible in web; delivery is not business action success.

## Technical architecture

```text
Telegram webhook → authenticated binding + update dedup → durable intake/action inbox
    → background media ingest → existing storage/library → shared content context/drafting
    → existing social_posts → version-bound approval → shared allocator/lifecycle
    → existing publisher → notification outbox → Telegram
Web UI reads/writes those same business records.
```

Webhook validates Telegram's configured secret header, bounds request size, accepts supported update types and persists before acknowledging. Do not download video, wait for model calls or publish in the webhook. Duplicate Telegram update_id is a no-op; track durable processing status and leases so crashes are recoverable.

Prefer a small HTTP Bot API adapter over a large framework unless existing runtime constraints justify one. Discover current Vercel route-count/build limits before adding endpoints. Shared lifecycle is a service, not a loopback HTTP call pretending to be an admin.

New transport stores only: bindings/link challenges, inbox/intake sessions, revision-bound action tickets, notification preferences/outbox. Library and social_posts remain authoritative. Add provenance (transport, message IDs, intake ID) without copying full business records into bot storage.

### Media and shared web intake

Audit the actual web upload/Video Remix/storage pipeline. Identify its metadata registration and asset storage interfaces; extract a shared intake adapter if necessary. Do not route ordinary uploads through rendering-only code or NAS analysis by default.

Telegram worker retrieves files and streams bounded bytes to the existing storage provider. Validate content type using actual file data, byte size, supported formats and client quota. File URLs contain the bot token: never log or expose them; store durable HITLOOP asset refs plus Telegram IDs for traceability. Secrets remain server-side.

Standard hosted Bot API getFile limit is currently 20 MB. Check current docs again at implementation. Over-limit video gets a short-lived, authenticated/scoped web upload continuation link bound to the same intake; completed upload resumes the chat. Do not proxy large uploads through the webhook. Offer “send as file” guidance where preserving the original matters; don't promise original quality for every Telegram photo.

MIME/size rejection, partial albums, broken downloads, retries and orphan cleanup have explicit states. A retry reuses the intake/asset identity. A repeated Telegram delivery is deduplicated; intentionally reusing an asset can create a new activity with the same stored asset reference.

### Approval correctness — required before pilot

Opaque callback tickets reference actor/client/post revision/action/schedule and have expiry. Callback payload stays short; no credentials or mutable post text in callback_data. Re-read authoritative records before applying. Changed media/text/time, disconnect, permission change, expired card or previously applied action invalidates the card.

Exactly-once business transition is the goal, not exactly-once Telegram messaging. Persist action claim/result; repeat clicks return the actual existing result. Handle crash recovery without reapplying a potentially completed action. Record reviewedBy as the authenticated bound user and transport, not an anonymous chat ID.

Normalization phase 3 uses read-then-write scheduling checks. Add transactional slot/package reservation or equivalent serialized scheduling authority covering BOTH web and Telegram scheduling, with rollback/recovery tests. A Telegram-only lock does not solve competing web writes. Inspect approveAndSchedule's wholesale rollback before reuse: it must not overwrite a concurrent web edit. Add revision checks/transactions where necessary.

Client-scoped library access is mandatory beyond the owner pilot. Never expose existing global inventory by granting a bound Telegram user admin tools. Build capability-scoped adapters; enforce membership at every read/action.

## Build phases

1. **Contract/base audit:** normalized HEAD, upload reuse, permissions, queue/worker options, state/revision model, confirmed external prerequisites. Record reuse table and baseline tests.
2. **Linking + inbox:** secure binding, revoke, webhook verification, durable dedup; fake transport tests. No external activation yet.
3. **Shared intake:** single photo/video, album grouping, factual context/clearance, durable library registration, large-file continuation, recoverable processing. Demonstrate web/Telegram parity.
4. **Prepare + revise:** shared context, source-aware draft/checks, previews, request changes, same post ID in web and chat; revision invalidation.
5. **Approve/schedule:** strengthen shared concurrency protections, role checks, stale-card handling, idempotent transitions. Mock publisher only until explicit external approval.
6. **Briefings + ops:** notification outbox/backoff, quiet hours/pause, failures/web fallback, connection/settings panel and runbook.
7. **Pilot acceptance:** real private bot with explicit owner-approved test messages/uploads, then separately authorized posting batch. Capture demo and customer feedback.

Keep first pilot narrow: one private chat/account, photos and short video, text context, X, deterministic state-machine intake plus existing AI for requested writing. Defer voice transcription, groups, Mini Apps, autonomous strategy changes, album watching, other messengers and new publishing adapters.

## Acceptance evidence

- One authenticated connection; wrong user/client rejected; unlink blocks old cards.
- Share a photo and a short video; both appear in existing web library with context/provenance.
- Album and oversized-file continuation behave predictably.
- Missing facts/clearance cause a question or ineligible item, never fabricated claims.
- Prepare/revise shows same durable post in web; cross-interface edit invalidates old approval.
- Repeat webhook/callback and concurrent web scheduling produce one correct record/reservation.
- Approved/scheduled status displayed only after successful shared-service transition.
- Mock delivery records platform result and one notification; failures leave clear recovery.
- Permissions revoked mid-flow, expired cards, worker crash and notification retry tested.
- Business owner completes capture/review without visiting dashboard; help/settings remain available there.

Use focused tests, fresh review for auth/lifecycle/concurrency, integrated suite against verified baseline, and a phone walkthrough. Distinguish fixture success from real Telegram success and deployed publishing success.

## External setup and deployment gate

Required: owner-created BotFather bot/token, webhook secret, public HTTPS endpoint, working inbox/media/outbox processor, existing asset storage credentials/quotas, binding settings, optional model configuration, existing publisher activation. Never claim Vercel has a continuously running worker; explicitly configure and document job dispatch/scheduled processing and measured review latency.

Implementation may use injected transport/storage and reversible local code. Bot registration, webhook activation, external messages, paid calls, new production settings and live posting require explicit user authorization for the pilot. Finish reviewable implementation before requesting activation. Do not log secrets or duplicate business data into demo artifacts.

## Official references

- Bot API (webhooks, media, callback queries, getFile limits): https://core.telegram.org/bots/api
- Bot features (account-linking deep links): https://core.telegram.org/bots/features#deep-linking

Recheck platform constraints during implementation; this is a dated plan, not a permanent API specification.
