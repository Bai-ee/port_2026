# Client Brain as Source of Truth (as-built, 2026-10-13)

Plan and history: `docs/plans/CLIENT-BRAIN-SOURCE-OF-TRUTH-MASTER-PLAN.md`. Brain format: `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`. Written against `bryan-balli-WUoltG84` (Hitloop, the home client), but the mechanism is per client since 2026-10-14: any onboarded client has its own Brain, and the admin operates it through the dashboard switcher (`?as=`). Admin only; clients do not self-serve (Phase 5, not built).

> **Multi-client (2026-10-14):** signup now writes a deterministic Brain **draft** from the client's own data (site crawl, scout config, brand overview, optional X/IG/competitors/goal); code never approves it. The owner injects/approves it (Brain wins; first approve adopts signup settings only into EMPTY sections). A client with no stored tracks now adopts Brain `### Content Tracks` rows: the first Brain track owns every engine (record/ue/client/identity), later ones start with none; engine reassignment in the UI is not built. Approved Brain is also one of the three `assertClientReady` inputs. See [`CONTENT-PILOT-OPERATIONS.md`](CONTENT-PILOT-OPERATIONS.md) §1b, §1e, §1f.

## 1. Purpose

The approved Client Brain (`CLIENT_BRAIN.md`, compiled into `clients/{clientId}/client_brain/current`) is the single source for every strategy field.

- **Brain to system.** Approve (or inject an approved Brain) and every Brain-owned field fills in every settings store.
- **System to Brain.** Editing a Brain-owned field in any card rewrites that field's home section in the Brain Markdown and recompiles it.
- Operational settings stay with their cards (section 3).
- This reverses the old rule "manual card setting > approved Brain decision". Fields are not locked.

Code: `features/client-brain/brain-sync.cjs` (manifest `TARGETS`, `syncBrainToSystem`, `recordCardEdits`, `adoptSettingsIntoBrain`, `readApprovedTrackTargets`) and `features/client-brain/store.cjs`.

## 2. Ownership manifest (field to Brain home)

| Target (store) | Field | Brain home |
|---|---|---|
| `marketingBrief` (`client_configs.marketingBriefConfig` + `scoutConfig` mirror) | brandName | Identity > Name |
| | brandXHandle, xGrowth.ownHandle | Identity > X Handle (shared) |
| | brandKeywords | Discovery > Keywords |
| | categoryTerms | Market > Topics To Monitor |
| | competitors | Market > Competitors |
| | kols (watchlist) | Discovery > Watch Lists |
| | instagramHandles | Discovery > Instagram Handles |
| | sourcePlatforms | Discovery > Primary Platforms |
| | searches | Discovery > Search Queries (derived when absent) |
| | sourceFocus | Discovery > Source Focus (derived when absent) |
| | scoutInstructions | Discovery > Scout Instructions |
| | scribeTone | Content > Voice |
| | scribeHardConstraints | Content > Hard Constraints (derived from Do Not Say) |
| | guardianReviewerContext | Content > Reviewer Context |
| | guardianRestrictedPatterns | Authority > Prohibited Claims |
| | opportunitySignals.queries | Opportunity > Opportunity Queries (`label: \| query: [\| enabled: false]`) |
| | xGrowth.benchmarkHandles | Market > Benchmark Accounts |
| `digest` (`digest_config`) | tone, extraInstructions, contactUrl | Content > Email Tone / Email Instructions, Identity > Contact Url |
| `brandOverview` | positioning, targetAudience, headline, summary | Identity > Positioning / Primary Audience / Strategic One-Liner / Mission |
| | businessModel, industry | Identity > Business Model / Industry (derived when absent) |
| `strategyBuilder` (`dashboard_state.strategyBuilder.config`) | vertical | Identity > Industry (shared with brandOverview.industry; first store to adopt wins) |
| | campaign.ctaText / ctaUrl / guardrails | Content > Calls To Action (first item) / CTA Url / Hard Constraints |
| | editorial.operatorPreferences.avoidTopics / preferredNarratives | Content > Topics To Avoid / Content Pillars |
| `strategyDoc` (Strategy Document store, versioned) | thesis, audience, tracks, formats, rules, algorithm, decisions, open | Strategy Document section of the same names ("Open questions" for `open`), each capped at 2000 chars |
| `contentTracks` (`x_strategy_plans` plan) | per track: label, share, topics, benchmarks | Content > Content Tracks, one bullet per track: `label: Design \| share: 40% \| topics: a; b \| benchmarks: handle; handle` (max 6 tracks, 3 benchmarks each) |
| `trackTargets` (plan `engineTargets`) | per track postsPerDay | Content > Track Targets, one bullet per track: `track: Design \| postsPerDay: 2 \| original-showcase: 30 \| original-text: 20 \| reply: 30 \| quote: 15 \| self-quote: 5 \| video: 40` (type values are percents) |

