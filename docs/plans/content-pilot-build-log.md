# Content Management — owner-pilot hardening build log

Worktree `~/Documents/Repos/Bballi_Portfolio-pilot`, branch `feat/content-pilot` from `feat/content-management` @ `da811b6b` (normalization complete). Dev server (when needed): `npm run dev -- -p 3006`. Plan: `docs/plans/CONTENT-MANAGEMENT-PILOT-LAUNCH-HARDENING.md`; orchestrator rules: `...-PILOT-LAUNCH-PROMPT.md` (wins on conflict). Owner client `bryan-balli-WUoltG84`.

## Phase 0 — base pinned
- Verified hard-stop 1: `-calendar` (80e4c201), `-content-system` (38f38a38), `-content-mgmt` (da811b6b) all clean at start.
- Base: `da811b6b`; this branch's first commit `783e4b20` adds the plan + prompt.
- Baseline `npm test`: **4888 tests, 4886 pass, 2 fail** = the two known vendor-api-lib failures. No flakes in this run.
- Commands: `npm install` (done), `npm test`, `npm run dev -- -p 3006`; never `npm run build` while a dev server runs in this worktree.
- Configured production paths (read from repo, activation unverified): `vercel.json` crons — `process-due` `40 13 * * *` (daily), digest/render/reconcile daily; `.github/workflows/social-publish-sweep.yml` (`*/30`, inert unless `vars.SOCIAL_PUBLISH_ENABLED=='true'`); other sweeps (`brief-worker-sweep`, `digest-delivery-sweep`, `email-digest-dispatch`) not social. `STALE_DUE_MS` = 26h (`twitter-service.js:290`).
- Owner decisions applied (not re-asked): Vercel Pro (publisher = existing `process-due` cron every 15 min, `STALE_DUE_MS` ~2h, GitHub sweep stays documented-disabled); reply-scheduling block for NEW (v2) posts only; manual scheduling enforces the plan by default.
