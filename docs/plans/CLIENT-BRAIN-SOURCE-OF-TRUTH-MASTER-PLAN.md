# Client Brain as Source of Truth: Master Plan

Status: **Shipped (pending merge/deploy ids — orchestrator fills).** Phases 0–3a, 3b, 4 and 6a–6c built. 6d (repost) not built. As-built SSOT: `docs/source-of-truth/CLIENT-BRAIN-SOURCE-OF-TRUTH.md`. Run prompt: `docs/plans/CLIENT-BRAIN-SOURCE-OF-TRUTH-MASTER-PROMPT.md`.
Worktree: `/Users/bballi/Documents/Repos/Bballi_Portfolio-content-center`, branch `feat/client-brain-sot` (off `main` `7ef8d210`).
Target client: **`bryan-balli-WUoltG84`** ("Hitloop · hitloop.agency"). `bryan-balli` is an orphan (no `clients` doc) and is ignored.
Last updated: 2026-10-13.

## Goal

The approved Client Brain (`CLIENT_BRAIN.md`, compiled into `clients/{clientId}/client_brain/current`) is the single source for every strategy field in the system:

- **Brain → system.** Approving a Brain, or injecting an approved one, fills every Brain-owned field in every settings store.
- **System → Brain.** Editing a Brain-owned field in any card rewrites that field's home section in the Brain's Markdown and recompiles the Brain.
- Operational settings stay owned by their cards: schedules, cadence, cost toggles, recipients, analytics IDs, post times and similar.

Owner decisions so far:

- Card edits write to the Brain. Fields are not locked.
- On first sync, the client's current settings are adopted into the Brain (option A) only where the Brain section is empty; where the Brain has a value, the Brain wins (2026-10-13).
- This reverses the earlier documented rule "manual card setting > approved Brain decision". The Brain now owns these fields.

---

## Phase 0: Field-gap fixes (formatter ⇄ compiler ⇄ consumers)

**What changed**

- **Compiler (`features/client-brain/markdown.cjs`)**
  - These Identity fields now compile into new keys. Each key is added only when the section exists, so existing brains are unchanged:
    - `Differentiators` → `positioning.differentiators`
    - `Mission` → `identity.mission`
    - `Long-Term Positioning` → `positioning.longTerm`
    - `Core Philosophy` → `positioning.principles`
    - The four one-liners → `positioning.channelOneLiners {strategic, safePublic, linkedin, x}`
    - `Authority Claim` (all items) → `positioning.authorityClaims`
  - **Root-cause fix.** `cleanList` split every bullet on commas, which broke values like "$3,500" and "Converts onboarding, websites…". A new `keepBullets` option keeps a prose bullet whole. Metrics, Authority Claim, Differentiators and Core Philosophy use it.
  - `sourceStandard` frontmatter is kept in `markdownMeta` when present (optional).
- **Context (`loadClientBrainContext` → `buildUseForContext`)**
  - The channel one-liner (`X one-liner` for socialPosts, `Public one-liner` for positioning uses) sits under `About:`, so it survives every caller budget (1500–2500 chars).
  - The other narrative lines are appended at the end.
  - The context was trimmed to make room:
    - `Positioning:` is skipped when it repeats `About:`.
    - `Differentiation:` is capped at 6 items, `Do:` at 12 and `Do not:` at 24.
- **Voice**
  - `voice-resolver.js` maps the Formatting Rules keys `punctuation` and `links`. Scribe already printed every key.
  - Guardian gets a `COPY RULES` block, but only when `punctuation` or `links` is present, so NTR's prompt is unchanged.
- **Docs**
  - `CLIENT_BRAIN_FORMATTER_PROMPT.md` now asks for every field the compiler reads, preserves them all when merging, and lists every Formatting Rules key and Decision Driver group.
  - `CLIENT_BRAIN_MARKDOWN_STANDARD.md` has the optional-fields table.

**Verified**

- The 9-phrase probe check passes on the HITLOOP brain. Results: `missingData` and `contradictions` are both `[]`, confidence is `high`, and there are 4 drivers.
- Backward compatibility is pinned by sha256 hashes of the pre-change compile for `bryan-balli`, `BRYAN_EXAMPLE` and `marketing/CLIENT_BRAIN.md`. Those brains only gain new keys.

