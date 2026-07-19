# Load Performance Implementation Plan

**Status:** DRAFT — awaiting approval
**Created:** 2026-07-18
**Companion:** [`DASHBOARDPAGE-DECOMPOSITION-PLAN.md`](DASHBOARDPAGE-DECOMPOSITION-PLAN.md) (approved input to this plan)

---

## Objective

Make the site load as fast as possible. Implement the DashboardPage decomposition where it pays for load speed, and fix the measured bottlenecks the decomposition does not touch.

## Expectation correction (measured, not assumed)

`DashboardPage.jsx` is already behind `dynamic()` in `app/dashboard/page.jsx` — it ships **only** on `/dashboard`. Decomposing it does **nothing** for the marketing site's load time. What it does buy:

- **Dashboard route:** the DashboardPage chunk is **1.08 MB minified** (`.next/static/chunks/`, verified by grepping the CSS marker into the chunk). ~34% of the source is the static `dashboardCss` string — parsed as JS on every dashboard load, uncacheable as CSS. Phase 1 of the decomposition converts that to real cacheable `.css` → smaller JS parse + parallel CSS fetch. Real win.
- **Dev speed:** faster compile/Fast-Refresh on the file every card touches.

The marketing site's load time is dominated by **media weight**, measured below. That is where "no delay" is won.

## Measured bottlenecks (production build, 2026-07-18)

| # | Finding | Cost |
|---|---|---|
| 1 | `dashboard.mov` referenced as `previewVideo` on the homepage (`StackedSlidesSection.jsx:338,445`) | **18.7 MB**, QuickTime container (no guaranteed browser decode) |
| 2 | Homepage peek cards render `ss1/ss2/ss3.png` at ~200 px height (`StackedSlidesSection.jsx:2031–2033`) | **5.5 MB** combined, full-res PNG |
| 3 | `PRELOAD_ASSETS` eagerly decodes deliverable images on homepage mount (`StackedSlidesSection.jsx:626,1387`) incl. `hitloop-device-mockup.png` | **~2 MB** eager + points at a **3.4 MB** mp4 |
| 4 | `dash.png` 630 KB; other homepage PNGs unoptimized; almost no `next/image` usage (raw `<img>` everywhere on home) | no srcset, no AVIF/WebP transform |
| 5 | Google Fonts loaded from external origins (`app/layout.jsx:104–136`), 3 families | 2 extra connections on the critical path |
| 6 | DashboardPage chunk 1.08 MB (see above) | dashboard-route JS parse |
| 7 | `public/img` = **836 MB** on disk; `reel.mp4` (37 MB) and `interactive_ss_*.png` (7.2 MB max) verified **unreferenced** | deploy/repo weight, not runtime — hygiene |

## Phase order

Two independent tracks. Track M (media) is the marketing-site win; Track D (decomposition) is the dashboard win. They touch disjoint files and can be approved separately.

### Track M — marketing-site load (highest user-visible impact)

**Phase M1 — homepage media diet.** Presentation-only, no logic/DOM-structure change.
1. Re-encode `dashboard.mov` → H.264/AV1 `.mp4` sized for its preview slot (target ≤ 2 MB), update the two `previewVideo` refs. Keep `preload="none"`/lazy if not already.
2. Resize + WebP-convert `ss1/ss2/ss3.png` for their rendered ~200 px card height (target ≤ 60 KB each; keep 2x for retina). Same for `dash.png` and `hitloop-device-mockup.png` (the existing `.webp` sibling is *larger* — regenerate at rendered size).
3. Gate `PRELOAD_ASSETS` warm-up behind first user intent (scroll-near or hover) instead of mount, or shrink the assets it warms so eager stays cheap. Smallest-diff option preferred.
4. Verify: homepage network waterfall before/after (DevTools, throttled Fast 4G), visual parity at 375/768/1440.

Expected: homepage transferred bytes drop from ~25 MB worst-case to low single-digit MB. This is the single biggest "no delay" lever in the repo.

**Phase M2 — self-host fonts.** Replace the Google Fonts preload chain with `next/font` (Doto, Space Grotesk, Space Mono — all on Google Fonts, so `next/font/google` inlines + self-hosts automatically). Removes 2 origins from the critical path, kills FOUT risk. One-file change in `app/layout.jsx`. Verify: font rendering parity, no layout shift.

**Phase M3 — asset prune (hygiene, needs explicit deletion approval).** `reel.mp4` (37 MB), `interactive_ss_*.png`, superseded `port/*.png` where a referenced `.webp` exists. Grep-verify each is unreferenced before removal; move to external storage rather than delete if history matters. Shrinks repo + deploy, zero runtime effect.

### Track D — dashboard load (decomposition plan, adopted)

Execute `DASHBOARDPAGE-DECOMPOSITION-PLAN.md` **Phase 0 + Phase 1 only**, per that plan's own recommendation. Answers to its reviewer questions:

1. **CSS target:** real `.css` files (browser caching + kills the mirror-drift bug class). Confirmed.
2. **Screenshot tooling:** no visual-diff harness exists. Primary gate = the byte-compare CSS hash (mechanical); screenshots = manual captures via `app/preview/mobile-audit` at 375, plus 768/1440 manual. Do not build new tooling for this.
3. **Phase 2 test scope:** branching-logic helpers only. Keep the phase short.
4. **Phase 4 stopping rule:** stop when the file is < 8,000 lines or remaining card branches are < 300 lines each, whichever first.
5. **Phase 5:** correctly deferred. No known state bug justifies it.

Phases 2–4 of the decomposition: re-review after Phase 1 lands (they are maintainability/interaction-perf, not load-speed).

### Deferred / not committed

- **`next/image` adoption on the homepage** — real wins (srcset, AVIF) but touches layout-sensitive GSAP-animated elements; M1's manual right-sizing captures most of the benefit at a fraction of the risk. Revisit after M1 ships.
- **Route-level bundle audit of the 666 KB shared chunk** — identify what's in it (likely gsap + firebase client) only if marketing-site TTI still lags after M1/M2.

## Risks

| Risk | Mitigation |
|---|---|
| Re-encoded media looks worse | Side-by-side visual check at rendered size before swap; keep originals until approved |
| `PRELOAD_ASSETS` gating breaks the hover-card reveal | Smallest-diff option; test the hover flow explicitly |
| Font swap shifts layout | `next/font` with matched fallback metrics; compare 375/1440 screenshots |
| Deletion of a referenced asset (M3) | Grep-verify per file; M3 requires separate explicit approval |
| Decomposition risks | Covered in the companion plan; Phase 0 is a hard prerequisite |
| `StackedSlidesSection.jsx` has uncommitted changes | Commit or stash before M1 touches it |

## Recommended approval

**Approve Phase M1 + M2 + Track D (Phase 0 + 1).** Hold M3 (deletions) and decomposition Phases 2–4 for re-review.

Suggested order: M1 → D0 → D1 → M2. M1 first because it is the largest user-visible win and independent of everything else.
