# Video Promo — Variation Engine + Render UX (SSOT)

Source of truth for how the **Video Promo card** produces a *unique* video on
every run, how that render is driven and surfaced, and the gotchas around it.
Written 2026-07-01. If this conflicts with older studio notes, this wins for the
variation + card-render-UX surface.

> **The imperative:** every render — Video Promo card button (admin), creative
> brief run, new-signup, social-post request, or email-digest run — must produce
> a **noticeably different** video, and it must show up in the card on command.

---

## 1. The single render chokepoint

Every trigger funnels through **one** function, so variation + storage live in one
place:

```
card RUN VIDEO ─┐
brief run ──────┤   POST /api/dashboard/studio-render        (client recipe)
signup ─────────┼─▶ createRenderJob(render_jobs) ─▶ trigger worker
social post ────┤            │
email digest ───┘            ▼
                   app/api/worker/render-studio/route.js  (claims job)
                             │
                             ▼
        api/_lib/studio-render-core.cjs → renderAndStoreStudioVideo()
                             │  ← varyRecipe() applied HERE (see §2)
                             ▼
                   Cloud Run GPU service  (services/studio-render, POST /render)
                             │  returns MP4 bytes
                             ▼
        saveBufferArtifact → appendCaptureRef →
        dashboard_state/{clientId}.studioCaptures   (capped 40; card reads this)
```

Because variation is applied **inside** `renderAndStoreStudioVideo` (not in the
card), every entry point gets it for free. The `render_jobs` doc stores the
*original* client recipe; the *varied* recipe is what's POSTed to Cloud Run and
what the capture's `variantLabel` reflects.

Key files:
- Client trigger + terminal: `DashboardPage.jsx` → `runMockupStudioVideo`
- Route: `app/api/dashboard/studio-render/route.js` (creates job, returns `202 {jobId}`)
- Worker: `app/api/worker/render-studio/route.js`
- Core + wiring: `api/_lib/studio-render-core.cjs`
- **Variation engine: `api/_lib/studio-recipe-variations.cjs`**
- Render service: `services/studio-render/{render,scene,recipe}.mjs`

---

## 2. Variation engine — `api/_lib/studio-recipe-variations.cjs`

Pure, stateless, no I/O. `varyRecipe(recipe, index, rngOverride?) → {recipe, label, index}`.
The render service (`recipe.mjs → normalizeRecipe`) re-clamps everything, so this
only edits the recipe — **no render-service redeploy needed** to change variation.

### Two hard rules (from the product ask)
1. **Zoom IN only.** The camera never pulls back past the point where the device
   mockup *fills the frame*; within a clip the radius is strictly non-increasing.
   No "whole device sitting in empty margin" shots.
2. **Corner dives.** From the fill framing it zooms into a random corner
   (TL/TR/BL/BR) at a varied angle, with randomized pacing.

Plus the **background is randomized** each render.

### The zoom cap — `fillRadiusFactor(viewport, outW, outH)`
`pose = [radiusFactor, azimuthDeg, elevationDeg, targetXFrac, targetYFrac]`;
camera distance = `camZ × radiusFactor` (smaller = closer). The cap = the
`radiusFactor` where the device (incl. bezel) just fills the frame on its tighter
axis, computed from the 38° vertical FOV + output aspect + device geometry:

| viewport | fill cap `radiusFactor` |
|----------|--------------------------|
| desktop  | ~0.50 |
| mobile   | ~0.73 |
| tablet   | ~0.82 |

`VP_GEOM` in the module is a **mirror of `services/studio-render/scene.mjs`
`VIEWPORTS`** (width/height/bezel/camZ) + `FOV_DEG = 38`. ⚠️ **Keep both in sync**
— if scene.mjs camera or device geometry changes, update `VP_GEOM`/`FOV_DEG`.

Every generated keyframe radius is `≤ fill × 1.0` and the track is sorted so radii
only shrink → guarantees rules 1+2. (Verified: 200-render sweep, 0 cap violations,
0 zoom-outs.)

