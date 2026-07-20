#!/usr/bin/env bash
set -euo pipefail

# Unlike studio-render's deploy script, this does NOT `cd` into its own
# directory first — the build needs api/_lib/*.cjs alongside it (see
# Dockerfile), so it must run from the repo root with --source . pointing at
# the repo root and --dockerfile pointing at this file explicitly.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

SERVICE_NAME="${SERVICE_NAME:-site-clone}"
REGION="${REGION:-us-central1}"
MAX_INSTANCES="${MAX_INSTANCES:-2}"
CONCURRENCY="${CONCURRENCY:-1}"
TIMEOUT="${TIMEOUT:-3000}" # seconds — a big clone run (many pages/assets + Playwright verify) can take a while; Cloud Run's own ceiling is 3600s.

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "GCP_PROJECT is required. Example: GCP_PROJECT=my-firebase-project SITE_CLONE_SHARED_SECRET=... ./deploy-cloud-run.sh" >&2
  exit 1
fi

if [[ -z "${SITE_CLONE_SHARED_SECRET:-}" ]]; then
  echo "SITE_CLONE_SHARED_SECRET is required. Generate one with: openssl rand -hex 24" >&2
  exit 1
fi

if [[ -z "${FIREBASE_ADMIN_PROJECT_ID:-}" || -z "${FIREBASE_ADMIN_CLIENT_EMAIL:-}" || -z "${FIREBASE_ADMIN_PRIVATE_KEY:-}" ]]; then
  echo "FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY are required (this worker talks to Firestore directly, same credentials as the main app)." >&2
  exit 1
fi

gcloud config set project "${GCP_PROJECT}" --quiet
gcloud config set run/region "${REGION}" --quiet
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet

# --allow-unauthenticated, same as studio-render: auth is this service's own
# x-worker-secret check (server.mjs), not Cloud Run IAM — matches the
# established pattern instead of requiring Vercel to mint Google identity
# tokens. FIREBASE_ADMIN_PRIVATE_KEY as a plain env var mirrors studio-render's
# all-env-vars approach; move it to Secret Manager (--set-secrets) as a later
# hardening step if desired, once that secret actually exists.
gcloud run deploy "${SERVICE_NAME}" \
  --quiet \
  --source . \
  --dockerfile services/site-clone/Dockerfile \
  --region "${REGION}" \
  --cpu 2 \
  --memory 2Gi \
  --concurrency "${CONCURRENCY}" \
  --min-instances 0 \
  --max-instances "${MAX_INSTANCES}" \
  --timeout "${TIMEOUT}" \
  --allow-unauthenticated \
  --set-env-vars "^|^SITE_CLONE_SHARED_SECRET=${SITE_CLONE_SHARED_SECRET}|FIREBASE_ADMIN_PROJECT_ID=${FIREBASE_ADMIN_PROJECT_ID}|FIREBASE_ADMIN_CLIENT_EMAIL=${FIREBASE_ADMIN_CLIENT_EMAIL}|FIREBASE_ADMIN_PRIVATE_KEY=${FIREBASE_ADMIN_PRIVATE_KEY}|VERCEL_AUTH_TOKEN=${VERCEL_AUTH_TOKEN:-}|VERCEL_TEAM_ID=${VERCEL_TEAM_ID:-}"

echo
echo "Cost controls applied:"
echo "- min instances: 0"
echo "- max instances: ${MAX_INSTANCES}"
echo "- request concurrency: ${CONCURRENCY}"
echo "- --allow-unauthenticated + x-worker-secret app-level auth: only the shared-secret-bearing caller (Vercel's site-clone route) can trigger a run"
echo
echo "Next step: set SITE_CLONE_WORKER_URL (this service's URL) and the same SITE_CLONE_SHARED_SECRET in Vercel's env so app/api/dashboard/site-clone/route.js can trigger it on job creation."
