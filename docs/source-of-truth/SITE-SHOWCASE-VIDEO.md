# Site Showcase Video (HITLOOP) — as built

**Status:** live since 2026-11-17 (PR #96). On-demand only: no daily run yet (see section 10). Companion doc: [`CQ-DAILY-BRIEF-VIDEO.md`](CQ-DAILY-BRIEF-VIDEO.md), which reuses the same render service.

An admin on the HITLOOP client opens the **Site Showcase Video** card (Creative Team bucket), picks one of three suggested focuses of the HITLOOP site, and renders a short branded video of it. The render runs off Vercel on a Cloud Run GPU service and lands in Firebase Storage. Nothing is posted or put on the calendar: the result is a playable and downloadable mp4 in the card.

## 1. Pieces

| Piece | Where |
|---|---|
| Card + panel | `DashboardPage.jsx` (card id `site-showcase`, domId `site-showcase-card`, Creative Team bucket), `components/dashboard/showcase/ShowcasePanel.jsx`, `useShowcaseSummary.js` (card-face summary, read-only) |
| API route | `app/api/dashboard/showcase/route.js` (GET `options` / `list` / `status`, POST `create`) |
| Feature code | `features/showcase/` (`clients.js` allowlist, `registry.js` focus lookup + input validation, `options.js` seeded option generator, `focus.hitloop.json` the focus list) |
| Render service | Cloud Run `showcase-render` (code in the `hitloop-video` repo, branch `feat/hitloop-showcase`, `services/showcase-render/`) |
| Template | `hitloop-video/clients/hitloop/src/showcase/` (composition `HL-Showcase`, scene modules, `focus.json`), `bin/showcase.mjs` (local CLI) |
| Firestore | `showcase_jobs/{jobId}` (jobs), `showcase_state/{clientId}` (day counter + active job) |
| Storage | `clients/{clientId}/showcase/{jobId}.mp4` in the service's `SHOWCASE_BUCKET`, token download URL |

## 2. Flow

```
Card (browser) --GET options--> route: 3 seeded focus options + quota
Card --POST create {focusId, format, theme}--> route
   route: auth gates -> validate -> transaction (one active job per client, daily cap)
          -> writes showcase_jobs/{sc_...} status=queued, showcase_state/{clientId}
          -> POST {SHOWCASE_RENDER_URL}/render {jobId}  (header x-render-secret, 4 s abort, errors swallowed)
   returns 202 {jobId}
Cloud Run showcase-render:
   claim (transaction queued -> rendering) -> build spec from ITS OWN bundled focus.json
   -> remotion render HL-Showcase (--gl=vulkan, --muted, crf 8) -> upload mp4 -> ffprobe
   -> update job: status=done, downloadUrl, sizeBytes, width/height/fps/durationInFrames, renderMs, totalMs
Card polls GET status every 5 s (up to 25 min) -> shows <video>, download link, caption
```

The request carries only `{focusId, format, theme}`. The service rebuilds the spec from its own copy of the focus file, so the browser can never inject scenes or props. `validateCreateInput` ignores every other body key.

## 3. Access gates (route, in order)

1. `verifyRequestUser` (Firebase ID token).
2. `isAdminEmail`: admin only (403).
3. `getEffectiveClientContext` + `requirePilotOwner`: the effective client must be a pilot owner.
4. `SHOWCASE_CLIENTS[clientId]` in `features/showcase/clients.js`: today only `'bryan-balli-WUoltG84': 'hitloop'`. `PILOT_CLIENT_IDS` also lists UE and NTR, so this separate map is what keeps the card HITLOOP-only.

The card is hidden unless `isAdmin && SHOWCASE_CLIENTS[effectiveClientId]` (`showcaseEnabled` in `DashboardPage.jsx`); the route stays authoritative. Responses are `cache-control: no-store`; `createdBy` (owner uid) is stripped from every job the route returns.

## 4. The route in detail

- **GET `?action=options[&shuffle=1..20]`**: returns `{options, quota:{used,max}}`. Options come from `generateOptions` (pure, `features/showcase/options.js`): focuses minus the last 3 `done` renders, sorted by id, shuffled with a seeded RNG (FNV-1a32 into mulberry32, seed `hitloop:{UTC date}` plus `#n` when shuffling), first 3 taken, one format picked per focus. Same day + same shuffle number gives the same options. `bin/showcase.mjs` in the video repo has the matching generator (the route's is a port).
- **GET `?action=list`**: last 30 jobs (collection order by `createdAt`), filtered to this client. Active jobs older than 20 min are failed ("timed out") in a transaction that re-checks the job is still active.
- **GET `?action=status&jobId=sc_...`**: one job (404 for another client's). Same 20 min timeout rule. A job still `queued` more than 20 s after its `triggerAt` is poked again (a lost trigger heals on the next poll).
- **POST `?action=create`**: 503 if `SHOWCASE_RENDER_URL` or `SHOWCASE_RENDER_SECRET` is unset (checked before any write). One transaction: 409 if the client already has an active job under 20 min old (an over-age one is failed first), 429 once the day count reaches the cap, otherwise writes the job and bumps `showcase_state`. Then it pokes the service and returns 202.

Constants: active timeout 20 min, re-poke after 20 s, trigger abort 4 s, list limit 30, job id `^sc_[a-z0-9_]{6,40}$`.

### Caps

- **Daily cap**: `SHOWCASE_MAX_RENDERS_PER_DAY` env, default **6** per client per UTC day (`showcase_state/{clientId}.{dayKey,count}`). Counted at queue time, so failed renders still use quota.
- **One active job** per client (`showcase_state.activeJobId`).
- Cloud Run itself is `max-instances 1`, `concurrency 1`: HITLOOP showcases and CQ brief videos share one render slot (a poke that cannot get the slot leaves the job `queued`; the next status poll or cron tick re-pokes it).

## 5. The focus list

`features/showcase/focus.hitloop.json` (server allowlist + captions shown in the UI) and `hitloop-video/clients/hitloop/src/showcase/focus.json` (what the service renders) **must stay identical**. A focus id the service does not know fails the job at stage `validate`.

| focusId | Title | Formats | Scenes |
|---|---|---|---|
| `cta-hover` | The enter button | square, feed | hover-cta (HUMANS to ENTER) |
| `hero-line` | Human in the loop | square, feed | hero-line (HUMAN IN THE LOOP to LET'S CONNECT) |
| `loading-dashboard` | Your dashboard is loading | square, feed, story | loading-dashboard |
| `cta-then-loading` | Enter, then the dashboard | square, feed | hover-cta, loading-dashboard |
| `hero-then-cta` | Human in the loop, then enter | square, feed | hero-line, hover-cta |
| `site-tour` | A quick tour of HITLOOP | square, feed | hero-line, hover-cta, loading-dashboard |

Themes: `cycle` (default; dark then light then back), `light`, `dark`. Formats: square 1080x1080, feed 1080x1350, story 1080x1920. A 1-scene hover clip is 637 frames at 30 fps (about 21 s).

### Adding a focus
1. Compose it from existing scene kinds in `focus.json` (video repo) and copy the same object into `features/showcase/focus.hitloop.json`. Keep `formats` to ones every scene supports.
2. Add/adjust tests (`features/showcase/__tests__/`), redeploy the service (section 8), then ship the app change. Deploy the service first: the app would otherwise offer a focus the service rejects.

### Adding a scene kind
Write the scene module in `clients/hitloop/src/showcase/scenes/`, register it in `client.ts` (`catalog`), render locally with `npm run showcase -- hl --render <n>`, then as above.

## 6. Render service `showcase-render`

- Project `human-in-the-loop-a1a19`, region `us-central1`, NVIDIA L4 GPU, 8 vCPU / 32 GiB, `min 0 / max 1`, concurrency 1, request timeout 900 s, no CPU throttling, unauthenticated at the network layer (auth is the shared secret header).
- URL `https://showcase-render-639335240998.us-central1.run.app`. Current revision `00003`, image tag `bv-1794973240`.
- Endpoints: `GET /health`, `POST /render {jobId}` with header `x-render-secret` (constant-time compare; unset secret = closed). The request is held open until the job ends; the render continues even if the caller disconnects (the app aborts at 4 s by design).
- `EXIT_AFTER_RENDER=true`: the process exits after each render so a fresh instance serves the next one.
- SIGTERM mid-render marks the active job failed ("service terminated mid-render").
- Render kill switch: hard kill of the whole process group at 720 s (`RENDER_KILL_MS`).
- Env on the service: `RENDER_SHARED_SECRET`, `SHOWCASE_BUCKET`, `EXIT_AFTER_RENDER`, `USE_XVFB=true`, `RENDER_CONCURRENCY=4`. Firestore/Storage use the service account (ADC), no key.
- **The secret** is stored on bballi-server at `~/.config/showcase/secret` and as Vercel `SHOWCASE_RENDER_SECRET`. Never print or paste it.

### Why Vulkan + Xvfb, and why the blur is in WebGL
HITLOOP renders use `--gl=vulkan` through ANGLE, with Xvfb providing a display (`entrypoint.sh`). Software GL froze on GitHub runners, and CSS `backdrop-filter` rendered diamond artifacts, so the blur was moved into WebGL. Do not reintroduce CSS backdrop-filter in showcase scenes.

### Measured
HITLOOP: 637 frames in about 1.5 to 1.7 min render time. Cost about **$0.07 to $0.10 per render**. The UI hint says "about $0.10, 3 to 6 min" (includes cold start).

### Rejected: GitHub Actions
A GitHub Actions render was tried and rejected (85 min per clip). Leftovers still exist: Cloud Run job `showcase-spike-render`, bucket `human-in-the-loop-a1a19-showcase-spike`, branch `spike/actions-render`. Safe to delete when nobody needs the spike logs.

## 7. Firestore

| Collection | Doc | Fields (main) |
|---|---|---|
| `showcase_jobs` | `sc_...` | `v, jobId, clientId, videoClient, focusId, format, theme, title, caption, status` (`queued`, `rendering`, `done`, `failed`), `createdBy, createdAt, updatedAt, dayKey, triggerAt`; service adds `startedAt, attempts, spec, specHash, bucket, outputPath, downloadUrl, contentType, sizeBytes, width, height, fps, durationInFrames, renderMs, totalMs, finishedAt`; on failure `error:{stage,message}` (stages: `validate`, `render`, `upload`) |
| `showcase_state` | `{clientId}` | `dayKey, count, activeJobId` |
| `showcase_state` | `briefvideo_{clientId}` | CQ's own counter (see the CQ doc) |

No rules or index changes were needed (the list query is a single-field order by `createdAt`, filtered in memory).

## 8. Operate

**Render one**: dashboard as admin on HITLOOP, Creative Team, Site Showcase Video, OPEN, pick an option (Shuffle options for others), choose a theme, Render.

**Redeploy the service** (needed when the video repo, a focus or the CQ template changes):
- From the video repo checkout: `GCP_PROJECT=human-in-the-loop-a1a19 SHOWCASE_BUCKET=<bucket> RENDER_SHARED_SECRET=<existing secret> services/showcase-render/deploy-cloud-run.sh`. It builds with Cloud Build from the repo root (Dockerfile in `services/showcase-render/`; `.gcloudignore` ships only `bin/`, `package.json`, `clients/hitloop/`, `clients/critters-quest/`, `services/showcase-render/`), then `gcloud run deploy` with the flags in section 6. Passing a different secret desyncs Vercel: reuse the stored one.
- Existing image only (rollout or roll back to a built tag): `gcloud run deploy showcase-render --region us-central1 --image us-central1-docker.pkg.dev/human-in-the-loop-a1a19/cloud-run-source-deploy/showcase-render:<tag>`. `gcloud run deploy --image` keeps the service's existing env and GPU settings.
- After any redeploy: render one HITLOOP showcase and one CQ dry run to prove neither regressed.

**Roll back by revision**: `gcloud run revisions list --service showcase-render --region us-central1`, then `gcloud run services update-traffic showcase-render --region us-central1 --to-revisions <rev>=100`. Revision 00005 (image tag `cqhowto-*`, hitloop-video `feat/hitloop-showcase` e9277c1, 2026-11-18) is live and adds the CQ `cq-howto` job kind; gate-tested for both `cq-howto` and `cq-brief`. Revision 00003 is the previous known-good one (roll back to it if 00005 misbehaves). Revision 00005 also carries the tag `cqhowto` (direct URL for tests, no traffic of its own).

**Turn it off**: unset `SHOWCASE_RENDER_URL` in Vercel production and redeploy. `create` then returns 503 and nothing is queued. (Unsetting only the secret does the same.) The card stays visible but cannot start renders.

**Env (Vercel production)**: `SHOWCASE_RENDER_URL`, `SHOWCASE_RENDER_SECRET`, optional `SHOWCASE_MAX_RENDERS_PER_DAY`. `PILOT_CLIENT_IDS` gates `requirePilotOwner`; it is sensitive, and it was rewritten on 2026-11-17 as the documented list home + UE + NTR + paradice-dbBQCHUX because the previous value could not be read. Treat it as write-only: when you change it, rewrite the whole list from this doc.

## 9. Troubleshoot

| Symptom | Cause / action |
|---|---|
| Card missing | Not admin, or the effective client is not in `SHOWCASE_CLIENTS` (switch client with `?as=`) |
| 503 "not configured" | `SHOWCASE_RENDER_URL` / `SHOWCASE_RENDER_SECRET` unset in Vercel |
| 403 on create | Client not in `PILOT_CLIENT_IDS` or not in `SHOWCASE_CLIENTS` |
| 409 "already running" | An active job under 20 min old; wait or let it time out |
| 429 | Daily cap; raise `SHOWCASE_MAX_RENDERS_PER_DAY` or wait for UTC midnight |
| Job stuck `queued` | Trigger lost or service cold/busy; the status poll re-pokes after 20 s. Check `curl .../health` (no secret needed) and Cloud Run logs |
| Failed, stage `validate` | Focus/format/theme not in the service's focus.json: the two focus files drifted; redeploy the service |
| Failed, stage `render` | Read the service log: `gcloud run services logs read showcase-render --region us-central1 --limit 200`. "killed after 720s" = GPU/GL problem; "service terminated mid-render" = instance recycled |
| Failed "timed out" | Active over 20 min (service never claimed it or died) |
| Diamond / faceted blur in output | CSS backdrop-filter crept back in; blur must be WebGL |
| Test jobs (postId `gate-test-not-attached`) | Only used to gate-test CQ attach; stamped `attachSkipped` (see the CQ doc) |

## 10. Known gaps and next steps

- **P3b**: a daily HITLOOP showcase landing on the calendar as a draft (like Video Remix). Not built; today's flow never touches `social_posts`.
- **Site-detail scene**: `services/showcase-render/capture.mjs` and `capture-cli.mjs` exist (read-only Playwright capture of interactive elements of a live site, light/dark x idle/hover). Step 1 was verified: 159 candidates across the 6 default pages (`/`, `/work`, `/case-studies`, `/about`, `/services/web-development`, `/contact`). The theme storage key is localStorage `theme:pref:v1` (`light|dark|system`). No scene or focus uses it yet.
- **Other clients**: add a `SHOWCASE_CLIENTS` entry, a `focus.<client>.json` registered in `registry.js`, a client template in the video repo and a service branch in `buildSpec` (it currently hard-codes `videoClient === 'hitloop'`).
- The video repo branch `feat/hitloop-showcase` is **not merged to its main**; the service image is built from that branch.
- Cloud Run is a single slot shared with CQ brief videos.

## 11. Tests

`features/showcase/__tests__/options.test.js`, `registry.test.js`; `app/api/dashboard/showcase/__tests__/gate.test.js`; service tests in the video repo (`services/showcase-render/__tests__`, `npm test`).
