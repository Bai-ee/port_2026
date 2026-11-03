# Stand Up Calendar Stage + single Post editor: master prompt (multi-agent, Sonnet)

> Paste everything below the line into an orchestrating session. It runs phases with parallel Sonnet agents,
> each owning separate files, and stops for owner approval after every phase. Written 2026-10-18 against
> `main` @ `c3df1b62` (PR #32 deployed).

---

## 0. Mission

Replace the stacked-modal calendar flow (dashboard → Queue & Calendar card modal → day modal → X preview modal → right-side
PostSheet drawer, each with its own blurred backdrop) with **one immersive Calendar Stage inside Stand Up**:

- Opening the calendar **fades the dashboard UI out completely**. Only the existing three.js gradient background
  (`InternalPageBackground`) remains, with the **Month** view on top of it.
- Clicking a day **fades Month out completely** and fades **Day** in.
- Opening a post **fades Day out completely**, leaving only the **View & Edit Post** editor on the gradient.
- **Close (✕) at any level** returns straight to Stand Up with the dashboard visible. **Back (← / Esc / browser Back)**
  steps up one level: Post → Day → Month → Stand Up.
- It must feel like its own page, with **exactly one visible layer** at a time. No backdrop blur and no modal on top of a modal.

**View & Edit Post is the single source of truth.** The X-style preview *is* the editor: copy, time, creative,
Save / Approve / Approve & schedule. What is shown is exactly what gets saved and approved. The PostSheet drawer's
remaining controls move into a "More" menu inside it, and the drawer is retired.

**Creative comes from media already in the system** (Content Center items / content packages), not file upload.

## 1. Hard rules (every agent)

- Read `CLAUDE.md` (repo) first. Follow the **Frontend DOM naming rule** (stable kebab-case ids on every edited
  container), the **mobile width standard** (`docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md`), and the **theme guard**: no
  new hex/rgba literals in migrated files; use `--t-*` tokens (`npm test` enforces it).
- **No new libraries.** Motion uses CSS transitions (opacity, plus at most a 0.98→1 scale). `prefers-reduced-motion` =
  instant swaps.
- **Reuse existing server calls.** The only new server code allowed is the one action in §4 Agent C.
- **Do not touch** the publish/delivery lifecycle (`features/social-posting/lifecycle.js`, `commitPostTransition`,
  `swapPostMedia`, `deliveryBlock`), agent undo (`features/x-strategy/agent/action-runtime.js`), crons, or `vercel.json`.
- **Work in your own git worktree** (`git worktree add ../Bballi_Portfolio-<agent> -b feat/cal-stage-<agent> origin/main`,
  then symlink `node_modules`). Never run `next build` in the main checkout while `npm run dev` runs there.
- **Edit only the files your section owns.** If you need a change in another agent's file, write it in your report
  instead.
- **No commits to `main`, no deploys, no paid calls, no X writes.** Run `npm test` and `npm run theme:check` before
  reporting.
- **Report back:** files changed, behaviour changed, tests run (pass/fail counts), what is not verified, and open
  questions. Keep it compact.

## 2. Current architecture (verify before building)

| Piece | Where |
|---|---|
| Stand Up tab (`'flow'`) | `DashboardPage.jsx` (~L12730 nav; ~L1675 admin landing; ~L2025 "Open Today" one-shot) |
| "Open Today" entry | `components/dashboard/OnboardingFlowPanel.jsx:42` → opens card `strategy-queue-calendar` with `openToday` |
| Queue & Calendar card | `components/dashboard/marketing/StrategyQueueCalendarCard.jsx` (Calendar · Compose · Quote targets) |
| Month + Day views | `components/dashboard/x-content/MonthCalendarPanel.jsx` (~694 lines; day view opens on top ~L376) |
| X preview | `components/dashboard/x-content/XPostPreview.jsx` |
| Edit drawer (to retire) | `components/dashboard/x-content/PostSheet.jsx` (+ `HiresMediaPanel.jsx`, `CalendarApprovalBits.jsx`, `calendar-bits.jsx`) |
| Row model | `components/dashboard/x-content/calendar-row-model.js` |
| Background scene | `InternalPageBackground` (mounted in `DashboardPage.jsx` ~L10828) |
| Content Center items | `components/dashboard/x-content/{ItemGrid,InventoryPanel,ItemDrawer,MiniThumb}.jsx`; `fetchMediaUrl` in `ItemGrid.jsx` |
| Server (posts) | `app/api/dashboard/quote-targets/route.js`: `calendar-approve` (saves edited `content` at the checked revision, then approves), `calendar-unapprove`, `calendar-suggestion-approve` (takes edited `text`), hi-res actions; `app/api/social-posting/route.js`: `update`, `approve-and-schedule`, `attach-media`, `reject-draft`, `reconcile-post` |
| Media resolution | `features/x-content-inventory/item-actions.js` `pickMediaRef` / `pickMedia` (returns `mediaStoragePath` `ev:<path>` or `publish-staging/…`; publish re-signs `ev:`) |
| Lifecycle | v2 posts: any material edit (copy, self-reply, media, variants, reply target) voids approval and schedule (`lifecycle.js` `contentHash` / `isMaterialEdit`) |

## 3. UX spec

**Levels:** `standup` → `month` → `day` → `post`. One level is visible at a time.

- **Enter:** Stand Up "Open Today" goes straight to `day` (today, in the client's time zone). The Queue & Calendar
  card's Calendar tab becomes an "Open calendar" button that enters at `month`.
- **Transition:** the outgoing level fades to opacity 0 (~180 ms ease-out), then the incoming level fades in (~220 ms),
  with an optional 0.98→1 scale. The dashboard UI (nav, cards, header) fades fully out and becomes `inert` /
  `aria-hidden`; the gradient background stays.
- **Chrome:** a minimal top bar on every level with ← Back (hidden on `month`), a level title (Month name / "Today ·
  Sat Oct 18" / "Edit post"), the client name, and ✕ Close. Nothing else from the dashboard shows.
- **Keys and history:** Esc = Back. Each level pushes a shallow history entry (`?cal=month|day|post&d=YYYY-MM-DD&p=<postId>`)
  so browser Back steps up a level and a reload restores the level. ✕ clears these params.
- **Focus:** moves to the new level's heading on every switch. Focus is trapped within the stage, and focus returns to the
  launching button on Close.
- **Mobile (≤480 px):** each level is full-width with the single `--mobile-gutter`; the top bar stays.
- **View & Edit Post layout:**
  - X-style card: avatar, name and handle, then an editable text area at X size with a live count (red over 280).
  - Below it: the creative (image/video), and a date/time field in the **client's** time zone (Central as fallback).
  - Footer buttons: **Save**, **Approve**, **Approve & schedule**.
  - **More ▾** menu: Reject, Unschedule, Reconcile, Use high-res, Leave unapproved.
  - Status pill (Draft / Approved / Scheduled / Needs review).
  - Message after a media change: "New creative cleared approval — approve again."
  - Revision conflict: keep the edit and offer "Reload".
  - Unsaved edits: leaving (Back / Close / Esc) asks first.
  - Pilot-owner 403: "Only the account owner can approve or schedule."

## 4. Agents and file ownership

### Phase 1: three agents in parallel

**Agent A: Stage shell and motion** (new directory `components/dashboard/calendar-stage/`)
- `CalendarStage.jsx`:
  - full-viewport layer and level state machine (`month|day|post`)
  - transitions, top bar, Esc/Back/history/focus handling
  - takes `renderMonth`, `renderDay` and `renderPost` render-props, so other agents' views slot in
- `calendar-stage-model.js`: pure level/history/URL logic, plus a test in `__tests__/`.
- `CalendarStageStyles.jsx`: `style jsx global`, ids prefixed `#calendar-stage-*`.
- Deliver a demo harness only behind `?calendar-stage-demo=1` (placeholder levels). **Do not** mount it in
  `DashboardPage.jsx`; Agent D does that.

**Agent B: the single Post editor** (new `components/dashboard/x-content/PostEditor.jsx` + `post-editor-model.js` + tests)
- Builds View & Edit Post (§3) on `XPostPreview`'s visual language, editing in place. Stays dumb about where it's
  mounted: props `postId | row`, `clientId`, `getIdToken`, `onClose`, `onSaved(row)`, `onPickCreative()`.
- **Save:** `update` with `expectedRevision`.
- **Approve:** `calendar-approve` with `content` + `expectedRevision`. No time required.
- **Approve & schedule:** `approve-and-schedule`. Requires a future time, at least a minute ahead.
- **Suggestions / requotes:** `calendar-suggestion-approve` with `text`.
- **More menu:** reuses the existing PostSheet calls. Read `PostSheet.jsx` and `HiresMediaPanel.jsx`, and port or reuse
  their logic, but **do not delete or edit them** (Agent D retires them).
- **The editor must show everything approval locks in:** copy, self-reply, media, media variants, and reply/quote target. A post
  with a self-reply or variants shows them. If a field can't be edited in place, it's shown read-only with "edit in
  More". Approve is never enabled while a locked-in field is hidden.
- Model tests: char count, approve/schedule enablement, dirty tracking, time-zone formatting, conflict handling.

**Agent C: Creative picker from Content Center + one server action**
- Server: new action `post-attach-item-media` in `app/api/dashboard/quote-targets/route.js`. It takes `{ postId, packageId }`,
  checks both belong to `context.clientId`, then `pickMedia(pkg, mediaSigners())` → `swapPostMedia(clientId, postId,
  media, { statuses: HIRES_EDITABLE_STATUSES })`.
  - Refuse non-X formats (only `video/mp4` and jpeg/png/webp/gif) with a clear message.
  - Pass through `needs-staging` (NAS item not staged) as code `needs-staging` + `packageId`, so the UI can offer Stage.
  - Return `{ ok, approvalVoided, row }`.
  - Add the action id to the route's action list. Tests use the existing fake-Firestore harness pattern
    (`features/social-posting/__tests__/pilot-lifecycle.test.js`).
- UI: new `components/dashboard/x-content/CreativePicker.jsx`.
  - Search/grid over the client's Content Center items, reusing `ItemGrid` / `MiniThumb` / `fetchMediaUrl`.
  - Filters: images / mp4 video / staged only.
  - Disabled tiles carry a reason: "Not staged", "Format X can't publish".
  - Emits `onPick(packageId)`. It is rendered *inside* the post level (a panel within the editor), never as a new
    overlay.

### Phase 2: one agent (after the owner approves Phase 1)

**Agent D: Integration and retirement**
- Mount `CalendarStage` from `DashboardPage.jsx`: fade the dashboard out, keep `InternalPageBackground`.
- Feed Month and Day from `MonthCalendarPanel` internals:
  - Extract month-grid and day-list presentational pieces if needed.
  - Remove its own modal/backdrop wrappers.
- Post level = `PostEditor`; its "Add / change creative" button opens `CreativePicker` inline.
- Rewire entry points:
  - "Open Today" (`OnboardingFlowPanel.jsx`, `DashboardPage.jsx` one-shot) → stage at `day` / today.
  - Queue & Calendar card Calendar tab → "Open calendar" button → stage at `month`.
  - Compose and Quote targets stay in the card.
- Retire `PostSheet.jsx` and its drawer mount once nothing references it. Delete dead imports and styles. Keep
  `HiresMediaPanel` only if `PostEditor`'s More menu uses it.
- Verify: no path opens a modal on top of a modal; Esc, Back and ✕ behave per §3; mobile width standard holds.

### Phase 3: one reviewer agent (read-only)
- Review the whole diff against this prompt and `CLAUDE.md`:
  - scope drift
  - lifecycle safety: every approve and media path goes through the listed calls
  - accessibility: focus, inert, reduced motion
  - mobile behaviour, theme literals, dead code
  - DOM ids
- Output format: Verdict / Findings (file:line, severity) / Risks / Next step.

## 5. Acceptance (owner walk-through after Phase 2)

1. Stand Up → Open Today: the dashboard fades fully out and today's Day view appears on the gradient. ✕ returns to Stand Up
   with the dashboard visible.
2. Month → day → post → Back → Back → Back returns to Stand Up, one level per step, never two layers visible. Browser
   Back does the same. Reloading on `post` restores it.
3. Edit copy → Save → reload: the copy persisted. Edit copy on an approved post → it becomes Draft → Approve.
4. Approve & schedule with a past time is blocked; with a future time the post is Scheduled at the shown time.
5. Add creative from Content Center on a scheduled post → "New creative cleared approval" → re-approve → schedule. A
   `.mov` source and an unstaged NAS item are refused with a reason.
6. A post with a self-reply shows it in the editor before Approve is possible.
7. The PostSheet drawer no longer exists; every action it had is reachable from More.
8. At ≤480 px, every level is full width; reduced-motion users get instant swaps.

## 6. Orchestration (for the session running this)

1. Phase 1: spawn Agents A, B and C **in parallel** (model: sonnet), each with §0–§4 plus its own section. Wait for all
   three. Summarize their reports for the owner. **Stop for approval.**
2. Phase 2: spawn Agent D with the Phase 1 branches merged into one integration branch. **Stop for approval.**
3. Phase 3: spawn the reviewer. Present its findings. Fix only approved findings. Open one PR. **No merge or deploy
   without explicit owner approval.**
