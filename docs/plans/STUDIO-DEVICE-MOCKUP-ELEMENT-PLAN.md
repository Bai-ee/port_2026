# Studio Device Mockup Element — Plan (Mockup Video devices inside HOLO PAPER)

**Status:** PLAN — not implemented. Stop after each phase for review.

**Repository:** `/Users/bballi/Documents/Repos/Bballi_Portfolio`

## Objective

Bring the Mockup Video pipeline's device mockups (desktop-with-stand / phone / tablet) into the HOLO PAPER scene (`ClothStudio.jsx`) as a catalog element, including the ability to point the device screen at a **website URL** — so devices showing a live-captured site render inside the studio's engine (cloth, glass, elements, Diffusion Camera, effects chain, PNG/MP4 export).

## Current relevant architecture (verified in-repo)

- **Device models are procedural, not GLB** — `services/studio-render/scene.mjs` builds each device in ~6 meshes: `RoundedBoxGeometry` body + rounded-rect glass face + screen plane (`CanvasTexture`), plus stand (desktop) or camera pod (mobile/tablet). `VIEWPORTS = { desktop: 1440×900, mobile: 390×844, tablet: 768×1024 }` with bezel/corner/depth constants. Direct port candidates.
- **`RoundedBoxGeometry` is already in the studio's stdlib bundle** (`ClothStudio.jsx` ~L2603) and already used by a factory (Translucent Monoliths, `factories.js` ~L268). No new dependency.
- **URL → screenshot capture already exists as an authed Vercel route:** `app/api/dashboard/studio-capture/route.js` (`verifyRequestUser` + client context → `captureScreenshotBuffer` in `api/_lib/browserless.cjs` → stored artifact + ref appended to `dashboard_state.{clientId}.studioCaptures`, max 40, listable). Same three viewports as the device models. `browserless.cjs` already has **fullPage** screenshot variants.
- The Cloud Run scroll-frame sequence capture (`render.mjs` CDP scroll recording) is NOT available as a Vercel API and is out of scope — see "scroll" below for the substitute.
- Element system contract: `elements/catalog.js` (`fieldSpec`, bounds, `finalRenderSupported`), `elements/factories.js` (`{create, applyInstance, animate, dispose}`), sanitize/persist via `scene-recipe.js`, upload precedent `components/LogoArtworkControl.jsx` (original-bytes data URL, browser-local library).
- HOLO PAPER is a **public** tool; `studio-capture` requires login. Browserless captures cost money and are ledgered in `browserless_requests` (Operating Cost card reads it).

## Proposed direction

New catalog element **`device-mockup`** ("Device Mockup"):

1. **Geometry:** port `scene.mjs`'s device build verbatim into a factory, uniformly scaled from pixel units to studio world units (≈ 1/1000; desktop ≈ 1.5 wu wide). One `viewport` field (`desktop` | `mobile` | `tablet`) switches the variant. Materials: same alum/glass `MeshPhysicalMaterial` recipe, `envMapIntensity` tuned to the studio light rig.
2. **Screen content — three sources, one field (`screenSource`):**
   - `placeholder` (default): built-in generated UI texture, works for anonymous public users.
   - `upload`: user image via the LogoArtworkControl pattern (browser-local library, size caps).
   - `capture` (**the URL feature**): a URL input in the Inspector captures ANY website — **no login required** (owner decision, 2026-07-31). Because `studio-capture` is hard-wired to `verifyRequestUser` + client context, Phase 2 adds a small PUBLIC capture route instead (e.g. `app/api/public/studio-site-capture`) that reuses `captureScreenshotBuffer` + `validateUrl` (SSRF guard) with cost guardrails: per-IP rate limit, a daily global cap, and result caching by URL+viewport so repeat captures of the same site are free. Captures remain ledgered in `browserless_requests` (visible on the Operating Cost card). Logged-in users additionally get their stored `studioCaptures` picker.
3. **Scroll without frame sequences:** the Cloud Run pipeline plays N captured scroll frames; in-browser we instead map the **tall fullPage screenshot** onto the screen plane and animate `texture.offset.y` in `animate()` (`scrollSpeed`, `scrollLoop` fields). Smooth, zero server load per frame, and visually equivalent for a mockup. True DOM-scroll frame parity stays a later, separate proposal.
4. **Everything else is free:** the element joins Diffusion Camera focal targets automatically (`listDiffusionFocalTargets` lists enabled instances), composes with bloom/diffusion/treatment, and appears in PNG/MP4 export since it's an ordinary scene object. `finalRenderSupported: false` (cloud 4K art render whitelist), same as portal-plane.
5. **Persistence:** instance stores `viewport`, screen fields, and either `captureUrl` (small remote URL — safe inside local + cloud Scene Templates) or `uploadAssetId` (browser-local only; deterministic placeholder fallback when absent, mirroring the GLB-import limitation).

## Keep vs change

- Keep: Mockup Video card + Cloud Run service untouched; `studio-capture` route reused as-is (add nothing server-side in Phase 1–2 unless the fullPage variant needs a param exposed); all existing elements.
- Add: one factory + catalog entry, one Inspector control (URL input + capture picker + upload), scroll animation, tests.
- Do NOT touch: `services/studio-render/*`, `renderAndStoreStudioVideo`, Proof Render, T-shirt/cloth systems.

## Files likely involved

- `app/dashboard/studio/elements/catalog.js` — `device-mockup` entry (fieldSpec: viewport, screenSource, scrollSpeed/scrollLoop, motion, presets)
- `app/dashboard/studio/elements/factories.js` — `deviceCreate/ApplyInstance/Animate` (geometry port from `scene.mjs`), texture load/dispose
- `app/dashboard/studio/components/DeviceScreenControl.jsx` — new Inspector control (URL field + Capture button + stored-captures picker + upload)
- `app/dashboard/studio/components/StudioElementInspector.jsx` — register control kind
- `ClothStudio.jsx` — auth/client-context availability flag for the capture UI; upload library key
- `elements/scene-recipe.js` / `preset-kinds.js` / `scope-randomize.js` — field sanitize + ranges (randomize pose/motion only, never the URL/asset)
- Tests: `elements/__tests__/` (schema auto-coverage + factory + sanitize round-trip + missing-source placeholder)

## Risks

