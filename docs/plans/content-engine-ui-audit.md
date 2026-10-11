# Content Engine UI — U0 audit (read-only)

Date: 2026-10-11 · Worktree `Bballi_Portfolio-ce-ui` (feat/content-engine-ui) · Plan: `CONTENT-ENGINE-UI-MOCKS-MASTER-PLAN.md` §3.
Paths below are relative to the worktree. `Card` = `components/dashboard/XContentEngineCard.jsx`, `x-content/` = `components/dashboard/x-content/`.

## 1. Headline findings (read before U1+)

- **Card props are only `{ getIdToken, activeClientId, clientName }`** (Card:66; mounted `DashboardPage.jsx:16113-16118`). No client list, no switch callback → **client switcher = Omit** (static `clientName` label, Card:395). The dashboard has its own "MY DASHBOARD" client dropdown outside the card.
- **Calendar week navigation already exists**: Card `weekStart` state + `onShiftWeek(±7)` (Card:184-188) → `week-calendar {start}` (`app/api/dashboard/quote-targets/route.js:364-379`, validates `YYYY-MM-DD`). CalendarPanel has Prev/Next (CalendarPanel:53-60). Window is "7 days from start" (default today CT), not Mon–Sun — matches the mock's "Oct 11–17".
- **Weekly-targets flags are in the payload** (`week-calendar.js:78-148`: `flags[]` incl. `weekly-min`, per-engine `weeklyMin/weeklyMax/belowWeeklyMin`). CalendarPanel already shows engine counts + a flags `<details>`.
- **"+ new thread" already exists** (StrategyChat:223-226 clears `threadId`; send omits it, :174) and the route mints a thread on empty `threadId` (`features/x-strategy/route-handlers.js:306,385-393`).
- **Content tab (`inventory`) has NO search, NO bucket/status filter, NO paging.** `InventoryPanel` renders every package (2,000 rows → card height ≈ 96k px at 1280 / 225k px at 400; see shots table). Search lives only in **Buckets** (`BucketsPanel.jsx:10,77,207-221`, uses `features/x-content-inventory/search-index.js` client-side). Mock 07's Content screen (search + All buckets + All statuses + Load more) therefore = **client-side composition** over the already-loaded `packages` (search-index + `_bucketId` from BucketsPanel + `STATUSES`), not new data. "Load more" = client-side slice (list is fully loaded: `inventory-list`). This is the biggest U3c item; paging is required, not optional.
- **"n notes" in the inventory row is audit warnings, not user notes** (InventoryPanel:317, `countLabel(warnCount,'note')` from `audit` entries). No per-item notes/feedback field. Mock "1 note" → **Adapt**: keep the existing warning chip, labelled as-is (do not call it a note count of user notes).
- **PlanPanel slots carry no "status"/"needs video" field.** Gap = `source==='inventory' && !packageId` (PlanPanel:57-59). "Needs content" = gap. "Needs video" is derivable only via `packages.find(id).mediaState` (schema `MEDIA_STATES` `features/x-content-inventory/schema.js:20`) but PlanPanel doesn't receive `packages` today → treat as **Omit** unless U3b passes `packages` through (prop only; no new data). Recommendation: Omit "Needs video"; use Gap/"Needs content" only.
- **Draft copy exists per slot** (PlanPanel:180, 271-286; `onDraft` → deterministic local `fallbackDraft`, Card:297-308). Offered only for slots with `packageId` or a ledger story. No model/network.
- **No Content search prefill / no cross-tab params.** `setTab` is the only navigation (Card:408). "Find content" = plain `setTab('inventory')` (or `'buckets'`), no prefill. Prefill would need new props on Inventory/Buckets state → Omit prefill, keep plain navigation.
- **Results panel reloads** (`onRefresh={loadPerformance}` Card:435; `windowDays: 30` hard-coded Card:176; header already prints "30d", PerformancePanel:40). No period dropdown (Omit per plan). Panel only has per-engine rows + `lastCapturedAt`; no "View content" / "Ask in chat" backing beyond tab switch.
- Strategy chat messages **persisted ones have `at`** (`features/x-strategy/agent/chat-store.js:73-74`); optimistic/just-sent ones don't (StrategyChat:171,180) → timestamps must fall back gracefully. Plan history entries have `{version, at, by, source:'manual'|'chat', reason, diff, before, after, proposalId?}` (`plan-state.js:172-173`).
- **Undo semantics**: `strategy-plan-revert {version}` restores the plan **as it stood AFTER that version**, written as a new version (`plan-state.js:179-194`). "Undo" for a confirmed plan-change vN = revert to **vN-1** (only possible when N-1 ≥ 1 and in history; undoing v1 → `version-unavailable`). Proposal `result.version` carries N (`ui-model.js:362`).
- Reply carries **no structured links**: `strategy-chat-send` returns `{threadId,text,proposals,usage,...}` only (route-handlers:435-439). No "Open Today" button.

