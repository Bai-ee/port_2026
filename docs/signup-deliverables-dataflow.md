# Signup Deliverables — Dataflow Reference

How a **new client signup** (`brief_runs.trigger = 'signup'`, also `'creative-brief'`) produces the
four launch deliverables and lands each one in its DELIVERABLES-bucket card.

Surface note: a signed-up **client** sees `DashboardPage.jsx` (the regular dashboard).
`LeadGenDashboard.jsx` is the **admin leadgen tool** over prospects (`leadgen_prospects/*`,
normalized by `app/api/leadgen/onboard/route.js`) — **not** in the signup path. Ignore it here.

## Run scope on signup

`app/api/worker/run-brief/route.js:210-217` — the narrow Creative Brief run.
For `trigger` `signup` / `creative-brief`, only two modules run:

```
moduleIdsToRun = ['multi-device-view', 'social-preview']
```

Plus the studio video render at `run-brief/route.js:374-392` (triggers: signup / reseed / creative-brief),
and the inline onboarding cover summary at `run-brief/route.js:588-595`.

> ⚠️ Success gate caveat: the run is marked `succeeded` when `anyOk` (one module ok) is true
> (`run-brief/route.js:394`). A run can be `succeeded` with individual deliverables failed.
> Trust the per-deliverable readiness gates below, **not** `run.status`.

## The four deliverables

Each row: client CARD → readiness GATE (`DashboardPage.jsx`) → `dashboard_state` FIELD → PRODUCER → known failure.

### 1. Multi-Device Mockup
- **Card:** "Multi-Device Mock" — `DashboardPage.jsx:7174` (DELIVERABLES bucket)
- **Gate:** `cbMockupReady` — `DashboardPage.jsx:5849`
  `Boolean(dashboardState.artifacts.homepageDeviceMockup.downloadUrl)`
- **Field:** `dashboard_state/{clientId}.artifacts.homepageDeviceMockup`
- **Producer:** `multi-device-view` module → projected by
  `run-lifecycle.cjs:projectScreenshotArtifacts()` line 813-815 (`deepSet(..., ['artifacts','homepageDeviceMockup'], ...)`)
- **Status:** WIRED.

### 2. Full-Page Screenshots
- **Card:** Cross-device views row on the Creative Brief card — `DashboardPage.jsx:7783`
  (also drives `intakeFullScreens` previews)
- **Gate:** `cbScreensReady` — `DashboardPage.jsx:5850`
  `_cbFp['desktop-full'|'tablet-full'|'mobile-full'].downloadUrl` **fallback** `artifacts.homepageScreenshots.desktop.downloadUrl`
- **Field:** `dashboard_state/{clientId}.artifacts.fullPageScreenshots` (`{desktop-full,tablet-full,mobile-full}`)
- **Producer:** `multi-device-view` module → `run-lifecycle.cjs:projectScreenshotArtifacts()` line 804-810
- **Status:** WIRED.

### 3. Social Preview
- **Card:** "Social Preview" — `DashboardPage.jsx:7090` (DELIVERABLES bucket)
- **Gate:** `cbSocialReady` — `DashboardPage.jsx:5851`  `Boolean(dashboardState.siteMeta.ogImage)`
- **Field:** `dashboard_state/{clientId}.siteMeta` (also mirrored to `onboard.socialPreview.siteMeta`)
- **Producer:** `social-preview` module → `run-lifecycle.cjs:projectModuleResult()` line 830-838
  (writes top-level `siteMeta` + `onboard.socialPreview`)
- **Known failure:** `site_meta_missing` — target site has no OG/Twitter meta tags. Module returns
  `ok:false`, gate stays false, card shows the pending shell. (Seen on clairecalles.com.)

### 4. Studio Motion Video
- **Card:** "Video Promo" — `DashboardPage.jsx:6802-6804` (DELIVERABLES bucket)
- **Gate:** `cbVideoReady` — `DashboardPage.jsx:5852`
  `studioCaptures.some(c => c.type==='studio_video' && c.downloadUrl)`
- **Field:** `dashboard_state/{clientId}.studioCaptures[]` (appended array, last 40)
- **Producer:** `studio-render-core.cjs:renderAndStoreStudioVideo()` → `appendCaptureRef()` line 26-35.
  Calls the Cloud Run GPU service (`STUDIO_RENDER_URL`). Failure is swallowed non-fatal in the worker
  (`run-brief/route.js:385-391` → event "Motion mockup will retry on a later run").
- **Known failure:** render service returned `"no frames captured from target site"`
  (recorded in `render_jobs/{id}.error`, NOT in run events). Gate stays false. (Seen on clairecalles.com.)

## Composite gate

`creativeBriefReady = cbMockupReady && cbScreensReady && cbVideoReady && cbSummaryReady`
— `DashboardPage.jsx:5854`. (Note: social preview is its own card, **not** in this composite.
`cbSummaryReady` = the onboarding cover copy from `generateBriefSummaries`.)

## Verification checklist (run after a fresh signup)

For `clients/{clientId}` after the signup run completes, confirm in `dashboard_state/{clientId}`:

| Deliverable | Pass condition |
|---|---|
| Mockup | `artifacts.homepageDeviceMockup.downloadUrl` present |
| Screenshots | one of `artifacts.fullPageScreenshots['{desktop,tablet,mobile}-full'].downloadUrl` present |
| Social Preview | `siteMeta.ogImage` present |
| Video | `studioCaptures[]` has an entry `type==='studio_video'` with `downloadUrl` |

If a condition fails, check the producer:
- Social → `dashboard_state.modules['social-preview'].lastErrorCode` (`site_meta_missing` = site has no OG tags)
- Video → `render_jobs` where `clientId == X`, latest `.error`
- Mockup / Screenshots → `dashboard_state.modules['multi-device-view'].status` + `lastErrorMessage`

## Known producer gaps (triage separately)

1. **Studio render "no frames captured"** — Cloud Run GPU capture fails on some sites. Swallowed silently;
   only `render_jobs.error` records it. Candidate causes: site blocks headless, slow paint vs `capture.warmupMs:1000`,
   bot wall. Needs Cloud Run capture-log investigation.
2. **`anyOk` success gate hides per-deliverable failure** — run reports `succeeded` while video/social are absent.
   No client-facing retry surfaced for the failed deliverable.
