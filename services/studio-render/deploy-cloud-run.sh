#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-studio-render}"
REGION="${REGION:-us-central1}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"
MAX_CONCURRENCY="${MAX_CONCURRENCY:-1}"
TIMEOUT="${TIMEOUT:-120}"
CHROME_FLAGS="${CHROME_FLAGS:---use-gl=angle,--use-angle=vulkan,--enable-features=Vulkan,--enable-webgl,--ignore-gpu-blocklist,--disable-gpu-sandbox,--disable-dev-shm-usage,--no-sandbox}"

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "GCP_PROJECT is required. Example: GCP_PROJECT=my-firebase-project RENDER_SHARED_SECRET=... ./deploy-cloud-run.sh" >&2
  exit 1
fi

if [[ -z "${RENDER_SHARED_SECRET:-}" ]]; then
  echo "RENDER_SHARED_SECRET is required. Generate one with: openssl rand -hex 24" >&2
  exit 1
fi

gcloud config set project "${GCP_PROJECT}" --quiet
gcloud config set run/region "${REGION}" --quiet
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet

gcloud run deploy "${SERVICE_NAME}" \
  --quiet \
  --source . \
  --region "${REGION}" \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --cpu 4 \
  --memory 16Gi \
  --no-cpu-throttling \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances "${MAX_INSTANCES}" \
  --timeout "${TIMEOUT}" \
  --allow-unauthenticated \
  --set-env-vars "^|^RENDER_SHARED_SECRET=${RENDER_SHARED_SECRET}|MAX_CONCURRENCY=${MAX_CONCURRENCY}|EXIT_AFTER_RENDER=true|USE_XVFB=true|CHROME_FLAGS=${CHROME_FLAGS}"

echo
echo "Cost controls applied:"
echo "- min instances: 0"
echo "- max instances: ${MAX_INSTANCES}"
echo "- request concurrency: 1"
echo "- service concurrency guard: ${MAX_CONCURRENCY}"
echo "- GPU zonal redundancy: off"
echo "- exit after render: true"
echo "- Xvfb display: true"
