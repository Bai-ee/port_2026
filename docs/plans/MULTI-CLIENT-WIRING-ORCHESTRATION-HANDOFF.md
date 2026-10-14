# Multi-client wiring — orchestration handoff

For the agent that runs this workstream. Read fully before dispatching anything. Companion assessment: [`MULTI-CLIENT-WIRING-MASTER-PLAN.md`](MULTI-CLIENT-WIRING-MASTER-PLAN.md) (difficulty, live state, keep/change). This doc is the operating contract: roles, phases, acceptance, gates.

## 0. Mission

Every client (not only home `bryan-balli-WUoltG84`) runs Brain → Strategy doc/plan/tracks → Today/Queue → publish on **its own** X account → Results/X Monitor → digest, on its own data, isolated. Admin drives each client through the existing dashboard switcher. Non-admin client logins = Phase 5, decision-gated, never started unprompted.

## 1. Where to work

| Item | Value |
|---|---|
| Branch | `feat/multi-client-wiring` (forked from `main` `07f4cdbd`) |
| Worktree | `~/Documents/Repos/Bballi_Portfolio-multi-client` (deps installed, `.env.local` copied → **prod Firebase**, treat localhost as view-only) |
| Main checkout | `~/Documents/Repos/Bballi_Portfolio` — the owner tests and edits there in parallel. **Never build or edit it.** A dev server may be listening on `:3000`. |
| Build | `npx next build --webpack` in the worktree only |
| Tests | `npm test` → log to a file, read the `ℹ` summary (never `| tail`). Baseline 5531 tests, 2 pre-existing failures in `studio-render` vendor-sync (`vendor/api-lib/firebase-admin.cjs` byte-identical + `vendorApiLib` isolation). Any other failure is yours. |
| Rebase | `git rebase main` at the start of every phase; the owner lands changes on `main` meanwhile. |
| Ship | One PR per phase → squash to `main` → Vercel auto-deploys. Verify with `vercel ls --yes` from the main checkout dir and `vercel inspect <url>` (no `--yes`). Record deploy id + rollback id in the PR and in the SSOT. |
| Public repo | `Bai-ee/port_2026` is PUBLIC. Never commit `docs/company-brain/clients/*/live-export-*`, Firestore dumps, keys, or the owner's bank details. `CLAUDE.md`, `.claude/`, `.mcp.json` stay untracked. |

## 2. Hard constraints (verbatim intent, non-negotiable)

1. **X API spend.** No X write and no metered X read without the free dry-run and the owner's explicit confirmation for that specific batch (X SSOT §0, `docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`). Sync, adopt, write-back, re-sync, proposals, migrations, backfills: zero paid calls.
2. **Prod data writes.** Any script that writes Firestore ships with `--dry-run` default ON, prints counts, and runs for real only after the owner says go in chat. Keep a pre-write export in the scratchpad, never in the repo.
3. **Spend gates stay per client per batch.** The owner's own click (Schedule / Post Now / Repost Now / Refresh confirm row) is the confirm. Agents and MCP only propose.
4. **Brain wins.** Do not revert the adoption rule (settings adopt only into empty Brain sections).
5. **Worker routes run unauthenticated locally** (`CRON_SECRET` unset in dev). Never curl `/api/worker/*` or `?action=process-due` as a compile check.
6. **Fail closed.** Every new per-client gate denies when the client's inputs are missing; no implicit fallback to the home client or to `@bai_ee`.
7. **Stop after each phase** for owner approval. Do not start the next phase, do not "clean up adjacent things".

## 3. Roles and dispatch

Orchestrator (you): rebase, brief sub-agents, review, run tests/build, open PR, write the phase report, stop.

