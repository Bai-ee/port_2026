# Studio Video Upgrades — Sonnet Completion Handoff

Status: **handoff prompt for resumed implementation**

Use this document to task Sonnet with completing the paused Studio video-making upgrade. This is **not** the Opportunity Signals / Market Signals feature. This is also **not** a request to rebuild the Video Remix bridge or Social Auto-Publish flow. The target is the existing Studio experience for creating better videos inside `/dashboard/studio`.

## Current integration summary

There are three related but separate video systems in this repo:

1. **Video Remix ⇄ EditVideos bridge**  
   Production-shipped path for short branded videos. Hitloop queues metadata into the deployed EditVideos render pipeline and reconciles finished MP4s back into the dashboard. It is documented in `docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`.

2. **Social Auto-Publish**  
   Production social publishing workflow for automatically generated daily videos. X is live, Instagram is currently stubbed. The approval page can remix an awaiting-approval post's video before publishing. It is documented in `docs/source-of-truth/SOCIAL-AUTO-PUBLISH.md`.

3. **Studio / Holo Paper cinematic set builder**  
   The current implementation target. It lives in the original `/dashboard/studio` surface and is meant to make Studio more powerful for video creation through scene elements, randomization, templates, professional looks, and eventual render tiers. The active plan is `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`.

Sonnet should work only on item 3 unless explicitly told otherwise.

## Current repo/worktree notes

- Current working repo: `/Users/bballi/Documents/Repos/Bballi_Portfolio`.
- Current branch at handoff time: `feat/social-auto-publish`.
- There are no known uncommitted Studio/video implementation diffs at handoff time.
- Existing unrelated or user-owned worktree items may be present, including `docs/company-brain/README.md`, `2006.glb`, `Layout Example.jpg`, `docs/company-brain/CLIENT_BRAIN_DEEP_RESEARCH_MASTER_PROMPT.md`, `docs/plans/OPPORTUNITY-SIGNALS-SESSION-HANDOFF.md`, `docs/x-content/`, and `scripts/x-content/`.
- Preserve all pre-existing user changes. Do not delete, overwrite, move, import, or optimize `2006.glb` or `Layout Example.jpg` unless the user explicitly asks.

## Required reading before editing

Read these files before implementation:

1. `CLAUDE.md`
2. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
3. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-SONNET-HANDOFF.md`
4. `docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`
5. `docs/source-of-truth/SOCIAL-AUTO-PUBLISH.md`
6. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
7. `docs/features/studio/README.md`
8. `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md`
9. `docs/features/studio/STUDIO_RENDER_HOSTING.md`
10. `app/dashboard/studio/page.jsx`
11. `app/dashboard/studio/ClothStudio.jsx`
12. `app/dashboard/studio/components/StudioElementsCard.jsx`
13. `app/dashboard/studio/components/StudioElementInspector.jsx`
14. `app/dashboard/studio/components/SceneTemplatesCard.jsx`
15. `app/dashboard/studio/elements/intensity.js`
16. `app/dashboard/studio/elements/scene-elements.js`
17. `app/dashboard/studio/elements/randomize.js`
18. `app/dashboard/studio/elements/history.js`
19. `app/dashboard/studio/elements/scene-recipe.js`
20. Relevant tests under `app/dashboard/studio/elements/__tests__/`

## Current implementation checkpoint

The latest plan checkpoint in `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md` says the Studio work is **blocked until explicitly resumed**. This handoff is that resume instruction, but only for a bounded correction/completion round.

Already implemented and non-live verified:

- `elements/intensity.js` with Refine, Remix, Transform, and Wild intensity behavior.
- `elements/scene-elements.js` support for `randomizeInstanceFields({ intensity, lockedGroups })`, `changedGroups`, and `randomizeAllElements`.
- `ClothStudio.jsx` support for intensity-aware selected-element randomization, Randomize All, and intensity-aware Look randomization.
- UI additions in `StudioElementsCard.jsx` and the Effects/Look card for intensity controls, Randomize All, changed-group reporting, and visible look seed.
- Prior checks passed at that checkpoint: `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs`.

Still incomplete from that checkpoint:

- Live browser verification of Randomize All.
- Live browser verification of all four Look intensity tiers.
- Live browser verification that changed-group report lines populate.
- Live Scene Template save/load round trip for `randomizeIntensity` and `lookSeed`.
- Per-parameter-group lock UI: the model reads `inst.random.groups`, but users cannot set it yet.
- The broader randomization plan scopes are not complete. Only Selected element, Elements only, and Look only exist.
- Remaining guardrails, curated set generators, Element/Look/Render preset kinds, cloud/global template persistence, thumbnails/migration, and final single-seed consolidation are not complete.

## Scope for Sonnet

Sonnet should complete a clean, reviewable slice of the paused Studio upgrade:

1. Start with live verification of the already-implemented WIP.
2. Fix any issues found during verification.
3. Complete the current randomization slice to a clean boundary, with special attention to user-settable parameter-group locks if they can be implemented without expanding into Phase 6.
4. Rerun full verification.
5. Update the plan with a non-WIP as-built checkpoint and stop for Codex review.

Do not start:

- Phase 6
- Proof rendering
- Ultra 4K rendering
- Cloud/global template persistence
- Production deployments
- Social Auto-Publish changes
- Video Remix/EditVideos bridge changes
- `services/studio-render` changes

## Acceptance criteria

The Sonnet task is complete only when:

- Randomize All is live-verified in the browser.
- Refine, Remix, Transform, and Wild Look randomization tiers are live-verified.
- Changed-group report lines visibly populate after randomization.
- Scene Template save/load preserves `randomizeIntensity` and `lookSeed`.
- Per-parameter-group locks are either implemented and verified, or explicitly documented as deferred with a concrete reason and no hidden partial UI.
- The current randomization slice has a non-WIP as-built checkpoint in the plan doc.
- `npm test` passes.
- `npm run build` passes.
- `node scripts/smoke-studio.mjs` passes.
- No changes are made to `services/studio-render`, Video Remix bridge behavior, Social Auto-Publish behavior, or unrelated user-owned files.

## Final master prompt for Sonnet

Copy the prompt below into Sonnet.

---

You are completing the paused **Studio video-making upgrade** in this repository:

`/Users/bballi/Documents/Repos/Bballi_Portfolio`

This is not Opportunity Signals, Market Signals, onboarding, Social Auto-Publish, or the Video Remix/EditVideos bridge. The target is the original `/dashboard/studio` Studio surface, specifically the paused Holo Paper / cinematic set builder work.

Before editing, read:

1. `CLAUDE.md`
2. `docs/plans/STUDIO-VIDEO-UPGRADES-SONNET-HANDOFF.md`
3. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
4. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-SONNET-HANDOFF.md`
5. `docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`
6. `docs/source-of-truth/SOCIAL-AUTO-PUBLISH.md`
7. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
8. `docs/features/studio/README.md`
9. `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md`
10. `docs/features/studio/STUDIO_RENDER_HOSTING.md`
11. `app/dashboard/studio/page.jsx`
12. `app/dashboard/studio/ClothStudio.jsx`
13. `app/dashboard/studio/components/StudioElementsCard.jsx`
14. `app/dashboard/studio/components/StudioElementInspector.jsx`
15. `app/dashboard/studio/components/SceneTemplatesCard.jsx`
16. `app/dashboard/studio/elements/intensity.js`
17. `app/dashboard/studio/elements/scene-elements.js`
18. `app/dashboard/studio/elements/randomize.js`
19. `app/dashboard/studio/elements/history.js`
20. `app/dashboard/studio/elements/scene-recipe.js`
21. Relevant tests under `app/dashboard/studio/elements/__tests__/`