## Phase 1: Market Signals + Listening owned by the Brain

**New module: `features/client-brain/brain-sync.cjs`**

- An ownership manifest maps each card field to exactly one home section in the Brain.
- `syncBrainToSystem` pushes Brain values into the settings stores. Card saves call `writeCardEditsToBrain` / `recordCardEdits`.
- Only fields that changed in that save are written back. A whole-form save never pushes stale values.
- On write-back, the Brain keeps items the card can't show: items past the card's cap, and filtered items such as the linkedin/producthunt platforms.
- A Brain value that is only *derived* (no explicit section yet) fills an empty field. It never replaces a tuned value.
- Comparisons use the normalized value, so whitespace or legacy formatting is not counted as a change.

**Fields (store: `client_configs.marketingBriefConfig`, plus the `scoutConfig` mirror)**

| Field | Brain home |
|---|---|
| brandName | Identity › Name |
| brandXHandle | Identity › X Handle *(new)* |
| brandKeywords | Discovery › Keywords |
| categoryTerms | Market › Topics To Monitor |
| competitors | Market › Competitors |
| kols (Listening watchlist) | Discovery › Watch Lists |
| instagramHandles | Discovery › Instagram Handles *(new)* |
| sourcePlatforms | Discovery › Primary Platforms |
| searches | Discovery › Search Queries *(new; derived from keywords/topics/competitors when absent)* |
| sourceFocus | Discovery › Source Focus *(new; derived from Positioning + Audience when absent)* |

**Wiring**

- `marketing-brief/config` GET returns the Brain's live projection as its "From Client Brain" defaults, replacing the frozen persisted defaults.
- POST writes changed fields back to the Brain.
- The old auto-promote loop is removed. It now runs only for brains without Markdown.
- `client-brain/approve` and inject (`client-brain` POST) both call `onBrainStatusChanged`.

**Bugs fixed**

- Market Signals saves no longer drop `gbpReputation`, `kolsOff`, `brandKeywordsOff` or `categoryTermsOff`.
- Approval status is kept in the Markdown frontmatter, so export and re-inject no longer silently un-approve a Brain.

## Phase 2: Voice, guard, Email Digest, Brand Overview

| Store › field | Brain home |
|---|---|
| marketingBriefConfig.scoutInstructions | Discovery › Scout Instructions *(new)* |
| marketingBriefConfig.scribeTone | Content › Voice |
| marketingBriefConfig.scribeHardConstraints | Content › Hard Constraints *(new; derived from Do Not Say)* |
| marketingBriefConfig.guardianReviewerContext | Content › Reviewer Context *(new; derived from Name + Positioning)* |
| marketingBriefConfig.guardianRestrictedPatterns | **Authority › Prohibited Claims.** Guardian rejects false claims. The first mapping, to Do Not Say, would have dropped NTR's real guardrails. |
| digest_config.tone | Content › Email Tone *(new; derived from Voice; the stock default counts as empty)* |
| digest_config.extraInstructions | Content › Email Instructions *(new)* |
| digest_config.contactUrl | Identity › Contact Url *(new)* |
| brandOverview.positioning / targetAudience / headline / summary | Identity › Positioning / Primary Audience / Strategic One-Liner / Mission |
| brandOverview.businessModel / industry | Identity › Business Model / Industry *(new; derived from Offers / first Category To Own)* |

Write-back hooks: `saveDigestConfig` (covers both digest routes) and `brand-overview/config`.

The Brand Overview sync does **not** run the positioning bridge, because that bridge makes a paid model call.

## Option A: one-time settings adoption

- **What it does.** On a client's first approve or inject of an approved Brain, `adoptSettingsIntoBrain` folds the client's current settings into the Brain before the first sync.
  - **Conflict rule (owner, 2026-10-13): the Brain wins.** A setting is adopted ONLY into a Brain section that is empty (no explicit value; a value the Brain only derives counts as empty).
  - Where the Brain already has a value, it is kept and the first sync pushes it to the card.
  - The Brain keeps items the card can't show (filtered platforms, cap overflow), same as write-back.
  - Two stores sharing one home (Identity › Industry = `brandOverview.industry` + `strategyBuilder.vertical`): the first store to adopt into it wins; the first sync pushes it to the other.
  - Plan engine defaults are not adopted as Track Targets; only explicit `engineTargets` count.
