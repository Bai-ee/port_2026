# Daily Content Loop — Prototype Build Plan (multi-agent)

Date: 2026-10-10
Status: active build plan. Orchestrated by one agent, executed in phases by parallel Sonnet agents.
Worktree: `~/Documents/Repos/Bballi_Portfolio-daily-loop` · branch `feat/daily-content-loop` · base `4c99ab23` (verified = current Vercel production deployment).
Builds on: `docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md` (product intent + rollout phases D–H). Where the two disagree on build steps, **this plan wins**; the master plan still owns long-term rollout.

---

## 0. The one question the loop answers

> "Which current X conversations are gaining momentum, which fit my brand, and what content do I already own that lets me contribute something useful?"

Flow: inputs → conversation shortlist → momentum + brand-fit assessment → relevant owned content → grounded draft → checks → human review → **save once as an unscheduled draft**.

Up to three suggestions per run is a **review limit, not a posting quota**. Fewer is a valid result when evidence or content is thin. Nothing is ever scheduled or published by the loop.

## 1. The bar: "working prototype", not "perfect"

The prototype is done when the loop is **installed and repeatable** on real data, with every weakness visible instead of hidden. Quality items that make it *better* but not *working* go to the Elevation Backlog (§9) and are explicitly out of scope.

Good-enough rules for every agent:

- Prefer a clearly labelled limitation over a clever fix.
- Prefer one readable function over a configurable framework.
- Reuse what exists; add new files only where this plan names them.
- A gap shown to the reviewer is a success; a silently forced match is a bug.
- No new libraries. No new collections beyond `x_content_daily_runs`. No new API route files.

## 2. Verified current state (2026-10-10, ~19:15 CT)

All uncommitted in the worktree. Another session built it between ~17:30 and ~18:05.

| Piece | File | State |
|---|---|---|
| Selection, brand fit, conversations, copy, checks, orchestration | `features/x-content-inventory/daily-loop.js` (1,037 lines, `LOOP_VERSION = 2`) | Built. Narratives = posts sharing ≥2 terms; momentum = velocity + reach + freshness; brand fit needs a library **anchor phrase** or held genre or ≥2–3 distinctive terms, plus a guard lane check; content basis tiers `story` / `facts` / `none`; contribution type reply/quote/original by age |
| Run store, input loader, review actions, model drafter | `features/x-content-inventory/daily-run-store.js` (336 lines) | Built. Transactional claim/lease, fingerprint skip, reviewed work preserved, create-once Save Draft |
| Queue helper | `features/social-posting/twitter-service.js` → `createDraftPostOnce` | Built. Derived id + `ref.create`; ALREADY_EXISTS returns the existing row |
| CLI | `scripts/x-content/daily-run.mjs` (245 lines) | Built: `--replay`, `--discover [--write]` (local `bird` search), `--execute [--set] [--force] [--draft-with-model]`, `--show`, `--save`, `--dismiss` |
| Route actions | `app/api/dashboard/quote-targets/route.js` | Built: `daily-run-latest/-generate/-save-draft/-dismiss` (owner allowlist; demo set by default, `library:'full'` opt-in). No new route file |
| Review UI | `components/dashboard/x-content/DailySuggestionsPanel.jsx` + `today` tab in `XContentEngineCard.jsx` | Built, **not walkthrough-verified** |
| Demo set | `features/x-content-inventory/daily-loop-demo-set.json` | 31 mechanically verified items (17 Discogs, 13 rendered mixes, 1 storied HoloPaper item). NAS flyers excluded pending OCR check |
| Tests | `__tests__/daily-loop.test.js` + `__tests__/fixtures/daily-loop-replay.json` | 18/18 pass. Full suite not yet run |

Real data already produced (read-only check):

- Run `bryan-balli-WUoltG84__2026-10-10__x__v2`: complete, fallback copy (no model), 31 items → 61 posts → 39 narratives → 4 on-brand with content, 35 off-brand → 3 suggestions (1 quote saved, 2 originals pending).
- `dashboard_state/bryan-balli-WUoltG84.marketingBrief.conversationSearch`: 10 queries, 50 posts, 23:01Z.
- `social_posts/social_dl_20261010_8cef4908`: `status:'draft'`, `scheduledAt:null` — exactly one row.

Data state:

- Brain: `status:'draft'`, v1, unapproved → used for nothing; shown as a gap.
- Strategy Builder plan: stale (09-08 → 10-08) → excluded with a reason.
- Benchmark: no saved report; computed on the fly from committed corpora `docs/audits/{bai-ee,seb-design}-x-corpus.json` and labelled as such.
- Library: 4,139 global items; 3 real stories; rich facets. Facts tier makes Discogs + own rendered mixes usable without inventing memories.

Known defects to fix in this plan (not elevation items):

1. Unsaved **edits are not persisted**; a regeneration drops them (requirement: preserve edits).
2. Preserved + regenerated suggestions can exceed 3.
3. `run.mode` says `replay` for a live-data run without the model — misleading. It conflates input source and copy source.
4. Saved-then-deleted queue row: suggestion still reports "existing".
5. `daily-loop.js` is one 1,037-line file — hard to read and impossible for parallel agents to edit safely.
6. UI not verified; edited containers lack stable DOM ids (repo rule).
7. No local daily trigger yet (scan → discover → execute).

## 3. Ground rules for every agent

Non-negotiable:

- **Work only in the worktree** `~/Documents/Repos/Bballi_Portfolio-daily-loop`. Never edit the main checkout or other worktrees.
- **No commits, pushes, deploys, Brain/strategy approvals.** The orchestrator commits only after the user approves the phase.
- **No paid calls.** No Anthropic calls, no X API calls. `bird` (local, free) is allowed only where a phase says so. Firestore **reads** are allowed; Firestore **writes** only in Phase 3 steps the user approves.
- **Never write `social_posts` except through `createDraftPostOnce`**, and never with a schedule.
- **Touch only the files your track owns** (§6). If you need a change in another track's file, report it; do not make it.
- Do not run `/api/worker/*` routes locally (they run unauthenticated and spend money).
- Do not run `npm run build` unless the orchestrator asks; if asked, only in this worktree.
- Read before editing: this plan, the files you own, and `CLAUDE.md` sections on X API spend gates and the Vercel Hobby route rules.

Style:

- Match surrounding code: ESM, pure functions with injected I/O, short comments that explain *why*, `⚠️` for traps. No TypeScript, no classes.
- Each new module starts with a 3–6 line header: what it decides, what it never does.
- Keep functions under ~60 lines where practical. Name by purpose.
- Frontend: any container you meaningfully edit gets a stable kebab-case `id` (e.g. `id="daily-suggestion-card"`, `id="daily-run-inputs-panel"`). Inline styles are the repo idiom.
- Tests: `node --test`. Add tests in **your own new test file** (named in §6) so tracks never collide in one file. Test real failure cases, not coverage.

Report format when finishing a task (to the orchestrator):

- Files changed · behaviour changed · what stayed untouched · tests run + result · what is not verified · any request for another track.

## 4. Target module layout (after Phase 1)

`daily-loop.js` and `daily-run-store.js` keep their paths as **barrels** (re-exports) so the CLI, route, panel and existing tests do not change imports.

```text
features/x-content-inventory/
  daily-loop.js                 barrel: export * from './daily-loop/index.js'
  daily-run-store.js            barrel: store + review re-exports (keeps current export names)
  daily-loop/
    index.js                    re-exports every public name below
    config.js                   LOOP_VERSION, CHANNEL, DEFAULT_TIMEZONE, MAX_SUGGESTIONS,
                                OWNER_CLIENT_IDS, assertOwnerClient, thresholds, SLOT_TIMES, MAX_LEN
    text.js                     tokenize, STOPWORDS, WEAK_TERMS, COMMON_WORDS, GENERIC_PHRASES,
                                packageTerms, packagePhrases, phraseHits
    content-basis.js            isRealStory, contentBasis, packageEligibility, INELIGIBLE_REASONS
    brand.js                    buildBrandProfile, brandFit, discoveryQueries
    conversations.js            normalizeConversationPost, conversationMomentum, groupNarratives,
                                conversationPostsFrom
    evidence.js                 performanceEvidence, deriveStrategy
    select.js                   matchScore, pickContributionType, snapshots, selectSuggestions
    copy.js                     buildContributionPrompt, fallbackCopy, guardTypeFor, checkSuggestionText
    time-ids.js                 localDateOf, zonedTimeToIso, stableHash, suggestionIdFor, socialPostIdFor
    run.js                      describeInputs, inputFingerprint, runDailyLoop
    run-store.js                runDocId, claimDecision, mergePreserved, memory + Firestore stores
    review.js                   composeQueueContent, saveSuggestionDraft, dismissSuggestion,
                                editSuggestion (Phase 2A)
    inputs.js                   loadDailyLoopInputs
    drafter.js                  DRAFT_MODEL, createModelDrafter
```

