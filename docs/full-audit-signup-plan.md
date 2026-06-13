# Full-Audit Signup — Implementation Plan (SOURCE OF TRUTH)

> Status: APPROVED PLAN — implement in phase order. Do not re-plan.
> Owner: Bryan. Created 2026-06-09 from a verified code review session.
> Companion diagram: `docs/search-param-flow.html` (two-lane flow, store A/B model).

---

## MASTER PROMPT (paste this to the implementer model)

You are the IMPLEMENTER for an approved plan. Rules:

- Read `docs/full-audit-signup-plan.md` (this file) fully before touching code. It is the source of truth; do not drift to other plans or invent scope.
- Implement ONE phase at a time, in order. Stop after each phase and report using the format at the bottom of this doc. Wait for approval before the next phase.
- Minimal diffs. Preserve established patterns. No new libraries. Do not refactor adjacent code.
- Every file:line reference in this doc was verified against the codebase on 2026-06-09. Re-verify a reference if the file has churned; if reality contradicts this doc, STOP and report the conflict instead of improvising.
- Do not touch billing/auth/blockchain-adjacent logic. Do not change the two-store data model (described below).
- All Firestore writes must use `merge:true` patterns consistent with existing code in the files you touch.

Current task: implement **Phase 1**, then stop.

---

## 1. Goal

1. Signup with a website URL, or adding/changing the URL later from the dashboard, triggers a FULL audit: all audit-card modules run AND the brand identity (`scoutConfig`) is generated. Every card arrives populated; the user then edits/personalizes.
2. Signup with name only (no URL): the same cards seed from name/idea-derived defaults so the user can build a custom brief from custom search parameters, and their card edits become the canonical identity.

## 2. Verified architecture facts (read before coding)

Two stores, one identity:

- **Store A** = `client_configs/{clientId}.scoutConfig` — canonical brand identity (`clientName`, `brandKeywords[]` (quoted), `categoryTerms[]`, `competitors[]`, `reddit{subreddits,mentionQueries}`, `industry`). Written by the audit; read A-first at every run.
- **Store B** = `client_configs/{clientId}.marketingBriefConfig` — the dashboard cards. Card save mirrors brand-identity fields B→A (`app/api/dashboard/marketing-brief/config/route.js:176-200`), **gated: mirror only happens if A already exists**.
- Runtime resolution: `features/not-the-rug-brief/config-loader.js:270-286` — A wins, B fallback, then derived. All non-identity fields read from B only.

Signup/run plumbing:

- Signup: `api/_lib/client-provisioning.cjs` — `provisionClientForUser` (~:216) writes `moduleConfig: getDefaultModuleConfig()` (:341) and queues a `brief_run` (`queueInitialBriefRun` ~:181, `trigger:'signup'`, `pipelineType:'free-tier-intake'`).
- Worker: `app/api/worker/run-brief/route.js` — if `clientConfig.moduleConfig` exists (ALWAYS true for new clients) takes the modular path (:112-126): filters `enabled === true` modules and calls `runModules`. Else legacy `runIntakePipeline` (:167-168).
- `runModules`: `features/scout-intake/runner.js:1010` — `Promise.all` parallel fan-out over `MODULE_RUNNERS` (:988): `multi-device-view`, `social-preview`, `seo-performance`, `agent-readiness`, `style-guide`, `design-evaluation`.
- Registry: `features/scout-intake/module-registry.js` — REGISTRY has 5 entries; **only `multi-device-view` is `foundational:true`**, so `getDefaultModuleConfig()` (:71) enables only that one. `design-evaluation` has a runner but NO registry entry. `autoRunOnSignup` flag is written but never read by the worker.
- Brand identity generator: `ensureScoutConfig` (`features/scout-intake/scout-config-generator.js:552`). Call sites (the ONLY two): `runner.js:605` (inside legacy `runIntakePipeline`) and `app/api/dashboard/scout-config-regenerate/route.js:89` (manual; fetches fresh crawl evidence itself — see its :29 comment).
- Card seeding: `DashboardPage.jsx:268-322` `buildDefaultMarketingBriefConfig` — seeds Brand & Keywords from A (strip-quotes :274-:280); operational cards seed from defaults; 5 default `searches[]` rows.

**The two gaps this plan closes:**

- G1: fresh signup runs ONE module (`multi-device-view`), not all.
- G2: modular path never calls `ensureScoutConfig` → store A never generated at signup → Brand & Keywords seeds from defaults, and the B→A mirror gate keeps A empty forever for name-only users.

## 3. Phases

