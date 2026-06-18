# Mockup Studio — GPU Render Hosting

How to host the `studio-render` service so the Creative Director card can
auto-generate mockup videos (live site loading in a 3D device, camera move,
auto-scroll). This doc covers **what we need, why, the options, costs, and a
step-by-step setup** for the recommended host.

> Status: ✅ **Live on Cloud Run GPU** (NVIDIA L4, project `human-in-the-loop-a1a19`,
> region `us-central1`). The WebGL-hero fidelity blocker is resolved — see the GPU
> path note in §4. Wired to the dashboard's **Mockup Studio** card ("RUN VIDEO");
> an admin-only **GPU Render Service** card shows live status, cost, and performance.
> This doc remains the decision + setup guide.

---

## 1. What we're hosting

A small HTTP service (Node + headless Chrome, in `services/studio-render/`) that,
on `POST /render`, produces one MP4 (H.264) video and returns it. The Vercel app calls
it when you click "Run" on the Creative Director card.

## 2. Why it needs a GPU (the core requirement)

We proved this the hard way during the spike:

- Target sites like **hitloop.agency render their hero (text + spinning ring) in
  WebGL**. On a **software renderer** (SwiftShader — what Browserless and most
  serverless platforms give you) that WebGL hero **freezes or renders blank**.
- On a **real GPU**, the same site renders correctly **and animates**. Confirmed
  locally on your Apple M4 Max (`ANGLE Metal`).

So: to show the live site loading/animating inside the mockup, the headless
browser **must have a real GPU**. There is no software workaround — it's the one
hard requirement that rules out the free/serverless options.

## 3. Requirements

| Requirement | Why |
|---|---|
| **NVIDIA GPU** exposed to the container | WebGL-hero sites only render + animate on real GPU |
| **Runs a Docker container** | service ships as a Dockerfile (`services/studio-render/Dockerfile`) |
| **HTTP-triggerable** | Vercel route calls it on user click |
| **Scale-to-zero** | renders are on-demand/infrequent → don't pay for idle GPU |
| **Outbound internet** | must load the live target site + `esm.sh` modules |
| **~60–90s request budget** | render itself is ~seconds on GPU; cold start is the variable |
| **Concurrency control** | cap parallel renders so GPU spend can't run away (service enforces `MAX_CONCURRENCY`) |

Render cost profile (measured locally): ~**3 ms/frame on GPU**, ~1–2s to render a
6s clip. The wall-clock cost is dominated by **cold start** (pulling the image +
GPU init), not the render.

## 4. Options & costs

> Prices are **approximate (June 2026)** and region-dependent — verify current
> rates before committing. Cloud Run GPU services use instance-based billing with
> a 1-minute minimum per started instance. We enable `EXIT_AFTER_RENDER=true` so
> the container exits after each render response instead of waiting through Cloud
> Run's possible GPU idle-retention window.
>
> **GPU path (resolved):** Cloud Run injects the NVIDIA driver userspace (so
> `nvidia-smi` works) but **not a Vulkan ICD manifest**, so the Vulkan loader finds
> no driver and Chrome silently falls back to SwiftShader (software → blank WebGL
> hero). The fix is to register an ICD at build time
> (`/usr/share/vulkan/icd.d/nvidia_icd.json` → the injected `libGLX_nvidia.so.0`).
> With it, `vulkaninfo` enumerates the L4 and Chrome's **ANGLE-Vulkan** backend
> (`--use-angle=vulkan`) renders WebGL on the real GPU. ANGLE's *GL* backend is a
> dead end on Cloud Run: it requires an X display, and the only one available
> (Xvfb) is Mesa/llvmpipe software. Xvfb still runs (`USE_XVFB=true`) only to
> satisfy ANGLE-Vulkan's `VK_KHR_xcb_surface`; rendering is GPU/offscreen.
> Verified: `[gpu] WebGL renderer: ANGLE (NVIDIA, Vulkan 1.3.242 (NVIDIA L4))`,
> hitloop hero animates, ~8 ms/frame, ~21s render.

