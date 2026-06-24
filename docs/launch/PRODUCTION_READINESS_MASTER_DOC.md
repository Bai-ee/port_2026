# Production Readiness Master Doc

Date: 2026-06-18

## Recommended launch position

Launch the product around **Mockup Studio video renders**.

Reason:

- It is the clearest feature with a concrete input -> output loop.
- It already has a working render path, modal flow, and export artifact.
- The broader "brief" / intelligence platform has more surface area, more client-state dependencies, and more half-finished expectations to manage publicly.

Recommended public offer:

- Primary CTA: submit a site URL and generate a mockup video.
- Secondary messaging: position the rest of the dashboard as part of the guided client onboarding, not the homepage promise.
- Keep other modules gated behind auth and/or controlled onboarding until they have dedicated QA passes.

## What was hardened

### Mockup Studio

- Added a dev-only smoke mode for `/dashboard/studio` so the feature can be tested without live auth.
- Fixed dashboard and studio signed-out behavior to redirect to `/login?redirect=...` instead of dropping users back on `/`.
- Added visible signed-out/loading fallback states for `/dashboard` and `/dashboard/studio` instead of blank screens.
- Restricted launch-safe Studio backgrounds to:
  - `Scene`
  - `Color`
- Hid launch-fragile Studio background options from the UI for now:
  - `Image`
  - `Site`
- Kept the underlying code paths for those hidden modes in place for later development.
- Made cloud renders use the current live Studio state when building the render recipe.
- Synced OrbitControls after viewport/device rebuilds to avoid camera drift after format switches.
- Added a local frame-start fix in the render service so exported videos no longer start on a blank white device frame.

### Smoke tooling

- Added [`scripts/smoke-studio.mjs`](/Users/bballi/Documents/Repos/Bballi_Portfolio/scripts/smoke-studio.mjs)
- Added [`scripts/smoke-routes.mjs`](/Users/bballi/Documents/Repos/Bballi_Portfolio/scripts/smoke-routes.mjs)
- Added npm scripts:
  - `npm run smoke:studio`
  - `npm run smoke:routes`

## Verified results

### Build and test baseline

- `npm run build` -> pass
- `npm test` -> pass (`480` tests, `0` failures)

### Studio smoke

`npm run smoke:studio` -> pass

Covered:

- Studio boot/render in smoke mode
- format and device switching
- launch-safe background modes
- environment loop toggle
- section mapping
- hi-res capture
- cloud render modal success path
- captures panel
- mobile overflow sanity check

Artifacts written to `/tmp/studio-smoke`.

### Route smoke

`npm run smoke:routes` -> pass

Result:

- `24 / 24` routes passed
- no Next error overlays detected

Covered public routes:

- `/`
- `/about`
- `/work`
- `/case-studies`
- `/gallery`
- `/faq`
- `/contact`
- `/how-it-works`
- `/process`
- service pages
- `/login`
- `/capture`
- `/preview/canvas`
- `/preview/intake-modal`
- `/preview/mini-brief`

Covered gated-route behavior:

- `/dashboard`
- `/dashboard/studio`
- `/admin/control`
- `/preview/brief`
- `/preview/scout-config`

Expected login redirects passed for all gated routes.

Artifacts written to `/tmp/route-smoke/summary.json`.

### Real render verification

Remote Cloud Run render check:

- `/health` responded `200`
- direct `/render` request returned valid H.264 MP4
- verified output size and duration with `ffprobe`

Important note:

- The currently deployed remote render service still showed a blank first frame before the local code fix below is deployed.

Local render-service verification after code fix:

- local `services/studio-render` server returned valid H.264 MP4
- render metadata included `liveFrameStart: 18`
- extracted first frame showed visible site content instead of a blank device screen

Conclusion:

- **Repo code is fixed**
- **remote render service still needs redeploy before production**

## Launch-safe Studio scope

### Keep live

- URL input
- device presets
- format switching
- Scene background
- Color background
- environment loop toggle
- section mapping
- hi-res capture
- cloud render modal
- saved captures panel

### Keep hidden for now

- custom image background
- site background / blurred site environment

Reason:

- those modes do not map cleanly and reliably through the current server-side render recipe
- keeping them visible would create a mismatch between what users see in Studio and what exports from the render service

## Feature audit

| Feature area | Status | Evidence | Production action |
| --- | --- | --- | --- |
| Public marketing site | Ready | `smoke:routes` pass across core public pages | Keep public |
| Login flow | Ready | route smoke pass | Keep public |
| Mockup Studio page | Ready for gated launch | `smoke:studio` pass | Promote as main offer |
| Mockup Studio render modal | Ready for gated launch | mocked smoke + real render checks | Keep |
| Mockup Studio export service | Ready after redeploy | local verification pass, remote health/render pass | Redeploy before push |
| Capture / preview playgrounds | Working but internal | route smoke pass only | Keep unpromoted |
| Dashboard shell | Ready as gated shell | redirect + fallback fixes verified | Keep gated |
| Admin control | Gated shell verified | redirect smoke pass | Keep internal |
| Knowledge Base | Code present, not fully E2E smoked | code audit only | Keep gated |
| Strategy Builder | Code present, not fully E2E smoked | code audit only | Keep gated |
| Marketing Brief / Executive Brief | Code present, not fully E2E smoked | code audit only | Keep gated |
| Social media posting | Code present, not fully E2E smoked | code audit only | Keep gated |
| Brand System | Code present, not fully E2E smoked | code audit only | Keep gated |
| Leadgen generation flows | Present but not production-certified in this pass | code audit only | Do not market yet |
| Dynamic client brief routes | Not audited end-to-end in this pass | no fixture-backed smoke run yet | Leave out of launch promise |

## What should not be the homepage promise yet

Do not lead with:

- the full AI brief platform
- all dashboard modules
- automated intelligence / scout coverage as the public core promise

Reason:

- too much of that surface still depends on live client data, authenticated state, and module-specific QA that has not been fully smoked end to end in this pass

## Production gate before push

1. Redeploy the Studio render service so the first-frame fix is live remotely.
2. Keep only `Scene` and `Color` backgrounds exposed in the Studio UI.
3. Keep all other dashboard modules behind auth/onboarding.
4. Push the repo only after rerunning:
   - `npm run build`
   - `npm test`
   - `npm run smoke:studio`
   - `npm run smoke:routes`
5. Verify one real remote MP4 render after deploy.

## Recommended rollout shape

### Public funnel

- homepage CTA -> Studio video render
- collect URL first
- gate advanced dashboard features until after account creation / guided onboarding

### Product narrative

- "Generate a video mockup of your site"
- "See your brand in motion"
- "Unlock the full workspace after render"

That keeps the public promise aligned with what is currently verified.

## Master prompt seed

Use the following as the next production-hardening prompt:

> Take [`docs/PRODUCTION_READINESS_MASTER_DOC.md`](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/PRODUCTION_READINESS_MASTER_DOC.md) as the source of truth. Prepare this repo for production launch around Mockup Studio video renders. Preserve the current gated status of non-Studio dashboard modules. Verify that only launch-safe Studio features are exposed, redeploy the Studio render service so the first-frame fix is live remotely, rerun build/tests/smoke suites, and produce a short ship report with any remaining blockers.