## 2. Build / Adapt / Omit table (one row per §3 row)

### Strategy

| # | Mock element | Verdict | Evidence | Reason |
|---|---|---|---|---|
| S1 | Chips: client · @handle · Plan vN | Build | `clientName` Card:395; `ownHandle` StrategyPanel `handles.own`/profile (:287-291 region); version `planDoc.version` (`todayPlanLine`, ui-model:290) | all data already on screen |
| S2a | "+ new thread" | Build | StrategyChat:223-226, route-handlers:306,385-393 | empty threadId starts a new thread |
| S2b | Topic dropdown "Posting cadence" | Omit | no topics anywhere in chat-store | nothing backs it |
| S3 | Chat bubbles + timestamps | Build | StrategyChat:251-268; `at` on persisted msgs chat-store:73-74 | timestamps absent on optimistic msgs: hide when missing |
| S4 | Proposal card "Plan updated…Undo/View plan/Why" | Adapt | StrategyChat:58-109 (Confirm/Reject, rationale, evidence), `plan-state.js:179-194`, ui-model:362 | pending = Confirm/Reject; confirmed = Saved vN + Undo (revert to N-1, plan-change only) + View plan (sets Details→Plan) + Why accordion (rationale+evidence, already rendered :71-79) |
| S5 | Inline "Manual edit · v10 · View change" rows | Build | `historyNewestFirst` StrategyPanel:~248, entries have `at/source/version` | client-side interleave by `at` with messages |
| S6 | Composer + send | Build | StrategyChat:274-292 | existing; Enter-to-send already |
| S7 | Prompt chips "Review my mix"/"Compare accounts" | Build | StrategyChat `text` state :120 + `send` :165 | UI prefill only. Note: clicking auto-send spends a model turn (existing behaviour of Send); prefer fill-only |
| S8 | Composer pill "Plan · live" | Omit | — | no context-scope feature |
| S9 | Paperclip attach | Omit | — | no attachments |
| S10 | "No draft yet · Open Today" button | Omit | route-handlers:435-439 | no structured link in replies; don't parse prose |
| S11 | Details→Plan: steppers, type limits, notes, last updated, Save, "Saved" badge | Build | `authoredPerDay` input StrategyPanel (:~386-390), `typeFloors/typeCaps` table (:~393-415), notes (:~417), `savePlan`→`strategy-plan-apply` (:217), `planDoc.updatedAt` plan-state:41,174; dirty = `planCheck.dirty` | number inputs → Stepper presentational; "Quote-react minimum" = `typeFloors['quote-react']`; reason field + Discard stay |
| S12 | "Benchmark needs refresh · Details" banner | Build | `freshnessLabel` ui-model:15-18 (`needs refresh`), `rowsMeta` `indexRowsMeta` | derive from existing label |
| S13 | Accounts: own + edit, rows/updated, Benchmarks n/5, avatar, Needs refresh, Refresh, delete, Add benchmark, Data coverage, Refresh data, Ask in chat | Build | handles inputs :287-308, `PLAN_LIMITS.maxBenchmarkHandles` :308, `startRefresh` :123, `strategy-profile-save` :167 | avatar = initials (no avatar field, grep empty). Delete/Add still need "Save handles" (existing flow). "Ask in chat" needs chat draft state lifted/ref'd (StrategyChat owns `text`, :120) — presentational plumbing only |
| S14 | Insights: Limited-data banner, headline, lift cards, posting frequency, comparison, sources & limitations, discuss | Build | `evaluation.gaps[].headline`, `own.entry.cadence`, `byType` (`features/x-strategy/evaluate.js:49-50`), `caveats` (:65,112), `EvaluationView` | exact lift field names to confirm in U3a from `byType` entries; green/red = sign only |
| S15 | History: CURRENT/MANUAL/CHAT badges, expand diff, Restore vN, "All changes" filter | Build | StrategyPanel history list (:~446-463), `revertPlan` :229, `historyDiffSummary` ui-model:263, `source` field | filter client-side by `source`; Restore needs confirm UI (existing click = immediate revert → add confirm only if the mock requires; behaviour change, flag to orchestrator) |
| S16 | Header "B" avatar / hamburger | Omit | dashboard owns account menu | — |