| Option | GPU | ~$/hr active | ~$/video | Scale-to-zero | Cold start | Ops effort | Notes |
|---|---|---|---|---|---|---|---|
| **Google Cloud Run + GPU** ⭐ | NVIDIA L4 | ~$1.05 all-in active | ~$0.01–0.02 target | Yes | ~10–40s | Low | **Same GCP project/billing as your Firebase.** HTTP-native. Best fit. |
| **Fly.io GPU** | A10 / L40S | ~$1.50 / ~$2.50 | ~$0.02–0.05 | Yes (autostop) | ~5–30s | Low–Med | Simple `fly deploy`. Separate account/billing. |
| **Modal** | L4 / A10G | ~$0.80 / ~$1.10 | ~$0.01–0.03 | Yes (fast) | fast (~secs) | Med | Purpose-built serverless GPU; wraps our container. Python-centric tooling. |
| **Runpod serverless** | L4 / A4000 | ~$0.69 (flex) | ~$0.01–0.02 | Yes | ~secs–30s | Med | Cheapest per-second; less polished than the above. |
| **Browserless GPU / dedicated** | varies | $$$$ | high | No (dedicated) | n/a | Low | Enterprise/dedicated only; expensive; availability unconfirmed. Not recommended. |

### Monthly cost by volume (rough, recommended host)

| Videos / month | Est. monthly cost |
|---|---|
| 50 | ~$0.50–1.50 |
| 250 | ~$2.50–7.50 |
| 1,000 | ~$10–30 |

Idle cost = **$0** with `--min-instances 0`. Google still bills a minimum of one
minute for each GPU instance that starts. The service exits after each render to
avoid paying for unnecessary idle lifetime after the response.

## 5. Recommendation: Google Cloud Run + GPU (L4)

Why, for you specifically:
- **You're already on GCP** — Firebase is a GCP project. Same console, same
  billing account, same IAM. No new vendor.
- **Scale-to-zero** with GPU is supported → $0 idle.
- **HTTP-native** → the Vercel route just POSTs to a URL.
- Lowest ops: one `gcloud run deploy`.

Trade-offs:
- Cold starts (~10–40s) on each render when `EXIT_AFTER_RENDER=true`. This is
  intentional: it keeps cost close to the 1-minute Cloud Run minimum.
- Do not keep a warm GPU instance unless volume is high. One warm L4 instance is
  roughly ~$1/hr all-in before discounts/free-tier effects.

---

## 6. Step-by-step setup (Cloud Run + GPU)

You run these — I can't authenticate your cloud. In this chat you can prefix a
command with `!` to run it inline (e.g. `! gcloud auth login`).

### Prereqs
- The GCP project that backs your Firebase (find it in Firebase console → Project
  settings → Project ID).
- `gcloud` CLI installed (`brew install --cask google-cloud-sdk`).
- GPU quota: Cloud Run GPUs need a quota grant. New projects often need to
  request **"Cloud Run Admin API — NVIDIA L4 GPUs"** quota (can take a little
  while to approve).

### 1) Auth + select project
```
gcloud auth login
gcloud config set project <YOUR_FIREBASE_PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### 2) Pick a GPU region
L4 on Cloud Run is in a limited set of regions (e.g. `us-central1`).
```
gcloud config set run/region us-central1
```

### 3) Generate a shared secret (Vercel ↔ service auth)
```
openssl rand -hex 24      # save this value — you'll set it on both sides
```

### 4) Build + deploy from the service dir
Recommended: use the checked-in helper so the cost-control flags stay consistent.
It deploys with `--min-instances 0`, `--max-instances 1`, `--concurrency 1`,
`--no-gpu-zonal-redundancy`, `EXIT_AFTER_RENDER=true`, and `USE_XVFB=true`.

```
cd services/studio-render
GCP_PROJECT=<YOUR_FIREBASE_PROJECT_ID> \
RENDER_SHARED_SECRET=<SECRET_FROM_STEP_3> \
./deploy-cloud-run.sh
```

Manual equivalent:

```
cd services/studio-render
gcloud run deploy studio-render \
  --source . \
  --gpu 1 --gpu-type nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu 4 --memory 16Gi \
  --no-cpu-throttling \
  --concurrency 1 \
  --min-instances 0 --max-instances 1 \
  --timeout 120 \
  --allow-unauthenticated \
  --set-env-vars ^\|^RENDER_SHARED_SECRET=<SECRET_FROM_STEP_3>\|MAX_CONCURRENCY=1\|EXIT_AFTER_RENDER=true\|USE_XVFB=true\|CHROME_FLAGS=--use-gl=angle,--use-angle=vulkan,--enable-features=Vulkan,--enable-webgl,--ignore-gpu-blocklist,--disable-gpu-sandbox,--disable-dev-shm-usage,--no-sandbox