- **Texture CORS:** the stored capture artifact URL must be loadable with `crossOrigin='anonymous'` for WebGL use; if the storage bucket lacks CORS headers, proxy the bytes through a small same-origin GET on the existing route instead. Verify early in Phase 2 — this is the most likely surprise.
- **Cost/abuse surface:** captures are paid browserless calls on a public page (login gate removed by owner decision). Mitigations are mandatory in Phase 2: `validateUrl` SSRF guard, per-IP rate limit, daily global cap, URL+viewport result cache. `browserless_requests` ledger keeps spend visible on the Operating Cost card.
- Scale/lighting mismatch porting pixel-scale geometry into the unit-scale studio — needs live calibration against the cloth/glass (same class of correction as portal-plane's ring resize).
- Tall fullPage textures can exceed GPU max texture size on very long pages — clamp capture height or downscale on load.
- localStorage quota for uploads (existing caps pattern).

## Recommended phase order

1. **Phase 1 — device element core:** geometry port (all 3 viewports) + placeholder screen + scroll animation of the placeholder + fields/presets/tests. No network. Live-verify scale/lighting.
2. **Phase 2 — screen sources:** URL capture via `studio-capture` (fullPage variant + CORS verification + stored-captures picker, auth-gated UI) and image upload. Placeholder fallback tests.
3. **Phase 3 — polish:** curated presets (desk hero shot, leaned phone, tablet stand pairing with existing elements), randomize ranges, Scene Template round-trip (local + cloud), live acceptance evidence incl. Diffusion Camera focused on the device screen.

**Approval recommendation:** approve Phase 1 only; review the device in the live scene before wiring any network source.

---

## Phase 1 — SHIPPED (2026-07-31, uncommitted)

- `elements/factories.js`: `DEVICE_VIEWPORTS` (scene.mjs port at 1/1000 scale, per-viewport `nf` normalization to ≈0.9 wu), `deviceRoundedRectGeo` (UV-remapped rounded rect), `makeDeviceScreenTexture` (96×288 DataTexture placeholder site, accent-colored, DOM-free for node tests), full factory registered as `device-mockup`. Scroll = smoothstep ping-pong of `texture.offset.y` over a 3-screen page; sway = motion-group Y rotation.
- `elements/catalog.js`: `device-mockup` entry (category `media`, `finalRenderSupported: false`, `bounds.localRadius: 0.65`, DEVICE/SCROLL/BODY TONE/SITE ACCENT/SWAY controls, 3 presets, randomize ranges — viewport deliberately not randomized).
- `elements/placement.js`: anchor `{ xSign: -1, ySign: -1, depth: 'background' }` (foreground at this radius is the metaball-bloom Square/Reel trap).
- `components/StudioElementInspector.jsx`: new generic `kind: 'select'` control (reads `ctrl.options`) — first generic enum control in the Inspector.
- Tests: 3 dedicated device tests added to `factories.test.js` (viewport hardware counts, rebuild-vs-live-update semantics incl. accent redraw, scroll/park/sway animate semantics) + automatic generic-loop/schema coverage. Full Studio suites **1010/1010 pass**.
- Live-verified on localhost:3055: added via ADD ELEMENT, desktop (stand + placeholder site w/ accent CTA/cards) and phone (pod, tall body) both render, viewport switch rebuilds live, no console errors. A demo instance was left in the owner's scene.
- Not done (Phase 2+): URL capture (public route + guardrails), image upload, capture picker.

## Phase 2 — SHIPPED (2026-07-31, uncommitted): public website→screen capture

- **Route `app/api/public/studio-device-capture/route.js`** (shared `maxDuration = 120` tier — no novel Hobby function group): `POST { url, viewport }` → SSRF-validate (`safe-fetch.cjs validateUrl`, https default-prefixed) → 24h URL+viewport cache check → quota consume → browserless **full-page** capture (`desktop-full`/`mobile-full`/`tablet-full` variants; `clientId: 'public-studio'`, ledgered in `browserless_requests`) → Storage at `public/studio-device-captures/<sha1>.<ext>` + cache doc. `GET ?id=` streams the stored bytes **same-origin** (`cache-control: public, max-age=86400`) — the CORS risk from the plan is eliminated by construction, not configured around. Stale cache is served as an honest fallback when a recapture fails.
- **Guardrail module `api/_lib/studio-device-capture.cjs`** (DI seam `__setTestContext`, same as proof-render-jobs): Firestore collections `studio_device_captures` (cache) + `studio_device_capture_quota` (per-UTC-day doc). Limits: 20/day per hashed IP, 200/day global; quota consumed pre-capture and never refunded (refunds would let an always-failing URL bypass the cap). 6 tests in `api/_lib/__tests__/studio-device-capture.test.js`.
- **Element wiring:** `appearance.captureUrl` (string ≤300, default '' = placeholder; carried safely by local+cloud templates — never bytes). Factory `deviceSyncScreenTexture` (browser-only async TextureLoader; race-guarded via `appliedCaptureUrl`; failed loads keep the placeholder and re-arm retry) + exported `deviceScreenRepeatFraction` — page-length-aware `texture.repeat.y` so scroll shows an undistorted viewport-shaped window (clamped for short pages). `deviceAnimate` scrolls whichever texture is live using the stored fraction.
- **UI:** `components/DeviceScreenControl.jsx` (WEBSITE SCREEN — URL input + Capture + Use placeholder, plain fetch, no auth) behind a new generic `device-screen` control kind in `StudioElementInspector.jsx`.
- **Tests:** studio suites 1018/1018; `api/_lib` 233/233.
- **Live-verified (localhost:3055):** captured `vercel.com` desktop full-page through the real route — real homepage readable on the device screen, scrolling; repeat POST returned `cached: true` (no second browserless spend); no console errors.
- Not done (Phase 3): image upload, stored-captures picker, curated presets, cloud-template round-trip evidence.

## Phase 3 — SHIPPED (2026-07-31, uncommitted): upload source + recent-captures picker + diffusion evidence

- **Upload screen source:** `appearance.uploadAssetId` (string ≤64) referencing a new browser-local library `holocloth-device-screen-library-v1` (ClothStudio `deviceScreenLibrary` state + `addDeviceScreenImage`/`deleteDeviceScreenImage`, ref-synced `persisted` outcome — exact clone of the T-shirt logo library mechanics). Resolved in the factory via `ctx.deviceScreenAssetsById` (mirrors `logoAssetsById`); `deviceWantedScreenSource` (exported, tested) encodes priority **upload > capture > placeholder**, with a missing library entry falling back to the PLACEHOLDER (never a stale capture). `shouldSyncElementEntry` gained a third recheck flag `deviceScreenNeedsRecheck` (scene-elements.js) so a library deletion propagates to every instance, same contract as `tshirtLogoNeedsRecheck`; sync effect deps include `deviceScreenLibrary`.
- **Recent-captures picker:** component-local list in `DeviceScreenControl` (`holocloth-device-captures-recent-v1`, max 8) — one-click "Use" re-applies a previous capture with zero server calls (the serving GET is CDN/24h-cached). Deliberately NOT ClothStudio state: convenience list, not an asset store.
- **Single-active-source rule:** every selection in the control writes BOTH fields (select upload → clears captureUrl, capture → clears uploadAssetId, Use placeholder → clears both), so the factory's priority order is a safety net, not a UX path. Upload caps mirror LogoArtworkControl (3MB, PNG/JPEG/WebP); a quota-exceeded save is reported honestly ("gone after reload").
- **Tests:** +3 (source priority/fallback, captureUrl+uploadAssetId normalize round-trip — what templates/settings persist — and the new recheck flag). Combined studio + api/_lib: **1248/1248 pass**.
- **Live-verified (localhost:3055):** 800×2400 generated PNG uploaded through the real file input → scrolls on the device screen; RECENT CAPTURES listed vercel.com and "Use" re-applied it; **Diffusion Camera focused on the device instance** (max-ish settings) rendered the device's on-screen site text crisp while the primary cloth blurred — the focal-target dropdown picks up the element automatically, zero extra wiring. No console errors. Owner's diffusion settings restored to shipped defaults afterward.
- Remaining (unclaimed, propose separately if wanted): curated-set authoring that pairs a device with existing elements; Cloud Scene-Template round-trip was covered at the normalize layer only, not exercised against the live cloud endpoint.

## Phase 4 — SHIPPED (2026-07-31, uncommitted): Device as PRIMARY SHAPE (hero/focal subject)

Owner direction: the device should REPLACE the paper/flyer as the scene's main element — the Mockup Video framing (steady centered device, site playing on screen) inside HOLO PAPER's engine.

- **Third Sheet Shape:** Images card's SHEET SHAPE row gains **Device** (`#cloth-sheet-shape-device-btn`) next to the aspect presets and T-Shirt. `clothShape === 'device'` disposes the flyer (the existing non-'sheet' branch) and a dedicated primary lifecycle effect — an exact mirror of `tshirtPrimaryEntry` — builds `world.devicePrimaryEntry` through the SAME `getFactory('device-mockup')` contract, centered at origin at hero scale, animated every frame from `loop()`.
- **`devicePrimary` state** (`DEFAULT_DEVICE_PRIMARY`): viewport, captureUrl/uploadAssetId (reusing ALL Phase 2/3 screen machinery incl. `deviceScreenLibrary`), body/accent colors, scroll+speed, sway+speed (default OFF — the reference frames a steady device and moves the camera), scale 1.45. Persisted in the settings blob, Look-history snapshots (`snapshotLookState`/restore incl. `clothShape==='device'`), and Scene-Template capture/apply.
- **Primary controls** in the Images card (`#cloth-device-primary-section`): Desktop/Phone/Tablet, the shared `DeviceScreenControl` (new `idPrefix` prop — `cloth-device-primary-screen-*` ids — so the Inspector's copy keeps unique DOM ids), DEVICE SCALE, SCREEN SCROLL/SPEED, SWAY/SPEED, BODY TONE, SITE ACCENT. HUD hint: "DEVICE MOCKUP · DRAG TO ORBIT".
- **Diffusion Camera:** `Primary artwork / cloth` focal target now resolves to the primary device (`resolveDiffusionFocusWorldPosition` + `primaryArtworkAvailable` include `devicePrimaryEntry`).
- **Capture-quality fixes found live:** (1) `browserless.cjs` gains an opt-in `scrollPage` body flag (spread-guarded — existing callers byte-identical) and the capture route always sets it for device captures: an instant full-page shot of a lazy-loading site came back almost entirely blank below the fold. ⚠️ Known limit: sites that animate sections in-viewport via IntersectionObserver (vercel.com) still capture mostly blank below the hero even with scrollPage — server-rendered pages (verified live with a Wikipedia article) capture fully; the honest workaround for animate-in sites is the upload source or the Cloud Run scroll-frame pipeline. (2) POST accepts `refresh: true` (recapture before the 24h TTL; still fully quota-gated) and `imageUrl` is now **versioned** (`&v=<capturedAt>`) so a recapture busts the day-long browser/CDN cache of the previous bytes. (3) The route evicts `studio-device-capture.cjs`/`browserless.cjs` from require.cache in dev (brief-preview's STALE_CJS pattern; firebase-admin deliberately not evicted).
- **Tests:** suites 1248/1248. **Live-verified:** Device shape selected → flyer gone, hero desktop centered; Wikipedia Three.js article captured through the primary control → real readable article content scrolling on the hero screen; recent-captures "Use" worked across both control mounts; no console errors. Owner's studio left in Device mode with the Wikipedia capture active (their sheet setup is one SHEET SHAPE click away).

## Phase 5 — SHIPPED (2026-07-31, uncommitted): timeline-keyframed scroll, no-skew backgrounds, Image Layers

Owner direction: page animation must line up with timeline keyframes (not auto-animate), with a %-scrub to set keyframes around; background image uploads must never skew; arbitrary JPG/PNG layers must be addable and place around scene center.

- **Timeline-driven page scroll:** `appearance.scrollPosition` (0=top..1=bottom — the "%" scrub) on device-mockup + `devicePrimary.scrollPosition`, and **AUTO SCROLL now defaults OFF** (both catalog and `DEFAULT_DEVICE_PRIMARY`). `'devicePrimary.scrollPosition'` joined `TIMELINE_LERP_WHITELIST`, so Add Keyframe captures the dial and playback pans the site smoothly between keyframes. Per-frame application: the loop writes `world.timelineOverride?.devicePrimary?.scrollPosition` onto the device entry's `userData.scrollPositionOverride` **after `stepTimelinePlayback`** (no one-frame lag); undefined clears itself the frame playback stops, falling back to the dial. Old keyframes without `devicePrimary` degrade honestly (blendRecipes skips missing leaves). SCROLL POSITION slider added to the primary section (disabled while AUTO SCROLL ping-pongs) and the extras Inspector.
- **Background image cover-fit:** new pure module `bg-cover.js` (`computeBackgroundCover` — CSS `background-size: cover` semantics), applied every frame in the loop to `scene.background`'s repeat/offset (`world.bgCoverInfo` armed by the bg-image effect; Clamp wrapping). Resizes/export-resolution swaps stay correct with zero hooks. Unit-tested incl. the sampled-patch-aspect === canvas-aspect "never skewed" property.
- **Image Layer element (`image-layer`):** any uploaded JPG/PNG/WebP as a flat scene layer — plane rebuilt to the image's TRUE aspect on load (`imageLayerPlaneSize`, longest edge 0.9 wu — never stretched), PNG alpha as soft transparency (`transparent` + `depthWrite:false`, right for clouds; diffusion depth sees through it by design). Uploads resolve through the SAME browser-local library as device screens (`ctx.deviceScreenAssetsById`). New `ImageLayerControl` (kind `layer-image`): upload + full library list with Use/Delete + clear. **Spawns at scene CENTER** (placement anchor `xSign:0, ySign:0` + `intentionalOverlap`) per the owner's "place around the paper and move from there" rule; position [0,0,0] is the scene origin where the paper/device sits.
- **Tests:** timeline fixture gained `devicePrimary`; +6 new (dial/override precedence + release, whitelist membership, plane aspect incl. garbage dims, placeholder/opacity lifecycle, cover-fit suite). Studio suites **1031/1031**; grand total with api/_lib 1260+.
- **Live-verified on the owner's own scene** (they were actively using it — critters-quest capture on the hero device): two keyframes (0% → 100%) played back panned the site from hero to footer; a generated 800×400 alpha cloud.png uploaded through the new element, spawned center, moved to the upper-left sky, rendered wide + soft (never squared/skewed). No console errors.
- ⚠️ **Owner's pre-demo timeline** (2 hero-text keyframes) is preserved verbatim at localStorage key `holocloth-timeline-backup-fable` — the current timeline holds the 2 scroll-demo keyframes on their live scene; restore on request.

## Phase 7 — SHIPPED (2026-08-01, uncommitted): LIVE interactive website on the primary device

Owner direction: run the live website in the device, interactive — "not just take a pic."

**Architecture (the only honest one):** browsers cannot rasterize live/cross-origin DOM into a WebGL texture, so this is the classic three.js CSS3D "screen" trick — a real `<iframe>` in a `CSS3DRenderer` layer BEHIND the WebGL canvas (renderer is already `alpha:true`), pinned every frame to the screen mesh's exact world matrix (decompose → position/quaternion/scale × 0.001, the DEVICE_VIEWPORTS px→wu ratio, so the site renders at its true viewport breakpoint: 1440/390/768 px), rendered with the SAME active camera after `stepTimelinePlayback` (keyframed camera moves carry the live screen). The WebGL screen mesh swaps to an **alpha-0 punch-through material** (`NoBlending`, black, opacity 0 — rgb must be 0 under premultiplied compositing) so the iframe shows through the hole and is correctly occluded by any 3D content drawn over it; both finish passes write `base.a`, so the hole survives the full fx chain. Factory stores `userData.screenMesh` for the swap; the saved material is restored from `userData.screenMaterial` on teardown (rebuild-safe).

- **State:** `devicePrimary.live` + `devicePrimary.liveUrl` (persisted); `deviceInteract` React state (ephemeral, never persisted, auto-off when live ends).
- **UI (`#cloth-device-primary-section`):** LIVE SCREEN url input + Go Live toggle + **INTERACT WITH SITE** toggle ("On — orbit paused": canvas gets `pointer-events:none`, the CSS layer `auto`, so scroll/click go to the real site; orbit pauses because the canvas stops receiving events). Honest limits stated inline: post effects can't touch the live screen itself, PNG/MP4 exports show a transparent hole there (switch to Capture to export), and `X-Frame-Options`/CSP `frame-ancestors` sites refuse to load (blank → use Capture).
- **Primary device only** (one iframe); extras instances stay texture-based.
- **Live-verified:** threejs.org live on the hero device — real sidebar/nav and project grid visible through the hole, and with Interact on, scrolling over the screen scrolled the REAL site (grid panned to further rows) while the studio scene stayed put. Interact off restored orbit. No console errors; studio suites green after wiring.

### Phase 7 correction (same day) — "it keeps loading the old site"

Owner hit it immediately: typed a URL, screen kept showing the demo site. Three compounding causes, all fixed:
1. **Per-keystroke iframe rebuilds:** the live effect depended on the whole `devicePrimary` object, so every keystroke in the URL field (and every unrelated primary-device slider) tore down and reloaded the live site mid-typing. Fixed: the URL input is now a LOCAL DRAFT (`liveUrlDraft`); **Go Live / Load URL** (or Enter) commits it in one write, a **Stop** button ends live mode, and the effect's deps are narrowed to exactly `[clothShape, worldReady, devicePrimary.live, devicePrimary.liveUrl, devicePrimary.viewport]`.
2. **Unguarded build could crash the effect** (→ studio remount → stale settings reload): iframe/hole creation is now wrapped in try/catch that degrades to the textured screen with a console.warn.
3. **Two studio tabs fighting over the settings key:** the Fable verification tab kept re-saving ITS state (demo URL) into `holocloth-studio-defaults-v9`, stomping the owner's tab's saves on every reload. The verification tab is closed; multi-tab last-writer-wins on the settings key is a PRE-EXISTING studio behavior worth a future `storage`-event guard, noted here honestly.

Debugging footnote for posterity: mid-investigation the loop looked dead (frozen clock, css layer never rendering) — that was Chrome pausing `requestAnimationFrame` in the occluded automation window, not a code path. `window.__clothWorld` (dev-only) was added as a permanent debugging escape hatch. Suites 1033/1033 after the fix.

### Phase 7 correction 2 (same day) — "nothing displays": three more real bugs, all pixel-verified

Owner screenshot showed the live site as a giant dim ghost across the whole canvas. Root causes and fixes:
1. **Accidental transparent background:** bg images are session-only; after a reload, `bgMode === 'image'` with no image fell through to `scene.background = null` — the ENTIRE canvas went transparent, exposing the CSS3D iframe (huge at close orbit) behind everything. Fixed: image mode with no loaded image now falls back to the SOLID `bgColor`, never transparent.
2. **Premultiplied ghost wash:** grain/treatment/bloom write rgb > 0 where alpha == 0; the browser composites the canvas premultiplied, so that rgb ADDS a dark veil over anything behind the canvas. Fixed: new `uCleanAlphaHole` uniform in TREATMENT (set only while a live screen exists) zeroes rgb wherever `base.a ≈ 0`.
3. **Bloom refilled the hole's alpha (measured: 0 → 0.81):** `UnrealBloomPass.materialCopy` composites additively, and additive blending adds ALPHA too. Fixed at construction: custom blending on `materialCopy` — identical additive rgb, destination alpha untouched (`blendSrcAlpha: Zero, blendDstAlpha: One`). Visually a no-op for opaque pixels.
4. **Hole lost on topology rebuild:** an accent/viewport randomize rebuilt the screen mesh with the factory material, leaving the iframe hidden behind an opaque screen. Fixed: the hole material now lives on `world.deviceLive.holeMat` and the primary lifecycle effect re-punches it after every `applyInstance`; `restore()` simply reinstates `userData.screenMaterial` (always the correct non-live material).

Verified by sampling actual canvas pixels (hole rgba 0,0,0,206 before → clean after; live page crisp in the frame). Suites 1266/1266.

### Phase 7 correction 3 (same day) — embed-block honesty + Live vs Capture handoff

Owner reports: a URL showed only Chrome's sad-page icon; and captures/uploads "didn't update the screen" while Live was on.

1. **Embed preflight:** Go Live now fires `{ url, checkEmbed: true }` at the capture route — a plain header fetch (no browserless, no quota, same SSRF validation) that reads `X-Frame-Options`/CSP `frame-ancestors` and, when the site refuses framing, shows `#cloth-device-live-embed-note`: "This site refuses to be embedded (X-Frame-Options: sameorigin) — use Capture…" (verified live against google.com). `sameorigin` counts as blocked — the studio is never the target's origin. The browser gives NO scriptable signal for a blocked frame, so a server-side preflight is the only honest detection.
2. **Choosing a capture/upload now auto-stops Live:** while the punch-through was up, texture changes updated the material invisibly underneath — the primary control's onChange now drops `live: false` (and Interact) whenever a captureUrl/uploadAssetId is selected.
3. **Restore-path bug (screen went permanently black after Stop):** `restore()` read the factory screen material off the MESH's userData; it lives on the ROOT's (`deviceRebuild`). The hole material stayed on after live ended, rendering the screen as an alpha-0 void. Fixed + verified live (capture visibly returns on Use).

Suites 1266/1266. Verification tab closed again (multi-tab settings-key last-writer-wins remains the known pre-existing sharp edge).

### Phase 5 addendum (2026-08-01) — Image Layers front door

Owner couldn't find the layer-upload path (it required ADD ELEMENT → Image Layer → Inspector upload). Added the discoverable route: **Images card → IMAGE LAYERS → "Add image layer (PNG/JPG)"** (`#cloth-image-layer-add-btn`, `addImageLayerFromFile`) — one click uploads the file into the shared library, creates an image-layer instance AT SCENE CENTER with the asset pre-assigned, and selects it in the Inspector; the status toast says where it went and how to move it. Caps/format checks mirror the Inspector control; disabled with an honest note at the element limit. Live-verified: generated sun.png → appeared centered → repositioned via Inspector sliders, soft alpha intact. Suites 1033/1033.

### Phase 8 (2026-08-01) — Element transforms are timeline-keyframeable

Owner ask: move/rotate/scale image layers AND have keyframes animate them.

- **`blendElementTransforms`** (timeline.js, exported): the `extraInstances` analog of `blendTextLayers` — instances matched by `id`+`type` tween `transform.position/scale` linearly and `rotation` via `shortestAngleLerp` (degrees) between keyframes; everything else about an instance (material/appearance/motion/enabled) stays a discrete cut at the boundary; unmatched instances appear/disappear at the cut. Wired into `blendRecipes` alongside the textLayers special case.
- **Per-frame application** in `applyTimelineContinuousOverride` (ClothStudio): the blended transforms write straight onto each live root in `world.elementLiveObjects` — same "timeline owns the transform while driving one" precedent as glass/shotCam. Only the ROOT transform is touched; factory drift/spin motion rides the separate motion child, so they never fight. Playback ending on a keyframe hands back seamlessly (the discrete cut already set state to the same values).
- Keyframes were ALREADY capturing `extraInstances` (full-recipe capture) — before this phase transforms jump-cut at boundaries; now they tween.
- **Workflow:** select a layer → pose it with the Inspector sliders → Add Keyframe → scrub → new pose → Add Keyframe → Play.
- **Tests:** +3 (lerp/shortest-angle/endpoint exactness; unmatched/type-mismatch cut rules; extraInstances riding a full `blendRecipes` blend). Suites 1036/1036.
- **Verification honesty:** the blend math is unit-proven and the per-frame wiring is the same pattern live-proven for `devicePrimary.scrollPosition` (hero→footer pan); a same-session visual replay was blocked by Chrome pausing rAF in the occluded automation window. A ready-made 2-keyframe demo (image-layer-1 sweeping left→right, scaling 0.7→1.5, tilting −20°→+25°) was left in the owner's saved timeline for a one-click Play check. Timeline backups: `holocloth-timeline-backup-fable` (hero-text era) and `holocloth-timeline-backup-fable-2` (scroll-demo era) in localStorage.

### Phase 9 (2026-08-01) — Mockup Video camera templates in HOLO PAPER

All 13 authored camera rides from the Mockup Video studio (page.jsx `CAMERA_TEMPLATES`) ported into a pure module `camera-templates.js` — poses, holds (duplicate-keyframe parking), the 1.1 radius cap, and the canonical front-3/4 open rule all verbatim; retargeted from pixel space to orbit world units (`BASE_DIST 2.6` wu ≈ camZ, targets × 0.5 wu subject half-extent, distance clamped inside OrbitControls' range). `buildCameraTemplateTimeline` emits timeline-v2 keyframes (named "SPIRAL IN 1…N") sharing ONE snapshot of the current scene (camera-only animation) with `shotCam.use` forced off; template's own duration adopted. Applying REPLACES current keyframes (same confirm-free idiom as Clear). Surfaced twice: the timeline bar's **Moves** dropdown next to Clear (`#cloth-timeline-camera-move-select`) and the Camera card's **CAMERA MOVES** picker (`#cloth-camera-move-select`). Tests: +5 (budget ≤12 for all 13 incl. worst-case Corner Tour at 11, t-span/monotonicity, sanitizer round-trip, canonical open, hold duplicates, world clamps) — suites 1041/1041. Live: SPIRAL IN applied through the real dropdown → 9 named keyframes with orbit poses landed (left in the owner's timeline as the Play-button self-demo; motion replay again blocked by the occluded-automation-window rAF pause).

### Phase 10 (2026-08-01) — "Desk Studio" realistic scene set + live-export guard

- **Live-export guard:** all four export paths (`Export PNG`, PNG-no-bg, `Export video`, `Export Timeline`) run through `runExportWithLiveGuard` — a live device screen can never be recorded (DOM behind the canvas), so exports auto-pause Live, let the captured/placeholder screen swap back in (1.4s beat), then start; status explains and points at Go Live to resume (deliberately not auto-resumed). Verified live: PNG export with hitloop.agency live → paused, iframe torn down, correct message, exported with the captured screen.
- **Desk Studio scene set** (`SCENE_PRESETS['desk-studio']`): the "monitor on a desk, realistic" ask. The Mockup Video pipeline's photo environments (`desk/loft/airport-terminal.webp`) copied from `services/studio-render/assets/environments/` into `public/env/`. New scene-preset capabilities, both generic: `photo` (async backdrop photograph, cover-fit via the existing per-frame `bgCoverInfo` math, procedural gradient paints instantly as fallback, staleness-token guarded) and `groundY` (raises the shadow floor; Desk uses −0.68 to meet the desktop stand foot at default scale — the monitor SITS instead of floating; `resetRig`/other sets restore −1.15). Device hardware meshes now `castShadow` (screen/face excluded). Verified live: office photo room + device shadow on the wood-toned desk floor. Suites 1041/1041.
- Loft + airport photos are staged in `public/env/` for two more photo sets whenever wanted (one preset entry each).

### Phase 10b (2026-08-01) — panorama scene sets ("ultra realistic, ~20 versions")

Owner (correctly) called the flat-photo desk backdrop weird — `desk.webp` is a 360° plate and pasting it flat produced fisheye warp. Reworked as TRUE equirect panoramas:
- **New scene-preset fields** (`pano`, `panoBlur`, `panoRotY`, `panoIntensity`) in the bg effect's scene branch: the plate (HDR via `world.rgbeLoader`, webp via TextureLoader; both cached in `world.panoCache`) becomes `scene.background` with `EquirectangularReflectionMapping` — the room surrounds the scene and pans with the orbit — plus `backgroundBlurriness`/`backgroundRotation`, and **matched IBL** (`pmrem.fromEquirectangular`, cached in `world.panoIblCache`) so the hardware reflects the room it stands in. `world.envOverriddenByPano` + `setEnvironment`'s new `lastEnvId` hand the IBL back to the Environment card when leaving a pano set. `bgTextureOwned` keeps cached panos from being disposed by mode switches. The old flat-`photo` path was removed (dead — desk-studio was its only user).
- **21 pano/cyc sets authored** from 7 plates (3 webp panoramas + 4 HDRIs) × sharp/soft/rotated variants × desk-height (`groundY: -0.68`) vs stage floors, + White Cyc / Ink Cyc product sweeps. Scene grid now 29 sets.
- Live-verified: Hotel Desk (equirect ✓ blur 0.12 ✓ IBL override ✓) and Venice Golden (HDR plate as sky, device standing on the warm desk plane). Suites 1041/1041.

### Phase 10c (2026-08-01) — resolution + surface realism pass

Owner: plates look low-res, table needs textures. Both fixed:
- **2k HDR plates** (Polyhaven CC0, ~6MB each, lazy-loaded per set) downloaded to `public/hdr/*_2k.hdr`; all HDR pano presets repointed (ENV_PRESETS' IBL stays 1k — reflections don't need it). The three webp rooms are capped at 2048×1024 by their source, so their "sharp" variants got blur floors raised to ≥0.25 — they now read as intentional depth-of-field rooms instead of mush.
- **PBR floors:** `GROUND_TEXTURES` (wood_table_001 + concrete_floor_02, Polyhaven CC0 2k diffuse+roughness in `public/tex/`) + `groundTex`/`groundTint` preset fields — the bg effect loads/caches both maps (`world.groundTexCache`, token-guarded, flat preset color until loaded), tiles them across the stage plane with anisotropy, and clears maps for untextured sets. Wood on every desk-height set (dark-tinted for Midnight), concrete on stage/terminal sets; the cycs stay clean sweeps.
- Live-verified: Venice Golden = 2k equirect sky + real wood plank grain with specular sheen under the device shadow. Suites 1041/1041.

### Phase 10d (2026-08-01) — 50-set batch 2 + Scene Lab (tweak & save)

- **Assets:** 9 more Polyhaven 2k HDRIs (potsdamer_platz, shanghai_bund, neon_photostudio, studio_small_03, artist_workshop, royal_esplanade, metro_noord, courtyard_night, autumn_field_puresky — `public/hdr`, ~55MB) + 5 more PBR floors (dark-wood, marble, metal, asphalt, granite — `public/tex`). `GROUND_TEXTURES` entries gained `label`s for the Lab picker.
- **50 new sets** (grid now 79): CYBER ×10 (night cities/neon, metal+asphalt, neon-cross rigs, fog), OFFICE ×8 (workshop/studio/esplanade/metro, wood+granite+marble), DARK ×8 (single-spot moody, dark woods/stone), LIGHT ×8 (pure sky/white studios, marble), ABSTRACT ×16 (procedural color fields — magma/ultraviolet/acid/arctic/jade/etc — with tinted textured floors + fog).
- **Scene Lab** (Background card, scene mode): live tweak overlay on the ACTIVE set — backdrop plate picker (all 16 plates via `PANO_PLATES`, or none), plate blur/rotation/brightness, floor surface picker + color/tint, floor height, fog on/color/density. Overlay composed by the pure `composeSceneDef` (same fn feeds the bg effect and the UI); tweaks persist in settings/recipes/Look history and clear when another set is picked; Reset discards them.
- **MY SCENES:** Save captures the composed look as a browser-local preset (`holocloth-user-scenes-v1`), listed above the Lab with delete; user ids survive reload (`sceneId` init accepts `user-*`), resolve everywhere via `getSceneDef`.
- Live-verified end-to-end: 79 set buttons; Cyber · Platz → Lab blur tweak + granite floor swap rendered live → saved as "My Cyber Granite" → became the active selectable scene. Suites 1041/1041.

### Phase 10e (2026-08-01) — Master Save (one-click full-state versions)

- New "Master Save" rail card (`#cloth-master-saves-panel`, top of GENERATE & OUTPUT, deliberately OUTSIDE the elementsV1Enabled gate). One click (`#cloth-master-save-version-btn`) captures the COMPLETE current state — `captureSceneRecipe()` PLUS `timeline` keyframes + `exportResolutionTier` (the two fields scene recipes deliberately omit; composing at this level avoids the recipe-in-keyframe recursion) — as a named version. Blank name auto-names "Version N".
- Versions list (newest first, saved-at timestamp): Load (stops playback, re-validates via applySceneRecipe + sanitizeTimeline + tier enum), Overwrite-with-current, Rename, hard Delete. Cap 12 with oldest-truncation — Save never disables.
- Pure schema = `elements/master-saves.js` (fourth preset kind, `kind:'master'`, `holocloth-master-saves-v1`); reuses templates.js generic list ops + preset-kinds parse. UI `components/MasterSavesCard.jsx`.
- Verified live: save (auto + named), 40-key recipe incl. timeline/tier, doctored-version load round-trip (bgColor + tier changed, timeline intact), delete; suites 1049/1049.

### Phase 10f (2026-08-01) — device seats on the floor + vertical reposition

- **Problem:** all three devices shared one floating origin — on desk-height scene sets (groundY −0.68) the device hovered above (or clipped through) the floor depending on viewport/scale.
- **Seat-on-floor** (`devicePrimary.seatOnFloor`, default ON): the primary-device lifecycle computes rootY = groundY − `deviceBottomLocalY(viewport)` × scale, so each device's true lowest point (desktop stand-foot underside −0.77 pre-nf, mobile −0.44, tablet −0.536 — new `bottom` field on DEVICE_VIEWPORTS + exported helper in factories.js) rests exactly on the active set's floor; tracks viewport/scale/floor-height (Scene Lab FLOOR HEIGHT) changes. No visible floor (color/image/transparent, floorless set) ⇒ seatY 0, prior behavior.
- **HEIGHT OFFSET** (`devicePrimary.posY`, −0.8..0.8): manual nudge on top of the seat base; in TIMELINE_LERP_WHITELIST so it keyframes/tweens; render loop reasserts y each frame from `world.deviceSeatY` + override (mirrors scrollPositionOverride's self-clearing contract). UI: `#cloth-device-seat-floor-row` toggle + slider under DEVICE SCALE in the Subject card.
- Live-verified: desktop/mobile/tablet Box3 bottom = −0.68 exactly at floor −0.68 (scale 2.2), +0.3 offset lifts to −0.38, seat off returns to origin. Suites 1050/1050.

### Phase 10g (2026-08-01) — device shell models + realistic/clay finish

- **DEVICE_MODELS** (factories.js, exported): per-viewport shell designs over the SAME screen (screen size/aspect stays on DEVICE_VIEWPORTS so captures/uploads/live-iframe/scroll math never vary by model). Desktop: Studio Display (original, arm stand) / Ultra Edge (thin bezel, column stand) / Retro Shell (thick shell, wedge foot). Phone: Flagship (original, pod) / Minimal Slab / Compact. Tablet: Pro (original, pod) / Sketch Slate. `deviceResolveModel` falls back to the family default for ''/wrong-family ids.
- **Seat integration:** bottoms now COMPUTED — `deviceBottomLocalY(viewport, model)` = -(H/2 + bezel + DEVICE_STAND_DROP[stand]) × nf; stand builds must match DEVICE_STAND_DROP (arm 0.29 / column 0.31 / wedge 0.105). Default models reproduce the Phase 10f constants exactly.
- **FINISH** (`devicePrimary.finish` / appearance.finish): 'realistic' = original physical metal + black glass face; 'clay' = ONE matte MeshStandardMaterial (metalness 0) over every shell part incl. face — BODY TONE recolors the whole clay shell, `claySoftness` (material field, 0.4–1) is a LIVE roughness dial (in deviceUpdateMaterial, deliberately NOT in the topology signature). Model+finish ARE in the signature (rebuild).
- **Primary UI** (Subject card): MODEL select `#cloth-device-model-select` (per-family options; each family remembers its pick via `devicePrimary.models{desktop,mobile,tablet}`), FINISH row `#cloth-device-finish-row`, CLAY SOFTNESS slider (clay-only). Extras Inspector gets MODEL/FINISH/CLAY SOFTNESS catalog controls too.
- Live-verified: edge/retro model swaps each re-seat exactly on the floor; clay = metalness 0 + roughness follows softness slider + BODY TONE recolors (#e8734a terracotta screenshot); realistic restores metal on rebuild. Suites 1051/1051.

### Phase 10h (2026-08-01) — shell textures, clay color palette, more display bases

- **Shell textures** (`appearance.shellTexture` / `#cloth-device-texture-select`): Smooth · Speckled Clay · Brushed · Fabric Weave · Grip Dots — procedural tileable 64×64 bump maps (DataTexture + deterministic integer hash, node-test safe like the placeholder site; BYTES cached module-wide, fresh DataTexture per rebuild because clearGroup disposes material textures). Applied to the shell in BOTH finishes (bumpScale 0.004 clay / 0.0018 metal), never the screen or glass face. In the topology signature (rebuild).
- **Clay color** (`material.clayColor`, default terracotta): clay's OWN color, separate from realistic BODY TONE — flipping finish never clobbers either. UI: 8-swatch palette + custom picker (`#cloth-device-clay-color-row`, clay mode only). Live dial (deviceUpdateMaterial), no rebuild.
- **New bases:** desktop Orbit (ring base: neck + disc, drop 0.316) / A-Frame (twin tilted legs, drop 0.2186 — rotated-extent math in the DROP comment) / Float (no stand, slab edge); tablet Docked (cradle bar, drop 0.03). DEVICE_STAND_DROP extended; all seat exactly (Box3-verified at −1.15 floor incl. the rotated A-frame legs).
- Live-verified: orbit + clay + speckle + sage swatch → color #9caf88, metalness 0, bumpMap on, seated exact; realistic ignores clayColor. Suites 1052/1052.

### Phase 10i (2026-08-01) — per-layer placement controls in the Image Layers card

- Discoverability fix: image-layer transforms previously lived ONLY behind Elements→select→Inspector. The Image Layers card now renders a control block per renderable layer (`#cloth-image-layer-controls-<id>`): POSITION X/Y, DEPTH (Z), SPIN (rot Z), TILT X/Y, SCALE (uniform) + an Inspect button (selects + opens the Inspector). Writes through the SAME `changeSceneElementField(id,'transform',…)` the Inspector uses — two surfaces, one state, timeline keyframes still tween them (blendElementTransforms). Live-verified: both existing layers rendered 7 sliders each; POSITION X nudge hit `extraInstances` and restored exactly. Suites unchanged (UI-only).

### Phase 10j (2026-08-01) — image layers render color-exact (the "low opacity" that wasn't)

- Owner report: an uploaded layer "looks like its opacity is low" at opacity 1. Root cause was NOT opacity — the layer's MeshBasicMaterial went through ACES tone mapping (renderer default) while the device screen renders `toneMapped:false`, so saturated flat artwork came out lifted/desaturated (milky pastel) next to the vivid screen. Fix: `toneMapped:false` on the image-layer material — flat 2D artwork is color-exact, same rule as the screen. All 3 of the owner's layers were confirmed at opacity 1 (tone mapping was the whole effect).
- OPACITY slider added to the per-layer block in the Image Layers card (was Inspector-only). Suites 1053/1053.

### Phase 10k (2026-08-01) — layer "ghosting" solved: SOLID IMAGE toggle

- Owner report: background/site content ghosting through an image layer. Bisect (bloom off, depthWrite on, camera orbit, canvas readPixels, per-asset alpha histograms) proved every renderer suspect innocent — the ghost was the **bg image (the site capture, `bgMode:'image'`) showing through the layer PNG's own partial-alpha interior pattern** (the grass hill paints its tuft detail at partial alpha: 45% of pixels). Screen-space band + hard horizontal boundary were the bg cover-fit, not 3D.
- Fixes: (a) automatic — globally-faded PNGs (NO fully-opaque pixel, e.g. a 95%-max export) are normalized on load (`imageLayerAlphaFixScale`, canvas pass in imageLayerSyncTexture; well-formed PNGs untouched); (b) opt-in per layer — **SOLID IMAGE** toggle (`appearance.solid`, card row + Inspector control): ≥60% alpha → fully opaque, true cutout edges keep relative softness (`imageLayerSolidAlphaScale`). `solid` participates in the texture dedupe key so the toggle re-processes. Deliberately not automatic: soft interiors are correct for clouds/glows.
- Also this round: image-layer material `toneMapped:false` (Phase 10j) + OPACITY in the card block. Live-verified: grass layer solid ON → body fully solid over the bright bg; owner's layer-3 left with solid ON (their ask), layer-1 transform restored. Suites 1055/1055.

### Phase 10l (2026-08-01) — Hero Text PLACEMENT: Overlay vs In Scene (+ Comic Neue)

- **Why:** Hero Text was a screen-space overlay pinned to the frame — camera-move keyframes never affected it ("text needs to animate with the keyframes… I'd need a layer in the 3js scene").
- **PLACEMENT** per layer (`layer.placement: 'overlay'|'scene'`, default overlay; POSITION section, `#hero-text-placement-row` + DEPTH (Z) slider `posZ` −1.5..1.5): 'scene' mounts the SAME canvas-textured plane in the main world — world-unit mapping via `layoutTextPlaneWorld`/`TEXT_WORLD_STAGE` (text-layers.js, pure/tested; fixed 2.0×1.25 stage so window size never moves it), depthTest ON (device occludes it), rides camera orbits and every camera-move keyframe.
- Timeline: `posZ` in TEXT_LAYER_LERP_FIELDS (depth tweens); placement added to blendTextLayers' discrete-cut guard (never lerps across coordinate spaces). Continuous per-frame override + Phase-3 in/out anims handle both placements (anim offsets scale to the world stage for in-scene entries). Overlay path byte-identical.
- Also: **Comic Neue** added to GOOGLE_FONT_CATALOG (Comic Sans equivalent, 300/400/700, falls back through real "Comic Sans MS").
- Live-verified: layer flipped In Scene → mesh re-parented into world.scene (depthTest true, z 0.6), camera orbit moved its screen projection (overlay layer unmoved); state restored to overlay after. Suites 1056/1056.

### Parked by owner decision (2026-08-01) — do not reopen unprompted

- **Critters-site frame headers stay untouched.** The owner's critters site (`Critters_Quest/FastPoker*` — `X-Frame-Options: DENY` + `frame-ancestors 'none'`, deliberate wallet-clickjacking protection) will NOT be loosened. Consequence, accepted: the LIVE screen cannot show that site; Capture is the path for it. The studio-side work here is complete — the embed preflight reports blocks honestly.
- **60fps deterministic export (WebCodecs) — assessed, not started.** Current exports are realtime MediaRecorder captures, so live stutter lands in the file. The fix design + lift estimate (~1 focused day: extract `renderFrame(t)`, port the `services/studio-render/scene.mjs` encoder recipe with `mp4-muxer`, preserve the export contract, MediaRecorder fallback) is recorded in the session, ready whenever the owner asks for it.

## Phase 6 — SHIPPED (2026-08-01, uncommitted): Background fit/shift + diffusion opt-out

Owner direction: Background panel needs on/off for the Diffusion ("displacement") Camera's effect on the backdrop, vertical position shift, and cover/contain fit — a crisp background only affected by chosen effects.

- **`bgFx` state** (`DEFAULT_BG_FX = { fit: 'cover', shiftY: 0, diffusion: true }`), persisted in settings, Look history, and Scene-Template capture/apply; `liveRef` carries it for the render loop.
- **DIFFUSION ON BACKGROUND toggle** (all bg modes, `#cloth-bg-diffusion-toggle-row`): new `uBgDiffusion` uniform in `DIFFUSION_SHADER` — when off, the backdrop pixels (rawDepth==1, where no geometry drew) skip the blur per-pixel while real scene objects keep full depth-of-field. This is a user-controlled re-instatement of the old backdrop gate the Codex round removed unconditionally. Honesty notes in the UI: the backdrop is never lit by scene lights (flat plate), and vignette/grain/treatment still apply as part of the print look.
- **FIT (Cover / Contain / Stretch) + SHIFT (−100..+100%)** for the uploaded bg image (`#cloth-bg-fit-row`, `#cloth-bg-image-controls`): `bg-cover.js` grew `shiftY` on `computeBackgroundCover` (slides the crop window through the vertical slack; honest no-op when the crop falls on the horizontal axis) and a new `computeContainLayout`. Contain is **baked** to a canvas at the stage's aspect with bars in the background color (texture repeat tricks can't paint bars — edge-clamp would streak); re-bakes on fit/shift/color/image change, and later resizes degrade to a mild centered crop of the bake via the existing per-frame cover math. Stretch = the old fill behavior, explicit.
- **Tests:** cover-shift (centered/pinned/clamped/no-slack-noop) + contain-layout (letterbox both orientations, shift through slack, centered bars) — suites **1266/1266** total.
- **Live-verified:** portrait ratio-test image (circle + TOP/BOTTOM markers) — Cover kept the circle perfectly round (centered crop), SHIFT +100% slid to the image top, Contain showed the whole image with bg-color side bars; max-diffusion A/B showed the backdrop crisp with the toggle Off while the device/glass stayed blurred. Owner's studio left at diffusion defaults, bg cover/centered/diffusion-on (their session bg image had already been replaced by the ratio-test upload — bg images are session-only state).
