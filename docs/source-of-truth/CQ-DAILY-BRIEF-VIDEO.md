# CQ Daily Brief Video — as built

**Status:** live since 2026-11-17 22:30 CST (PR #100; the Site Showcase card is PR #96). Sister doc: [`SITE-SHOWCASE-VIDEO.md`](SITE-SHOWCASE-VIDEO.md) (the shared render service, its deploy and rollback live there).

Critters Quest (CQ) calendar drafts carry an **internal video brief** after the public X copy. A cron finds the next draft without media, renders a template video from the brief on the `showcase-render` Cloud Run service, and attaches the mp4 + poster to the draft. A human still reviews and approves the post in the calendar. Nothing is ever posted by this system.

## 0. Read first: risks

- **Real client account.** `paradice-dbBQCHUX` (companyName Critters Quest) belongs to another person. Writes touch their `social_posts` drafts (`content`, media fields). Do not enable for other clients, change attach rules, or re-render in bulk without the owner's OK. The 6 `critters-*` `client_configs` records are stale April intake records, not this client.
- **Template, not real footage.** The video is built from CQ art and rebuilt UI panels from the CQ Remotion package, not recordings of the game. Captions use only words and digits from the brief. Briefs that say "capture the real UI / actual raid alert" get a stand-in template cut; the human reviewer must know that before approving. There is no Season 3 art, and the rebuilt UI panels carry mock numbers, so only raid and bank use UI panels with numeric fields hidden or blank.
- **The brief must never be published.** Enforced by the strip-on-attach and the publish guard (section 5).
- Costs about $0.07 to $0.10 per render; capped at 10 renders per CT day.

## 1. Flow

```
Vercel cron */15 * * * *  --GET (Bearer CRON_SECRET)-->  /api/worker/cq-daily-video
  runTick (features/brief-video/worker.js), at most one of each per tick:
   1. attach   oldest brief_video_jobs doc with status=done and no attachedAt/attachSkipped
                 -> attachJobToPost (one transaction) -> post gets video, job gets attachedAt | attachSkipped:<reason>
   2. fail     oldest active job past its timeout -> status=failed "timed out"
   3. re-poke  a queued job whose trigger is >60 s old
   4. start    only if nothing active and nothing failed this tick:
                 pick earliest eligible draft -> createJob (transaction, daily cap) -> POST service /render {jobId}
Cloud Run showcase-render (job id prefix bv_ -> collection brief_video_jobs):
   claim queued->rendering -> mapBrief(brief, {hook}) -> remotion render CQ-BriefCut (--gl=vulkan, music kept, crf 18)
   -> ffmpeg poster (frame at 1 s) -> upload mp4 + jpg -> ffprobe -> status=done + downloadUrl/posterUrl
Next tick (15 min later at most): step 1 attaches it. Calendar shows the video via posterUrl; the human approves.
```

The service never touches `social_posts`; only `attachJobToPost` does.

## 2. Files

App (`Bballi_Portfolio`):
- `app/api/worker/cq-daily-video/route.js`: cron route + auth + dry run + force re-render.
- `features/brief-video/clients.js`: allowlist `DAILY_BRIEF_VIDEO_CLIENTS = {'paradice-dbBQCHUX': 'critters-quest'}`, constants.
- `brief.js`: parse/strip the brief (`parseBrief`, `stripBrief`, `briefHash`, `firstSentence`, `briefOfPost`).
- `jobs.js`: candidate selection, idempotent job ids, job doc shape.
- `worker.js`: `runTick`, `dryRun`, `pokeService`.
- `attach.js`: `planAttach` (pure rules) and `attachJobToPost` (transaction).
- `features/social-posting/twitter-service.js`: `assertNoInternalBrief` guard.
- `features/x-content-inventory/calendar-media-backfill.js`: brief-draft skip.
- `vercel.json`: cron `{"path": "/api/worker/cq-daily-video", "schedule": "*/15 * * * *"}`.
- Tests: `features/brief-video/__tests__/brief-video.test.js`.

Video repo (`hitloop-video`, branch `feat/hitloop-showcase`): `clients/critters-quest/briefcut/mapBrief.mjs` (+ `.test.mjs`, `example-briefs.json`), `clients/critters-quest/src/briefcut/` (`Full.tsx`, `tune.ts`), composition `CQ-BriefCut` in `src/Root.tsx`, and `services/showcase-render/job.mjs` (`runBriefJob`).

## 3. Draft format and the cron tick

A draft's `content` is `"<public X copy>\n\nINTERNAL VIDEO BRIEF: <instructions>"`. `parseBrief` takes the text after the marker (trimmed) as `brief`, `briefHash = sha256(brief).slice(0,16)`, `hook` = first sentence of the public copy (max 280 chars; the mapper trims it to 60).

**Candidate rules** (`selectCandidates`): `clientId` in the allowlist, `status === 'draft'`, no `mediaUrl`, `reviewOn` is `YYYY-MM-DD` within today..today+7 (**America/Chicago** date), a non-empty brief, and the brief does **not** match `/\bHOLD\b/`. Sorted by `reviewOn` then id.

**HOLD skip.** A brief containing the word HOLD (for example the Dec 18 draft) is never rendered: a human has to decide it. `?dryRun=1` lists it with `skipReason: 'hold'`; a forced re-render also refuses (`skipped: 'hold'`).

**Per tick, `runTick`:**
1. Attach at most one done job (oldest first). Fail at most one timed-out active job (`rendering`: 20 min from `startedAt`; `queued`: 60 min from `createdAt`). Re-poke at most one queued job older than 60 s (`triggerAt`).
2. Start a new job only when no job is active and none was failed this tick (`skipped: 'failed-this-tick' | 'active-job'`). For the earliest candidate: skip if any job for that post+briefHash is not `failed` (queued, rendering or done: reconcile owns it); skip if it already has 2 attempts (`MAX_ATTEMPTS`). Otherwise create `brief_video_jobs/{jobId}` with `attempt = max+1`.
3. `createJob` runs in a transaction that also increments `showcase_state/briefvideo_{clientId}` (`{day, count}`, CT day) and refuses at 10 (`skipped: 'daily-cap'`). Job id `bv_` + sha256(`postId:briefHash:templateVersion:attempt`).slice(0,20) means a double tick cannot create two docs (`job-exists`).
4. Poke `{SHOWCASE_RENDER_URL}/render` with `x-render-secret`, 4 s abort, errors swallowed.

The tick report (JSON) fields: `ok, attached, failed, repoked, started, skipped`.

**One attach per tick, and one start per tick.** Throughput is therefore about one video per 15 to 30 min. It also meant that the two gate-test jobs (postId `gate-test-not-attached`, stamped `attachSkipped`) occupied the first two ticks after going live before real drafts were attached.

## 4. Attach rules (`planAttach`)

One transaction re-reads the post and the job and re-checks everything. On any failed rule the job is stamped `attachSkipped: <reason>` (permanent, the tick will not retry it) and the post is untouched.

| Reason | Meaning |
|---|---|
| `job-not-done` / `already-stamped` | job not done, or already attached/skipped |
| `post-missing` | draft was deleted |
| `client-mismatch` | post's client differs from the job's |
| `not-draft` | approved/scheduled/posted/rejected already |
| `has-media` | `mediaVariants`, `nasSha`, or a `mediaUrl` already present (a `mediaUrl` is replaced only on a forced re-render of media that a `bv_` job attached) |
| `no-brief` / `brief-changed` | brief gone, or its hash differs from the job's (someone edited the brief; a new job will be made for the new hash) |
| `empty-public-copy` / `public-copy-too-long` | public copy empty or over 280 chars |
| `job-incomplete` | no `downloadUrl` or `posterUrl` |

On success the post gets: `content` = public copy only (brief stripped), `videoBrief` + `videoBriefHash` (the brief moved here), `mediaUrl`, `mediaType: 'video'`, `mediaContentType`, `mediaStoragePath`, `mediaJobId` (bv_...), `posterUrl`, `mediaMetadata {source: 'cq-briefcut', templateVersion, width, height, durationInFrames}`, `agents.mediaGenerator {status: 'complete', ...}`, `revision + 1`, `updatedAt`; the job gets `attachedAt`. The calendar UI needed no change (month calendar passes `mediaUrl`, `mediaType`, `posterUrl`).

## 5. The publish guard

`assertNoInternalBrief` in `features/social-posting/twitter-service.js` throws 409 `internal-brief-present` when any text matches `/INTERNAL VIDEO BRIEF/i`. It runs in: `postToTwitter` (content and self-reply), `postNow`, the approve path (`approveAndSchedule`/approve draft: `post.content` and `selfReply.text`), and the self-reply publish paths. So a draft that has not been attached yet cannot be approved or posted; the fix is to wait for the attach or edit the brief out. This is the safety net behind the strip-on-attach: do not remove it.

**Backfill skip.** `features/x-content-inventory/calendar-media-backfill.js` ignores drafts whose content matches `/INTERNAL VIDEO BRIEF/i`, so the stock-media backfill cannot attach library media to a brief draft and make it ineligible (the draft would gain a `mediaUrl`).

## 6. The mapper (`mapBrief.mjs`) — deterministic, no LLM

`mapBrief(brief, {hook})` returns `{v:1, totalFrames, beats:[{kind, caption, label?}], endCard:{hook?}, music:true}`. Every caption word and every digit shown comes from the brief; nothing is invented.

- **Duration**: first `(\d+)\s*s` clamped 12 to 25 s, default 15 s, at 30 fps (`totalFrames` 360 to 750). Of that, 3 s is the end card.
- **Clauses**: split on `->`, arrow, `;`, `then`, sentence ends, and commas only when both sides have 2+ words.
- **Meta clauses dropped** (instructions to a human editor): label, hold on, real UI only, no unreleased, crop account, use one account, recording, a leading "circle".
- **Caption**: clause minus leading directive words (open with, start on, match-cut, an actual, capture, show, open, use, record, cut, actual, the, a, real), first 8 words, UPPERCASE.
- **label**: only when the clause contains a digit; the first date or number found, uppercased.
- **Beats**: 2 to 5 (extra beats are dropped). Fewer than 2: padded with the public hook (first 8 words) or `CRITTERS QUEST`.
- **Hook**: first sentence of the public copy, with links, hashtags, mentions and emoji removed, max 60 chars at a word boundary. It is the end card text.
- Pure mapper tests assert every caption word appears in the brief and no foreign digits appear.

**Scene kinds**: first keyword match wins, in this order; otherwise `generic`.

| kind | keywords (case-insensitive) | art |
|---|---|---|
| map | map, world, territory, nexus, region | world map, nexus map |
| town | town, castle, building, village, overview | sand castle, town hall, visiting a town |
| raid | raid, defense/defence, defender | raid UI panels (numbers hidden), raid/defense art |
| bank | bank, pool, vault, treasury | world bank art, pool info card (numbers hidden) |
| shards | shard, crystal | shard art |
| battle | battle, fight, boss, gravitax, attack, damage | Gravitax art |
| results | result, report, outcome, reward, winner, leaderboard, ranking | defeated goblins art |
| critter | critter, squad, character, hero, team | critter portraits, build-a-squad |
| resource | resource, gather, inventory, node, mining, wood, stone, log, ore, market, material | resource market, resources icon |
| hospital | hospital, heal, revive, injur | hospital screen |
| date | month + day, target card, countdown, deadline, date | typographic card on startup background |
| generic | anything else | forest path, logo key art |

Authoritative lists: `KIND_RULES` in `mapBrief.mjs` and the per-kind art in `src/briefcut/tune.ts`/`Full.tsx`; the table above is a summary.

## 7. The timeline (`planTimeline`, `tune.ts`)

1080x1080, 30 fps, music on (`critters_theme.mp3`), no voice-over, no new ElevenLabs spend. The last 90 frames (3 s) are the end card (wordmark, hook, `critters.quest`). The time before it is split equally among beats (`beatLen = floor((total - 90) / beats)`). Consecutive beats of the same kind share one scene (the camera glides to a new framing and the caption changes, no wipe to the same screen); a change of kind uses a diagonal wipe + whoosh. Props are validated again by zod (`briefCutSchema`) in the composition. `TEMPLATE_VERSION` (`cq-briefcut-1`) is in the job id: bump it in both `features/brief-video/clients.js` and `mapBrief.mjs` when the template changes so re-renders get fresh ids.

## 8. Render settings and measurements

`npx remotion render src/index.ts CQ-BriefCut --props=<spec.json> --concurrency=4 --timeout=60000 --crf=18 --gl=vulkan --chrome-mode=chrome-for-testing`, run in `clients/critters-quest` (its own Remotion 4.0.534; hitloop's is 4.0.421, never hoist them together), hard-killed at 720 s. CQ uses `--gl=vulkan` because `swangle` (CPU GL, the first choice) tiled the end card. Music is kept (no `--muted`). Output paths: `clients/{clientId}/brief-videos/{reviewOn}_{jobId}.mp4` and `.jpg`.

Measured: 600 frames in about 1.2 to 3.3 min. Cost about $0.07 to $0.10 per render.

## 9. Operate

All calls use the cron secret from Vercel (`CRON_SECRET`); never print it. Base: the production site origin.

- **Dry run** (writes nothing, works even when the flag is off): `GET /api/worker/cq-daily-video?dryRun=1` with `Authorization: Bearer $CRON_SECRET`. Returns `today`, the 7-day window, and for CQ every brief draft (`postId, reviewOn, hasMedia, brief, briefHash, hook, skipReason`) plus the `candidates` the next tick would take.
- **Normal tick**: `GET /api/worker/cq-daily-video` (Vercel cron does this). Returns `{ok:true, disabled:true}` unless `DAILY_BRIEF_VIDEO_ENABLED=true`. Fails closed (401) in production without a matching bearer.
- **Force re-render**: `GET ...?postId=<id>&force=1`. Only for a draft whose `mediaJobId` starts with `bv_` and is still `draft`; makes a new attempt (job `replace: true`), and on completion replaces the media. Use after fixing a bad render or bumping `TEMPLATE_VERSION`. `postId` without `force=1` returns `skipped: 'postId-needs-force'`.
- **Off switch**: unset `DAILY_BRIEF_VIDEO_ENABLED` in Vercel production and redeploy (env changes need a redeploy to apply). Cron keeps firing and returns `disabled`. To stop the render spend only: unset `SHOWCASE_RENDER_URL` and redeploy (jobs would then sit `queued` and time out).
- **Rollback**: set the flag off; route Cloud Run to the previous revision (`gcloud run services update-traffic showcase-render --region us-central1 --to-revisions <rev>=100`; revisions and redeploy steps are in `SITE-SHOWCASE-VIDEO.md` section 8); clear media on affected drafts if needed (restore `content` from `content` + `\n\nINTERNAL VIDEO BRIEF: ` + `videoBrief`, and clear `mediaUrl`, `mediaType`, `posterUrl`, `mediaJobId`, `mediaStoragePath`, `mediaMetadata`, `videoBrief*`; this is a write to a client's account: owner OK first).
- **Env (Vercel production)**: `DAILY_BRIEF_VIDEO_ENABLED=true`, `SHOWCASE_RENDER_URL`, `SHOWCASE_RENDER_SECRET`, `CRON_SECRET`, and `PILOT_CLIENT_IDS`. The last is sensitive and was rewritten on 2026-11-17 as home + UE + NTR + paradice-dbBQCHUX, because the previous value could not be read. CQ must be in it: calendar approve calls `requirePilotOwner`, which 403s for a client missing from `PILOT_CLIENT_IDS`.
- **Add another client**: add it to `DAILY_BRIEF_VIDEO_CLIENTS`, add its template/`videoClient` branch in `buildBriefSpec` (service, currently `critters-quest` only), add it to `PILOT_CLIENT_IDS` (owner OK), redeploy the service and the app. Do a dry run first.

## 10. Firestore

- `brief_video_jobs/{bv_...}`: `v, jobId, kind:'cq-brief', clientId, videoClient, postId, reviewOn, brief, briefHash, hook, templateVersion, status` (`queued|rendering|done|failed`), `attempt, createdAt, updatedAt, triggerAt, startedAt`, optional `replace`; service writes `spec, specHash, bucket, outputPath, downloadUrl, posterPath, posterUrl, contentType, sizeBytes, width, height, fps, durationInFrames, renderMs, totalMs, finishedAt` or `error:{stage,message}` (stages `validate`, `render`, `poster`, `upload`); app writes `attachedAt` or `attachSkipped`.
- `showcase_state/briefvideo_{clientId}`: `{day (CT), count, updatedAt}`.
- `social_posts`: the CQ drafts (fields in section 4).
- The job collection is separate from `showcase_jobs` on purpose, so HITLOOP's UI list is never polluted.

## 11. Troubleshoot

| Symptom | Check |
|---|---|
| Nothing happens | `DAILY_BRIEF_VIDEO_ENABLED` unset (tick returns `disabled`); cron secret mismatch (401); no candidate in the 7-day window (dry run) |
| Tick says `active-job` for a long time | A job is `queued`/`rendering`. Look at its doc and the Cloud Run logs; it times out (20/60 min) and is failed, then retried (max 2 attempts) |
| `failed-this-tick` | Normal: a timed-out job was failed; a retry starts next tick |
| `daily-cap` | 10 renders already today (CT); raise `MAX_RENDERS_PER_DAY` in code or wait |
| Draft has no video, job `done` but `attachSkipped` | The reason is on the job doc (section 4). `brief-changed`: edit made after the job; a new job is made at the next tick for the new hash. `has-media`: someone or the backfill added media first |
| Draft never picked | Contains `HOLD`, `reviewOn` outside today..+7 CT, already has `mediaUrl`, has a non-failed job, or 2 attempts used |
| Approve returns 409 `internal-brief-present` | The video is not attached yet (brief still in content). Wait for the attach or remove the brief text by hand |
| Approve returns 403 | Client missing from `PILOT_CLIENT_IDS` |
| Bad render (tiled/glitched frames) | Check `--gl=vulkan` is still used for `cq-brief` in `remotionRender`; then fix and force a re-render |
| Wrong captions | Mapper is deterministic: reproduce with `node -e` importing `mapBrief.mjs`, edit the brief, or adjust the mapper and bump `TEMPLATE_VERSION` |

## 12. Tests

App: `features/brief-video/__tests__/brief-video.test.js` (selection, idempotent ids, attach preconditions, strip regex, HOLD, guard). Video repo: `clients/critters-quest/briefcut/mapBrief.test.mjs`, `services/showcase-render/__tests__/brief-job.test.mjs`. The in-prod gate test used jobs with postId `gate-test-not-attached` (no such post), which end `attachSkipped`.