### Phase 1 — All modules run at signup
- `features/scout-intake/module-registry.js`: set `foundational: true` on `social-preview`, `seo-performance`, `agent-readiness`, `style-guide`. Add a REGISTRY entry for `design-evaluation` (mirror the shape of `style-guide`; `category:'onboarding'`, `cacheOnSuccess:true`, `retryOnFailure:true`, `foundational:true`; dependencies per its runner in `features/scout-intake/modules/design-evaluation.js`).
- Decide `autoRunOnSignup`: either make the worker filter on it for signup-trigger runs, or delete the flag everywhere it's written. Do NOT leave it half-dead. (Recommend: delete — `enabled` is the live signal.)
- Touch nothing in the worker if the flag is deleted.
- Acceptance: new signup with URL → all 6 modules appear queued/running, `moduleState` reflects each.

### Phase 2 — Generate brand identity in the modular path
- `app/api/worker/run-brief/route.js`: after `runModules` resolves on the modular path (~:126-140), call `ensureScoutConfig` for signup-trigger / intake runs when a website URL exists. Reuse the evidence-refresh approach from `scout-config-regenerate/route.js` (it fetches crawl evidence then calls the generator) — extract/share rather than duplicate if clean.
- Must be non-fatal: identity generation failure must NOT fail the whole run; log + continue (match existing warning patterns in that route).
- Acceptance: new signup with URL → `client_configs/{id}.scoutConfig` populated; dashboard Brand & Keywords card shows crawl-derived values.

### Phase 3 — Dashboard URL add/change triggers the same full run
- FIRST verify what the URL band "Update & Rerun" control calls (`DashboardPage.jsx`, `#reseed-control-row` / `#dashboard-source-cta-row` area) and which endpoint queues what.
- Route it through the same `free-tier-intake` queue with force semantics so Phase 1+2 behavior fires on URL add/change. Respect `allowMultiRun`/tier gating — confirm free tier can re-audit; if not, surface the block clearly in UI rather than silently skipping.
- Acceptance: change URL in dashboard → all modules re-run + scoutConfig regenerates.

### Phase 4 — Name-only signups
- (a) Mirror gate (`marketing-brief/config/route.js` ~:176): allow first card save to CREATE A when the client has no website URL (`sourceInputs.websiteUrl` empty) — i.e., no crawl will ever exist. Keep the gate when a URL exists but A doesn't yet (crawl pending — do not fabricate).
- (b) Optional, behind approval: starter identity via `ensureScoutConfig`'s `userContext` arg from name + `ideaDescription`, no crawl.
- Acceptance: name-only user saves Brand & Keywords → A exists with quoted keywords + `reddit.mentionQueries`; external scouts pick up edits.

### Phase 5 — Seed-race fix
- Problem: user opens dashboard before audit finishes → `buildDefaultMarketingBriefConfig` seeds defaults; a save freezes them; A arriving later never re-seeds.
- Fix in `DashboardPage.jsx`: when A appears (bootstrap or poll) and B's brand-identity fields are still pristine defaults (untouched by user), re-hydrate them from A. Track "user-edited" explicitly or compare against the known default values — do not overwrite user edits, ever.
- Acceptance: open dashboard mid-audit, wait for completion → Brand & Keywords updates to crawl values without losing any field the user already typed in.

### Phase 6 (OPTIONAL — separate approval) — Backfill existing clients
- Stored `moduleConfig` wins over registry defaults (bootstrap merge in `client-provisioning.cjs:679`), so Phases 1-2 do NOT change existing clients. If wanted: migration script or bootstrap reconciliation to enable new foundational modules for existing clients. Do not start without explicit approval.

## 4. Pitfalls — read twice

1. **Cost/time per signup** jumps from 1 module to 6 + LLM identity generation (browserless, PageSpeed, multiple Anthropic calls). Confirm acceptable before Phase 1 ships.
2. **Worker timeout**: parallel `Promise.all` of all modules + scoutConfig in one invocation may exceed the route's max duration. Check the route's `maxDuration`/runtime config FIRST. If tight: run scoutConfig generation in the same invocation only if budget allows, else queue it as a follow-up run.
3. **Duplicate site fetches**: runners fetch the site independently despite shared `site-fetch` deps. Known inefficiency — do NOT build a cache layer in this plan; note it and move on.
4. **Seed race (Phase 5)**: without it, Phase 2 will look broken for any user who opens the dashboard quickly. Do not skip.
5. **Mirror-gate nuance (Phase 4)**: the gate prevents fabricating a partial A before a crawl. The relaxation must distinguish "no crawl YET" (URL exists → keep gate) from "no crawl EVER" (no URL → allow create).
6. **Existing clients see no change** without Phase 6 — expected, not a failed rollout.
7. **`design-evaluation`** was never default-enabled; registering it changes default state shape — verify `getDefaultModuleState` output renders sanely on the dashboard for it.

## 5. Per-phase report format (mandatory)

```
Phase N — <name>
- Files changed:
- Exact behavior changed:
- What stayed untouched:
- Verification run (commands/output):
- Manual test next (for Bryan):
- Risks / not verified:
Blocked/conflicts (if any): <doc-vs-code contradictions — stop here>
```