Track notes:

- `contentTracks` is written before `trackTargets` (targets look tracks up by label). Engines and promotions stay with the plan. Every engine must sit in exactly one track; otherwise the current owner is kept and a `warnings[]` entry is returned. Exception (2026-10-14): a client with zero stored tracks adopts the Brain rows and the first one takes every engine, so the warning no longer blocks a trackless client.
- **Track Targets mapping.** Only `postsPerDay` maps into the plan: it is split across the track's engines (`engineTargets.engines.*`) and the sum across tracks drives `authoredPerDay`. The per-type shares and the video share have no per-track home in the plan schema, so they stay **Brain-only** and are carried through write-back untouched. They are read via `readApprovedTrackTargets` for evaluation (section 11).
- Plan writes use the versioned plan save with actor/reason `client-brain`. Strategy Document writes use the doc store's save (its `history` applies).
- Brain overwrites even a confirmed Strategy Document (owner decision 2026-10-13). The safety net is the version log (section 7).

## 3. Not owned by the Brain (stay with their cards)

- Schedules and cadence toggles (Email Digest `schedule.*`, Daily-email opt-in, cron enrollment).
- Cost toggles and paid-source switches.
- Recipients (`recipientEmail`), analytics ids (GA4 property, tracked events).
- Post times and the Queue & Calendar contents.
- Plan engines and promotions (only per-track label/share/topics/benchmarks and postsPerDay are Brain-owned).
- Events and local signals.
- Strategy Builder editorial campaigns.

## 4. Adoption rule (Brain wins)

- Runs once, on a client's first approve or inject of an approved Brain, before the first sync (`adoptSettingsIntoBrain`).
- Folds the client's current settings into the Brain **only into sections that are empty** (a value the Brain merely derives counts as empty). Where the Brain has a value, it is kept and the first sync pushes it to the card.
- The Brain keeps items the card can't show (filtered platforms, items past a card's cap).
- Plan engine defaults are not adopted as Track Targets; only explicit `engineTargets` count.
- `settingsAdoptedAt` on the Brain doc is the run-once marker. The adopted Markdown is versioned (reason `adopt`).
- The result (`adoption.changes`) is shown once after approve/inject in `#client-brain-sync-result`.

## 5. Sync triggers

1. **Approve** (`POST /api/dashboard/client-brain/approve`, admin).
2. **Inject** of an approved Brain (`POST /api/dashboard/client-brain`).
3. **Re-sync button** (`#client-brain-resync-button` on APPROVED BRAIN): `POST approve {status:'approved', resync:true}`. Sync only, no adoption. Result diff in `#client-brain-sync-result`.

Brains without Markdown (generated) get no sync and keep the old fill-empty behavior. A non-approved Brain is skipped.
Generate now recompiles from the Markdown when `markdownSource` exists (reason `regenerate`, returns `mode:'markdown'`).
The export route reads the digest from `digest_config/{clientId}` and Strategy Builder from `dashboard_state/{clientId}.strategyBuilder.config`, so export and re-inject round-trip.

## 6. Write-back (card edit to Brain)

- Hooks: `marketing-brief/config`, `saveDigestConfig`, `brand-overview/config`, `strategy-builder/config`, X profile saves (`onXGrowthSaved`), and Strategy doc / plan saves (`onBrainOwnedSaved` in `features/x-strategy/route-handlers.js`). Hooks are injectable and not wired in tests.
- **Changed fields only.** `recordCardEdits(clientId, target, prior, next)` diffs prior vs next on the normalized value, so a whole-form save never pushes stale values.
- **Brain keeps what the card can't show** (cap overflow, filtered platforms).
- **Loop guard.** Saves made by the sync itself carry the `client-brain` actor/source and do not write back.
- Each write recompiles the Brain with reason `card-edit:<target>` after taking a version.
- Known limits: if an operator removes an item from a capped list, a Brain item past the cap moves into view on the next sync. `brandXHandle` and `xGrowth.ownHandle` share a home, so editing both to different values in one save: last wins.