Per phase, dispatch in this order:
1. **Explore** (read-only, `subagent_type: Explore`, breadth "very thorough") — confirm every file:line in the phase table still holds after rebase; return a diff of what moved. Cheap insurance against the owner's parallel edits.
2. **Implementer** (Sonnet is fine for Phases 1–3a, Opus for 4) — one agent per bounded work item in the table, briefed with: the item's rows, the constraints in §2, the acceptance checks, and "do not touch anything outside the listed files". Run independent items in parallel.
3. **Reviewer** (fresh agent, give it the diff, not your conclusions) — review against §2 and the phase acceptance list. Format: Verdict / Findings / Risks / Next step.
4. You: full `npm test`, `next build --webpack`, fix, PR.

Sub-agent briefs must include the file list and the acceptance checks verbatim; they have no other context.

## 4. Phases

### Phase 1 — Config only (no code, no deploy)
Owner-driven. You only verify.
- Owner sets Vercel prod env `PILOT_CLIENT_IDS` = target list (assumed home + `nottherug-ten-QSMYxuuv` + `undergroundexistence-0CsKkpaq`; confirm with owner).
- Owner runs the per-client checklist (§6) for each target.
- **Accept:** `social-posting` approve/schedule/reject for NTR/UE no longer returns `pilot-wrong-client`; `isPilotClient` test row in `features/social-posting/__tests__/pilot-concurrency.test.js:896` still passes. Daily loop, MCP, quote targets are still home-only (expected until Phase 2).

### Phase 2 — Remove owner hardcodes (M)
**Status: BUILT on `feat/multi-client-wiring` (2026-10-14), PR open, NOT merged/deployed.** Deploy id / rollback id: _pending owner merge_. Before merge the owner must make home ready (`node scripts/client-readiness/content-loop.mjs --client bryan-balli-WUoltG84 --enable-loop --write`, or approve its Brain + connect X) and confirm home has an own X handle on record (saved xGrowth `ownHandle` or Brain `X Handle`), else home Today/daily-run 403s and the digest X queue skips. Residual literals (deliberate, later phases): `features/x-strategy/{route-handlers.js DEFAULT_PROFILE, loop-corpora.js}` + COMMITTED_CORPORA (4.4), inventory/ingest script `--client` defaults (3a.4), MCP `DEFAULT_CLIENT_ID` (owner convenience, 2.4), descriptive text in `features/mcp/{guide,tools/data}.js`, analysis CLIs `scripts/x-content/{session-brief,day-view,research/*}`.
| Item | Files | Change |
|---|---|---|
| 2.1 `assertClientReady` | new `features/client-readiness/index.js` (+ `.cjs` shim if a CJS caller needs it) | `assertClientReady(clientId)` → requires approved Brain (`clients/{id}/client_brain/current.status==='approved'`), plan doc `x_strategy_plans/{id}`, connected X (`social_accounts/{id}.platforms.x.username`), or explicit `clients/{id}.contentLoop.enabled===true`. Throws 403 with a code naming the missing input. |
| 2.2 Daily loop | `features/x-content-inventory/daily-loop/config.js:13-24`, `run.js:99`, `index.js`, `scheduled.js:24-28` | Replace `OWNER_CLIENT_IDS`/`assertOwnerClient` with 2.1. `scheduled.js` keeps the `PILOT_CLIENT_IDS` loop and fail-closed 503. |
| 2.3 Quote targets route | `app/api/dashboard/quote-targets/route.js:770` | Same swap. |
| 2.4 MCP | `features/mcp/tools/common.js:5,10`, `server.js:70`, `readers.js:133`, `tools/strategy.js:21`, `paid-syncs.js:101` | `clientId` required on every tool (keep `DEFAULT_CLIENT_ID` only as the home owner's convenience default when the OAuth email is the admin's); `strategy_review` honors `args.clientId`; `uid:null` → the resolved admin uid. |
| 2.5 Handle fallbacks | `daily-loop/run.js:52`, `daily-loop/inputs.js:80`, `daily-loop/plan-day.js:97`, `app/api/admin/daily-digest/route.js:86,846-890` | `ownHandle` from `social_accounts/{id}.platforms.x.username`, else Brain X profile handle, else throw. Delete the `'bai_ee'` literals. Digest X queue uses the client's handle, drop `DIGEST_X_HANDLE` default. |
| 2.6 Scripts | `scripts/x-content/daily-run.mjs:152+`, `scripts/pilot/*.mjs` | `--client` required; no owner default. |
| 2.7 Tests | every `__tests__` importing `OWNER_CLIENT_IDS` (daily-loop suites, `quote-targets/__tests__/pilot-degraded.test.js`) | Switch to a fixture client that satisfies 2.1 through the fake Firestore (`api/_lib/__tests__/fake-firestore.cjs`). Add: a client missing each input is denied with the named code; home still passes. |