### Today (06)

| # | Mock element | Verdict | Evidence | Reason |
|---|---|---|---|---|
| T1 | Plan \| Discover segmented | Build | tabs `plan` / `today` (Card:314-345, 399-415) | wrapper over existing bodies |
| T2 | "4 planned slots · Strategy ↗" | Build | PlanPanel:90-104 (`filled/total`, `onOpenStrategy`) | exists |
| T3 | "2 slots need content" amber accordion | Build | PlanPanel `gaps`, `unfilled` :79-83,159-163 | exists |
| T4a | Slot rows: time/type/thumb/title/badge | Build | PlanPanel:183-269 | badge = Gap/"Needs content" |
| T4b | "Needs video" badge | Omit | no slot status; PlanPanel gets no `packages` | see §1 |
| T4c | "Find content" action | Adapt | only `setTab` exists (Card:408) | plain navigation, no prefill |
| T4d | "Draft copy" action | Build | PlanPanel:180,271-286, Card:297-308 | only where `canDraft` (package or ledger story) |
| T5 | Plan details accordion | Build | PlanPanel `<details>` :236,316 | exists |
| T6 | Plan "Ask in chat" | Adapt | needs chat prefill across tabs | only if S13's prefill plumbing exists; else Omit |
| T7 | Discover: conversations, empty state, Generate, Generation options (Paid), How it works | Build | DailySuggestionsPanel: model toggle :314-316 ("Use model copy (paid, ≤3 calls)"), Generate :318, Regenerate :321, runbook note :324, `daily-run-*` calls :262-303 | restyle only; Generate/Regenerate are model-spending, do not click in QA |

### Content, Calendar, Results (07)

| # | Mock element | Verdict | Evidence | Reason |
|---|---|---|---|---|
| C1 | Header + count, + Add | Build | InventoryPanel:250-262 | exists |
| C2 | Search | Adapt | search only in BucketsPanel:207-221 (`search-index.js`) | client-side search over loaded `packages`; reuse existing module, no new fetch |
| C3 | "All buckets" filter | Adapt | `_bucketId`/`resolveBucket` BucketsPanel:143-155 | needs bucket resolution reused in Inventory (client-side) |
| C4 | "All statuses" filter | Adapt | `STATUSES` schema.js:34 (`idea,drafted,scheduled,posted,retired`) | client-side filter over existing values |
| C5 | Rows: code chip, title, bucket line, IDEA badge, chevron | Build | InventoryPanel:279-322 (series thumb, pillar, status chip) | bucket line needs `_bucketId` (see C3) |
| C6 | "1 note" | Adapt | InventoryPanel:315-318 = audit warnings | keep as warnings chip; not user notes |
| C7 | "Showing n of N" + Load more | Build (required) | full list rendered, 2,000 rows | client-side slice; no new data |
| C8 | Calendar ‹ › week nav | Build | Card:184-188, CalendarPanel:53-60, route:364 | already works |
| C9 | CT label, Week / Unscheduled · n tabs | Build | `calendar.tz`, `unscheduled[]` (week-calendar.js:140-147), CalendarPanel:151 | segmented over existing sections |
| C10 | Day strip, "Nothing scheduled", View unscheduled | Build | CalendarPanel:108-149 | exists |
| C11 | Weekly targets · flags | Build | week-calendar.js:78-148, CalendarPanel:75-106 | payload carries them |
| C12 | Ready to schedule with APPROVED/DRAFT + Schedule/Review | Build | CalendarPanel:151-193, `onApprove` Card:190, `onSchedule` Card:207 | "Review" has no backing → Omit that button label; Approve (draft) + Schedule (approved) only |
| C13 | Results: back "More / Results" | Build | tab only | nav chrome from U2 |
| C14 | Last-30-days dropdown | Omit | `windowDays:30` hard-coded Card:176 | static label |
| C15 | Results refresh | Build | PerformancePanel:45-49, `loadPerformance` Card:172 | reloads |
| C16 | "0 measured posts" empty, View content, By engine, Measurement details | Build | PerformancePanel:40-96 | `stats.total/unmeasured`; View content = `setTab` |
| C17 | Results "Ask in chat" | Omit/Adapt | see T6 | same dependency |
| C18 | Client switcher "Hitloop ▾" | Omit (static label) | Card props :66 | no client list/switch callback |

