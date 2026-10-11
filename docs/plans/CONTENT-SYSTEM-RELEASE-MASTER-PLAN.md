# Content system release — final master plan

Date: 2026-10-11. Owner decision: **merge everything from the content workstream to `main` and deploy to the public URL (hitloop.agency)** so a human developer can review it and the owner can test on device. Live X posting batches stay a separate owner action.

## Scope (verified against `origin/main`)
| Branch / commit | Disposition |
|---|---|
| `feat/content-pilot` @ 264cd139 (52 commits: daily loop, X Strategy tab, Content Engine UI, social-archive Timeline, normalization, pilot hardening) | **Ship** — release base |
| `fix/nas-job-status-labels` 38f38a38 (Discogs panel, NAS + social-archive ingest edits) | **Merge** — conflict in `quote-targets/route.js` |
| `feat/records-acs-hooks` 9163bac6 (Discogs ACS fields, packageId join key, backfill script) | **Merge** — clean |
| `feat/content-calendar-month` 80e4c201 | **Superseded** — UI adopted in normalization, server re-implemented as `approveAndSchedule`; not merged |
| `feat/daily-content-loop`, `feat/content-engine-ui`, `feat/content-management`, `feat/content-calendar-month` | Contained in the release; archive after deploy |
| Old codex archive branches (3 wks, 110 behind), `onboarding-brief`/`production` (4 months), `snapshot/*` | Out of scope — stale, not part of this workstream |
| Main checkout uncommitted media edits (`editvideos-bridge.cjs`, `media/route.js`, `pre-digest-video/route.js`) | Out of scope — separate Archive WIP, untouched |

## Verified preconditions
- `SOCIAL_PUBLISH_ENABLED` GitHub variable is unset → `social-publish-sweep.yml` is inert (`if: vars.SOCIAL_PUBLISH_ENABLED == 'true'`). One publisher = Vercel cron `process-due` every 15 min.
- Preview env shares production Firebase admin, `TWITTER_*` (live @bai_ee) and Anthropic keys; `CRON_SECRET` is Production-only; previews are behind Vercel SSO.
- Cron route and pilot actions fail closed when their secrets/allowlists are unset.

## Phases
**R0 — integrate (orchestrator).** Branch `release/content-system` from `feat/content-pilot`; merge 9163bac6, merge 38f38a38 (keep both sides' route actions; Discogs panel mounts in the existing nav without changing tab ids); `git rm` the 4 build-log screenshots in `docs/plans/x-strategy-build-log-screens/`. Gate: targeted tests.

**R1 — parallel Sonnet tracks (disjoint files, no git writes):**
- A. Discogs integration: DiscogsPanel reachable in the new workspace, its actions behind the existing admin gate, tests green. Owns `components/dashboard/x-content/DiscogsPanel.jsx`, `features/discogs-ingest/*`.
- B. Real-contention test: `scripts/pilot/contention-test.mjs` — N concurrent schedulers through the real `reservations.js` transactions against live Firestore under a throwaway client id `zz-contention-test`, asserting no double-booked slot/package and spacing held; deletes everything it wrote. Orchestrator runs it.
- C. Developer handoff: `docs/DEVELOPER-HANDOFF-CONTENT-SYSTEM.md` — what was built, architecture map (stores → services → routes → UI), run/test commands, SSOT links, known limits, branch history, superseded work, plus an owner on-device review checklist.
- D. Fresh reviewer: whole diff vs `origin/main` for production regressions affecting non-owner clients (social-posting, quote-targets, crons, approval tokens), leftover debug code, secrets. Findings only.

**R2 — gate (orchestrator).** Fix R1 findings; full `npm test` (baseline: only vendor-api-lib ×2); push → Vercel preview READY.

**R3 — production config (orchestrator).** Read-only check for overdue scheduled rows (the stale window drops 26h → 2h); set Production `PILOT_OWNER_UIDS` + `PILOT_CLIENT_IDS`; remove `TWITTER_*` from Preview; record the current production deployment id for rollback.

**R4 — ship (orchestrator).** PR `release/content-system` → `main` with the handoff as its body; squash-merge (keeps screenshot blobs out of `main` history; the PR keeps per-commit history); production deploy READY; smoke: public pages 200, `/dashboard` requires sign-in, `process-due` without secret refused, crons registered.

**R5 — handoff.** PR URL + public URL + device checklist to the owner; update repo map and memory.

## Rollback
Vercel → Deployments → promote the recorded previous production deployment (instant). Code: `git revert -m 1 <merge>` or revert the squash commit on `main`. Env: remove `PILOT_*` (pilot actions then refuse with 503; legacy flows unaffected).

## Not in this release
Live posting batches, enabling the GitHub sweep, installing the local scan/refresh worker, customer access.
