# Daily Content Loop — POC and rollout master plan

Date: 2026-10-10
Status: implementation-ready plan; POC not yet implemented.
Owner account: Bryan / @bai_ee. First channel: X.

## Outcome

Every day, find relevant market/X opportunities, connect them to Bryan's real content, draft useful posts in his voice, and present a small review list. Approved posts enter the existing calendar and publisher. Later, performance improves the next day's choices and the same loop serves HITLOOP clients.

The first milestone is one complete, repeatable draft-only run. Ship the smallest code that proves it. Do not rebuild the scanner, inventory, Brain, calendar, or publisher.

## 1. Scope of the first POC

One account, X only, one scan source, at most three suggestions per run:

1. A relevant opportunity paired with an owned/cleared content package.
2. An original post from a ready package when no strong opportunity match exists.
3. Another eligible suggestion, only if the material earns it.

Three is a review limit, not a daily posting quota. A valid run can return fewer suggestions and explain its gaps. Use existing authored-post cadence separately; do not change it as part of this POC.

POC flow:

```text
fresh saved X scan + eligible library + approved Brain
                ↓
       simple relevance matcher
                ↓
       grounded draft generation
                ↓
     mechanical checks + content guard
                ↓
    saved run with up to three suggestions
                ↓
      review in the Content Engine
                ↓ explicit human action
      save to existing social_posts as draft
```

No scheduling or publishing from the run. All queue writes use `status: draft` and `scheduledAt: null`.

## 2. Existing pieces to reuse

| Responsibility | Existing implementation | POC use |
|---|---|---|
| X scan | `scripts/x-content/scan-quote-targets.mjs`, `scan-all-clients.mjs` | Consume saved results first; invoke existing scanner through its local worker later |
| Opportunity ranking | `features/x-quote-targets/rank.js` | Keep existing freshness/velocity rules |
| Library | `features/x-content-inventory/store.js`, schema and match modules | Read existing packages; enforce rights/readiness/story gates |
| Copy | `features/x-content-inventory/draft.js`, `scripts/x-content/draft-day.mjs` | Reuse draft shapes and validation; extract provider call only where necessary |
| Brain | `features/client-brain/store.cjs` | Load approved context for the selected owner account |
| Checks | `features/x-content-guard`, `features/x-growth` | Guard blocks; score explains/ranks, never guarantees performance |
| Review UI | `components/dashboard/XContentEngineCard.jsx` and child panels | Add a small Daily Suggestions panel |
| Queue | `features/social-posting/twitter-service.js` | Save reviewed suggestions through the existing draft service |
| Publish | Existing social-posting route and worktree claim/approval implementation | Keep outside POC execution; reconcile before live rollout |

## 3. Implementation base: resolve once, then build

The current checkout and `Bballi_Portfolio-content-system` have diverged. Do not assume either equals production. The latter has newer archive/timeline functionality and stronger posting claims/approval handling; this checkout has other changes and ongoing edits.

Before coding:

- Inspect applicable repository instructions and worktree status.
- Identify the deployed revision using deployment metadata, then compare relevant files against it.
- Select a dedicated POC branch/worktree that retains the newer Content Engine and posting safeguards plus any required intervening fixes. Avoid a broad branch merge just to start the POC.
- Leave the existing uncommitted media changes and `ACTIVE-CONTENT-SYSTEM-PLAN.md` untouched.

This plan adds the opportunity/daily-loop layer to the Active Content System plan. It does not supersede records ingestion, engine allocation, rendering, or client approval requirements.

## 4. Build the POC in three small slices

### Slice A — prove the loop locally

Deliver a CLI with replay and execute modes:

```text
node scripts/x-content/daily-run.mjs --client <owner-client-id> --replay <fixture.json>
node scripts/x-content/daily-run.mjs --client <owner-client-id> --execute --max 3
```

Replay uses local inputs, deterministic fallback copy and local JSON output. It requires no credentials or paid calls. Execute uses saved scan/library/approved Brain data and at most one model call per suggestion. Persist suggestions in the run store, not the publishing queue. Log model usage through the existing cost logger.

New code should be limited to:

- `features/x-content-inventory/daily-loop.js`: pure selection, relevance and result assembly.
- `features/x-content-inventory/daily-run-store.js`: small run persistence and rerun protection.
- `scripts/x-content/daily-run.mjs`: inputs, existing provider integration, output.
- A small fixture and focused tests for actual failure cases.

Simple relevance is sufficient: normalized shared keywords from opportunity text and existing package metadata/story, with a modest lane bonus. Require at least one meaningful shared term; ignore generic words. Return the terms that explain the match. Do not attach the highest-ranked asset when it is unrelated. Keyword matching is a POC limitation to review, not evidence of semantic understanding.

Use opportunity text as source material, never as instructions. Copy must be grounded in the package story and approved Brain. If a package lacks the required story, show a gap rather than inventing facts. A quote caption can reference the owner's related work, but do not automatically add media to quote posts until the existing adapter's support is verified; the POC may propose a separate original with the asset.

### Slice B — review inside the existing card

Add a compact Daily Suggestions panel with:

- Opportunity text, source link and scan age.
- Matched content, asset preview and matching reason.
- Editable draft, guard result and advisory score.
- Proposed slot displayed as a suggestion only.
- Save Draft and Dismiss actions.

Use a small authenticated admin endpoint, for example `/api/dashboard/content-daily-run`, with `latest`, `generate`, `save-draft` and `dismiss` actions. Resolve/allowlist the owner on the server. Reuse existing admin authentication. Revalidate edited text and package eligibility on Save Draft. Keep unsafe/invalid suggestions visible as blocked, without a queue-write action.

