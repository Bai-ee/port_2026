# Load Performance Implementation Plan

**Status:** EXECUTED — full approved scope shipped (M1 `83390739`, D0 `037a53ea`, D1 `7b3be4fc`, M2 `76bbe184`), 2026-07-18/19. Held for re-review: M3 (asset prune), decomposition Phases 2–5.
**Created:** 2026-07-18
**Approved:** 2026-07-18
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
| 2 | ~~Homepage peek cards render `ss1/ss2/ss3.png` at ~200 px height~~ — **correction:** these already render via `next/image` (`<Image fill sizes=...>`, `StackedSlidesSection.jsx:2061`). `next.config.mjs` has no `unoptimized` flag, so the default optimizer serves resized WebP/AVIF at request time. The "5.5 MB" figure was raw on-disk PNG size, not transferred bytes — not a real load-time cost. Source-file resize deferred to M3 (repo-weight hygiene only). | not a real bottleneck — no action in M1 |
| 3 | `PRELOAD_ASSETS` warm-up (`StackedSlidesSection.jsx:626,1387`, pre-fix) — **correction:** it fetched raw `/img/...` originals via bare `<img src>`/`new Image()`, bypassing the optimizer entirely. The real `DeliverableHoverCard` renders those same assets through `next/image`, which requests a *different* (`/_next/image?...`) URL. So the warm-up populated a cache entry the real card never reads — pure waste, not "eager decode of the transformed image." Fixed by deleting the warm-up (dead code, zero benefit); see M1 execution notes. | **~2 MB** fetched and discarded every desktop mount, for zero cache benefit |
| 3b | `hitloop-video.mp4` (referenced by the same hover cards) — **new finding, not in original scan:** 1920×1200 @ 6.8 Mbps for a ≤380px hover-card slot. | oversized for its render slot |
| 4 | `dash.png` 630 KB — **correction:** dead code. Its only reference (`StackedSlidesSection.jsx:615`) is inside a commented-out disabled hover handler. Never fetched at runtime. No action taken. | not a real bottleneck |
| 5 | Google Fonts loaded from external origins (`app/layout.jsx:104–136`), 3 families | 2 extra connections on the critical path |
| 6 | DashboardPage chunk 1.08 MB (see above) | dashboard-route JS parse |
| 7 | `public/img` = **836 MB** on disk; `reel.mp4` (37 MB) and `interactive_ss_*.png` (7.2 MB max) verified **unreferenced** | deploy/repo weight, not runtime — hygiene |

## Phase order

Two independent tracks. Track M (media) is the marketing-site win; Track D (decomposition) is the dashboard win. They touch disjoint files and can be approved separately.

### Track M — marketing-site load (highest user-visible impact)

