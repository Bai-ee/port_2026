# studio-render

GPU headless-Chrome render service for Mockup Studio videos (Creative Director).

Drives Chrome via raw CDP (no puppeteer): screencasts the live target site
(including its WebGL hero — which only renders on a **real GPU**, not SwiftShader),
auto-scrolls it after the camera move, renders the 3D device scene, and exports a
true-CFR MP4 (H.264) via WebCodecs. Returns the MP4 bytes. MP4 (not WebM) so the
clip can be posted directly to X, which does not accept WebM.

## Why GPU
SwiftShader (software GL, what Browserless/most serverless give you) renders the
device scene but **freezes/blanks WebGL-hero sites** like hitloop.agency. A real
GPU renders them correctly + animating. Confirmed locally on Apple M4 Max
(`ANGLE Metal`); Linux hosts need an NVIDIA GPU exposed to the container.

## GPU path on Cloud Run (the fix — resolved June 2026)
Cloud Run injects the NVIDIA driver userspace (so `nvidia-smi` works) but **not a
Vulkan ICD manifest**, so the Vulkan loader finds no driver and Chrome silently
falls back to SwiftShader → blank hero. The Dockerfile fixes this by registering
an ICD at `/usr/share/vulkan/icd.d/nvidia_icd.json` → the injected
`libGLX_nvidia.so.0`. With it, `vulkaninfo` enumerates the L4 and
`--use-angle=vulkan` renders WebGL on the GPU. ANGLE's *GL* backend is a dead end
here (it needs an X display; the only one available, Xvfb, is Mesa/llvmpipe
software). The service logs the backend per render — look for
`[gpu] WebGL renderer: ANGLE (NVIDIA, Vulkan … L4) ✓ GPU` and a boot `[diag]` line
(nvidia-smi / vulkaninfo / ICD list). **Verified**: hero animates, ~9 ms/frame,
~21s warm render.

## API
- `GET /health` → `{ ok, active, max, exitAfterRender }`
- `POST /render` (header `x-render-secret: <RENDER_SHARED_SECRET>`)
  body: `{ url, seconds?, moveSeconds?, fps?, siteSpeed?, warmupMs?, scroll? }`
  → `200 video/mp4` (bytes), `x-render-info` header has frame/codec stats.
  Caps: seconds 2–10, move 0.5–8, fps 24–30. Concurrency `MAX_CONCURRENCY` (default 1).

## Scroll & capture behavior
- **Default site motion** when a recipe sets no `scroll`: `DEFAULT_SCROLL_TO_END`
  (`recipe.mjs`) — hold the hero to `startAt` (0.25), then smooth-scroll to the
  page **bottom** (`percent:100`) by `arriveAt` (1.0).
- **Scroll-to-end is pre-warmed.** For a `percent` target with no selector/text,
  the off-camera probe (`probeExpression` in `render.mjs`) first **pre-walks the
  whole document** so lazy media + scroll-triggered sections load, then measures
  the *full settled* height and resets to top (`how:'percent-prewarmed'`). Capture
  then does ONE fixed-target smooth scroll → continuous motion through every
  section, lands flush at the bottom. (Before this, the height was measured at load
  time → the scroll stopped short or jumped past sections as content loaded mid-scroll.)
- **Frame rate.** Output is true CFR at `output.fps` — clamped **24–30, default 30**
  (`recipe.mjs` + `signup-video-recipe.cjs`), encoded H.264/AVC on the L4. The
  **site** texture's temporal smoothness is bound by the screencast rate, NOT by
  output fps: raising fps smooths the camera move but not the scroll.
- **Scroll twitch fix (2026-07-01): `everyNthFrame: 1`** (was 2) on
  `Page.startScreencast` in `render.mjs`. `scene.mjs` (~line 176) maps each output
  frame to the **nearest** captured site frame (`Math.floor`, no interpolation); if
  captured frames < output frames (`fps×seconds`), each captured frame repeats for
  several output frames → chunky "twitchy" scroll. `everyNthFrame:1` captures every
  composited frame of the (already dense) rAF smooth-scroll so `playableCount ≥`
  output frames and the mapping stays smooth to the bottom. The signup/locked
  recipe was also bumped `seconds 8 → 10` (more capture time, calmer scroll). L4 has
  headroom. **Changing this requires a Cloud Run redeploy** (`deploy-cloud-run.sh`).
