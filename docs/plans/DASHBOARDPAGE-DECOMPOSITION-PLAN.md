# DashboardPage.jsx Decomposition Plan

**Status:** Phase 0 + Phase 1 EXECUTED 2026-07-18 (D0 `037a53ea`, D1 `7b3be4fc` — DashboardPage.jsx 32.4k→21.3k lines, CSS now `styles/dashboard/*.css`, mirror deleted; byte-gate delta + parity evidence in `decomposition-baselines/BASELINE-COMMANDS.md`). Phases 2–4 NOT approved — re-review required. Phase 5 deferred.
**Reviewer:** Fable
**Implementer:** Sonnet
**Author:** Opus (measurement + plan, no code changes made)
**Created:** 2026-07-18
**Approved:** 2026-07-18

---

## Objective

`DashboardPage.jsx` is **32,381 lines / 1.5 MB** in a single file. Break it into maintainable units without changing a single pixel or behavior, in phases that can each be verified mechanically and stopped at any point.

This is a **structural** refactor. It is explicitly NOT a redesign, NOT a logic rewrite, and NOT an opportunity to "improve" anything encountered along the way.

---

## Current architecture (measured, not estimated)

### Region map

| Lines | Region | Count | % of file |
|---|---|---|---|
| 1–2,936 | Module scope: constants, pure helpers, dynamic imports, `LazyVideoThumb`, `GlassTooltipLayer` | 2,936 | 9% |
| 2,937–21,288 | `DashboardPage` component — **one function** | 18,352 | 57% |
| ‎ ↳ 2,937–13,163 | state + callbacks + effects | 10,227 | 32% |
| ‎ ↳ 13,164–21,288 | the JSX `return` | 8,125 | 25% |
| 21,289–32,377 | `dashboardCss` template literal | 11,089 | 34% |

### Hook density inside the single component

| Hook | Count |
|---|---|
| `useState` | **194** |
| `useCallback` | 111 |
| `useEffect` | 84 |
| `useRef` | 45 |
| `useMemo` | 11 |
| **Total hook calls** | **445** |

Last `useState` appears at line 9,461 — the state declaration block alone spans ~6,500 lines.

### Other measurements

- **16 `render*` helper functions are defined inside the component body** (`renderSignalsControlPanel`, `renderSignalsBriefMock`, `renderRecipeBriefBlock`, `renderWatchlistAnalysisBlock`, …). Every one is re-allocated on every render.
- **`dashboardCss` contains zero `${}` interpolations** — verified. It is 100% static CSS masquerading as JavaScript.
- **261 section comments** inside the CSS literal — natural, pre-existing split seams.
- **`dashboard.css` (the "readable mirror") has drifted 3,237 lines** from the runtime literal. It is unimported and actively misleading. CLAUDE.md instructs keeping it in sync; that has not happened.
- **`app/preview/mobile-audit/page.jsx` imports `dashboardCss` from `DashboardPage`** — pulling the entire 32k-line module into a screenshot harness that only wants a stylesheet.
- **15 components (8,758 lines) have already been extracted** into `components/dashboard/*`. The pattern is proven — `MediaLibraryCard.jsx` and `CopywriterCard.jsx` came out cleanly.

### Why this went unflagged before production

No test exercises the render. `npm run smoke:routes` checks that routes respond, not what they contain. File size is not in any CI gate. The file grew card-by-card, each addition individually reasonable. Nothing was ever *wrong* — it just never got measured.

---

## Proposed direction

**Extract in order of (volume removed ÷ risk taken), highest ratio first.** CSS before logic. Pure functions before stateful ones. Leaf components before the state graph.

Each phase must be **independently shippable and independently revertible.** No phase depends on a later phase landing.

### Keep vs change

**Keep unchanged:**
- All runtime behavior, all styling output, all DOM ids and structure
- The `dashboardCss` cascade order (splitting must preserve it exactly)
- Inline `style` props as the primary idiom (per `ds-bundle` conventions — do NOT convert to classes)
- The existing `components/dashboard/*` extraction pattern and dynamic-import convention
- The mobile-width standard chain (`--mobile-gutter`) — see `docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md`

**Change:**
- Where code lives, and nothing else

---

## Phase order

### Phase 0 — Safety net (prerequisite, no extraction)

There is currently no way to prove this refactor is behavior-neutral. Build one first.