Dependency direction (no cycles): `config, text, time-ids` → `content-basis` → `brand, conversations, evidence` → `select` → `copy` → `run`; `run-store` → `review`; `inputs, drafter` stand alone.

## 5. Contracts (agents code against these)

These shapes already exist; Phase 2 only adds the fields marked **new**.

```js
// Run doc: x_content_daily_runs/{clientId}__{localDate}__x__v{LOOP_VERSION}
{
  clientId, localDate, timezone, channel: 'x', version,
  status: 'running' | 'complete' | 'partial',
  inputSource: 'live' | 'fixture',          // new (replaces the misleading `mode`)
  copySource: 'model' | 'fallback' | 'mixed', // new
  mode,                                      // kept one version for old readers; derived from the two above
  inputFingerprint, inputs: [/* describeInputs rows */],
  scanGeneratedAt, searchGeneratedAt, brainStatus, brainVersion,
  strategy, brandProfile, shortlist, stats, gaps: [{ code, message, count? }],
  suggestions: [Suggestion], usage: { modelCalls, failures }, generatedAt,
}

// Suggestion
{
  id,                                        // dl_YYYYMMDD_hash(clientId|date|opportunity|package) — stable
  type: 'reply' | 'quote' | 'original',
  rank, conversation, opportunity, package, why: { now, brand, brain, strategy, content, history },
  scores, match, proposedSlot,               // proposedSlot is display-only
  draft: { text, selfReply, source },
  checks,                                    // checkSuggestionText(draft.text)
  edit: { text, at, checks } | null,         // new — the reviewer's working copy
  reviewState: 'pending' | 'edited' | 'saved' | 'dismissed',  // 'edited' is new
  socialPostId: string | null,
}
```

Review action contract (Phase 2A implements, 2B calls):

```js
editSuggestion(deps, { key, suggestionId, text })
  // → updated Suggestion. Re-runs checkSuggestionText on `text`, stores edit {text, at, checks},
  //   sets reviewState 'edited'. Refuses saved/dismissed (409). Empty text clears the edit → 'pending'.
saveSuggestionDraft(deps, { key, suggestionId, text? })
  // text omitted → uses edit.text if present, else draft.text. Unchanged otherwise.
```

Route actions (all on `POST /api/dashboard/quote-targets`, owner-only):
`daily-run-latest`, `daily-run-generate`, `daily-run-edit` (**new**), `daily-run-save-draft`, `daily-run-dismiss`.

Preservation rule (run-store `mergePreserved`): a suggestion is kept across regeneration when `reviewState ∈ {edited, saved, dismissed}` or `socialPostId` is set. Kept suggestions come first. Fresh pending suggestions fill **only the remaining slots up to MAX_SUGGESTIONS**, counting only kept suggestions that are not dismissed. Dismissed suggestions stay in the doc (hidden by default in UI) and their package/opportunity pair is not re-suggested the same day.

## 6. Phases

Each phase ends with a **gate**: orchestrator runs verification, reports to the user, and stops for approval (and a commit, if the user approves) before the next phase.

### Phase 0 — Orchestrator setup (no sub-agents)

1. Confirm with the user that the session that built the current WIP is closed. Check file mtimes; if anything changed in the last 15 minutes, stop and ask.
2. `git status` in the worktree; ensure the untracked `node_modules` symlink is ignored (check `.gitignore`; if not ignored, propose adding `/node_modules` handling to the user — do not commit it).
3. Copy `docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md` from the main checkout into the worktree (it is untracked there). Do not modify the main checkout copy.
4. Baseline: `node --test features/x-content-inventory/__tests__/daily-loop.test.js` (expect 18/18), then `npm test` once; record pass/fail counts. Pre-existing failures are noted, not fixed.
5. **Gate 0:** ask the user to approve a WIP snapshot commit on `feat/daily-content-loop` ("wip: daily content loop prototype as built") so Phase 1 has a clean diff base. No push.

### Phase 1 — Readability split (1 agent, sequential)

**Agent 1-SPLIT** owns: everything under `features/x-content-inventory/daily-loop/` (new), `daily-loop.js`, `daily-run-store.js`.

- Move code into the §4 layout **verbatim** (cut/paste + imports). No logic changes, no renames of exported names, no reformatting beyond imports.
- Barrels keep every current export name working: the CLI, route, panel and `daily-loop.test.js` must run unchanged.
- Add the short header comment to each new module.
- Do not touch the test file, CLI, route, panel or twitter-service.

