# Unified Content Studio — integration and migration plan

Status: proposed, implementation not started  
Date: 2026-07-22  
Proposed route: `/dashboard/studio-v2`  
Primary constraint: preserve every working Studio, Video Remix, Site Recreate, signup-video, and email-video path until the replacement is proven.

## Decision

Build a new, isolated Studio page that provides one authoring model and one timeline UI, then translates a saved Studio Project into the existing render pipelines through versioned adapters. Do not merge the render engines or replace the existing pages, cards, queues, workers, defaults, or email automations in the first release.

### Why this option

The features are complementary at the authoring layer but not yet interchangeable at the rendering layer:

- Mockup Video already has the canonical full-screen Studio, camera-keyframe timeline, website capture, Cloud Run GPU render, three output shapes, saved local templates, and an admin-controlled signup default.
- Holo Paper shares the page and visual language, but it is a separate client-side Three.js/MediaRecorder tool with its own settings and exports.
- Video Remix is a separate EditVideos/Firebase/GitHub Actions pipeline. Production is locked to a 720×720, 30-second MP4 made from exactly six ordered clips.
- The daily-email remix is code-owned and intentionally does not read the existing Video Remix UI settings.
- Site Recreate produces a verified static clone, Vercel preview, zip, managed demo/CMS, and optional permanent publishing. Its most useful Studio integration is as a website source, not as another visual effect.

A shared project model plus render adapters gives the user one Studio without making a risky “one renderer does everything” rewrite.

## Options considered

| Option | How it works | Upside | Downside | Effort | Reversibility |
|---|---|---|---|---|---|
| A. Expand the current `/dashboard/studio` page in place | Add Remix and Recreate directly to the current 3,000-line page | Fastest visible merge | Highest regression risk; couples more state to an already large live surface | Medium | Hard |
| B. New Studio page with shared project model and adapters | New UI and persistence; existing backends remain execution engines | Safest migration, supports gradual parity and rollback | Temporary duplication while the new page matures | Large | Easy |
| C. Build one new renderer first | Port Mockup, Remix, Holo, layers, and exports into one service before exposing UI | Clean theoretical endpoint | Long delay, cross-repo rewrite, greatest risk to working automation | Extra large | Hard |

Recommendation: **Option B**.

What this gives up: the first version will not make every control work in every mode. It will make compatibility explicit and preserve projects safely while the render adapters gain capabilities.

## Existing system inventory

### Canonical Studio shell

`app/dashboard/studio/page.jsx` is the UI standard and should remain the interaction reference:

- full-screen export artboard;
- Mockup Video ⇄ Holo Paper tool switch;
- desktop, mobile, and tablet device selection;
- landscape 1920×1200, square 1080×1080, and reel 1080×1920 output formats;
- camera keyframes, playhead, drag/retime, duration, playback, and saved local templates;
- collapsible inspector rail, captures, render console, and outcome toasts;
- server-side Mockup render recipe and admin “new-signup default.”

The new page should follow `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`; it should not invent a second editor language.

### Mockup Video render path

The working production path is:

`Studio/Dashboard → render_jobs → render-studio worker → studio-render-core → Cloud Run GPU → dashboard_state.studioCaptures`.

Important existing constraints:

- output duration is clamped to 2–12 seconds;
- FPS is clamped to 24–30;
- output size is bounded by the Studio render recipe;
- `siteSpeed` must remain 1 because other values desynchronize or wrap website scrolling;
- the variation engine runs at the shared render chokepoint unless `autoVary:false`;
- signup, Creative Brief, dashboard card, social/email consumers, and direct Studio runs already converge on this system.

### Video Remix and automated email video path

The working production path is:

`Studio/Dashboard/cron → media_jobs → EditVideos videoJobs → GitHub Action/FFmpeg → reconcile → dashboard_state.mediaCaptures`.

Important existing constraints:

- output is locked to 720×720, 30 FPS, 30 seconds;
- an explicit timeline requires one source folder and exactly six clip slots;
- the shared clip selector pins six clips and avoids recent repeats;
- look, overlay, top logo, end logo, audio, and final compositing live in the separate EditVideos worker repository;
- the daily-email recipe is currently code-owned in `pre-digest-video` and uses `skyline`, six clips, a B&W look, a top logo, and an end logo;
- daily email reuses a recent render only with an explicit stale warning;
- the GitHub dispatch must be awaited or jobs can miss the email send window.