First inspect `git status --short`. Preserve all existing user changes. Do not touch `2006.glb`, `Layout Example.jpg`, Opportunity Signals docs, company brain docs, `docs/x-content/`, or `scripts/x-content/` unless the user explicitly asks.

Your job is a bounded resume/completion round for the current Studio randomization slice:

1. Live-verify the existing WIP before making assumptions:
   - Randomize All end-to-end.
   - all four Look intensity tiers: Refine, Remix, Transform, Wild.
   - changed-group report lines populate visibly.
   - Scene Template save/load round-trip preserves `randomizeIntensity` and `lookSeed`.

2. Fix bugs found during that verification.

3. Complete the current randomization slice to a clean review boundary:
   - If feasible within this slice, implement user-settable per-parameter-group lock UI that writes the existing `inst.random.groups` structure and is respected by selected-element and Randomize All actions.
   - Keep the UI aligned with the existing Video Studio UX kit and rail-card patterns.
   - Keep every randomization action undoable.
   - Keep intensity behavior deterministic and seeded.
   - Keep changed-group reporting accurate.

4. Do not expand into broader future phases:
   - Do not start Phase 6.
   - Do not implement Proof rendering.
   - Do not implement Ultra 4K rendering.
   - Do not implement cloud/global template persistence.
   - Do not change Social Auto-Publish.
   - Do not change the Video Remix/EditVideos bridge.
   - Do not modify `services/studio-render`.
   - Do not deploy anything or trigger paid rendering.

5. Verify with:
   - `npm test`
   - `npm run build`
   - `node scripts/smoke-studio.mjs`
   - live browser checks for the acceptance criteria above.

6. Documentation:
   - Update `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md` with a new non-WIP as-built checkpoint.
   - Include exact files changed, what is complete, what remains deferred, and the verification commands/results.
   - Stop for Codex review after the clean slice. Do not continue into the next phase without review.

Completion criteria:

- Randomize All is live-verified.
- all four Look intensity tiers are live-verified.
- changed-group reports visibly populate.
- Scene Template save/load preserves `randomizeIntensity` and `lookSeed`.
- per-parameter-group locks are implemented and verified, or explicitly documented as deferred with a concrete reason.
- `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs` pass.
- no render-service, Video Remix, Social Auto-Publish, deployment, or unrelated-file changes.

When done, report the changed files, verification results, remaining deferred items, and any risks that need Codex review.