**Phase M1 — homepage media diet.** Presentation-only, no logic/DOM-structure change. **EXECUTED 2026-07-18** (revised scope, per the bottleneck corrections above):
1. Re-encoded `dashboard.mov` → H.264 `.mp4`, 640px wide (portrait), 30fps, CRF 23, audio stripped (source had none) — **18.7 MB → 1.22 MB**. Updated both `previewVideo` refs (`StackedSlidesSection.jsx:338,445`) to `/vid/dashboard.mp4`. Original `.mov` kept on disk, untouched.
2. Deleted the broken `PRELOAD_ASSETS` warm-up entirely (the effect at `StackedSlidesSection.jsx:622-630` and the hidden-portal render at `:1372-1379`), plus the now-dead `PRELOAD_ASSETS` export in `DeliverableHoverCards.jsx` and its now-unused import. It was fetching the wrong (unoptimized) URLs — removing it is a pure ~2 MB/mount win with no loss of function.
3. Re-encoded `hitloop-video.mp4` (item 3b) — 1920×1200 → 800px wide, CRF 23 — **3.41 MB → 1.02 MB**. Added `preload="none"` to both `<video>` tags in `DeliverableHoverCards.jsx` (video-post, post-me shells) as a defensive no-op (the component was already hover-mount-gated). Original kept as `hitloop-video.mp4.orig`.
4. Dropped: `ss1/ss2/ss3.png` resize and `hitloop-device-mockup.png` resize — deferred to M3 (see corrected bottleneck #2 — `next/image` already handles the wire cost; resizing the source is a repo-weight hygiene move, not a load-time fix). `dash.png` untouched (dead code, bottleneck #4 correction).
5. Verified: production build clean; both new asset URLs serve 200/correct mime via the dev server. **Not verified:** desktop-hover visual parity — this session's browser-automation viewport was capped at ~614px CSS width (extension panel constraint, resize had no effect), so the hover-card reveal could not be visually confirmed at desktop width. Mobile tap-to-expand path was reachable but the specific rows clicked didn't trigger a preview (informational-only rows, not wired to the hover-card system). **Recommend a manual desktop-hover + mobile-tap check before merge.**

Expected: the ~2 MB wasted warm-up fetch is eliminated, and the two video files drop from 18.7+3.41=22.1 MB combined to 1.22+1.02=2.24 MB combined. `ss1/ss2/ss3`/`dash.png`/`hitloop-device-mockup.png` were not load-time contributors to begin with (see corrections above), so no further homepage-transferred-bytes win is expected from touching them.

**Phase M2 — self-host fonts.** Replace the Google Fonts preload chain with `next/font` (Doto, Space Grotesk, Space Mono — all on Google Fonts, so `next/font/google` inlines + self-hosts automatically). Removes 2 origins from the critical path, kills FOUT risk. One-file change in `app/layout.jsx`. Verify: font rendering parity, no layout shift.

**EXECUTED 2026-07-19** (`76bbe184`, `app/layout.jsx` only, +11/−38): the preconnect/preload/media-flip/noscript chain replaced with `next/font/google`, `display:'swap'`. Literal family names preserved in the generated `@font-face` (reviewer-verified in `document.fonts` — real names, not hashed), so the 150+ existing literal `font-family` references needed zero changes. Verified: 0 requests to fonts.googleapis/gstatic, self-hosted woff2 from `/_next/static/media/`, CLS 0, visual parity on live page. Known side-effect: `<html>` now inherits Space Mono as default family via the className stack (was browser serif) — only affects text with no explicit font-family.

**Phase M3 — asset prune (hygiene, needs explicit deletion approval).** `reel.mp4` (37 MB), `interactive_ss_*.png`, superseded `port/*.png` where a referenced `.webp` exists. Grep-verify each is unreferenced before removal; move to external storage rather than delete if history matters. Shrinks repo + deploy, zero runtime effect.

### Track D — dashboard load (decomposition plan, adopted)

Execute `DASHBOARDPAGE-DECOMPOSITION-PLAN.md` **Phase 0 + Phase 1 only**, per that plan's own recommendation.

**EXECUTED 2026-07-18** — D0 `037a53ea` (baselines in `docs/plans/decomposition-baselines/`), D1 `7b3be4fc` (11 split files under `styles/dashboard/`, DashboardPage.jsx 32.4k→21.3k lines, stale `dashboard.css` mirror deleted, harness repointed). Byte-gate result: concat matches baseline except ONE enumerated comment rewording — see the known-delta entry in `BASELINE-COMMANDS.md`. Cascade order reviewer-verified in the compiled CSSOM (all 11 file markers in import order); responsive parity captured at 375/768/1444 (`034976f4`). In-flight X Command Center work was split into its own commit (`26fb839f`) to keep D1 move-only pure.

Answers to the decomposition plan's reviewer questions:

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

**Approved 2026-07-18: Phase M1 (revised scope, executed) + M2 + Track D (Phase 0 + 1).** Hold M3 (deletions/hygiene resize) and decomposition Phases 2–4 for re-review.

Order: M1 → D0 → D1 → M2. M1 executed first; D0 next.
