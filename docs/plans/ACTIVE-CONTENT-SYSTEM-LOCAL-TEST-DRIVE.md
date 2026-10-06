# Active Content System — local test drive

Branch `feat/active-content-system` (uncommitted), merged with `feat/records-acs-hooks`.
Runs at **http://localhost:3002**. Your normal dev server on :3000 is untouched.

## ⚠️ Read first: this talks to the REAL database

The local server uses your real `.env.local`: production Firestore, your real `@bai_ee` X connection. Anything you click that writes data writes it for real.

| Safe to click | Do NOT click during this test |
|---|---|
| Opening tabs, browsing the calendar, week navigation | **Schedule** on any real draft. Production's daily cron (13:40 UTC) runs the OLD publish code and would post it |
| **Approve** / **Reject** on a package or draft. Approved is a new state the live code ignores | **Post now** (Copywriter / Schedule Posts) |
| Capturing a client story (creates an `idea` row, never posts) | Any X Monitor **sync** (metered X API) |
| Copywriter live **score** (free, no AI) | Copywriter **Enhance** (paid AI call) |

If you schedule something by accident, open it in Copywriter and clear the date. It returns to draft.

## Start / stop

- Start: `cd ~/Documents/Repos/Bballi_Portfolio-content-system && ./node_modules/.bin/next dev --webpack -p 3002`
- Stop: Ctrl+C in that terminal, or `lsof -ti tcp:3002 | xargs kill`
- First load of each page compiles for 5–30 s. That is normal.
- You will need to log in again on :3002, because each port keeps its own login.

## The test drive (about 20 min)

### 1. Content Engine card: Plan tab
1. Go to http://localhost:3002/dashboard and log in as admin.
2. Open the **Social** bucket, then **Content Engine**.
3. Plan tab, expect:
   - 4 authored slots at least 2 h apart. Some show "(was 08:30)" where they were moved for spacing.
   - Each slot labelled with an engine: record, ue, client or identity.
   - Engine counts vs limits, plus warnings like "ue: 0/3 this week".
   - Empty engines show as a named **gap**. Quota-skipped slots show **Skipped (engine quota)**.
   - No placeholder row (TODO / `[add your memory]`) fills a slot.

### 2. Calendar tab
1. Expect a 7-day grid of real `social_posts`, colour-coded by engine and status.
2. Expect per-engine counts vs limits and spacing/over-cap warnings.
3. Use the week navigation arrows.
4. Click **Approve** on one draft. It should move to *approved*. Do not click Schedule.
5. Check that there is no Post Now button anywhere in the calendar.

### 3. Clients tab
1. Fill the capture form with one real story: client, problem, decision, rejected idea, result.
2. Expect it to appear in the list as **approval needed**.
3. Click **Approve**, then **Reject**, and watch the state change.
4. Go back to the Plan tab. A client story only becomes eligible once it is approved and has your written story.

### 4. Results tab
Expect "insufficient data" flags. Nothing has posted through the new system yet, so this tab is empty by design. It should not error.

### 5. Copywriter (scorer check)
1. Social bucket, then **Copywriter**. Type a draft.
2. The live score updates. Expect lower, narrower numbers than before (re-weighted).
3. A post with a link should recommend "move link to first reply".
4. It should **not** recommend "add a question".

### 6. Phone width
Use DevTools device mode at 390 px on each new tab. Content should be full width with no sideways scroll.

### 7. Terminal checks (free, nothing written)
Run these from `~/Documents/Repos/Bballi_Portfolio-content-system`:
- `node scripts/x-content/day-view.mjs --posts 4`: today's plan by engine.
- `node scripts/x-content/ue-ingest.mjs`: preview of the 23 Underground Existence mixes and 6 build stories.
- `node scripts/media/render-still-video.mjs --image <any.jpg> --aspect both --out /tmp/test.mp4`: renders sample videos.
- `node scripts/x-content/research/replay-scorer.mjs`: old vs new scorer on your real posts.
- `npm test`: expect 2 known failures only (studio vendor-sync, pre-existing).

## What to report back
For each step: works / broken / looks wrong, plus a screenshot of anything off. Every new container has a stable id (e.g. `x-content-week-calendar-panel`), so name the id and I can fix it precisely.

## After the test drive (not before)
1. Fix anything you found.
2. Commit, merge and deploy (your approval).
3. Run `firebase deploy --only firestore:indexes`, then the backfills (ACS fields first, then index fields).
4. Write stories for the 17 drafts.
5. Make the first supervised post.
6. Turn on the GitHub publisher.
