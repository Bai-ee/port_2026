# Implementation assignment — Video Remix → Content Management POC

Implement this focused feature start to finish on the latest verified integrated HITLOOP codebase. Read applicable repository instructions and current Content Management/daily-loop SSOT before editing. Verify the deployed revision rather than assuming the current checkout or a named branch is latest. Preserve unrelated edits and use an isolated feature branch/worktree.

## Outcome

Existing completed Video Remix videos are discoverable inside Content Management, shown in a **Video Remixes** bucket alongside NAS, Discogs, Ideas and other existing sources. The daily runner and Content Management chat understand their metadata and can recommend appropriate videos in response to relevant X conversations.

Example: an available music mix features Andrew Emil. A fresh scanned tweet mentions Andrew Emil as a great DJ. The runner finds the related mix, explains why it is relevant, and proposes a grounded contribution using that asset. Birthday relevance requires an explicit reliable date/source; do not invent a birthday from the artist name.

Visibility alone is insufficient: prove a remix can be discovered, matched, reviewed and saved into the existing posting queue.

## Scope

- Video Remix outputs only. No client briefs, generic capability catalog, new render automation, autonomous feature execution, or broad integration framework.
- Read existing generated videos; do not generate new videos for this implementation.
- Reuse existing asset storage and authoritative output records. No duplicate video files or second content library.
- Add a narrow adapter with a stable contract that future producers can follow. Do not generalize beyond actual requirements.

## First: trace existing integrations

Inspect Video Remix card, output/video listing, generation completion writes, storage/media records and Content Management's rendered-video/bucket/inventory readers. Some rendered-video integrations may already exist. Identify exactly which outputs are visible now, which are missing, and which metadata is lost. Extend existing integration where possible; do not create a duplicate bucket for the same outputs.

Record a short reuse table of authoritative stores, client identifiers, completion states, asset URLs/refs, metadata fields and current ingestion paths. Verify intended deployed branch and actual source data shape before implementation. Inspect records without paid calls or live mutations.

## Implementation requirements

### 1. Producer adapter and stable identity

Create or extend a Video Remix adapter mapping existing completed outputs into the current content discovery/library contract. Use stable producer + client + output IDs. Retain source-record references and provenance so updates refresh an existing item instead of creating duplicates.

Choose the smallest reliable registration mechanism based on current code: shared read projection, idempotent sync, or completion hook plus catch-up sync. Support existing videos as well as future completions. A completion hook alone is insufficient. Do not initiate analysis/rendering from a listing or sync action.

Only eligible completed outputs are candidates. Pending/failed/missing/unplayable assets remain excluded or visibly unavailable. A producer output that is later deleted/invalidated must not remain silently usable. Avoid destructive source changes.

### 2. Metadata and client ownership

Preserve available artist/performer names, aliases, mix/title, description, genre/topics, source links, dates, video duration/aspect/format, thumbnails, playable/downloadable asset references, generation status, source ID, and relevant project/series identifiers. Store structured entities and searchable text, not just a generic filename.

Distinguish recording date, event date, render date and upload date. Missing metadata stays missing; do not invent it. Add optional manually editable factual context through existing controls where needed.

Enforce existing owner-pilot/client permissions. Records must carry or resolve their client owner explicitly; never infer ownership merely because an admin selected a dashboard. Do not widen global library access or claim multi-client readiness without isolation checks.

Existing video readiness does not establish music rights or client clearance. Reuse rights/approval gates, preserving declared source permissions; unknown rights remain ineligible pending review. Do not default every imported remix to owned/cleared.

### 3. Content Management UX

Use the current Library/Content bucket UI. Add/reuse **Video Remixes** with count, thumbnail, artist/title, readiness, relevant metadata, source link and appropriate existing actions. Follow actual UI labels instead of introducing another card.

Provide a clear empty state and sync/status behavior if sync is required. Operators can see existing generated videos without manual re-upload. Sync twice yields the same items. Edits to library story/rights/clearance must survive sync; define producer-owned vs operator-owned fields.

### 4. Runner and chat integration

Feed normalized remix entries through the existing content context, inventory search, eligibility and matching pipeline. Preserve entity/artist/title terms in matching. Expose them to chat through bounded existing inventory tools.

A suitable music mix must not be excluded solely because its producer lacks an old Discogs series label; map it truthfully onto an eligible existing type or introduce one narrow source/series mapping if required. Do not weaken rights, grounding, readiness or fatigue rules to force matches.

Use factual metadata as grounding where the format permits; do not require an invented personal memory or claim that a video proves customer results. Preserve existing draft/guard checks. Do not force attach-video quote behavior if the publisher doesn't support it; suggest a supported original post or manual contribution instead.

### 5. Queue and downstream consistency

Save through the shared idempotent draft service, using existing media payload/provenance and package/source IDs. No automatic scheduling or publishing. Revalidate current asset/clearance before save and existing lifecycle checks before later delivery.

Ensure calendar, results, manual bundles and Telegram previews can resolve the same asset reference if those integrations are present. Do not build Telegram as part of this assignment. Avoid ephemeral signed URLs as permanent references; resolve fresh access through existing storage helpers.

## Acceptance evidence

1. Existing completed remixes appear in the bucket without re-uploading files.
2. Repeat sync/read gives one entry per client/output; failed/deleted assets don't become candidates.
3. Metadata preserves artist/title/entities and operator edits; cross-client access fails.
4. A fixture scanned conversation mentioning Andrew Emil matches a cleared, completed Andrew Emil remix and explains the entity connection. Also test unrelated conversation and missing-rights cases.
5. Chat/inventory search finds the same entry.
6. A grounded draft can be saved once into the existing queue with the correct playable video and source references; regeneration does not overwrite reviewed work.
7. Existing NAS/Discogs buckets and remix UI continue working.
8. Operator browser walkthrough confirms bucket visibility, playback, metadata and draft saving. Clearly distinguish fixtures from real owner data.

Use focused adapter/integration/idempotency/eligibility tests and the relevant existing suites. Run the integrated suite after stabilization, comparing known baseline failures. Fresh review for metadata/rights/client-scope and queue changes. Avoid tests merely mirroring implementation.

## Execution and handoff

Implement rather than stopping at another plan. Resolve routine choices autonomously. Delegation of bounded disjoint tasks is authorized; keep shared contract/routes integration under one owner. Maintain a concise build log and local commits where repository rules permit.

No push/deploy, paid analysis/rendering, external messages, live production-record mutation, scheduling or X posting without explicit authorization. Use fixture stores for write-path proof. If live browser saving requires authorization, finish unaffected work and report that exact remaining check.

Deliver branch/commits, adapter/data-flow explanation, tests/review evidence, screenshots or browser evidence, a simple operator walkthrough, honest limitations and deployment steps. The future extension is other producer adapters using this pattern—not a generalized feature harness built now.
