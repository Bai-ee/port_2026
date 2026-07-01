# Mockup Studio

Status: active feature docs for the Studio render and mockup systems.

## Start Here

1. `STUDIO_RENDER_HOSTING.md` — Cloud Run GPU render hosting, cost controls, deploy steps, and operational notes.
2. `MOCKUP_CALIBRATION.md` — device template coordinate calibration for static mockup generation.
3. `../../dashboard-ui/VIDEO_STUDIO_UX_KIT.md` — UI standard for full-screen video/studio editor surfaces.
4. `../../source-of-truth/CREATIVE-BRIEF-DELIVERABLES-WIRING.md` — launch card wiring for Video Promo / Mockup Studio.

## Current Integration Points

- Dashboard render route: `app/api/dashboard/studio-render/route.js`
- Worker route: `app/api/worker/render-studio/route.js`
- Core helper: `api/_lib/studio-render-core.cjs`
- Cloud Run service: `services/studio-render/`
- Dashboard output: `dashboard_state/{clientId}.studioCaptures`

## Operational Notes

- Studio render is a launch deliverable, but live Cloud Run env/service health is an ops fact and must be verified outside the repo.
- GPU render hosting details belong in `STUDIO_RENDER_HOSTING.md`.
- Static mockup template coordinate changes belong in `MOCKUP_CALIBRATION.md`.
- **Scroll/capture + frame-rate behavior** (scroll-to-end page pre-warm, why the
  scroll reaches the bottom without skipping, output fps 24–30 vs. the
  `everyNthFrame` capture-rate stutter lever) lives in
  `services/studio-render/README.md` → "Scroll & capture behavior".