```
> The `^\|^` prefix sets `|` as the env-var delimiter so the comma-separated
> `CHROME_FLAGS` value isn't split into separate vars. The Dockerfile bakes the
> NVIDIA Vulkan ICD manifest; `--use-angle=vulkan` then reaches the L4.
> `--allow-unauthenticated` keeps it simple; the shared secret protects it. If you
> prefer, drop that flag and use GCP IAM auth instead (more setup).
>
> `EXIT_AFTER_RENDER=true` is the important shutdown guard. After `/render`
> returns the MP4, the service closes its listener and exits, so Cloud Run can
> terminate the GPU instance instead of leaving it idle.
>
> `USE_XVFB=true` gives ANGLE-Vulkan the `VK_KHR_xcb_surface` it asks for. The GPU
> render itself is offscreen on the L4 (the NVIDIA Vulkan ICD), not via Xvfb —
> Xvfb is Mesa/software and is only there to satisfy the surface extension.

### 5) Grab the URL + smoke-test
The deploy prints a `Service URL`. Test it:
```
curl -s <SERVICE_URL>/health
curl -s -X POST <SERVICE_URL>/render \
  -H "x-render-secret: <SECRET>" -H "content-type: application/json" \
  -d '{"url":"https://hitloop.agency","seconds":5}' \
  -o cloud-render.mp4
open cloud-render.mp4
```

### 6) Phase 0.5 — verify GPU (the go/no-go) — ✅ PASSED
Open `cloud-render.mp4`. **Confirm hitloop's WebGL hero (text + ring) appears
and animates** — not blank. The service logs the actual backend per render:
`[gpu] WebGL renderer: …`. Expect `ANGLE (NVIDIA, Vulkan … L4)`; if it says
`SwiftShader`/`Mesa…llvmpipe`/`NO-WEBGL`, the GPU isn't reaching Chrome — check the
boot `[diag]` lines (nvidia-smi, vulkaninfo, ICD list) and `CHROME_FLAGS`.
Resolved June 2026 via the NVIDIA Vulkan ICD + `--use-angle=vulkan` (see §4 note).

### 7) Hand me two values to finish Phases 2–3
- `STUDIO_RENDER_URL` = the Service URL
- `STUDIO_RENDER_SECRET` = the secret from step 3

I'll set them as Vercel env vars (you approve), build the `/api/dashboard/studio-render`
route + Creative Director button, and the card will produce videos.

---

## 7. Alternative quickstart: Fly.io GPU

If you'd rather not use GCP:
```
brew install flyctl
fly auth login
cd services/studio-render
fly launch --no-deploy            # creates fly.toml; pick a GPU region
# edit fly.toml: set a GPU machine (e.g. a10), [http_service] auto_stop_machines=true, min_machines_running=0
fly secrets set RENDER_SHARED_SECRET=<secret>
fly deploy
```
Same `/health` + `/render` smoke test as above.

---

## 8. Cost-control checklist (built in + operational)

- [x] **Scale-to-zero** host (`--min-instances 0`) → $0 idle.
- [x] **`MAX_CONCURRENCY=1`** in the service → one GPU render at a time.
- [x] **`--concurrency 1` + `--max-instances 1`** → hard cap on parallel GPU instances.
- [x] **`--no-gpu-zonal-redundancy`** → avoids the higher redundant-GPU rate.
- [x] **`EXIT_AFTER_RENDER=true`** → exits after each render response to avoid idle GPU lifetime.
- [x] **NVIDIA Vulkan ICD baked in image** → `--use-angle=vulkan` reaches the L4 (the actual GPU fix; without it Chrome falls back to SwiftShader → blank hero).
- [x] **`USE_XVFB=true`** → satisfies ANGLE-Vulkan's `VK_KHR_xcb_surface`; render is GPU/offscreen.
- [x] **Length/resolution caps** in the service (`seconds` 2–10, fps 24–30).
- [x] **Render only on explicit click** (enforced by the Vercel route, Phase 2).
- [ ] **Set a GCP budget alert** (Billing → Budgets & alerts) — recommended.
- [ ] Optionally **cache** the per-URL site capture so re-renders skip nav (later optimization).

## 9. What runs where (recap)

```
[Creative Director card]  →  POST /api/dashboard/studio-render  (Vercel, auth'd)
                                   │  x-render-secret
                                   ▼
                        [studio-render service]  (Cloud Run GPU, scale-to-zero)
                                   │  returns MP4
                                   ▼
                  reuse existing upload-video path → Firebase Storage
                                   ▼
                     card displays the video (studioCaptures)
```
