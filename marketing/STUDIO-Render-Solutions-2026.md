# STUDIO Render — Solutions Research (2026)

> **Document type:** infrastructure decision / research doc.
> **Subject:** the `studio-render` GPU service that produces mockup/promo videos (live site loading in a 3D
> device, WebGL hero animating). Evaluates whether the current host is still the best solution.
> **Grounds in:** the uploaded `STUDIO_RENDER_HOSTING.md` (current state) + 2026 market research.
> **Prepared:** 2026-06-25.

---

## 0. TL;DR

**Keep Cloud Run GPU (L4) as the baseline — it's the right call and the hard problem is already solved.** The one weakness worth fixing is **cold start (10–40s)**, and that matters more than cost because the render is the *wow moment in the sales diagnostic*. Fix cold start with **site-capture caching first** (cheapest, no migration); pilot **RunPod serverless (FlashBoot ~1s)** only if cold start stays a demo liability or volume scales. Do **not** move to a managed GPU-browser service (Browserless GPU) at this volume — it's expensive and doesn't scale to zero.

---

## 1. What the service actually needs (the hard constraints)

From the current hosting doc, the non-negotiables are:

1. **A real NVIDIA GPU reachable by headless Chrome.** Target sites (e.g. hitloop.agency) render their hero in **WebGL**; on a software renderer (SwiftShader) the hero freezes or renders blank. This rules out every free/serverless-CPU option. The fix was non-trivial: bake an NVIDIA Vulkan ICD into the image and run Chrome with `--use-angle=vulkan`. **This is solved on Cloud Run today.**
2. **Scale-to-zero.** Renders are on-demand and infrequent → must not pay for idle GPU.
3. **HTTP-triggerable container** (Vercel route POSTs to it).
4. **Low ops** — solo operator; minimize vendors and maintenance.
5. **Tiny cost at low volume** — current spend is ~$0.01–0.02/video, ~$10–30/mo even at 1,000 videos.

The render itself is fast (~8 ms/frame, ~21s for a clip). **Wall-clock is dominated by cold start, not render.** That single fact drives this whole analysis.

---

## 2. The options (2026)

| Host | GPU | Cold start | Scale-to-zero | Cost posture | WebGL setup | Ops / fit |
|---|---|---|---|---|---|---|
| **Cloud Run GPU (current)** ⭐ | L4 (24GB) | ~10–40s | Yes (`min-instances 0`) | ~$0.84/hr active; 1-min min/start; ~$0.01–0.02/video | **Already solved** (Vulkan ICD baked) | Same GCP project/billing as Firebase. Lowest migration risk. |
| **RunPod serverless** | L4 / A4000+ | **~1s (FlashBoot)**, 48% <200ms | Yes | Cheapest/sec; ~30–95% under AWS/GCP; zero egress | Must re-prove the GPU/WebGL Docker setup | Separate vendor. Best cold-start + cost combo. Less polished. |
| **Modal** | L4 / A10 | 2–4s | Yes | Per-second, but **1.25×–3.75× multipliers** (region + production guarantee) erode the headline rate | Re-prove setup; Python-centric tooling wrapping a Node container | Good DX; multipliers + Node mismatch make it a weaker fit here. |
| **Fly.io GPU** | A10 / L40S | ~5–30s | Yes (autostop) | ~$1.50–2.50/hr active | Re-prove setup | Simple `fly deploy`; separate billing. |
| **Browserless GPU (managed)** | varies | n/a (dedicated) | **No** | $$$$ dedicated/enterprise | **Zero setup** — they maintain the GPU browser | Removes all infra maintenance, but no scale-to-zero + expensive = wrong for low/infrequent volume. |

