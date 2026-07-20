# CPU-only clone-engine worker — no GPU needed, unlike services/studio-render.
#
# Build context = REPO ROOT (not this directory — unlike studio-render's
# `cd "$(dirname "$0")"` pattern). This service's code requires a handful of
# api/_lib/*.cjs modules by relative path (clone-jobs.cjs, site-clone-publish.cjs,
# firebase-admin.cjs, storage-artifacts.cjs, safe-fetch.cjs) exactly like the
# local CLI does — the COPY commands below preserve that same repo-relative
# directory layout inside the image so those requires resolve unchanged.
# deploy-cloud-run.sh invokes this with
# `gcloud run deploy --source . --dockerfile services/site-clone/Dockerfile`
# run from the repo root.

FROM mcr.microsoft.com/playwright:v1.61.0-noble

ENV DEBIAN_FRONTEND=noninteractive
# `zip` for package.mjs's zipSite() — not present in the Playwright base image.
RUN apt-get update && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install first (cached layer) — only the extra deps this worker needs beyond
# what the Playwright base image already provides (Chromium + its system libs).
COPY services/site-clone/package.json ./package.json
RUN npm install --omit=dev

# Preserve the exact repo-relative layout so every existing
# `require('../../api/_lib/...')` / `require('../../../api/_lib/...')` in this
# service's code resolves unchanged from local dev.
COPY api/_lib/clone-jobs.cjs api/_lib/site-clone-publish.cjs api/_lib/firebase-admin.cjs api/_lib/storage-artifacts.cjs api/_lib/safe-fetch.cjs ./api/_lib/
COPY services/site-clone/ ./services/site-clone/

ENV PORT=8080
EXPOSE 8080
WORKDIR /app/services/site-clone
CMD ["node", "server.mjs"]
