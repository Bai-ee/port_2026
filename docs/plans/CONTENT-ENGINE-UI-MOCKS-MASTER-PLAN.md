# Content Engine UI — Match the Mocks (master plan)

Date: 2026-10-11 · Status: **PLAN** · Presentation-only workstream.
Mocks: `~/Downloads/Content-Engine-UI-Mocks/01…07-*.png` (an identical copy sits untracked in the daily-loop worktree, git-excluded; never commit it).

## 0. Rule that governs everything

**Restyle what exists; build nothing new to satisfy a mock.** If a mock shows a control backed by an existing action or data field, build it to look like the mock. If nothing backs it, leave it out (§3 lists each case). No new route actions, no new Firestore fields, no new server logic. Changes are to JSX layout, styles, client-side composition of data already returned, and navigation between tabs.

## 1. Which mock is canonical

The mocks include early variants, so pick one source per surface:

| Surface | Canonical | Reference only |
|---|---|---|
| Desktop shell + Strategy | **03** (tab row, chat left, Details right) | 01, 02 (A/B variants) |
| Mobile shell + Strategy | **04, 05** (Chat/Details toggle; Plan/Accounts/Insights/History sub-tabs) | 01/02 right-hand phones |
| Mobile Today / Discover | **06** | — |
| Content, Calendar, Results | **07** | — |
| Proposal / applied-change card | **03** card (+ 04 compact form on mobile) | 01 "Applied changes" |

