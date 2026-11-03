# Discogs "Process drive" button — plan (2026-10-23)

Objective: one button in the Discogs panel that takes whatever is NEW on the Discogs drive all the way to drafts on the calendar, with a review stop only for records it cannot place with confidence. Nothing renames on the NAS. Nothing posts.

## Current relevant architecture (as built)

- Mac worker `~/Documents/Repos/assetManager`, analyzer daemon (launchd `com.hitloop.archive-analyzer`, `lib/discogs/analyzer-entry.ts`) already serves the Discogs plugin: queued commands `DISCOGS_PLAN` / `DISCOGS_APPLY` / `DISCOGS_UNDO` (`lib/discogs/analyzer-plugin.ts`), free live routes `GET /discogs/status`, `POST /discogs/estimate` on `127.0.0.1:8777`.
- Transport: dashboard → `POST /api/dashboard/quote-targets {action:'discogs-*'}` (`features/discogs-ingest/actions.js`) → Firestore `archive_commands` → analyzer polls, runs serially, PATCHes state/result. Contract: `docs/plans/DISCOGS-PANEL-CONTRACT.md`.
- UI: `components/dashboard/x-content/DiscogsPanel.jsx` (folder picker, estimate, Read labels & match, results, Add to collection, Undo, job history).
- Render + draft is CLI-only today: `lib/discogs/publish-cli.ts` `main()` (313 lines, not importable), posting to `app/api/archive/worker/discogs/{upload-url,draft}`.
- Grouping rule fixed 2026-10-22 (video → first label shot after it), uncommitted in `lib/discogs/media.ts`.
- State: `~/.discogs-ingest/` (`index.json`, `runs/*-plan.json`, `published.json`, `cache/`).

## Proposed direction

Add ONE worker command, `DISCOGS_PROCESS`, that chains the three existing steps over new files only, and ONE panel button that queues it and shows its progress + review list. Keep the existing three buttons (they become the manual path).

### Phase A — worker: make publish callable (no behaviour change)
- Extract `publish-cli.ts` `main()` into `lib/discogs/publish-run.ts`: `publishRecord(rec, { video?, force?, clipMode, aspect }, deps)` returning `{ releaseId, postId, packageId, clip }`, plus `loadPlansNewestFirst()` and `fetchSource()` as exports. CLI becomes a thin wrapper. Same output, same `published.json` write.
- Commit the grouping fix + tests first (separate commit) so the rule cannot drift.
- Tests: existing 86 + a `publishRecord` test with injected HITLOOP/ffmpeg deps (dry path).

### Phase B — worker: `DISCOGS_PROCESS` command
Input: `{ sourceId, relativePath, capUsd (default 2), publish: true }`.
Steps, each reported as `progress.phase` on the command:
1. `scanning` — `scanFolder` through `index.json`; new = files not in the index. If none → COMPLETE with `summary.newFiles = 0`.
2. `reading` / `matching` — `planFolder` (vision reads cached; only new labels bill). Save the plan as today.
3. `adding` — `applyPlan` for groups with action `add` only (exact catno). `notes: false`, never `--rename`.
4. `rendering` — for each group that is NEW (has a file not in the previous index) AND confident (`isConfident`: add | already-owned, exact catno) AND not in `published.json` AND has exactly one video → `publishRecord`. Groups with 2+ videos or 0 videos are NOT rendered; they go to review.
5. `done` — result `{ published: [{releaseId, postId, title}], review: ReviewRow[], noClip: [...], spentUsd, journal }`.

`ReviewRow` = `{ groupId, labelName, labelThumb (base64 jpeg ≤ 40 KB), clips: [{ name, seconds, frameThumb }], candidates: top 4 {releaseId, title, catno, label, country, year, score}, reason }`. Thumbs are generated the same way as the 2026-10-23 contact sheet (ffmpeg mid-frame), so the review is the eyeball step, inside the panel.

Cancel: honours `isCancelled` between records; a cancelled run keeps what it published.

### Phase C — HITLOOP: action + panel
- `features/discogs-ingest/actions.js`: `discogs-process` (queues `DISCOGS_PROCESS`), `discogs-resolve` (`{ groupId, releaseId, video? }` → queues a `DISCOGS_PROCESS` with `only:[{groupId, releaseId, video}]`, which pins exactly like `--release --group --video`). Equality-only queries, same guards as `discogs-plan`.
- `DiscogsPanel.jsx`: `#discogs-process-row` with **Process drive** (estimate line already shows new-file count and price; button disabled at 0 new files), a progress line per phase, and `#discogs-process-review` listing ReviewRows: label photo + clip frame(s) side by side, candidate radio list, optional clip radio when 2+ clips, **Use this** → `discogs-resolve`. Published rows link to the calendar post.
- Job history shows DISCOGS_PROCESS like the others.

### Phase D — hand-off
- RUNBOOK: new section "Process drive" + "the review list IS the eyeball step".
- CONTENT-PILOT / CLAUDE.md Discogs note: button path + CLI fallback.

## Keep vs change
- Keep: all CLI flags, the three existing commands, `published.json` as the source of what is drafted, exact-catno gate for collection adds, NAS read-only.
- Change: publish logic becomes a module; one new command type; one new panel row.
- Not doing: NAS renames (ever, by button), auto-scheduling/posting, Discogs release creation, moving the worker to the cloud.

## Files likely involved
Worker: `lib/discogs/publish-cli.ts` → `publish-run.ts` (new), `analyzer-plugin.ts`, `run.ts`, `media.ts` (commit), tests.
HITLOOP: `features/discogs-ingest/actions.js` (+ tests), `components/dashboard/x-content/DiscogsPanel.jsx`, `docs/plans/DISCOGS-PANEL-CONTRACT.md` (v2 section), worker RUNBOOK.

## Risks
- Render time blocks the analyzer's other commands (serial): a 40-record run is ~10 min of render; NAS Stage jobs wait. Acceptable; progress shows it. Mitigation later: a second daemon slot.
- Vision spend: capped by `capUsd` as today; publish framing calls are ~$0.007/record.
- "New" is defined by `index.json`; re-exported duplicates (`IMG_0812 3.heic`) are deduped by fingerprint already.
- A record filmed twice (two clips) always goes to review. Correct, but it will surprise; the review copy must say why.

## Recommended phase order
A (worker extract + commit grouping fix) → B (command) → C (panel) → D (docs). Stop for approval after each. A and B can be tested entirely from the CLI and a queued command before any UI exists.

## Approval needed before coding
- OK to commit the worker grouping fix now (it is what the 2026-10-23 batch ran on).
- Confirm "2+ clips → review, never auto-pick longest" (the old longest-wins rule is what produced the Swirl People / Halo & Justin Long strays).