- **Run-once marker.** `settingsAdoptedAt` on the Brain doc ensures it runs only once. The adopted Markdown is versioned (reason `adopt`).
- **Read-only preview.** `node scripts/client-brain/brain-sync-report.cjs <clientId> [--markdown <path>]` shows the adoption and the first-sync diff.
- **HITLOOP on `bryan-balli-WUoltG84` (local Brain via `--markdown`, read-only):** adoption changes **0** fields. First sync writes from the Brain: Scribe tone, Brand Overview positioning / audience / headline / summary, plus the fills — X handle `bai_ee`, 14 Guardian prohibited claims, 6 Strategy Builder fields (vertical, CTA text + url, guardrails, avoid topics, preferred narratives) and Track Targets (posts/day into plan engine targets). Strategy doc and content tracks: 0 changes (the Brain already matches the live plan/doc).
- **⚠️ NTR (`nottherug-ten-QSMYxuuv`, live read-only) under Brain-wins:** adoption fills 8 empty sections (Instagram handles, searches, source focus, scout instructions, hard constraints, reviewer context, digest tone + instructions), but the first sync then replaces tuned card values with the NTR Brain's: keywords (4 → 12), topics, competitors, KOLs, **sources `web, reddit, instagram` → `instagram` only**, Scribe tone, and Guardian patterns — **"insured and bonded" is not in the Brain's Prohibited Claims and would be dropped.** Nothing happens until NTR is re-approved or re-injected. **Before that, edit the NTR Brain:** add "insured and bonded" under Authority › Prohibited Claims and `web`, `reddit` under Discovery › Primary Platforms, then run the preview.

## Phase 3a: Opportunity, X profile, Strategy Builder

| Store › field | Brain home |
|---|---|
| marketingBriefConfig.opportunitySignals.queries | Opportunity › Opportunity Queries *(new; `label: \| query: [\| enabled: false]`, on/off kept per row)* |
| marketingBriefConfig.xGrowth.ownHandle | Identity › X Handle (shared with brandXHandle) |
| marketingBriefConfig.xGrowth.benchmarkHandles | Market › Benchmark Accounts *(new)* |
| strategyBuilder.config.vertical | Identity › Industry |
| strategyBuilder.config.campaign.ctaText | Content › Calls To Action (first item only) |
| strategyBuilder.config.campaign.ctaUrl | Content › CTA Url *(new; derived from Primary Url)* |
| strategyBuilder.config.campaign.guardrails | Content › Hard Constraints |
| strategyBuilder.config.editorial.operatorPreferences.avoidTopics / preferredNarratives | Content › Topics To Avoid / Content Pillars |

Write-back hooks:

- `strategy-builder/config`.
- X Strategy profile saves go through an injectable `onXGrowthSaved`, wired in the `quote-targets` route and the MCP readers. It is not wired in tests.

---

## Files changed

- **New:**
  - `features/client-brain/brain-sync.cjs`
  - `scripts/client-brain/brain-sync-report.cjs`
  - `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md` (copied from main)
  - Tests:
    - `features/client-brain/__tests__/{markdown-field-gaps,brain-sync}.test.js`
    - `features/not-the-rug-brief/__tests__/guardian-copy-rules.test.js`
- **Modified:**
  - Compiler / Brain: `features/client-brain/{markdown,store}.cjs`
  - Voice: `features/not-the-rug-brief/{voice-resolver,guardian}.js`
  - Digest config: `features/intelligence/_digest-config.js`
  - X Strategy: `features/x-strategy/route-handlers.js`
  - MCP: `features/mcp/readers.js`
  - Routes: `app/api/dashboard/{marketing-brief/config,client-brain,client-brain/approve,brand-overview/config,strategy-builder/config,quote-targets}/route.js`
  - Docs: `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`
  - The new, previously untracked formatter prompt: `docs/company-brain/CLIENT_BRAIN_FORMATTER_PROMPT.md`

## Verification

- **`npm test`:** 5,492 tests, 5,490 pass.
  - The 2 failures are `studio-render` vendor-sync tests. They were already failing at HEAD: the vendor copy of `firebase-admin.cjs` differs from the source, and this work didn't touch either file.
  - One run also hit a flaky IBL determinism timeout. That test passes alone (137/137).