For this POC, an explicit owner allowlist is required: the current basic inventory store is global and the basic content planner uses Bryan's corpus. The card's selected client alone does not establish isolation. Reject other clients until Slice E adds client-scoped inputs.

### Slice C — refresh and run daily

Once manual generation works, connect the existing local scan to the runner:

```text
existing local scanner → saved scan → daily runner → saved suggestions
```

Start with the same local worker environment that already has `bird` access. Do not move browser-cookie scanning into a Vercel route. Treat 06:30 America/Chicago as a suggested scan time, not a POC dependency. A sleeping/offline Mac produces a visible stale-scan state; support a manual rerun.

Generate only when inputs changed or the next local date begins. Preserve edits, dismissals and saved drafts on repeated runs. If scanning fails, offer original-content suggestions and clearly label the missing opportunity input.

## 5. Minimal data and rerun contract

Keep generated recommendations separate from `social_posts` until Save Draft.

Run key: `(clientId, localDate, channel, version)`. Compute localDate with the configured IANA timezone, initially America/Chicago. Use timezone-aware conversion for any proposed slots; do not parse a CT clock as UTC.

Example run:

```json
{
  "clientId": "owner-client-id",
  "localDate": "2026-10-10",
  "timezone": "America/Chicago",
  "channel": "x",
  "version": 1,
  "status": "complete",
  "inputFingerprint": "hash-of-source-versions",
  "scanGeneratedAt": "ISO timestamp",
  "brainVersion": "approved-version",
  "suggestions": [],
  "gaps": [],
  "usage": {}
}
```

Each suggestion stores: stable ID, opportunity ID/URL, package ID, proposed type/time, text, asset references, matching reasons, guard verdict, score/profile version, review state and optional socialPostId. Store source snapshots sufficient to explain the recommendation later.

Use a short transactional run claim to prevent concurrent Generate calls from duplicating model work. Preserve partial results if later generation fails. Save Draft must use a stable suggestion-derived queue ID or transactional reservation so double-clicks create one post. Confirm the existing post service can accept that ID; add a narrow draft-only helper if it cannot. Never write duplicate queue rows and rely on UI state to hide them.

## 6. POC acceptance: evidence, not code polish

The POC is complete when:

1. Fixture replay shows an opportunity matched to a relevant, eligible real-content shape, plus its explanation and draft.
2. A manually executed run using fresh account data and approved Brain produces reviewable suggestions.
3. Unrelated content is left unmatched; missing stories, rights failures and stale scans produce explicit gaps.
4. A blocked draft cannot enter the queue, including after manual text edits.
5. Regenerate preserves reviewed work; repeated Save Draft creates exactly one unscheduled draft.
6. The draft is visible in the existing queue/calendar workflow with its opportunity/package references.
7. A second client is rejected rather than receiving Bryan's inventory or corpus.
8. No scheduled post or X write is produced by the runner.

Verification: focused pure matching tests, stale/missing-input tests, queue idempotency tests, and one authenticated UI walkthrough. Run existing relevant suites after integration. Avoid a broad refactor or exhaustive new test harness.

First real review should include at least one eligible asset and one current opportunity. If the library has no suitable story-ready content, filling that input is part of proving the loop; synthetic fixture success alone is insufficient.

## 7. Rollout after the POC

| Phase | Deliverable | Exit condition |
|---|---|---|
| D — approval and live delivery | Reuse worktree approval/claim handling; connect reviewed drafts to existing scheduling; verify deployed publisher and enabled sweeper | One explicitly approved batch passes dry run and posts correctly; published IDs/statuses are saved |
| E — second-client pilot | Client-scoped inventory/corpora, settings, watchlist, guard rules, timezone and permissions | One other client completes the same loop without owner data leaking into its results |
| F — performance feedback | Join published IDs to suggestion/package/opportunity; collect available outcomes with sample-age context | Review can compare opportunities, originals and assets using real results |
| G — smarter selection | Tune relevance, cadence, engine diversity and formats from pilot evidence | Measured improvement over the initial rules, with understandable reasons |
| H — more channels and sources | Add other existing scanners, then supported channel adapters and channel-specific copy | Each source/channel passes its own end-to-end flow |

Keep publishing approval separate from approval to build the POC. Follow the repository's X-operation requirements before live writes. Automated drafting can roll out before automated publishing.

## 8. Brain integration

For the POC, read the approved Brain and existing benchmark report. Do not create a second Brain or modify its schema just to generate three suggestions.

After the loop works, add a reviewed Distribution Strategy section containing preferred formats, cadence policy, account targets, examples and evidence dates/confidence. Retain raw scans, audit reports and metrics in their source stores. Wire the new section into context builders and consumers explicitly; adding a field alone does not update downstream prompts.

Audit conclusions should arrive as proposed strategy changes with evidence. Do not overwrite approved brand identity or strategy based on one successful post.

## 9. Defer until the loop proves useful

Embeddings/vector search, a new calendar, a new content card, generic workflow infrastructure, large inventory migrations, multi-channel autopublishing, automatic Brain rewrites, model routing optimization and advanced cadence experiments.

Keep the pure selector separate from storage/provider calls, stable source IDs and existing gates. Those few boundaries make later improvements possible without slowing the POC.

## 10. Build priority

Start with Slice A immediately after confirming the implementation base. Then Slice B proves the user workflow. Slice C proves daily operation. Do not wait for the entire Active Content System roadmap, performance dashboard or client productization before demonstrating value.

POC handoff evidence: one replay output, one saved real-data run, screenshots of the review panel and resulting unscheduled draft, relevant test results, and a short list of known limitations.