**Design language** (from the mocks): white cards with 1px light-grey borders and 12–16px radii; near-black (#1f1d1b-ish) primary buttons; uppercase monospaced labels with letter-spacing (use the existing `var(--font-mono)`); sans body text; a thin cyan→magenta gradient rule under the header; pill badges (green "Saved · vN", amber "Needs refresh"/"Limited data", blue "CHAT", grey "MANUAL"/"IDEA"); amber warning rows with an icon; steppers (− value +); chevron accordions; lucide icons (already a dependency). Tokens go in one place (§4).

## 2. Information architecture (from existing tabs only)

Existing tabs (`XContentEngineCard.jsx TABS`): `strategy, plan, today, inventory, buckets, calendar, clients, performance`.

- **Desktop (≥ 900px), mock 03:** top tab row `Strategy · Plan · Today · Content · Buckets · Calendar · More▾` (More holds Clients and Results). The labels map to the existing tab ids: inventory→"Content", performance→"Results".
- **Mobile (≤ 480px), mocks 04–07:** a header with the client name, plus a bottom nav `Chat · Today · Content · Calendar · More`.
  - Chat = the strategy tab.
  - Today = a segmented control **Plan | Discover**, mapping to the existing `plan` and `today` tab bodies.
  - More = Buckets, Clients, Results.
  - Inside Strategy: a **Chat | Details** toggle. Details = sub-tabs **Plan · Accounts · Insights · History**, all from the existing StrategyPanel sections.
- **Tablet (481–899px):** desktop tab row, single column, with Details below the chat.
- The remembered-tab logic (`xce-last-tab`) and every existing tab id stay. Only labels and the grouping change.

## 3. Mock element → existing feature (build, adapt, or omit)

**Build** = exists, restyle to match. **Adapt** = exists but the mock implies a different flow; follow the real flow. **Omit** = nothing backs it.

### Strategy (03, 04, 05; 01/02 reference)

| Mock element | Verdict | Backing / note |
|---|---|---|
| Chips: client · @handle · Plan vN | Build | profile ownHandle, plan version, `clientName` prop |
| Topic dropdown "Posting cadence" + "+" new thread | **Verify, then Build or Omit** | StrategyChat keeps one thread id. Build "+ new thread" only if `strategy-chat-send` accepts an empty threadId and starts a new one; omit the topic dropdown (no topics exist). |
| Chat bubbles (user dark right, assistant light left, timestamps) | Build | chat history |
| Proposal card "Plan updated · Daily posts 4→3 · Saved v9 · Undo · View plan · Why this change" | **Adapt** | Real flow is propose → confirm. Pending: same card layout with **Confirm / Reject**. After confirm: "Saved · vN", **Undo** (= `strategy-plan-revert` to the prior version, only for plan-change), **View plan** (opens Details→Plan), "Why this change" accordion (proposal `rationale` + `evidence`). |
| Inline history row "Manual edit · … · v10 · View change" | Build | interleave plan `history` entries into the chat timeline by timestamp (client-side) |
| Composer + send button | Build | existing |
| Prompt chips "Review my mix", "Compare accounts" | Build | prefill and send a message (UI only) |
| Composer context pill "Plan · live" | Omit | no context-scope feature |
| Paperclip attach (01/02) | Omit | no attachments |
| Agent reply "There's no draft yet · Open Today" (04) | Build only if the reply carries a structured link today; else omit the button | don't parse prose to invent buttons |
| Details → Plan: stepper Posts per day, stepper Quote-react minimum, Type limits, Notes, Last updated, Save changes, "Saved" badge | Build | plan fields authoredPerDay, typeFloors['quote-react'], typeCaps, notes, updatedAt; `strategy-plan-apply` |
| "Benchmark needs refresh · Details" banner | Build | rowsMeta freshness / evaluation caveats |
| Accounts: your account + edit, "262 posts · Updated today", Benchmarks n/5, avatar, Needs refresh, Refresh, delete, Add benchmark, Data coverage, Refresh data, Ask in chat | Build | profile handles, rowsMeta, `strategy-refresh`. **Avatar: initials circle** unless an avatar URL is already stored. Add/delete use the existing handle-edit path. "Ask in chat" = switch to Chat with a prefilled draft (UI). |
| Insights: Limited data banner, headline, lift cards (green/red), Posting frequency, View comparison, Sources & limitations, Discuss in chat | Build | evaluation view model: gaps[0].headline, byType lift, cadence, caveats |
| History: versions with CURRENT/MANUAL/CHAT badges, expand diff, Restore vN (confirm), "All changes" filter, Ask in chat | Build | plan history + `strategy-plan-revert`; the filter is client-side by `source` |
| Header "B" avatar, hamburger (01) | Omit | dashboard owns the account menu |

### Today (06)

| Mock element | Verdict | Backing |
|---|---|---|
| Plan \| Discover segmented | Build | existing `plan` + `today` bodies |
| "4 planned slots · Strategy ↗" | Build | content-plan summary; the link switches to the Strategy tab |
| "2 slots need content" amber accordion | Build | plan gaps |
| Slot rows: time, type, thumb/code, title, badge (Needs video / Needs content), action, + Details | Build | plan slots. Actions only where they exist: **Find content** = go to the Content tab with the slot's type/search prefilled (if Content supports a search prefill; else plain navigation). **Draft copy** only if the Plan tab already has a draft action for that slot type; otherwise no button. |
| Plan details accordion, Ask in chat | Build | existing plan detail + Chat prefill |
| Discover: "Conversations to join", empty state, Generate suggestions, Generation options (Paid badge = model copy toggle), How it works | Build | DailySuggestionsPanel (generate, model toggle, runbook text); suggestion cards restyled to the same card language |

### Content, Calendar, Results (07)

| Mock element | Verdict | Backing |
|---|---|---|
| Content header + count, + Add, search, All buckets, All statuses, rows (code chip C6, title, bucket line, IDEA badge, "1 note"), chevron, Showing n of N, Load more | Build, with checks | InventoryPanel/BucketsPanel (search-index, buckets). **"n notes" only if a notes/feedback count exists on the item**; else omit. Status filter only over existing `status` values. Load more = client-side paging if the list is already loaded. |
| Calendar: Oct 11–17 with ‹ ›, CT label, Week / Unscheduled · n tabs, day strip, "Nothing scheduled", View unscheduled, Weekly targets · flags, Ready to schedule with APPROVED/DRAFT + Schedule/Review | Build, with checks | CalendarPanel (`week-calendar`, `onApprove`, `onSchedule`, unscheduled list). **Week navigation only if week-calendar accepts a start date**; else show the current week with no arrows. Weekly-targets flags only if the payload carries them. |
| Results: back "More / Results", Last 30 days dropdown, refresh, "0 measured posts", empty state, View content, By engine, Measurement details, Ask in chat | Build, with checks | PerformancePanel (`engine-performance`, `windowDays`). **No period dropdown**: show the window as a static label. Refresh only if the panel already reloads. |
| Client switcher "Hitloop ▾" | **Verify, then Build or Omit** | Build as a dropdown only if the card already receives a client list + switch callback; else a static client-name label. |

## 4. Where styles live (and the constraint)

- `xce-*` classes are defined inside `components/dashboard/XContentEngineCard.jsx`. Strategy components use inline styles plus `xce-*`.
- **Create** `components/dashboard/x-content/xce-tokens.js` (colours, radii, spacing, type, as plain constants) and `components/dashboard/x-content/ui/` with small presentational primitives: `Card`, `SectionLabel`, `Badge`, `Stepper`, `Accordion`, `SegmentedControl`, `WarnRow`, `IconButton`, `BottomNav`. They are pure presentational components: no data fetching, no new logic.
- Restyle `xce-*` in place where a class is shared, so every tab moves together. Don't fork a second class family.
- Mobile: follow `docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md` (≤480px uses the single `--mobile-gutter`). The bottom nav must not cover content (pad the body by the nav's height; respect `env(safe-area-inset-bottom)`).
- Every edited container gets a stable id (`xce-*` / `x-strategy-*` / `x-today-*` / `x-content-*` kebab-case). Keep existing ids; add, never rename.

## 5. Phases and tracks (parallel Sonnet agents)

**Start condition:** the X Strategy build orchestrator has committed T5 (it is editing `XContentEngineCard.jsx` and `PlanPanel.jsx`). Preferably wait for T6. U0 is read-only and can start now.

Work in a **separate worktree**: `git worktree add ~/Documents/Repos/Bballi_Portfolio-ce-ui -b feat/content-engine-ui feat/daily-content-loop` (from the branch tip at start time). Dev server on **:3004**. Merge back into `feat/daily-content-loop` at the end, after the build orchestrator is done. Never edit the daily-loop worktree.

| Phase | Track | Owns | Task |
|---|---|---|---|
| **U0** audit (1 agent, read-only) | — | `docs/plans/content-engine-ui-audit.md` (new) | Resolve every "Verify" and "with checks" item in §3 by reading the code. Output a final build/omit table with file:line evidence. Screenshot every current tab at 1280 and 400 px as the baseline. |
| **U1** foundation (1 agent) | tokens + primitives | `xce-tokens.js`, `ui/*`, shared `xce-*` style block in `XContentEngineCard.jsx` (styles only) | Tokens, primitives, gradient rule, base card/button/badge restyle. Visual-only diff: no JSX logic changes. |
| **U2** shell (1 agent, after U1) | IA | `XContentEngineCard.jsx` (header, tab row, More menu, bottom nav, mobile Today segmented wrapper) | §2. Tab ids, remembered tab and data loading are unchanged. |
| **U3** parallel, after U2 | U3a Strategy | `StrategyPanel.jsx`, `StrategyChat.jsx` | §3 Strategy: desktop two-pane, mobile Chat/Details, sub-tabs, proposal card states, history interleave, prompt chips. |
| | U3b Today | `PlanPanel.jsx`, `DailySuggestionsPanel.jsx` | §3 Today. |
| | U3c Content | `InventoryPanel.jsx`, `BucketsPanel.jsx`, `BucketRail.jsx`, `BucketToolbar.jsx`, `ItemGrid.jsx`, `FolderRow.jsx`, `ItemDrawer.jsx` | §3 Content (rows, filters, drawer in the same card language). |
| | U3d Calendar + Results + Clients | `CalendarPanel.jsx`, `PerformancePanel.jsx`, `ClientCapturePanel.jsx` | §3 Calendar/Results; Clients restyled to match. |
| **U4** integration + QA (orchestrator + 1 reviewer) | — | fixes only, by the owning track | Cross-tab consistency, mobile pass, a11y basics, final screenshots. |

Not in scope: `NasPanel`, `NasCopyMovePanel`, `SourcePanel`, `Popover`, `Feedback` beyond inheriting the shared restyle. Restyle them only if they visibly break.

## 6. Verification gate (every phase; the orchestrator runs it, not the agent)

1. `npm test` green except the 2 known vendor-api-lib failures. UI changes must not change any test expectation other than DOM-id additions.
2. **No logic drift:** `git diff` per phase reviewed by a fresh reviewer agent against §0. Flag any new fetch/call action, new state that changes data flow, removed handler, or renamed id. Fix before moving on.
3. **Visual check on :3004** with a browser tool (Claude in Chrome, or a scratch Playwright script, not committed). Each touched tab at 1280px and 400px:
   - screenshots side by side with the canonical mock, saved to `docs/plans/content-engine-ui-shots/<phase>/` (commit the PNGs only if under 3MB total for the phase; else keep them in a scratch dir and list them)
   - zero console errors
   - no horizontal scroll at 400px
   - the bottom nav doesn't cover content
4. **Behaviour smoke:** every pre-existing action on the touched tab still works (click through: generate, edit, save draft on a memory-safe path, plan apply/revert, refresh status, approve/schedule only on a dry or already-safe path; never schedule a real post).
5. Commit the phase on `feat/content-engine-ui` (no push).

## 7. Acceptance

- Every **Build** row in the U0 audit is present and matches its mock's layout, hierarchy and styling at 1280 and 400 px. Every **Omit** row is absent (no dead buttons, no "coming soon").
- All existing functions behave exactly as before (the U0 baseline click-through repeated).
- Stable ids on all edited containers; one token file; no duplicated class families.
- Final side-by-side screenshot sheet for each mock.

## 8. Risks

- **Collision with the build orchestrator** on `XContentEngineCard.jsx`/`PlanPanel.jsx`: separate worktree, start after T5, merge after T6. Expect one merge pass; U4 owns it.
- **The styled-jsx scope trap** (see the X Monitor note in CLAUDE.md): styles for JSX returned from helpers/children need global selectors prefixed by the card id.
- **Mocks disagree with each other**: §1 decides; don't blend variants.
- **Scope creep** ("the mock has it, so let's add it"): §0 + U0's omit list + the reviewer gate.
- **Fast Refresh** on :3004 only; never edit while the build's :3003 live checks run (different worktree avoids it).