1. Baseline `npm run build`, `npm test`, `npm run smoke:routes` — record output.
2. Capture screenshot baselines of the dashboard at 375px, 768px, 1440px, plus each card modal that has one. `app/preview/mobile-audit/page.jsx` already exists for the 375px case — use it.
3. Record the full computed-CSS baseline: serialize `dashboardCss` to a file and hash it. Every later phase must reproduce that hash byte-for-byte until deliberately changed.

**Exit criteria:** a documented, repeatable command sequence that a later phase can re-run to prove neutrality.

**Do not skip this.** Phases 1–4 are only safe because Phase 0 makes regressions detectable.

---

### Phase 1 — CSS extraction · 11,089 lines · **lowest risk, highest volume**

Removes 34% of the file. The CSS is static, verified interpolation-free, and has no logic to break.

1. Split the literal at its existing 261 section comments into ~8–12 domain files under `styles/dashboard/` (e.g. `_base.css`, `_cards.css`, `_tile-detail.css`, `_video-remix.css`, `_mobile-width.css`, …).
2. **Preserve cascade order.** Import them in the exact original sequence. Order is load-bearing — later rules override earlier ones.
3. **Verify mechanically before switching:** concatenate the split files and byte-compare against the extracted original. Identical or the phase is not done. This is a provable step, not a judgment call.
4. Import the CSS in `DashboardPage.jsx`; remove `<style>{dashboardCss}</style>`.
5. Repoint `app/preview/mobile-audit/page.jsx` at the stylesheet directly, dropping its `DashboardPage` import.
6. **Delete `dashboard.css`.** It is 3,237 lines stale, unimported, and its existence is a trap — anyone editing it changes nothing at runtime. The split files become the readable source, so the mirror has no remaining purpose.
7. Update CLAUDE.md: the `dashboardCss` template-literal warning and the "keep the mirror in sync" instruction both become obsolete.

⚠️ `--mobile-gutter` / MOBILE WIDTH STANDARD block must land in a file whose import order preserves its current override position.

**Risk:** low. Cascade-order mistakes are the only real failure mode, and the byte-compare in step 3 catches them before anything ships.

---

### Phase 2 — Module-scope helpers · 2,936 lines

Lines 1–2,936 are constants and pure functions. No hooks, no closures over component state.

Move to `lib/dashboard/` grouped by domain:
- video-remix helpers (`buildRemixRecipe`, `normalizeVideoRemixFolderDetails`, `formatVideoRemixBytes`, storage-key helpers, …)
- marketing-brief config builders (`buildDefaultMarketingBriefConfig`, `buildGeneratedScoutSearchRows`, `getMarketingBriefSearchStats`, …)
- estimate/brief draft helpers (`buildDefaultEstimateBriefDraft`, `parseEstimateLineItems`, …)
- brand snapshot helpers (`buildBrandSnapshotDraft`, `draftToStyleGuide`, `colorInputValue`, …)
- generic formatters (`safeDownloadName`, `cloneJson`, `termArrCount`, …)

**These are pure functions — this is where the repo's first real dashboard unit tests should be added.** Adding tests here is in scope for this phase; it is the cheapest coverage available and it protects every later phase.

`LazyVideoThumb` and `GlassTooltipLayer` are components — move to `components/dashboard/`.

**Risk:** low. Import errors fail the build loudly. Nothing is silent.

---

### Phase 3 — Render helpers out of the component body · 16 functions

The `render*` helpers inside the component are re-allocated on every render of a component holding 445 hooks.

1. Audit each for what it actually closes over.
2. Closure-free ones → real components in `components/dashboard/`.
3. Closure-dependent ones → components taking explicit props.
4. Where a helper needs 8+ props, that is a signal the state it reads belongs together — **note it for Phase 5, do not fix it here.**

**This is the first phase with a genuine runtime performance payoff**, not just organization.

**Risk:** medium. Closure dependencies are easy to miss. One function at a time, verify against Phase 0 baselines after each.

---

### Phase 4 — Card modal extraction · ~8,125-line JSX return

Follow the proven `MediaLibraryCard` / `CopywriterCard` pattern exactly. The per-card branches in the return (`activeTileModal.cardId === '…'`, lines ~15,900–16,200+) are the seams.