Sources: [RunPod serverless guide](https://www.runpod.io/articles/guides/top-serverless-gpu-clouds), [Modal vs RunPod billing](https://www.buildmvpfast.com/blog/scale-to-zero-serverless-gpu-modal-runpod-ai-hosting-2026), [Modal pricing](https://modal.com/pricing), [Cloud Run GPU docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [Browserless GPU](https://www.browserless.io/blog/browserless-gpu-instances).

---

## 3. Reading the research against *your* situation

**Cost is already a non-issue.** At ≤1,000 videos/month you're at ~$10–30/mo on Cloud Run, $0 idle. RunPod would shave that further, but you'd be optimizing a rounding error. **Do not switch hosts to save money** — the savings don't justify re-solving the WebGL/Vulkan setup on a new platform.

**Cold start is the real lever — and it's strategic, not cosmetic.** Per the Angles/ Rollout work, the promo video is the *wow* inside the free diagnostic that opens every sales conversation. A 10–40s wait when you're demoing live to a prospect is a credibility tax. So cold start is worth attacking — but host migration is the *expensive* way to attack it.

**The break-even math confirms staying put.** Research puts the serverless-vs-dedicated break-even around ~30% GPU utilization; below that, scale-to-zero serverless wins. You're far below 30% — so the *model* (scale-to-zero GPU) is right, and Cloud Run already implements it within your existing billing.

**Managed GPU-browser (Browserless) is the wrong shape.** It would delete your infra-maintenance burden (attractive for a solo operator), but it's dedicated and expensive with no scale-to-zero — the opposite of an infrequent-render profile. Only revisit if maintaining the container ever becomes a genuine time sink.

---

## 4. Recommendation

**Stay on Cloud Run GPU L4.** It's working, it's cheapest-to-keep, it shares Firebase billing/IAM, and it already solved the one genuinely hard thing (WebGL on GPU). Migration risk > any upside today.

**Then reduce cold start, cheapest lever first:**

1. **Cache the per-URL site capture** (already listed as a future optimization in your hosting doc). Re-renders skip navigation/asset load — the slowest part after GPU init. Biggest win for zero vendor change.
2. **Warm-on-intent:** when a user opens the card / starts a diagnostic, fire a tiny warm-up ping so the GPU instance is spun up by the time they click "Run." Trades a few cents for a near-instant feel during live demos.
3. **Pre-render for outreach:** for the diagnostic wedge specifically, generate the prospect's promo *ahead of the conversation* (batch, off the critical path) so the demo plays instantly. This aligns render timing with the sales motion instead of fighting cold start in real time.

**Decision trigger to revisit hosts:** pilot **RunPod serverless** (FlashBoot ~1s cold start, cheapest/sec, zero egress) only if (a) cold start remains a live-demo liability after the caching/warm-up fixes, or (b) monthly volume climbs toward ~30% utilization. RunPod is the best cost+cold-start target; budget time to re-prove the NVIDIA Vulkan ICD + ANGLE-Vulkan setup in its Docker environment before committing.

**Escape hatch (only if ops pain):** if maintaining the GPU/Chrome/Vulkan container ever costs more of your time than it's worth, Browserless GPU removes that burden entirely — accept the higher cost and loss of scale-to-zero as the price of zero maintenance.

---

## 5. One-line summary

The current Cloud Run GPU L4 host is the correct baseline — don't migrate for cost. Attack **cold start** (caching → warm-on-intent → pre-render for outreach) because the render is your sales wow; keep **RunPod serverless** in your pocket as the migration target if cold start or volume ever forces the issue.

## Sources
- [RunPod — top serverless GPU clouds 2026](https://www.runpod.io/articles/guides/top-serverless-gpu-clouds) · [Scale-to-zero: Modal vs RunPod vs Replicate](https://www.buildmvpfast.com/blog/scale-to-zero-serverless-gpu-modal-runpod-ai-hosting-2026) · [Modal pricing](https://modal.com/pricing) · [Cloud Run GPU docs](https://docs.cloud.google.com/run/docs/configuring/services/gpu) · [Browserless GPU instances](https://www.browserless.io/blog/browserless-gpu-instances) · [GPU cloud pricing 2026](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/)