### Camera move — `buildCornerZoomTrack(rng, fill)`
- `rStart = fill × [0.9,1.0]` (widest, ~fills), `rEnd = fill × [0.55,0.72]` (tightest).
- Opens filling/centered (small `reach`), ends tight on a corner (larger reach + angle).
- Azimuth `corner.tx × [8,22]°`, elevation `corner.ty × [4,13]°`.
- 2 or 3 keyframes (random); pacing via `warpTrack(track, gamma∈[0.7,1.4])` — `t' = t^gamma`,
  endpoints fixed, so it re-times the move (perceived speed) without changing radii/targets.

### Background — `BACKGROUNDS`
Randomizes `recipe.environment`: `brand` (gradient) · `studio` · `sunset` (gradient
presets) · `loft` · `airport-terminal` · `desk` (photo webp scenes, assets in
`services/studio-render/assets/environments/`). **`device.backdrop` is NOT rendered
by the scene — `environment` is the only background lever.** The environment is
built fresh (`{...bg.env, reflections:true}`) so no stale base preset bleeds through.

### ⚠️ `output.siteSpeed` is BANNED as a variation lever
`scene.mjs:176` scales captured-site-frame playback by `SITE_SPEED`:
```js
idx = liveFrameStart + (Math.floor((f/(total-1))*(playableCount-1)*SITE_SPEED) % playableCount)
```
- `siteSpeed < 1` → never reaches the last captured frame → **scroll never hits the bottom**.
- `siteSpeed > 1` → the `% playableCount` **wraps → scroll jumps back to top mid-clip**.

Both break "always scroll to the bottom." So variation **never touches siteSpeed**
(left at 1); speed = camera pacing (`warpTrack`). Scroll is always `target.percent:100`,
`arriveAt ≤ 1`. This was a real bug we hit and fixed — do not reintroduce it.

### Randomness / rotation
- Seeded `mulberry32(index)` PRNG where `index` = a **per-client counter**
  `dashboard_state.studioVariantIndex`, atomically incremented by
  `nextStudioVariantIndex(clientId)` in `studio-render-core.cjs` (best-effort;
  falls back to a time seed). Seeded (not `Math.random`) so a given index is
  **reproducible** for debugging, yet every render advances the counter → always
  different from the last.
- Opt out per render with `recipe.autoVary === false` (e.g. an explicit
  hand-authored Studio shot that must render exactly).

### Wiring in `renderAndStoreStudioVideo`
- Reads/increments the counter → `varyRecipe` → replaces the recipe before the
  Cloud Run POST.
- Stamps `variantLabel` on the capture ref (`label: "Cloud GPU Mockup Video · <variant>"`)
  and metadata, so you can see which shot each stored capture is.
- Locked/signup recipe (`buildLockedStudioRecipe`) is `seconds: 10` (was 8) — a
  longer, calmer scroll (more frames, smaller per-frame delta = smoother).

---

## 3. Render-service calibration (twitch fix)

Twitch cause: `scene.mjs:176` maps each output frame to the **nearest** captured
site frame (`Math.floor`, no interpolation). When captured frames `playableCount`
< output frames `total = fps×seconds`, each captured frame repeats for several
output frames → chunky, "twitchy" scroll.

Fixes (in `services/studio-render/render.mjs`, **needs Cloud Run redeploy**):
- **`everyNthFrame: 2 → 1`** on `Page.startScreencast` — capture every composited
  scroll frame (the rAF smooth-scroll is already dense; we were under-sampling it).
- Longer clip (`seconds` bump above) — more capture time + slower scroll.

Deployed via `services/studio-render/deploy-cloud-run.sh`
(`GCP_PROJECT=human-in-the-loop-a1a19 RENDER_SHARED_SECRET=<matches app secret>`).
Live as revision `studio-render-00031-b4z` (2026-07-01). See
`services/studio-render/README.md` → "Scroll & capture behavior".

---

## 4. Card render UX — `DashboardPage.jsx`

### Terminal: minimize → RUNNING pill → reopen
Closing a *running* render terminal must not destroy it. `adhocTerminal` carries an
`open` flag; the `[ ✕ ]` handler branches on status: `running` →
`minimizeAdhocTerminal` (`open:false`, render keeps going), `done`/`error` →
`closeAdhocTerminal` (state → `null`). When minimized, `#adhoc-run-status-pill`
(fixed, bottom-right) shows live status and reopens via `reopenAdhocTerminal`. The
`done` auto-close (4s) only fires while `open` so a result that finished minimized
isn't lost. Full spec: `docs/dashboard-ui/DASHBOARD_MODAL_CARD_UI_GUIDE.md` →
"Run Terminal — minimize & reopen".