### Holo Paper

Holo Paper is a lazy-loaded client-only Studio tool with its own local settings, materials, lighting, effects, artwork library, capture frames, PNG export, and browser-recorded video. It is visually complementary, but it does not currently participate in the server render queues or automated email pipeline.

### Site Recreate

Site Recreate is a separate admin workflow with its own legal attestation, job queue, verification gate, Cloud Run worker, Vercel preview, zip, hosted demo/CMS, and publishing flow. The safe Studio connection is:

`completed clone preview/managed URL → website source asset → Mockup Video scene`.

Site ownership attestation, verification, CMS, and publishing controls should remain in the Recreate workflow.

## Product model: one Studio, multiple compositions

The new page should expose four workspace modes:

1. **Website Mockup** — animate a live site, a recreated-site preview, or a managed-site URL inside the existing 3D device scene.
2. **Video Remix** — arrange six dynamically populated video slots, transitions, branding layers, audio, and an end card.
3. **Holo Paper** — create Holo Paper stills/videos and later use their renders as assets in Remix.
4. **Recreate Website** — show eligible clone jobs and a “Recreate a site” launch action; completed jobs become selectable Website Mockup sources. The full cloning workflow remains on its existing page/card.

These are modes inside one Studio navigation model, not a promise that every renderer accepts every control.

## Studio Project v1

Add a versioned project document rather than storing the new Studio only in component state or one localStorage object.

Suggested collection:

`studio_projects/{projectId}`

Suggested shape:

```js
{
  schemaVersion: 1,
  projectId,
  clientId,
  name,
  mode: 'website-mockup' | 'video-remix' | 'holo-paper',
  status: 'draft' | 'ready' | 'archived',
  canvas: {
    format: 'landscape' | 'square' | 'reel',
    width,
    height,
    fps,
    durationSeconds
  },
  source: {
    kind: 'live-site' | 'recreated-site' | 'media-folder' | 'uploaded-asset',
    url: null,
    cloneJobId: null,
    folder: null
  },
  timeline: {
    tracks: [
      { type: 'video', clips: [] },
      { type: 'transition', items: [] },
      { type: 'camera', keyframes: [] },
      { type: 'overlay', items: [] },
      { type: 'audio', items: [] },
      { type: 'end-card', items: [] }
    ]
  },
  assetBindings: [],
  renderer: {
    target: 'studio-render-v1' | 'editvideos-v1' | 'browser-holo-v1',
    settings: {}
  },
  validationSnapshot: null,
  createdAt,
  updatedAt,
  createdBy,
  updatedBy
}
```

Every saved project is editable. Every queued render also stores an immutable resolved snapshot of the project so an asset folder or default changing later cannot change what a historical render claims it used.

## Dynamic asset population

The six-slot Remix default should be represented directly on the timeline.

Default composition:

- 30 seconds total;
- six 5-second clip slots;
- five transition boundaries between the six clips;
- one top-logo overlay track that can span the full video or be overridden per slot;
- optional creative overlay/effect tracks;
- one audio track;
- one end-card region at the tail, with logo and text fields.

Each clip slot can be either:

- **Pinned** — exact asset ID/path, reproducible;
- **Dynamic** — a rule such as folder, media type, minimum size, tags, exclude-recent count, or random seed.

Before preview/render, dynamic bindings resolve into six explicit asset references. Show both states in the UI:

- `DYNAMIC · skyline · avoid last 3` before resolution;
- the selected thumbnail and filename after resolution;
- “refresh selection” to resolve again;
- “pin all” to freeze the current six.

Do not allow the production job to fall back silently from an invalid six-slot resolution to the worker’s implicit selection. A production profile should block and explain which slot cannot be filled.

## Timeline design

Reuse the current timeline’s visual and interaction language, but expand it from one keyframe track into stacked tracks.

Recommended default track order:

1. **Video** — six thumbnail blocks, draggable order, duration shown on each block.
2. **Transitions** — one control on each boundary; start with Cut, Crossfade, Dip to Color, and Wipe only after the renderer supports them.
3. **Camera / Motion** — website-mockup keyframes; hidden or read-only when irrelevant.
4. **Overlays** — top logo, per-clip logo opportunities, texture/effect layers, text, or uploaded artwork.
5. **Audio** — selected artist/mix/track, trim/start metadata when supported.
6. **End Card** — end logo, text, background, and duration.

The inspector rail edits the selected timeline object. The rail should not duplicate controls that belong on the timeline.

### Preview levels

Label preview fidelity explicitly:

- **Live Preview** — immediate browser approximation for layout, timing, layers, and transitions.
- **Render Proof** — short/exact backend render using the real target renderer.
- **Production Render** — full resolution, stored artifact, automation-safe.

For Remix, a browser preview cannot be described as pixel-identical until its FFmpeg filters and layers match the EditVideos worker. This must be visible in the UI.

## Compatibility and messaging

Every control declares support per renderer. Unsupported values are never discarded silently.

| Capability | Website Mockup | Video Remix v1 | Holo Paper | Recreated-site source |
|---|---:|---:|---:|---:|
| Landscape | Yes | No, blocker until v2 worker | Local/browser where supported | Via Website Mockup |
| Square | Yes | Yes, currently 720×720 | Yes | Via Website Mockup |
| Reel/vertical | Yes | No, blocker until v2 worker | Yes | Via Website Mockup |
| Editable six-clip timeline | No | Yes | No | No |
| Camera keyframes | Yes | No | Holo camera controls, separate schema | Via Website Mockup |
| Clip transitions | N/A | Requires worker extension | N/A | N/A |
| Top logo | New layer support needed | Yes | Artwork/HUD, not same contract | New layer support needed |
| End card | New layer support needed | Yes | New support needed | New layer support needed |
| Automated email render | Existing capture can be consumed | Yes | Not until server renderer exists | Via Website Mockup |
| Exact server preview | Yes | Full render only today | No | Via Website Mockup |

Validation levels:

- **Info** — supported but rendered differently by the selected engine.
- **Warning** — preview works, but production will clamp or approximate a value.
- **Blocker** — production cannot render the project as configured.

Examples of required copy:

- “Video Remix v1 exports square 720×720 only. Choose Square or switch to the experimental multi-format renderer.”
- “Mockup Video production supports 2–12 seconds. This 30-second timeline cannot be sent to that renderer.”
- “Video Remix production requires exactly six resolved clips from one folder.”
- “This transition is preview-only and will render as a cut in production.”
- “Holo Paper browser recording is not automation-safe. Export locally or choose a server-renderable mode.”
- “This website blocks live embedding. Render Proof still works because the server captures it directly.”
- “Today’s email render is not ready; sending now would reuse the labeled prior capture.”

The Render button remains disabled for blockers and opens a “Fix before rendering” list that deep-links to each invalid field.

## Defaults and automation profiles

Do not overload one “default” concept. Separate them:

1. **My last setup** — local convenience, per browser/user.
2. **Project template** — reusable saved project.
3. **Client default** — default project when opening the Studio for a client.
4. **Automation profile** — immutable/versioned pointer used by signup, daily email, social export, or other scheduled jobs.

Suggested collection:

`studio_automation_profiles/{profileId}`

Each profile stores `clientId`, `channel`, `projectId`, `projectVersion`, schedule/enabled state, freshness policy, fallback policy, and last successful render. “Save as new default” creates a new project version and moves the chosen pointer only after validation. It does not mutate already queued jobs.

The daily email should eventually point to an `email-daily-video` automation profile. Until migration is complete, its current code-owned recipe remains authoritative.

## Adapter architecture

Implement pure, tested adapters:

- `projectToStudioRenderV1(projectSnapshot)`
- `projectToEditVideosV1(projectSnapshot)`
- `projectToHoloBrowserV1(projectSnapshot)`

Each returns:

```js
{ ok, recipe, warnings, blockers, unsupportedFields, resolvedAssets }
```

Adapters are the only layer allowed to translate the unified project into existing backend recipes. Existing routes continue validating their native contracts as the final security boundary.

### Multi-format Remix

