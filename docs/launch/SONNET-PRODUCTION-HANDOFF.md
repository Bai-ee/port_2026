# Sonnet Production Handoff Plan

Objective: produce a clean, optimized, production-ready repository from the current local work, without accidental artifacts, stale diagnostics, or unneeded files. Work on a separate branch first, verify it thoroughly, then promote it to the public/main production branch only after all gates pass.

## Ground Rules

- Do not force-push or rewrite `main`.
- Do not delete user work unless it is clearly a generated diagnostic artifact or explicitly approved.
- Preserve all intentional product/media changes.
- Keep cleanup and production-hardening commits separate from feature/content commits when possible.
- Treat `.env.local` and any secret-bearing files as sensitive. Never commit them.
- Before deleting anything, list candidates and confirm they are not referenced by the app.

## Starting Context

Known current state from the last Codex pass:

- Tests pass: `npm test` → 491 passing
- Audit clean: `npm audit --audit-level=moderate` → 0 vulnerabilities
- Build passes: `npm run build`
- Smoke routes pass: `npm run smoke:routes` → 25 routes, 0 failures
- Remaining build warning: Turbopack NFT trace warning for `/api/leadgen/generate`
- Working tree still contains intentional code edits plus untracked assets/diagnostics
- Tracker file exists: `PRODUCTION-READINESS-TRACKER.md`

## Branch Strategy

1. Start from the current local repo state.
2. Create a dedicated production cleanup branch:

```bash
git checkout -b codex/production-ready-cleanup
```

3. Keep `main` untouched until the cleanup branch is verified.
4. When verified, merge via PR or non-force merge:

```bash
git checkout main
git merge --no-ff codex/production-ready-cleanup
```

5. Push `main` only after the final verification pass succeeds locally and on preview.

## Phase 1: Inventory And Classify Files

Run:

```bash
git status --short
git diff --stat
git ls-files --others --exclude-standard
du -sh public scripts .next 2>/dev/null
```

Classify every changed/untracked file into one of these buckets:

- **Keep and commit:** production code, required UI files, required public assets, docs.
- **Ignore:** local diagnostics, generated screenshots/videos, temporary scripts, output folders.
- **Delete locally:** build/cache artifacts or one-off generated files that are not useful.
- **Needs owner decision:** ambiguous new assets or files not referenced by code.

Expected files needing classification:

- `public/img/dash.png`
- `public/img/deliverables/hitloop-postme-frame.png`
- `public/img/deliverables/hitloop-video.mp4`
- `components/home/HeroDeliverableDeck.jsx`
- `skills-lock.json`
- `scripts/*.html`
- `scripts/*.jpg`
- `scripts/*.png`
- `scripts/*.webm`

## Phase 2: Reference Check Before Cleanup

Before ignoring/deleting any asset, check references:

```bash
rg -n "dash\\.png|hitloop-postme-frame|hitloop-video|HeroDeliverableDeck|creative-brief-|spike-studio|diag-|gpu-|local-render|skills-lock"
```

Rules:

- If referenced by production code and required for UI: keep and commit.
- If only referenced by local scripts/docs or not referenced: ignore or delete.
- If referenced by new UI but not yet imported anywhere: ask whether it is intended.

Recommended cleanup:

- Add diagnostic script artifacts to `.gitignore` or keep `scripts/` ignored by `.vercelignore` and avoid committing them.
- Commit only production public media that the app actually imports/serves.
- Keep `PRODUCTION-READINESS-TRACKER.md` and this handoff doc.

## Phase 3: Git Hygiene

After classification:

1. Update `.gitignore` if needed for local diagnostics.
2. Remove unneeded generated files from the working tree only after classification.
3. Stage intentionally:

```bash
git add <specific files>
git diff --cached --stat
git diff --cached
```

Avoid `git add .` until the cleanup inventory is complete.

Suggested commit grouping:

1. `security: harden production launch paths`
2. `perf: reduce launch cost and tracing bloat`
3. `ops: add health check and cron coverage`
4. `chore: clean production repo artifacts`