- ⚠️ **`siteSpeed` desyncs the scroll — do not use it to vary speed.** `scene.mjs`
  scales frame playback by `SITE_SPEED`; any value ≠ 1 breaks scroll-to-bottom
  (`<1` never reaches the last frame, `>1` wraps back to the top via `% playableCount`).
  The Video Promo variation engine deliberately never sets it — see
  `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md` §2.

## Env
| var | default | notes |
|-----|---------|-------|
| `PORT` | 8080 | |
| `RENDER_SHARED_SECRET` | (off) | require this header from callers (set in prod) |
| `MAX_CONCURRENCY` | 1 | GPU spend guard |
| `EXIT_AFTER_RENDER` | `false` | set `true` on Cloud Run so the instance exits after each render instead of waiting through idle retention |
| `USE_XVFB` | `true` | headless X display; on Cloud Run it satisfies ANGLE-Vulkan's `VK_KHR_xcb_surface` (render itself is GPU/offscreen, not via Xvfb's software GL) |
| `CHROME_PATH` | `/usr/bin/chromium` | container path |
| `CHROME_FLAGS` | `--use-gl=angle,--use-angle=vulkan,--enable-features=Vulkan,--enable-webgl,--ignore-gpu-blocklist,--disable-gpu-sandbox,--disable-dev-shm-usage,--no-sandbox` | NVIDIA L4: ANGLE-Vulkan backend (see GPU path note) |

## Local test (uses your installed Chrome + GPU)
```
cd services/studio-render
node render-cli.mjs https://hitloop.agency 6 2.5 30 1 400   # → service-render.mp4
```

## Deploy: Cloud Run GPU

Cloud Run GPU is the selected production host. The helper script deploys the
service with the cost controls we want: L4 GPU, no GPU zonal redundancy, 4 CPU,
16Gi memory, instance-based billing, min instances 0, max instances 1,
concurrency 1, `EXIT_AFTER_RENDER=true`, and `USE_XVFB=true`.

```
cd services/studio-render
GCP_PROJECT=<YOUR_FIREBASE_PROJECT_ID> \
RENDER_SHARED_SECRET=<SECRET_FROM_OPENSSL> \
./deploy-cloud-run.sh
```

Generate the secret with:

```
openssl rand -hex 24
```

Cost notes:
- Cloud Run GPU services use instance-based billing and have a 1-minute minimum
  billable lifetime per started instance.
- `EXIT_AFTER_RENDER=true` makes this service close itself after each render
  response, avoiding Cloud Run's possible idle retention window after the job.
- With one L4, 4 CPU, and 16Gi memory in `us-central1`, the target cost for an
  isolated 5s render is roughly 1-3 cents before storage/network noise.

Smoke test after deploy:

```
curl -s <SERVICE_URL>/health
curl -s -X POST <SERVICE_URL>/render \
  -H "x-render-secret: <SECRET_FROM_OPENSSL>" \
  -H "content-type: application/json" \
  -d '{"url":"https://hitloop.agency","seconds":5}' \
  -o cloud-render.mp4
```

Open `cloud-render.mp4` and confirm the WebGL hero appears and animates.

## Other GPU hosts

Build: `docker build -t studio-render services/studio-render`

Per-host GPU notes:
- **Cloud Run + GPU (L4)**: deploy with `--gpu 1 --gpu-type nvidia-l4`, set
  `--concurrency 1`, `--min-instances 0`, `--max-instances 1`,
  `--no-gpu-zonal-redundancy`, `EXIT_AFTER_RENDER=true`, and `USE_XVFB=true`.
- **Fly.io GPU**: `fly deploy` on a GPU machine, `auto_stop_machines=true`,
  `min_machines_running=0`.
- **Runpod / Modal**: wrap this image as a serverless GPU endpoint; same env.

GPU verification (Phase 0.5): hit `/render` with hitloop and confirm the WebGL
hero appears + animates (not blank). Check the `[gpu] WebGL renderer:` log line —
want `ANGLE (NVIDIA, Vulkan … L4)`, not `SwiftShader`/`Mesa…llvmpipe`/`NO-WEBGL`.
If wrong → GPU not reaching Chrome; check the boot `[diag]` lines (is the Vulkan
ICD present? does `vulkaninfo` see the GPU?) and `CHROME_FLAGS` / driver.

## Cost controls
Scale-to-zero host + `MAX_CONCURRENCY` + length/res caps + render-only-on-click
(enforced by the Vercel route, Phase 2) + `EXIT_AFTER_RENDER=true` on Cloud Run.
Target is roughly ~$0.01–0.02 per isolated 5s render, $0 idle.