- One card per commit. Never batch.
- Each extracted card behind `dynamic()` like its 15 predecessors.
- Order by block size, largest first.
- Preserve `cardId` — it is the join key across `module-registry.js`, `run-lifecycle.cjs` `projectModuleResult`, and the card. **Renaming a `cardId` breaks the pipeline.**
- Cards with SSOT docs (`video-remix`, `media-library`, `signals`, `mockup-studio`, `client-brain`, `email-digest`, `operating-cost`, `archive-publishing`, `creative-brief-composer`, `copywriter`) — **read the doc before touching that card.** Several have non-obvious constraints.

**Risk:** medium-high per card, low in aggregate because each is independently revertible.

---

### Phase 5 — State decomposition · 194 `useState` · **DEFER**

Grouping 194 state atoms into domain reducers or context is the highest-risk work in this plan and the least likely to be necessary.

**Recommendation: do not commit to this now.** After Phases 1–4 the file should be roughly 6–9k lines with logic mostly co-located by domain. Re-measure then and decide. Phase 3's "8+ props" notes are the input to that decision.

Doing Phase 5 speculatively risks destabilizing a working production dashboard for an organizational benefit that may already have been achieved.

---

## Projected outcome

| | Before | After Phases 1–4 |
|---|---|---|
| `DashboardPage.jsx` | 32,381 lines | ~6,000–9,000 |
| CSS location | JS template literal | real, cacheable `.css` files |
| Stale `dashboard.css` mirror | 3,237 lines drifted | deleted |
| Dashboard unit tests | 0 | pure helpers covered |
| Preview harness import | pulls 32k-line module | imports a stylesheet |

---

## Risks

| Risk | Mitigation |
|---|---|
| No render test coverage exists | Phase 0 is a hard prerequisite |
| CSS cascade order breaks silently | Byte-compare before switching (Phase 1 step 3) |
| Closure deps missed in render helpers | One at a time, verify each |
| Fast Refresh instability mid-refactor | ⚠️ **Never edit this file while a run is active** — the existing rule applies double during this work. See `docs/source-of-truth/MARKET-SIGNALS-GENERATE-REPORT-FLOW.md` |
| `cardId` renamed during extraction | Explicit rule in Phase 4; it is the system-wide join key |
| Scope drift into redesign | Every phase is move-only. Behavior changes require a separate approved task |
| Merge conflicts against parallel work | Phases are small and sequential; land each before starting the next |

**Stale worktree:** `.claude/worktrees/inspiring-brattain-48426b/` holds an old 492 KB copy of this file. Ignore it; do not refactor it.

---

## Files likely involved

- `DashboardPage.jsx` (primary)
- `dashboard.css` (deleted, Phase 1)
- `styles/dashboard/*.css` (new, Phase 1)
- `lib/dashboard/*` (new, Phase 2)
- `components/dashboard/*` (new files, Phases 3–4)
- `app/preview/mobile-audit/page.jsx` (repointed, Phase 1)
- `CLAUDE.md` (obsolete warnings removed, Phase 1)

---

## Questions for the reviewer (Fable)

1. **Phase 1 CSS target** — real `.css` files imported by the component (proposed), or keep string chunks in `.js` modules? Real files get browser caching and kill the drift class of bug; string chunks are a smaller conceptual change. Recommendation: real files, since zero interpolation is verified.
2. **Phase 0 screenshot tooling** — is there an existing visual-diff harness to reuse, or should baselines be manual captures? This determines how rigorous Phases 3–4 verification can be.
3. **Phase 2 test scope** — add tests for all extracted pure helpers, or only those with real branching logic? Full coverage is cheap here but adds phase length.
4. **Phase 4 sequencing** — extract all remaining cards, or stop once the file is under a target line count? A stopping rule would prevent this becoming open-ended.
5. **Is Phase 5 correctly deferred**, or is there a known state bug that would justify taking it on now?

---

## Approval recommendation

**Approved 2026-07-18: Phase 0 + Phase 1 only.** Reviewer questions above answered in the companion [`LOAD-PERFORMANCE-IMPLEMENTATION-PLAN.md`](LOAD-PERFORMANCE-IMPLEMENTATION-PLAN.md) § Track D.

Phase 1 removes a third of the file, is mechanically verifiable, has no logic risk, and deletes a genuinely misleading artifact. It is the clearest win available and it validates the Phase 0 safety net on low-stakes work.

Re-review after Phase 1 lands before committing to Phases 2–4. Phase 5 stays out of scope pending re-measurement.