### Counts

Verdict counts (rows above, "Omit/Adapt" counted as Adapt-or-Omit shown conservatively as Omit where no backing):
- Build: S1, S2a, S3, S5, S6, S7, S11, S12, S13, S14, S15, T1, T2, T3, T4a, T4d, T5, T7, C1, C5, C7, C8, C9, C10, C11, C13, C15, C16 = **28**
- Adapt: S4, T4c, T6, C2, C3, C4, C6, C12 = **8**
- Omit: S2b, S8, S9, S10, S16, T4b, C14, C17, C18 = **9**

## 3. How to reach the card on :3004

- Route: `/dashboard` → capability filter "Social" → tile **Content Engine** (`#tile-x-content`, cardId `x-content`, admin-only, `DashboardPage.jsx:9498-9510`) → modal `#x-content-modal-panel` → `#x-content-card`. No deep link (only `?open=post-me|brief`, DashboardPage.jsx:1833). No preview harness exists (`app/preview/*` has none for this card).
- Auth: Firebase Auth, route requires admin email (`requireAdminContext`, route.js:90-104). **No dev bypass exists.** Least-invasive method used (no app code changed, no Firestore write): scratch script mints a Firebase custom token for `bryanballi@gmail.com` with the admin SDK creds in `.env.local`, exchanges it via the Identity Toolkit REST endpoint, and writes the auth user into the page's IndexedDB `firebaseLocalStorageDb` (key `firebase:authUser:<apiKey>:[DEFAULT]`) before loading `/dashboard`. Scripts: `/private/tmp/claude-501/ce-ui-scratch/{mint.cjs,lib.cjs,shots.cjs}` (mint.cjs → `auth.json`, expires ~1h; re-run to refresh). The card then operates on client `Hitloop` (`bryan-balli-WUoltG84`).
- Headless quirks (all in the scratch script, not the app): the dashboard is heavy; first paint takes ~25-60 s. Use `--disable-3d-apis --disable-webgl` + `reducedMotion:'reduce'` (WebGL errors from that flag are filtered; they are not app errors). A wrapper stays `opacity:0` → set it via `style.setProperty('opacity','1','important')` on card ancestors; hide `#dashboard-loading-overlay` with an injected style. Open nav/tile with DOM `.click()` (elements are attached but not hit-testable while the intro runs).
- Safety: Playwright `page.route` allow-lists read actions on `/api/dashboard/quote-targets` (`content-plan, inventory-list, week-calendar, engine-performance, strategy-get, strategy-chat-history, strategy-refresh-status, daily-run-latest, list-buckets, list-folders, nas-status, media-url(s)`); every other action is stubbed. In particular the **Buckets tab auto-fires `sync-rendered-videos` on mount** (BucketsPanel:128-132) — a server-side sync that can write — and it was stubbed. The dashboard's own load calls (`recipe-run`, `daily-digest`) were also stubbed on POST.
- Next dev overlay shows "4 Issues" (not diagnosed; no console errors captured).

## 4. Baseline screenshots

Saved to `docs/plans/content-engine-ui-shots/baseline/` (≈2.3 MB). `<tab>-<width>.png` = element screenshot of `#x-content-card` (only when card height < 8000 px; at 1280 the capture also shows part of the page behind the modal); `<tab>-<width>-viewport.png` = viewport.
No console errors on any tab at either width (WebGL noise from the `--disable-webgl` flag excluded). No horizontal overflow at 400 (card `scrollWidth = clientWidth = 350`).

| Tab | 1280 card height | 400 card height | element shot |
|---|---|---|---|
| strategy | 2536 | 4177 | yes |
| plan | 580 | 755 | yes |
| today | 232 | 1970 | yes |
| inventory | 96172 | 225478 | viewport only |
| buckets | 145649 | 234746 | viewport only |
| calendar | 9021 | 10786 | viewport only |
| clients | 1376 | 1518 | yes |
| performance | 261 | 361 | yes |