Do not loosen `media-recipe.cjs` v1 in place. Add a versioned contract and worker capability:

- preserve `editvideos-v1` at 720×720/30s/six clips;
- add `editvideos-v2` with an explicit allowlist of 1080×1080, 1080×1920, and 1920×1080 or the exact approved landscape size;
- define contain/crop/safe-area behavior per format;
- make logo size/position format-relative;
- make transition type/duration explicit;
- version end-card composition;
- deploy the EditVideos worker support before enabling the UI option;
- retain v1 as rollback and for historical re-renders.

The first Studio release should show non-square Remix formats as unavailable, not pretend they work.

## Site Recreate integration

Add a Source picker in Website Mockup:

- Live URL;
- Client website;
- Recreated site;
- Managed/hosted CMS URL.

For Recreated site:

- list only completed, verified clone jobs for the active client;
- show preview thumbnail, source URL, verification status, and last content update;
- “Use in Studio” sets the clone preview/hosted URL as the Mockup source;
- “Recreate another site” opens the existing Recreate flow in a new page;
- content editing, ownership attestation, download, CMS deployment, Arweave estimate, and publish remain outside the Studio.

This provides useful composition without duplicating a legally sensitive workflow.

## Safe implementation phases

### Phase 0 — freeze baselines and contracts

- Capture screenshots and smoke results for current `/dashboard/studio` in both tools and all three output shapes.
- Add contract fixtures for current Studio render recipes, signup default recipes, Video Remix recipes, six-clip selection, captures, and email freshness/fallback behavior.
- Record existing queue/status transitions for `render_jobs`, `media_jobs`, and `clone_jobs`.
- Add a short “do not change” inventory for the current routes, workers, cron schedule, collections, and card listeners.

Exit gate: the current working surfaces have repeatable tests and screenshots before new UI work begins.

### Phase 1 — isolated Studio v2 shell

- Create `/dashboard/studio-v2`, admin-only/feature-flagged.
- Reproduce the current Studio shell, artboard hierarchy, rail cards, timeline styling, render console, toasts, responsive behavior, and tool switch.
- Use fixture data only; no production mutations.
- Keep `/dashboard/studio` unchanged and linked as “Current Studio.”

Exit gate: visual parity and responsive smoke pass without importing or editing the live page’s state machine.

### Phase 2 — Studio Project persistence and validation

- Add `studio_projects` CRUD with client/owner authorization and schema-version validation.
- Add Save, Save As, duplicate, archive, version history, client default, and unsaved-change protection.
- Add compatibility registry and inline Info/Warning/Blocker messages.
- Store immutable render snapshots separately from mutable projects.

Exit gate: projects survive reloads and invalid configurations cannot enqueue a production job.

### Phase 3 — Video Remix timeline on the existing v1 backend

- Build the stacked six-slot timeline, dynamic asset bindings, thumbnails, order, logo/end-card/audio controls, and supported filter/overlay controls.
- Resolve dynamic selections through the existing shared clip selector.
- Implement `projectToEditVideosV1` and enqueue through the existing media route/queue.
- Square-only, exactly six clips, 30 seconds; non-square and unsupported transitions are blockers.
- Preserve awaited GitHub dispatch, reconcile behavior, captures, and stale email labels.

Exit gate: a Studio v2 square project produces the same valid native recipe and completed artifact as the existing Video Remix card.

### Phase 4 — Website Mockup adapter and Recreate source picker

- Implement `projectToStudioRenderV1` using the current camera timeline, environment, device, website scroll, and output formats.
- Set `autoVary:false` for an explicitly authored exact shot; leave automation variation policy configurable at the automation-profile level.
- Add verified clone/hosted site selection without modifying the clone pipeline.
- Continue writing normal `studioCaptures` so existing Brief, dashboard, email, social, and archive consumers still work.

Exit gate: all three Mockup formats render from Studio v2 and a completed recreated site can be used as a source.

### Phase 5 — render-proof preview and creative layers

- Add browser Live Preview for transitions/layers.
- Add exact Render Proof actions per backend.
- Extend only the selected backend contracts for approved layer types.
- Add top-logo spans, per-clip logo overrides, text/image layers, blend/opacity/position controls, and end-card duration/branding.
- Show preview fidelity and unsupported-field messaging at all times.