- Read-only live dry runs were done for `nottherug-ten-QSMYxuuv` and `bryan-balli-WUoltG84`. **No live writes** were made.
- **`bryan-balli-WUoltG84`, 2026-10-13 (read-only, `brain-sync-report.cjs`):**
  - Live Brain (Claire Calls, `stale`): sync skips it until approved. Adoption would fold 25 fields of the live Hitloop settings into the Claire Calls Markdown — the reason the owner injects the HITLOOP Markdown first.
  - Local HITLOOP `CLIENT_BRAIN.md` via `--markdown` (as if injected + approved), Brain-wins rule: see Option A (adoption 0; first sync = Scribe tone + 4 Brand Overview fields from the Brain + the fills).
  - Two bugs found and fixed by this run: (a) `Identity › Industry` is shared by `brandOverview.industry` and `strategyBuilder.vertical`, and adoption let the later (junk) vertical overwrite Industry — now the first store to adopt a shared home wins; (b) `joined` fields (Primary Audience) were truncated at 240 chars per bullet on the round trip, producing a phantom diff — the cap is now 1000.
- No paid calls were made: no LLM, X API or ScrapeCreators.

---

## Owner decisions (2026-10-13, final)

1. **Target client = `bryan-balli-WUoltG84`.** It holds the live Market Signals config (12 keywords, brandName Hitloop) and a wrong Brain (status `stale`, Markdown = Claire Calls). The owner injects the HITLOOP Markdown there in prod; approve then adopts settings once and syncs. `bryan-balli` (no `clients` doc) is ignored.
2. **Phase 3b: the Brain owns the Strategy document and X content tracks outright.** Brain changes overwrite even a confirmed Strategy document; card edits write back. Safety = a versioned backup of the Brain Markdown before every Markdown write (`clients/{id}/client_brain_versions`, last 50).
3. **Phase 4 UI:** "From Client Brain" labels, Re-sync button, Generate recompiles from Markdown, export-route fix, Versions list.
4. **Phase 6:** 6a agent-proposed approve / schedule / unschedule (owner confirms each card), 6b Brain-owned per-track cadence + mix targets, 6c Today "act now" suggestions with trigger + inventory match. **6d repost is not built** (X write; separate owner go).
5. **Ship:** commit, PR to `main`, squash merge, confirm the Vercel production deploy.
6. Events/local signals stay out of the Brain. Strategy Builder editorial campaigns stay card-owned.

## Target UX (owner, 2026-10-13) — the loop this plan must deliver

1. Owner writes one well-thought-out HITLOOP Brain, injects it into `bryan-balli-WUoltG84`, approves. Every Brain-owned field above (plus Strategy document, content tracks, per-track cadence + mix targets after 3b) fills.
2. Refresh → baseline strategy: market report, plan, Today queue, strategy doc. Owner reviews, edits, approves. Edits in cards or in the Brain Markdown stay in sync, every Markdown write versioned.
3. Owner discusses the strategy with either agent, at the same level:
   - **In-app HITLOOP agent** (Marketing Director › Strategy chat): reads tracks, benchmark profiles (posts/day, best hours, type mix, media mix per track, never blended), evaluation, rule check, market signals, opportunities, inventory. Proposes changes as confirm cards.
   - **ChatGPT / Claude via MCP**: the same read + propose tools 1:1 (`strategy_*`), plus daily brief + playbook. A proposal made over MCP lands as a pending card in the in-app chat (thread "MCP") that the owner confirms in HITLOOP.
   - Questions the agents must answer well: best cadence per bucket (track) vs that track's benchmarks; what mix to post (original showcase / original text / reply / quote-react / self-quote / repost / throwback from archive / video); what to gather for it; "this narrative is hot and you already have this content, post it now"; "post about your work now".
4. Applying: a confirmed `plan-change` / `benchmarks-change` / `strategy-doc-edit` re-tunes the calendar through the existing plan → Today queue path. Posts get approved / scheduled either by the owner in Queue & Calendar, or — new in Phase 6 — by confirming an agent proposal. Publishing stays the `process-due` cron (every 15 min) plus Social Auto-Publish modes. The agent never publishes.
5. Push channel: Telegram command center (shipped, inactive until the owner activates the bot).

### Phase 6: Strategy operating loop (agent-applied queue actions + Brain-owned targets)