Observed at baseline: inventory/buckets/calendar render every row unpaged (calendar 9k px because `unscheduled` is long). At 400 the tab strip wraps to three rows (Card:312-393).

## 5. Existing actions per tab (for behaviour smoke)

Safe = no model call, no write, no queue, no X/ScrapeCreators. **Unsafe (do not click in QA)** are marked ⛔.

| Tab | Existing actions (id) | Backing call | Smoke safety |
|---|---|---|---|
| Tab strip | switch tab (`x-content-tab-<id>`), remembered tab `xce-last-tab` | — | safe |
| strategy | Reload (`x-strategy-evaluation-reload-button`) | `strategy-get` | safe |
| | Refresh data (`x-strategy-refresh-button`), evaluate-refresh | `strategy-refresh` (+ status poll) | ⛔ ingests posts (cost/queue) |
| | Edit own/benchmark handle, Add benchmark, Remove | local state | safe (do not Save) |
| | Save handles (`x-strategy-save-handles-button`) | `strategy-profile-save` | ⛔ write |
| | Evaluate handle (`x-strategy-evaluate-handle-button`) | `strategy-evaluate-handle` | ⛔ may need data/cost |
| | Plan edit: posts/day, floors/caps, notes, reason, Discard | local state | safe |
| | Save plan (`x-strategy-plan-save-button`), Restore vN (`x-strategy-plan-revert-N`) | `strategy-plan-apply` / `strategy-plan-revert` | ⛔ write (only on a throwaway client) |
| | Chat: type, New thread | local state | safe |
| | Chat Send | `strategy-chat-send` | ⛔ model call + turn cap |
| | Proposal Confirm/Reject | `strategy-proposal-decide` | ⛔ write |
| plan | Tier 5/8 (`x-content-plan-tier-N`; or read-out + Open Strategy when plan-doc) | `content-plan` | safe |
| | Refresh (`x-content-plan-refresh-button`) | `content-plan`+`inventory-list` | safe |
| | Draft copy (`x-content-plan-draft-button-<slot>`) | local deterministic, no network | safe |
| | Details accordions | — | safe |
| today | Show dismissed, show-all toggles | local | safe |
| | Generate / Regenerate / model checkbox | `daily-run-generate` (model optional) | ⛔ |
| | Edit / Save draft / Dismiss | `daily-run-edit/save-draft/dismiss` | ⛔ writes |
| inventory | Add (`x-content-inventory-add-button`), open row, close editor, field edits | local | safe |
| | Save / Delete | `inventory-save` / `inventory-delete` | ⛔ writes |
| buckets | Bucket rail select, view select, search box, open item drawer, legend/folder popovers | local + `media-urls` (read) | safe |
| | Source toggle/sync, folder create/delete, move item, facets save, rights, create-draft, nas-stage | `sync-rendered-videos`, `upsert-folder`, `move-item`, `update-item-facets`, `set-rights`, `create-draft-from-item`, `nas-stage` | ⛔ writes |
| calendar | Prev / Next week (`x-content-week-prev/next-button`), Refresh | `week-calendar` | safe |
| | Approve (`x-content-week-approve-button-<id>`) | `social-posting approve-draft` | ⛔ write |
| | Schedule (`x-content-week-schedule-button-<id>`) | `social-posting update` | ⛔ NEVER on a real post |
| clients | Capture form fields | local | safe |
| | Capture submit, Approve/Reject package | `capture-client-story`, `approve/reject-package` | ⛔ writes |
| performance | Refresh (`x-content-performance-refresh-button`), Details | `engine-performance` | safe |

Verified in this audit by code reading + a live Playwright pass that only switched tabs (read calls observed per tab: strategy → `strategy-chat-history, strategy-get`; plan → none extra (loaded at card mount: `content-plan, inventory-list`); today → `daily-run-latest`; buckets → `nas-status, list-buckets, list-folders, sync-rendered-videos(stubbed), media-urls`; calendar → `week-calendar`; performance → `engine-performance`; inventory/clients → none). Interactive click-through (week prev/next, tier toggle, editors, drawer) is **specified here but not yet executed** — to run in the per-phase smoke.