### Terminal shows REAL progress (not a timer)
`runWithTerminal({..., task})` passes a `{ advance, note }` channel to `task`. The
cosmetic staged timer runs until the **first `advance()`**, then freezes so the
terminal reflects reality. `runMockupStudioVideo`'s task drives it off the actual
`render_jobs` status (`queued` → `rendering` → `done`/`failed`; requeue → note).
Tasks that ignore the arg (Video Remix, Generate Report) keep the old timer —
backward-compatible.

### Card live-refresh — `studioCaptures` listener (`DashboardPage.jsx` ~line 7335)
An `onSnapshot` on `dashboard_state/{cid}` merges **only** `studioCaptures` /
`mediaCaptures` / pending markers into `bootstrap.dashboardState` (cherry-picked so
raw Firestore Timestamps never clobber the serialized bootstrap shape). ⚠️ This is
**intentionally NOT gated by `isImpersonating`** — an admin who requests a render
for a client they're viewing must see it land live; the merge is fully scoped to
`cid` (the effective/impersonated client), so it's safe. The card's
`latestStudioVideo` (~line 7613) reads the newest matching `studio_video` capture
(filtered by client `sourceUrl`; admin falls back to newest-any).

---

## 5. ⚠️ Dev gotcha — server-side `.cjs` is cached; RESTART after editing

`studio-recipe-variations.cjs` and `studio-render-core.cjs` are CommonJS required
through `createRequire` in the worker route chain. **Node caches them in the
running dev process; Next Fast Refresh does NOT reload them.** After editing either,
**restart `npm run dev`** or renders keep using the old module (symptom: new
variation code on disk but captures still show old variant labels / unchanged
background). This bit us — every render looked identical until the restart.

---

## 6. Env config — which render service the app hits

`.env.local`:
- **Cloud Run (prod GPU, default):** `STUDIO_RENDER_URL=https://studio-render-639335240998.us-central1.run.app`,
  `STUDIO_RENDER_SECRET=<hex>`.
- **Local service:** `STUDIO_RENDER_URL=http://localhost:8787`, `STUDIO_RENDER_SECRET=localdev`,
  and run `cd services/studio-render && PORT=8787 STUDIO_RENDER_SECRET=localdev npm start`
  (needs a real GPU or the WebGL hero renders blank — see the render README).

The app sends `STUDIO_RENDER_SECRET` as the `x-render-secret` header; it MUST equal
the service's `RENDER_SHARED_SECRET` (`server.mjs`) or every render 401s.

---

## 7. Diagnostics — confirm a render landed

Renders are async; "nothing in the card" is usually still-rendering or a stale
in-memory `dashboardState`, not a lost video. To confirm where it went:

**Cloud Run got the request?**
```
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="studio-render"' --freshness=30m \
  --format="value(timestamp,textPayload,httpRequest.requestUrl,httpRequest.status)"
```
Look for `POST /render → 200`, `[gpu] … ✓ GPU`, `[scroll] … scrollY=<n>`.

**Where the capture stored (Firestore):** a throwaway node script that loads
`.env.local` and uses `api/_lib/firebase-admin.cjs`:
- `render_jobs` (newest): `status`, `clientId`, `error`, `capture` present?
- `dashboard_state/{clientId}.studioCaptures`: count, newest `capturedAt` /
  `variantLabel` / `environmentPreset` / `sourceUrl`.

If `render_jobs.status=done`, `capture=YES`, and the capture is in
`dashboard_state.studioCaptures` → the pipeline worked and the issue is purely the
card not re-reading (see §4 listener / §5 restart).

---

## 8. Verified checklist (2026-07-01)
- Renders reach Cloud Run (200/GPU) and scroll to the bottom.
- Captures land in `dashboard_state/{clientId}.studioCaptures`, one unique variant per run.
- Variation: 0 zoom-cap violations, 0 zoom-outs, all 4 corners + all 6 backgrounds rotate, deterministic per index.
- `siteSpeed` never set by variation; scroll always reaches percent 100.
- Terminal minimizes to a reopenable pill; shows real job status.
- Card listener updates during impersonation.
- Open item at time of writing: dev server needed a restart to load the current variation module.