**Gate 1:** 18/18 daily-loop tests unchanged; `npm test` counts identical to baseline; `node scripts/x-content/daily-run.mjs --replay features/x-content-inventory/__tests__/fixtures/daily-loop-replay.json` output identical (diff the JSON with `generatedAt` ignored); `git diff --stat` shows only moves + barrels.

### Phase 2 — Parallel hardening (4 agents at once, disjoint files)

Launch all four together. Each owns its files exclusively.

**Agent 2A — Review state** owns `daily-loop/run-store.js`, `daily-loop/review.js`, `daily-loop/run.js`, new test `__tests__/daily-loop-review.test.js`.

- Implement `editSuggestion` per §5; `saveSuggestionDraft` uses `edit.text` when no text passed.
- Fix `mergePreserved`: keep `edited` too; cap total non-dismissed at `MAX_SUGGESTIONS`; skip fresh suggestions whose `(opportunity.id, package.id)` was dismissed today.
- Replace `mode` semantics: set `inputSource` (`'fixture'` only when the caller passes `opts.inputSource = 'fixture'`; default `'live'`) and `copySource`; keep `mode` derived for one version.
- Saved-then-deleted: in `saveSuggestionDraft`, when `s.socialPostId` is set, accept an optional `deps.postExists(id)`; if provided and false, clear `socialPostId`, set `reviewState:'edited'` with the saved text, and allow a re-save (same derived id — still exactly one row). If `postExists` is not provided, keep current behaviour.
- Tests: edit survives forced regeneration; edit re-checked (blocked edit cannot save); cap holds at 3 with 2 kept + 3 fresh; dismissed pair not re-suggested; repeated save after edit → one row; deleted-row re-save → one row.

**Agent 2B — Route + panel** owns the daily-run block in `app/api/dashboard/quote-targets/route.js` (only `DAILY_RUN_ACTIONS`, `handleDailyRun`, `latestDailyRun`), `components/dashboard/x-content/DailySuggestionsPanel.jsx`, the `today` tab lines in `XContentEngineCard.jsx`.

- Add `daily-run-edit` calling `editSuggestion`; pass `postExists` (one `social_posts` doc read) and `inputSource:'live'` to the loop.
- Panel, in this order, top to bottom:
  1. `id="daily-run-inputs-panel"` — the `run.inputs` rows: input, status, age, detail. Missing/stale/unapproved shown in plain words.
  2. `id="daily-run-gaps-list"` — `run.gaps` messages (collapsed after 3).
  3. One `id="daily-suggestion-card"` per suggestion (`data-suggestion-id`): type badge; conversation posts (author, text, age, link); **why now / why brand / what content / history** lines from `why`; asset thumb if `package.thumbRef`; package facts with provenance; editable textarea (debounced `daily-run-edit` on blur), checks (blocked violations in red, warnings, advisory score labelled "advisory"); proposed slot labelled "suggestion only"; buttons **Save Draft** (disabled while blocked or saving) and **Dismiss**.
  4. `id="daily-run-shortlist"` — collapsed list of skipped conversations (off-brand / no content) from `shortlist` + gaps, so the reviewer sees what was rejected and why.
  - Saved card shows "Saved as draft" + post id; dismissed cards hidden behind a "show dismissed" toggle.
  - "Generate" button with a "Use model copy (paid, ≤3 calls)" checkbox **off by default**; the label states the cost.
- Code against the §5 contract even before 2A lands; integration happens at the gate.
- Mobile: respect the repo mobile-width standard (no extra horizontal padding ≤480px).

**Agent 2C — Selection regressions** owns `daily-loop/text.js`, `daily-loop/brand.js`, `daily-loop/conversations.js`, `daily-loop/select.js`, new test `__tests__/daily-loop-selection.test.js`, new fixture `__tests__/fixtures/daily-loop-real-shapes.json`.

- Build a fixture from **real saved shapes** (copy 10–15 posts from the saved `conversationSearch` + scan via a read-only Firestore read, and ~20 demo-set packages). Strip nothing but tokens/secrets; keep texts short.
- Lock in behaviour with tests, changing logic **only** when a test exposes a clear defect. Required cases:
  - The junk matches found in review stay rejected: "pro" ↛ "Kojak – Hold Me", "hey" ↛ portrait, "japanese" ↛ shokupan photo, "super" ↛ "Super Bowl Beatdown", "star wars" ↛ text-message screenshot.
  - A conversation naming a held label/artist matches that item with tier `specific`.
  - An image-only post with no text is never brand-fit; it appears in the shortlist with reason "no text to assess".
  - A viral off-brand post loses to a modest on-brand one.
  - Every suggestion has non-empty `why.now`, `why.brand`, `why.content`.