Exit gate: the user can tell which result is approximate versus production-exact, and no field is silently dropped.

### Phase 6 — versioned multi-format EditVideos worker

- Add and deploy `editvideos-v2` output-size, crop/safe-area, transitions, and format-aware logo/end-card support in the worker repo.
- Add v2 validation/mapping in Hitloop without changing v1 behavior.
- Enable Square, Reel, and Landscape only after worker capability detection and end-to-end render proofs pass.

Exit gate: six-clip videos render correctly in all approved formats while v1 jobs remain reproducible.

### Phase 7 — Holo Paper project integration

- Persist Holo settings as a Studio Project renderer payload.
- Let local Holo image/video exports register as Studio assets usable by Remix.
- If Holo is required for automated emails, build a deterministic server renderer before enabling that automation; browser MediaRecorder is not sufficient.
- Keep the current Holo tool available until server and v2 parity are proven.

Exit gate: Holo projects save/reopen, exported Holo assets can enter Remix, and automation remains blocked unless server-renderable.

### Phase 8 — automation migration and canary rollout

- Add automation profiles for daily email, signup video, and selected social exports.
- Start with one admin/client canary and `dryRun` recipe inspection.
- For daily email, compare v2-resolved assets/recipe with the existing code-owned recipe without changing the send.
- Then feature-flag one production automation at a time; retain the old recipe as immediate fallback.
- Surface last render, next render, selected default version, failure reason, reuse/fallback, and email freshness in Studio.

Exit gate: at least seven consecutive scheduled runs succeed per migrated profile, with fresh-artifact and fallback behavior verified.

### Phase 9 — optional cutover

- After parity, change navigation to make Studio v2 primary.
- Keep `/dashboard/studio` and the existing Video Remix card available behind an admin “Legacy tools” link for at least one release cycle.
- Remove or redirect old surfaces only after production metrics, renders, captures, emails, and rollback drills pass.

## Regression protection

- No edits to the current Studio page during Phases 0–2.
- No schema changes to existing `render_jobs`, `media_jobs`, `videoJobs`, or `clone_jobs`; add adapter snapshots/metadata only.
- No change to current cron timing or daily-email recipe until Phase 8.
- No replacement of `dashboard_state.studioCaptures` or `mediaCaptures`; existing consumers continue reading the same capture shapes.
- No renderer silently clamps a Studio Project. Adapter warnings/blockers must be shown before enqueue, while native backend validation remains authoritative.
- No cross-repo worker field is enabled in UI until the worker version that supports it is deployed and capability-checked.
- Preserve awaited EditVideos dispatch and current reconcile/freshness safeguards.
- Keep versioned defaults and immutable job snapshots so “Save as new default” cannot rewrite history.
- Run unit tests, build, Studio smoke, route smoke, visual checks, and one real canary render for every adapter phase.

## Operational and UI acceptance criteria

- The new Studio page can be developed without affecting the working Studio or card workflows.
- Default view is the timeline, not a settings form.
- Video Remix opens with six dynamically populated slots and visible transition boundaries.
- Top logos, per-clip logo opportunities, creative overlay layers, and end card are represented as timeline objects.
- Users can preview, modify, save as a project, save as a template, and—when authorized—promote a validated version to a client or automation default.
- Landscape, square, and reel are visible across the Studio; unsupported renderer/format pairs are disabled with a specific reason.
- A project that is too long, too large, missing clips, using unsupported transitions, or otherwise unsafe for production cannot enqueue.
- Existing signup videos, dashboard Video Promo, Video Remix card, Recreate workflow, captures, daily email, captions, archive, and social consumers continue operating throughout migration.
- Every production render can be traced to project ID, project version, resolved asset snapshot, native recipe, renderer version, job ID, and output capture.

## First implementation slice

Build only Phases 0–2 first: baselines, `/dashboard/studio-v2`, Studio Project persistence, the compatibility registry, and a fixture-backed six-track timeline. This creates the background workspace the user can review while all existing production features continue running untouched. Do not connect a production render button until the adapter returns a clean native recipe and the phase-specific contract tests pass.

