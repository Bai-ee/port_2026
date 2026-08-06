#!/usr/bin/env bash
set -euo pipefail

# Deploys the CPU-only Proof/Final Render service (Phase 3,
# STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md) from Dockerfile.proof
# — completely separate from deploy-cloud-run.sh (the GPU Video Promo
# service; untouched by this script, non-negotiable #1). NOT wired into any
# automated pipeline; a human runs this deliberately, after the Phase 7
# approval gate.
#
# Explicit two-step build-then-deploy (`gcloud builds submit --file
# Dockerfile.proof` then `gcloud run deploy --image <built image>`) rather
# than a one-step `gcloud run deploy --source .` — this directory contains
# TWO Dockerfiles (the GPU service's ./Dockerfile and this service's
# ./Dockerfile.proof); `--source .` auto-detection only ever picks up a file
# literally named `Dockerfile`, which would silently build and deploy the
# WRONG (GPU) image to this CPU-only service. The explicit `--file` flag
# removes that ambiguity entirely rather than relying on gcloud's
# auto-detection to guess correctly.
cd "$(dirname "$0")"

# Freshen ALL vendored dependency closures right before every deploy — see
# scripts/vendor-elements.mjs, scripts/vendor-api-lib.mjs,
# scripts/vendor-diffusion-camera.mjs, and scripts/vendor-timeline.mjs's own
# header comments. Belt-and-suspenders on top of the committed copies, same
# discipline deploy-cloud-run.sh already established for vendor-elements.mjs
# alone.
node scripts/vendor-elements.mjs
node scripts/vendor-api-lib.mjs
node scripts/vendor-diffusion-camera.mjs
node scripts/vendor-timeline.mjs

SERVICE_NAME="${SERVICE_NAME:-studio-proof-render}"
REGION="${REGION:-us-central1}"
MAX_INSTANCES="${MAX_INSTANCES:-2}"
# Total render/job deadline is 600s (api/_lib/proof-render-jobs.cjs
# TOTAL_RENDER_DEADLINE_MS) — the Cloud Run request timeout for /run must
# stay comfortably above that so the platform never kills an in-flight
# render+upload before the worker's OWN deadline has a chance to. 60s buffer.
# drainProofRenderJobs' own DEFAULT_REQUEST_DEADLINE_MS (proof-render-
# worker.mjs, 630s) self-protects BELOW this 660s value with its own 30s
# margin — every iteration's per-job budget is clamped to the request's
# remaining time, so the worker itself stops well before Cloud Run would
# ever need to kill the request. If this TIMEOUT is ever changed, keep
# DEFAULT_REQUEST_DEADLINE_MS comfortably below it, not the other way
# around — the worker's own deadline is the real protection; this value is
# the platform-level backstop behind it.
TIMEOUT="${TIMEOUT:-660}"
ARTIFACT_REPO="${ARTIFACT_REPO:-studio-proof-render}"

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "GCP_PROJECT is required. Example: GCP_PROJECT=my-firebase-project PROOF_RENDER_SHARED_SECRET=... ./deploy-cloud-run-proof.sh" >&2
  exit 1
fi

if [[ -z "${PROOF_RENDER_SHARED_SECRET:-}" ]]; then
  echo "PROOF_RENDER_SHARED_SECRET is required. Generate one with: openssl rand -hex 24" >&2
  exit 1
fi

gcloud config set project "${GCP_PROJECT}" --quiet
gcloud config set run/region "${REGION}" --quiet
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet

# Dedicated Artifact Registry repo — never shares an image history with the
# GPU service's own repo/tags.
gcloud artifacts repositories describe "${ARTIFACT_REPO}" --location "${REGION}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "${ARTIFACT_REPO}" --repository-format=docker --location "${REGION}" --quiet

IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${ARTIFACT_REPO}/${SERVICE_NAME}:$(date +%Y%m%d%H%M%S)"

echo "Building ${IMAGE} from Dockerfile.proof ..."
gcloud builds submit --tag "${IMAGE}" --file Dockerfile.proof . --quiet

# Cost controls: scale-to-zero, concurrency 1 (one render per container
# instance — a Playwright/ffmpeg render is CPU/memory-heavy per request,
# never intended to share an instance across concurrent renders), bounded
# max instances, no GPU flags at all (this is the entire point of the
# separate CPU-only service).
gcloud run deploy "${SERVICE_NAME}" \
  --quiet \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --cpu 2 \
  --memory 4Gi \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances "${MAX_INSTANCES}" \
  --timeout "${TIMEOUT}" \
  --no-allow-unauthenticated \
  --set-env-vars "^|^PROOF_RENDER_SHARED_SECRET=${PROOF_RENDER_SHARED_SECRET}"

echo
echo "Cost controls applied:"
echo "- min instances: 0"
echo "- max instances: ${MAX_INSTANCES}"
echo "- request concurrency: 1"
echo "- request timeout: ${TIMEOUT}s (600s render/job deadline + 60s buffer)"
echo "- GPU: none (CPU-only service, isolated from studio-render's GPU image)"
echo "- public access: OFF (--no-allow-unauthenticated) — only an authenticated dispatcher (Cloud Tasks OIDC, or an authenticated manual call) can invoke /run"
echo
echo "NOT done by this script (separate, deliberate steps): Cloud Tasks queue/dispatch wiring, IAM service-account bindings, the global Studio Final Render flag, and any canary render. See the handoff's Phase 7 stop gate."