## Phase 4: Production Config Verification

Check Vercel/env setup before promotion.

Required envs:

- `WORKER_SECRET`
- `CRON_SECRET`
- `SOCIAL_POSTING_CRON_SECRET` if intentionally separate
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_WEEKLY`
- `STRIPE_PRICE_ID_WEEKLY_PLUS`
- `STRIPE_PRICE_ID_DAILY`
- `STRIPE_PRICE_ID_CONTINUOUS`
- `STRIPE_PRICE_ID_STUDIO`
- Firebase Admin envs
- Browserless envs
- OpenAI/Anthropic envs
- Studio render service envs

Verify:

```bash
vercel env ls
```

Do not print secret values into logs or docs.

## Phase 5: Local Verification Gate

Run in this order:

```bash
npm audit --audit-level=moderate
npm test
npm run build
npm run smoke:routes
```

Pass criteria:

- audit: 0 vulnerabilities
- tests: all passing
- build: successful
- smoke: 0 route failures

Build warning policy:

- The remaining `/api/leadgen/generate` NFT warning is acceptable only if the trace manifest stays bounded and preview deployment function sizes are acceptable.
- Inspect:

```bash
node -e "const fs=require('fs'); const p='.next/server/app/api/leadgen/generate/route.js.nft.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(j.files.length)"
```

If the trace includes app/public/root bulk again, stop and fix before promotion.

## Phase 6: Preview Deploy Gate

Deploy the cleanup branch to preview.

Recommended:

```bash
vercel --yes
```

Then verify:

- preview build succeeds
- no function size deployment failure
- `/api/health` returns `{ ok: true }`
- unauthenticated dashboard/admin routes redirect to login
- admin access works only for `admins` collection users
- signup/provisioning succeeds once and rate-limits abuse
- Studio capture rejects private/local URLs and works for normal public URLs
- deliverables ZIP works for valid Firebase Storage assets
- Knowledge Base upload/text/URL ingest returns quickly and item status progresses
- Stripe test subscription works for every displayed tier
- Stripe webhook is received and idempotent
- worker queue drains
- cron routes authorize and execute in logs

## Phase 7: Manual Launch QA

Run these flows on preview:

1. Public homepage on desktop and mobile.
2. Login flow.
3. New signup with dashboard provisioning.
4. Returning user dashboard.
5. Admin client switcher.
6. Knowledge Base add/search/chat.
7. Studio capture/render.
8. Payment modal:
   - weekly
   - weekly-plus
   - daily
   - continuous
   - studio
9. Stripe webhook event handling.
10. Social posting process-due route through cron or manual authorized trigger.

## Phase 8: Promotion To Public/Main

Only promote if all gates pass.

Preferred promotion path:

1. Commit all cleanup branch changes.
2. Push branch.
3. Open PR into `main`.
4. Review changed file list for accidental artifacts.
5. Merge into `main`.
6. Deploy production from `main`.
7. Watch logs and dashboards for at least 60 minutes.

Do not promote if:

- audit fails
- tests fail
- build fails
- smoke fails
- preview function size fails
- Stripe tier mapping is unverified
- cron auth is unverified
- unclassified artifacts remain staged

## Phase 9: Post-Launch Monitoring

Monitor immediately after production promotion:

- Vercel 5xx and latency
- worker run failures
- worker queue age
- Browserless failures/spend
- Firestore read/write spikes
- Stripe webhook failures
- OpenAI/Anthropic spend
- signup/provisioning errors
- dashboard bootstrap errors

Recommended rollback:

- Keep the previous production deployment available in Vercel.
- If payment, auth, data isolation, or worker queue failures appear, roll back first, debug second.

## Final Deliverable

Sonnet should leave the repo with:

- clean production branch
- no accidental local artifacts committed
- passing audit/tests/build/smoke
- preview deployment verified
- production env checklist completed
- PR/merge path into `main`
- updated `PRODUCTION-READINESS-TRACKER.md` with final status