| Part | What | Gate |
|---|---|---|
| 6a | New proposal kinds `post-approve`, `post-schedule` (`{postId, scheduledAt}`), `post-unschedule`; executed on confirm through the existing `updateSocialPost` / schedule path (ledger + reservation rules unchanged). MCP inherits them automatically. Prompt rule text updated: the agent may *propose* approve/schedule, never publish. | Owner confirm card, no spend |
| 6b | Per-track **cadence + mix targets** in the Brain (`Content › Track Targets`: posts/day, share per type, video share) → plan `engineTargets` / track share. Benchmark profile vs target vs actual shown in `get_evaluation` and Results. | Part of 3b sync |
| 6c | Today "act now" suggestions carry the trigger (hot narrative / opportunity / benchmark gap) + the matched inventory item + Save draft / Schedule actions. Verify what `DailySuggestionsPanel` already does; fill gaps only. | Free |
| 6d | **Repost (retweet) as a post kind** (`kind:'repost'`, `repostOf.tweetId`), published by the cron through the X adapter's `repost` call. It is an X API **write**: the owner's own schedule / Repost Now click per row is the confirm; the agent only proposes. | **Built 2026-10-14 on owner go** (SSOT §13) |
| 6e | Telegram activation runbook (bot token, env, setWebhook) in the SSOT. Owner task, no code. | — |

## Known limits / risks

- **Prompt changes.** The context trims and caps change prompt text for every approved brain with long lists.
- **Write-back overflow.** If an operator removes an item from a capped card list, a Brain item past the cap moves into view on the next sync. Adoption doesn't do this.
- **X handle edits in one save.** `brandXHandle` and `xGrowth.ownHandle` share a home section, so if both are edited to different values in one save, the last one wins.
- **Generated brains.** Brains without Markdown get no sync and keep the old fill-empty and promote behavior.
- **Category terms.** Legacy terms longer than 4 words aren't pushed into the Brain's projection. The card already trims them on its next save.
- **No live HITLOOP Brain yet.** `bryan-balli-WUoltG84` holds the Hitloop settings but a Claire Calls Brain; the HITLOOP Brain exists only as `docs/company-brain/clients/hitloop/CLIENT_BRAIN.md` until the owner injects it in prod.
- **Adoption = Brain wins.** On first approve, card values are adopted only into empty Brain sections; everywhere else the Brain overwrites the card. Review the sync result after inject; every Brain write is versioned and can be reloaded from the Versions list. See the NTR prerequisite under Option A.

## Built in this run (2026-10-13)

- **3b:** Brain owns the Strategy Document, content tracks and Track Targets (`strategyDoc`, `contentTracks`, `trackTargets` in `brain-sync.cjs`); card/plan/doc edits write back via `onBrainOwnedSaved`; every Markdown write versioned (`client_brain_versions`, last 50).
- **4:** "From Client Brain" tags, Re-sync button (`client-brain-resync-button`, `client-brain-sync-result`), Versions list with Load into editor (`client-brain-versions-list`), Generate recompiles from Markdown, export-route fix.
- **6a:** proposal kinds `post-approve`, `post-schedule`, `post-unschedule` (+ MCP tools, registry 51).
- **6b:** Brain-owned per-track postsPerDay (mapped to the plan); per-type/video shares Brain-only; `byTrack` benchmark vs target vs actual in evaluation/Results.
- **6c:** Today act-now triggers (`suggestionTrigger`) with matched inventory and Save draft / Schedule.
- Not built: 6d repost (owner-gated X write). 6e Telegram runbook is documented in the SSOT (owner task).

## Prod runbook (HITLOOP on `bryan-balli-WUoltG84`)

1. Inject the HITLOOP Markdown (`docs/company-brain/clients/hitloop/CLIENT_BRAIN.md`) in Client Brain > BRAIN SOURCE.
2. Read the sync/adoption result in `#client-brain-sync-result`.
3. Approve (adoption runs once, then sync).
4. Check Market Signals, the Strategy doc, content tracks and Track Targets.
5. Re-add the ChatGPT MCP connector to pick up the new tools.
6. Run the first paid Refresh (confirm row; Client Brain upload and search params first).
Rollback of any Brain write: Versions list > Load into editor > inject > approve.