- If a change is needed outside these files, report it.

**Agent 2D — CLI, local automation, runbook** owns `scripts/x-content/daily-run.mjs`, new `scripts/x-content/daily-loop-local.sh`, `scripts/x-content/install-scan-schedule.sh` (additions only), new `docs/source-of-truth/DAILY-CONTENT-LOOP.md`.

- CLI: pass `inputSource:'fixture'` for `--replay`; print the inputs table first; add `--edit <id> --text "..."`; add `--library full|demo` (default `demo`, same as the route); `--show` prints why-lines and gaps.
- `daily-loop-local.sh`: runs, in order, the existing scan (`scan-quote-targets.mjs --client …`), `daily-run.mjs --discover --write`, `daily-run.mjs --execute` (no model). Exits non-zero on failure; each step logs to `~/Library/Logs/hitloop-daily-loop.log`; a failed scan does not block discover/execute (the run shows the stale input).
- `install-scan-schedule.sh`: add an **optional, separate** launchd job for `daily-loop-local.sh` at 06:45 America/Chicago, printed as a dry-run plist unless `--install` is passed. Do not install it.
- Runbook `DAILY-CONTENT-LOOP.md` (as-built SSOT, ≤150 lines): what the loop does, inputs and where each lives, commands, cost table (what is free / what is paid), traps (bird is local-only; worker routes unauthenticated locally; demo set vs full library; Brain must be approved to shape voice), how to read a run, how to reset a day (`--force`).

**Gate 2 (orchestrator):**

- All daily-loop test files pass; `npm test` no new failures vs baseline.
- Replay CLI works; `--show` on today's real run prints inputs, why-lines, gaps (read-only).
- Grep: no `scheduledAt:` non-null writes, no `postNow`, no X API imports in new code.
- Integration check of 2A × 2B: route `daily-run-edit` → `editSuggestion` contract matches.
- Short code read for readability: headers present, no dead code, no debug logs.

### Phase 3 — Real-data manual loop (orchestrator + 1 agent; user present)

**Owner decisions needed before starting** (orchestrator asks; do not assume):

1. Brain: approve as-is · correct then approve · or run this phase with the Brain unapproved and labelled (acceptance then records "voice not from approved Brain").
2. Library for the run: demo set (default) or full library.
3. Approve model copy: ≤3 Anthropic calls (~cents, logged to the Operating Cost card) — or stay on fallback copy.
4. Approve the Firestore writes this phase makes (run doc, `conversationSearch`, at most 3 draft rows).

Steps:

1. Free refresh: existing scan + `--discover --write` (local `bird`).
2. `--execute --force` (fallback copy) → inspect with `--show`.
3. If approved: `--execute --force --draft-with-model`.
4. **Agent 3-UI** starts the worktree dev server on a non-default port (`next dev --webpack -p 3001`), opens the Content Engine card → Today tab, and walks through: inputs panel, gaps, one edit (blur → persisted), reload page (edit still there), regenerate (edit still there), Save Draft twice quickly (one row), Dismiss one. Screenshots of each. Read-only on anything outside the loop.
5. Verify the saved draft appears in the existing queue/calendar view with `sourceRef.kind:'daily-loop'`, `status:'draft'`, `scheduledAt:null`.
6. Verify a second client id is rejected (route returns 403).

**Gate 3:** acceptance tier 2 (§7) evidence collected: run doc id, screenshots, draft id, test counts, known limitations list.

### Phase 4 — Install daily operation (user-approved)

1. User approves installing the launchd job from 2D (`install-scan-schedule.sh --install`).
2. Soak: three consecutive mornings. Each morning the orchestrator (or user) checks: run exists for the local date, inputs ages sensible, no duplicate `social_posts`, edits from the previous day untouched, log has no errors.
3. **Gate 4:** acceptance tier 3. Then propose (not start) the first Elevation items.

Out of scope until separately approved: merge to `main`, deploy, publishing/scheduling, a second client.

## 7. Acceptance tiers

**Tier 1 — Fixture demo (no credentials, no cost)**