**Accept:** `rg "bryan-balli-WUoltG84|'bai_ee'" --glob '!docs/**' --glob '!__tests__/**' --glob '!scripts/client-brain/**'` returns only `pilot-access.cjs:11` (`isPilotClient` fallback, keep), `features/discogs-ingest/service.js:19`, `app/api/public/hitloop-creative-brief/route.js:27`, and fixtures. Full suite green minus the 2 baseline failures. Build passes.

**Does not** make other clients useful yet: their inventory is still empty and global (3a).

### Phase 3a — Scope the content inventory (M, prod data write)
**Status: code BUILT on branch `feat/multi-client-3a-inventory` (stacked on PR #9), NOT pushed/merged/deployed (2026-10-14).** **Prod data steps DONE 2026-10-14:** export at `~/Documents/backups/x_content_packages-pre-backfill-2026-10-14.json`; indexes deployed, `clientId+engine+status+lastPostedAt` READY; backfill `--write` stamped 6,276 rows, 0 left. Owner still owes: `NAS_INVENTORY_CLIENT_ID` env, home readiness override, merge PR #9 + 3a PR, then the post-deploy backfill re-run. Dry run: 6,276 rows, 0 with clientId. New env `NAS_INVENTORY_CLIENT_ID` (NAS/archive owner; fail closed when unset). See `CONTENT-PILOT-OPERATIONS.md` §1c.
| Item | Files | Change |
|---|---|---|
| 3a.1 Schema | `features/x-content-inventory/store.js:5-19,151` | `clientId` field on `x_content_packages`; `readInventory({ clientId })` required (throw without it); query `where('clientId','==',id)`. |
| 3a.2 Index | `firestore.indexes.json` | `clientId` + existing order fields. Deploy index before the code (owner runs `firebase deploy --only firestore:indexes` or you with go). |
| 3a.3 Readers | `app/api/dashboard/quote-targets/route.js:367,417,865`, `features/mcp/readers.js:161`, daily loop inputs, `features/x-content-inventory/nas.js`, `features/telegram/intake.js`, `intake-storage.js`, `features/records-page/records-data.js` | Pass the resolved clientId. |
| 3a.4 Writers | NAS stage path, Telegram intake, social-archive ingest (`scripts/social-archive/ingest.mjs:35`), `scripts/x-content/sync-rendered-videos.mjs:31`, discogs backfills | Stamp `clientId`; CLI `--client` required, no default. |
| 3a.5 Backfill | new `scripts/x-content/backfill-package-client.mjs` | Dry-run default: counts rows without `clientId`, prints sample ids. `--write --client bryan-balli-WUoltG84` after owner go. Batched writes (≤400/batch), idempotent. |
| 3a.6 Tests | `features/x-content-inventory/__tests__/store.test.js` + readers | Two clients' packages never bleed; `readInventory()` without clientId throws. |

**Order inside the phase:** index → backfill (owner go) → code PR. Code that requires `clientId` must not ship before the backfill or the home client's Today/Queue goes empty.

**Accept:** home Today/Queue identical before/after (compare `get_daily_brief` output or the Today card for the same day); NTR/UE show empty inventory, not an error; backfill report attached to the PR (counts only).

### Phase 4 — Per-client X identity and priors (M)
**Status: BUILT on `feat/multi-client-3a-inventory` (2026-10-14), stacked, NOT pushed/merged/deployed.** Full suite 5574 / 5572 pass / 2 baseline fails; build passes; replay-guard FALSE POSITIVES 0. Home X Monitor deliberately stays on the global @bai_ee connection while it exists (home's per-client X doc is @UGExistence for publishing tests). Owner still owes before merge: home priors seed (`node scripts/x-content/seed-home-priors.mjs --client bryan-balli-WUoltG84 --write`; dry run fills timezone + 39-account watchlist, keeps ownHandle/benchmarks), then reinstall the scan schedule (`install-scan-schedule.sh install --pilot` or the home id). Follow-ups: DashboardPage X Monitor tile ignores `?as=`. (DEFAULT_TRACKS / DEFAULT_PLAN.benchmarkPrimary / strategy-doc-seed priors: done in 4.7.) See `CONTENT-PILOT-OPERATIONS.md` §1d.
| Item | Files | Change |
|---|---|---|
| 4.1 X Monitor | `features/x-monitor/sync.js:83,97,147,250`, `store.js:3-27`, `app/api/dashboard/x-monitor/route.js:23,39-51,127`, `components/dashboard/XMonitorCard.jsx` | `sync(clientId)` → `getPlatformClient(clientId,'x')`; store rows carry `clientId`; card reads by the active client's account id. Every POST still metered and still behind the confirm row naming the call count. |
| 4.2 Token fallback | `features/social-posting/x-oauth.js:286` | Global `system_flags/x_oauth_tokens` fallback only when `clientId === resolveDigestClientId()`; everyone else 409 `account-not-connected`. |
| 4.3 Audience | `features/x-strategy/route-handlers.js:975-977` | Match `x_monitor` rows by the client's account id, not username. |
| 4.4 Priors | `features/x-strategy/route-handlers.js:90` (`DEFAULT_PROFILE`), `features/x-quote-targets/watchlist.js:23,64`, `app/api/dashboard/quote-targets/route.js:336` (`COMMITTED_CORPORA`) | Source from the client's plan doc / Brain (tracks + benchmarks already exist there). Home keeps today's values as its stored config (one-time seed, dry-run first). No client inherits Bryan's watchlist. |
| 4.5 Scan | `scripts/x-content/scan-quote-targets.mjs:40,194-221`, `install-scan-schedule.sh:25` | Loop `--client` over `PILOT_CLIENT_IDS` under the one launchd label; per-client write target. `bird` reads public timelines with the owner's cookies, so no new auth. |
| 4.6 Score weights | `features/x-growth/score-draft.js`, `features/x-content-guard/rules.js` | No code. Add a note in the X growth SSOT that weights were measured on `@bai_ee`. |
| 4.7 No inherited priors | `features/x-strategy/{contracts,content-tracks,strategy-doc-seed,plan-state,evaluate}.js`, `scripts/x-content/seed-home-priors.mjs`, `ContentTracksPanel.jsx`, `StrategyDocPanel.jsx` | **BUILT 2026-10-14** (stacked, not pushed). `benchmarkPrimary ''`, `DEFAULT_TRACKS []`, blank strategy seed; home's former values moved verbatim to the seed script (fills plan tracks/benchmark + strategy doc only when absent; dry run: home already has all). Gap: Brain track rows can't create tracks for a trackless client (no engines). |

**Accept:** X Monitor sync for UE (after the owner connects UE's X and confirms the call count) writes rows with `clientId: undergroundexistence-…` and the home card is unchanged. `scoreXPost` untouched (replay harness `scripts/x-content/research/replay-guard.mjs` still passes).

### Phase 2b — Onboarding feeds the Client Brain (M, GO 2026-10-14, run after Phase 4)
**Status: BUILT on `feat/multi-client-3a-inventory` (2026-10-14), stacked after Phase 4, NOT pushed/merged/deployed.** Full suite 5590 / 5585 pass / 5 fail = 2 baseline vendor-sync + 2 pre-existing `chat-queue.test.js` date-bomb (`FUTURE='2026-10-14T15:00Z'` passed) + 1 flaky `proof-render-worker` timing test (29/29 when re-run alone); build passes. Spec corrections applied: survey has no X/IG/goal keys (stored as `answers.xHandle/instagramHandle/goal`, source `signup`); deterministic Brain saves `generated` → marked `draft`; brand overview is deterministic at signup to hold ≤2 Anthropic calls. Live acceptance (localhost signup → delete) is the owner's. See `CONTENT-PILOT-OPERATIONS.md` §1e.

**Problem.** Signup (`/login` → `AuthPage.jsx` → `POST /api/clients/provision` → worker `run-brief`) collects only website URL / idea text + email, forces two modules (`run-brief/route.js:287-294`), and skips `synthesizeBrandOverview`, `ensureScoutConfig`, `mergeMarketingBriefConfig` on `trigger === 'signup'` (`:371`). The Brain reads 9 auto sources (`store.cjs:381-532`); signup fills 4 (`client-record`, `website-source-input`, `site-meta`, `creative-brief-summary`). Brain is never generated. Survey that captures competitors/keywords/influencers is hidden (`HIDE_INTAKE_CHAT`, `lib/dashboard/tier-access-config.js:105`). `snapshot.searchSeeds` is written, never read. A fresh signup can never pass `assertClientReady`.

**Design rule (must hold).** Signup never writes the Brain Markdown. It writes **sources and settings** (`dashboard_state.brandOverview`, `client_configs.scoutConfig`, `marketingBriefConfig`, `onboardingAnswers`) and then generates a Brain **draft** from them. When the owner later uploads/injects Brain Markdown and approves, the existing adoption rule applies unchanged: **Brain wins**, and settings adopt only into EMPTY Brain sections (`brain-sync.cjs` field map, lines ~129-205: `brandName`, `brandXHandle`, `brandKeywords`, `categoryTerms`, `competitors`, `kols`, `instagramHandles`, `sourcePlatforms`, `searches`, `positioning`, `targetAudience`, `industry`, `businessModel`, `campaign.*`, `xGrowth.ownHandle`, `xGrowth.benchmarkHandles`, …). So signup-derived data survives only where the uploaded Brain is silent. No new merge logic; do not touch `brain-sync.cjs` adoption semantics.

| Item | Files | Change |
|---|---|---|
| 2b.1 Capture | `AuthPage.jsx:36-41,455-510`, `AuthContext.jsx` (`pending-dashboard-signup`), `app/api/clients/provision/route.js`, `api/_lib/client-provisioning.cjs:270-518` | Add optional fields: X handle, Instagram handle, up to 3 competitors (URL or @handle), one-line goal/positioning. Persist to `client_configs.onboardingAnswers` using the existing survey keys (`features/scout-intake/onboarding/questions.config.cjs:124-200`) so `user-context` / `qa-synthesizer` consume them unchanged. Keep URL-only signup working. |
| 2b.2 Signup run | `app/api/worker/run-brief/route.js:287-294,371,678-680` | On `trigger==='signup'` with a real site: also run `synthesizeBrandOverview` + `ensureScoutConfig` + `mergeMarketingBriefConfig`. Market signals, X, ScrapeCreators stay OFF. Fix the stale comment at `:678`. Instrument any new Anthropic call with `logAnthropicCall`. |
| 2b.3 Seeds | `features/scout-intake/seed-extractor.js:105` (`snapshot.searchSeeds`) | Feed into `ensureScoutConfig` as keyword candidates (only when `scoutConfig` is empty). |
| 2b.4 Brain draft | end of signup run (`run-brief`), `features/client-brain/store.cjs:1452` | Call `generateAndSaveClientBrain(clientId, { mode: 'deterministic' })` → status `draft`, never approved by code. Idempotent: skip if a Brain doc already exists. |
| 2b.5 Per-client docs | `api/_lib/client-provisioning.cjs:429-452` | Create `digest_config/{id}` (schedule OFF, `recipientEmail` = signup email, no `homeClientId`) and `clients/{id}.contentLoop.enabled=false`. Nothing else. |
| 2b.6 Upload path | `app/api/dashboard/client-brain/{route,approve}` | Verify (test, not code): upload Markdown over a signup draft → approve → adopted settings only fill empty sections; non-empty uploaded sections override signup-derived values; a second approve is a no-op. Approve stays as-is (owner/admin); do not widen. |
| 2b.7 Tests | new `api/_lib/__tests__/client-provisioning.test.js`, `app/api/worker/__tests__/run-brief-signup.test.js`, `features/client-brain/__tests__/signup-draft-then-upload.test.js` | Provision writes the 2 new docs; signup run populates 7 of 9 sources; draft generated once; Brain-wins merge per 2b.6. Use `fake-firestore.cjs`. |

**Accept:** fresh signup (localhost, test client, then delete) ends with Brain `draft` whose Gaps panel lists only voice/examples; `client_configs.scoutConfig` has competitors/keywords from the form + site; `digest_config` exists OFF; no X/ScrapeCreators call logged; `usage_events` shows ≤2 Anthropic calls for the run. Paywall untouched (separate work; still cosmetic).

### Phase 3b — Per-client content sources (M, after 4)
Non-home clients have no NAS. Verify/build the three writers per client: Telegram intake, Timeline/social-archive ingest of the client's own X/IG, Brain `Content Library`. Decision for owner first: does any other client get a NAS collection (worker repo `~/Documents/Repos/assetManager`, PUBLIC)?

### Phase 5 — Client-role access (L, decision-gated)
Do not start without an explicit owner instruction naming this phase. Scope when it comes: `isAdmin ? [` card spreads in `DashboardPage.jsx` (15 sites, ~9344-9748) → `canSeeStrategy(user, client)`; MCP OAuth user→client map (`features/mcp/auth.js:54-62`); per-client Telegram binding; per-admin scopes on `getEffectiveClientContext` (`api/_lib/client-provisioning.cjs:146-213`); billing decision (client BYO OAuth1 keys vs HitLoop credits).

## 5. Do-not-touch list
- `DashboardPage.jsx` card definitions (until Phase 5), and never while the owner has a local run going.
- `api/_lib/pilot-access.cjs` semantics (`isPilotClient` owner fallback is deliberate).
- `features/social-posting/twitter-service.js` lifecycle (`buildSocialPostRecord`, `processDuePosts`, repost branch) — already multi-client.
- `features/client-brain/*` and `brain-sync.cjs` — already per client; no home assumptions found.
- Cron schedules in `vercel.json`.
- Anything under `docs/source-of-truth/` except the two SSOT updates each phase requires (below).

## 6. Per-client onboarding checklist (owner, no code)
1. Client Brain: inject Markdown, approve.
2. Social Accounts card: connect X (OAuth2) or BYO OAuth1 keys; username visible.
3. Strategy: Builder follows the doc → plan doc, content tracks, per-track targets/benchmarks.
4. Email Digest: `recipientEmail`, Daily toggle, include toggles.
5. `PILOT_CLIENT_IDS` (Phase 1) / `assertClientReady` passes (Phase 2).
6. First paid Refresh through the confirm row; first scheduled post via the owner's click.

## 7. Phase report (what you hand back, compact)
- Files changed · exact behavior changed · what stayed untouched
- Verification: test counts (total/pass/fail, naming the 2 baseline), build result, any dry-run output (counts only)
- Manual test next (which card, which client)
- Risks / not verified
- SSOT updates made: `docs/source-of-truth/CONTENT-PILOT-OPERATIONS.md` (gates), `X-API-AND-PROFILE-OPERATIONS.md` (any new metered call site), plus this doc's phase row marked built with PR + deploy ids.
- Then STOP.

## 8. Live state snapshot (2026-10-14, read-only)
17 client docs. Plans: home only. Brains: NTR approved; home `stale`; UE, paradice, clairecalls, tryvtc, bryan-balli-pLOR5oyc draft; rest none. `social_accounts` docs: home, UE (both without username). `social_posts` by client: home 92, UE 17, spacex 9, NTR 1. `x_content_packages`: 0 of 400 sampled rows carry `clientId`. Digest enabled: home only.