## 7. Version log

- Collection `clients/{clientId}/client_brain_versions/{ISO ts}`: `{markdownSource (the PRIOR Markdown), status, reason, byUid, createdAtIso, size}`.
- Written by `recordBrainVersion` before any Markdown-changing save, best effort (a failure is logged, never blocks the save). Last **50** kept.
- Reasons: `inject`, `adopt`, `card-edit:<target>`, `resync`, `regenerate`, `save`.
- API: `GET /api/dashboard/client-brain?action=versions` (id, time, reason, status, size) and `?action=version&ts=<id>` (full Markdown).
- UI: `#client-brain-versions-list` on BRAIN SOURCE, with **Load into editor**.
- **Rollback** = Load a version into the editor, inject it, then approve (or Re-sync). Nothing is restored automatically.

## 8. Paid-call rule

None of sync, adopt, write-back, Re-sync or agent proposals makes an LLM, X API or ScrapeCreators call. The Brand Overview sync deliberately does **not** run the positioning bridge (it makes a paid model call). Scripts read Firestore read-only. Paid work happens only from the Refresh button (confirm row) or an owner-confirmed `paid-sync` card.

## 9. Operating loop

1. Ask the in-app agent (Marketing Director > Strategy chat) or ChatGPT/Claude over MCP (same tools 1:1, `strategy_*`, plus `get_daily_brief` and `get_action_playbook`).
2. A change becomes a **proposal card** (MCP proposals land in the in-app chat thread "MCP", badge From MCP).
3. The owner confirms the card in HITLOOP. A confirmed `plan-change` / `benchmarks-change` / `strategy-doc-edit` re-tunes the calendar through the existing plan to Today queue path, and Brain-owned edits write back (section 6).
4. Posts reach the calendar by the owner approving/scheduling in Queue & Calendar, or by confirming an agent `post-approve` / `post-schedule` / `post-unschedule` card (executed through the existing `updateSocialPost` / schedule path; ledger and reservation rules unchanged).
5. Publishing stays the `process-due` cron (every 15 minutes) plus Social Auto-Publish modes.

New propose tools: `propose_post_approve`, `propose_post_schedule`, `propose_post_unschedule` (proposal kinds `post-approve {postId, updatedAt}`, `post-schedule {postId, scheduledAt, updatedAt}`, `post-unschedule {postId, updatedAt}`). Over MCP they appear as `strategy_propose_post_approve|schedule|unschedule`. Cards: `strategy-proposal-card-post-approve` etc. Approve only works on a draft; schedule approves a still-draft post; moving an already-scheduled post uses `propose_post_edit`.

## 10. What the agent can never do

Publish, post, reply, follow, spend, or confirm its own proposals. There is no confirm tool; the owner presses Confirm on the card. Agents propose, cards apply.

## 11. Today act-now triggers and per-track evaluation

- **Act-now (6c).** `suggestionTrigger(s)` in `features/x-content-inventory/daily-loop/present.js` returns `{kind, label, reason, track}`: `opportunity-signal`, `archive-throwback`, `hot-narrative`, `benchmark-gap`. An explicit `s.trigger.kind` wins; old saved runs derive it from stored fields. Each suggestion in Today shows its trigger, the matched inventory item, and Save draft / Schedule (existing path).
- **Per-track evaluation (6b).** `features/x-strategy/evaluate.js` adds `byTrack` (only when the plan has `contentTracks`): per track `benchmarkProfile` (posts/day, best hours, type and media mix, never blended), the Brain target (`brainTrackTargets` from `readApprovedTrackTargets`), and actual last 14 days. Surfaced through `get_evaluation` and Results.

## 12. Telegram activation (owner task, no code)

Exact names and steps are in `docs/source-of-truth/TELEGRAM-COMMAND-CENTER.md` (Activation). Summary:

1. Create the bot in @BotFather (`/newbot`), keep the token private.
2. Vercel Production env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (1-256 chars, `[A-Za-z0-9_-]`), `TELEGRAM_UPLOAD_SECRET`; optional `TELEGRAM_PUBLIC_BASE_URL`.
3. Confirm `/api/worker/telegram-dispatch` returns 401 without the secret.
4. `setWebhook` with `url=https://hitloop.agency/api/telegram/webhook`, `secret_token=<TELEGRAM_WEBHOOK_SECRET>`, `allowed_updates=["message","callback_query"]`.
5. Link in Content Engine > More > Telegram > Connect Telegram. Pilot gate 1 is messaging only; gate 2 (publishing) is a separate authorization.

## 13. 6d repost (built 2026-10-14, owner go)

Repost (retweet) is a `social_posts` row with `kind:'repost'` and `repostOf {tweetId, url, author, text}` (`features/social-posting/repost.js` parses an x.com/twitter.com status URL or a bare id). Its `content` is the display label `Repost @author <url>`, never sent to X, so every existing content rule (required, 280, placeholder guard, approval hash, revision) applies unchanged. Publishing goes through the normal `publishStoredPost` path, which calls the X adapter's `repost` (`v2.retweet(userId, tweetId)`, one metered write, counted on the Operating Cost card as `x-write` with `isRepost:true`) instead of creating a tweet; `twitterId` stores the target id, so a second publish is a no-op. Instagram rows reject the kind.

Owner creates one in Queue & Calendar › Compose (mode **Repost**, `#social-posting-repost-ref-input`): Save Draft, Schedule (the `process-due` cron publishes), or Repost Now (immediate write). The composer states the spend (`#social-posting-repost-spend-note`). The agent/MCP can propose approve / schedule / unschedule on an existing repost draft like any other post; it cannot create one and never publishes. The spend gate is the owner's own schedule / Repost Now click per row (`X-API-AND-PROFILE-OPERATIONS.md` §0, §2a).

## 14. Preview script

`node scripts/client-brain/brain-sync-report.cjs <clientId> [--markdown <path>]`. Read-only: shows the adoption and the first-sync diff per target. `--markdown` evaluates a local file as if injected and approved (for example `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md`). No writes, no paid calls.

## 15. NTR prerequisite

`nottherug-ten-QSMYxuuv` has tuned card values that Brain-wins would overwrite on its next approve/inject: sources `web, reddit, instagram` would become `instagram` only, keywords/topics/competitors/KOLs/Scribe tone/Guardian patterns would be replaced, and **"insured and bonded" is not in the NTR Brain's Prohibited Claims and would be dropped.** Nothing happens until NTR is re-approved or re-injected. Before that: add "insured and bonded" under Authority > Prohibited Claims and `web`, `reddit` under Discovery > Primary Platforms in the NTR Brain, then run the preview script.

## 16. Prod runbook: HITLOOP on `bryan-balli-WUoltG84`
(Home-client runbook. For any other client use the per-client checklist in `docs/plans/MULTI-CLIENT-FINAL-PASS.md` §5: switcher → inject/approve Brain → connect X → Builder follows doc.)

The live Brain there is Claire Calls (`stale`); the real one is `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md`.

1. Switch to Hitloop (`bryan-balli-WUoltG84`). Optionally run the preview script with `--markdown` first.
2. Client Brain > BRAIN SOURCE: **inject** the HITLOOP Markdown (a version of the old Markdown is saved, reason `inject`).
3. Read the result in `#client-brain-sync-result`. Expected for HITLOOP: adoption 0 changes; first sync writes Scribe tone, Brand Overview fields, X handle `bai_ee`, Guardian prohibited claims, Strategy Builder fields, Track Targets; the Strategy doc and tracks follow the Brain.
4. **Approve.** Adoption runs once, then the sync. Re-sync later with the button.
5. Check Market Signals (fields tagged "From Client Brain"), the Strategy doc, content tracks and Track Targets in Marketing Director.
6. Re-add the ChatGPT/Claude MCP connector so it picks up the new tools (registry now 51 tools, including the three `strategy_propose_post_*`).
7. Run the first paid Refresh from the Marketing Director header (paid groups default OFF; confirm row). The owner has not run one in prod yet; the Client Brain upload and search params are the prerequisites.
8. Mistake? Versions list > Load into editor > inject > approve.