- `--replay` on both fixtures completes, `inputSource:'fixture'`, `copySource:'fallback'`.
- One multi-post conversation matched to a specific owned item; momentum explained with timestamps/ages.
- Viral unrelated post rejected with a visible reason; image-only post rejected with a reason.
- Facts-only item drafted with no memory/attendance/result claims; story item may use first person.
- Blocked edit cannot be saved; double save → one row; regeneration keeps edits and dismissals; cap ≤3.
- Non-owner client rejected.

**Tier 2 — Real-data manual loop**

- Scan and search under 36h old at run time; inputs panel shows every input's status and age.
- Brain status recorded (approved version, or explicitly "unapproved — not used").
- 0–3 suggestions, each with why-now, why-brand, what-content, and history (or "no evidence").
- At least one conversation→owned-content pairing the owner judges relevant. If none, the run's gaps explain why; that is recorded as a **fail of conversation discovery**, not hidden.
- Model calls ≤1 per suggestion, logged (if approved).
- Save Draft → exactly one `social_posts` draft, `scheduledAt:null`, visible in the existing queue; edits survive reload and regeneration.
- Zero X writes; zero scheduled rows.

**Tier 3 — Daily automation**

- launchd runs scan → discover → execute at ~06:45 CT without manual steps.
- A sleeping/offline Mac yields a visible stale-input run (or no run) — never a silent failure.
- Unchanged inputs skip regeneration; 3 consecutive days with no duplicate rows, no lost edits, no unlogged spend.
- Still draft-only.

## 8. Risks and how the plan contains them

| Risk | Containment |
|---|---|
| Parallel agents collide | Phase 1 split + exclusive file ownership + per-track test files |
| Split silently changes behaviour | Verbatim move; Gate 1 compares replay JSON and test counts |
| Concurrent session still editing | Phase 0 mtime check + user confirmation |
| Paid calls by accident | No-paid-calls rule; model copy off by default and gated in Phase 3 |
| Duplicate queue rows | Derived id + `ref.create`; tested in 2A and walked through in Phase 3 |
| Invented facts | Facts-tier prompt rule + human review; OCR flyers excluded until verified |
| Owner data leaking to clients | Owner allowlist stays; client rollout is an Elevation item |
| Vercel function count | No new route file; actions added to the existing route |

## 9. Elevation backlog (after the loop is installed — not now)

Ordered roughly by value. Each becomes its own small plan when picked up.

1. **Approved Brain as brand-fit input**, not only voice: positioning/topics → brand profile terms (wire through `loadClientBrainContext` consumers explicitly).
2. **Momentum over time**: a second daily scan snapshot → acceleration instead of single-point velocity.
3. **Conversation depth**: fetch replies/quotes for the top shortlisted narrative (free `bird`), show what people are actually saying.
4. **Image-only posts**: a cheap vision description for shortlisted image posts (paid, opt-in).
5. **Full library default**: verify OCR flyers (903 with printed facts), widen beyond the demo set.
6. **Story capture**: prompt the owner for a 2-line story on items that keep matching.
7. **Quote/media handling**: verify the publisher's quote behaviour (trailing status URL vs `quote_tweet_id`); attach owned media to originals.
8. **Distribution Strategy section in the Brain** (master plan §8) with evidence dates.
9. **Performance feedback** (master plan phase F): join published ids → suggestion/package/conversation outcomes.
10. **Approval + scheduling** (master plan phase D) under the X spend-gate protocol.
11. **Second client** (phase E): client-scoped inventory, corpora, watchlist, timezone.
12. Tune thresholds/weights from pilot evidence; model choice review for drafting.

## 10. Agent brief template (orchestrator fills this per agent)

```text
You are Agent <ID> on the Daily Content Loop prototype.
Worktree: ~/Documents/Repos/Bballi_Portfolio-daily-loop (branch feat/daily-content-loop). Work only here.
Read first: docs/plans/DAILY-CONTENT-LOOP-PROTOTYPE-BUILD-PLAN.md (§1, §3, §5, and your track in §6), then the files you own.
You own exactly these files: <list>. Do not edit anything else; report needed changes instead.
Task: <track bullets from §6>.
Rules: no commits/pushes/deploys; no Anthropic or X API calls; Firestore reads only<, plus …>; no new libraries;
match existing style; stable DOM ids on edited UI containers; tests in <your test file>.
Done when: <track acceptance>.
Report: files changed · behaviour changed · untouched · tests run + results · not verified · requests for other tracks.
```
