# Theme Studio — Coverage Map

Companion to [`THEME-STUDIO-CONTRACT.md`](THEME-STUDIO-CONTRACT.md). Token names are `--t-<role>` (contract §4). "WS" = owning workstream. Counts are literal occurrences measured at base `2635d4e8` by the inspectors (hex / rgba / hsl). "Exception" ids refer to contract §13; "—" means the surface is themed.

## A. Global / runtime

| Surface | Current color source | Proposed token mapping | Exception |
|---|---|---|---|
| `<html>` / `<body>` (`app/layout.jsx`) | No `data-theme`, no `color-scheme`, no body bg/color (UA white / black) | `html[data-theme][data-theme-pref]`, inline `color-scheme`; body `background: var(--t-page)`, `color: var(--t-text-default)`; `viewport.themeColor` from page tokens (WS2) | — |
| Pre-paint | none | ES5 `<head>` bootstrap from `lib/theme/bootstrap-source.js`; no CSP exists so inline is allowed (hash-pinnable) (WS1/WS2) | — |
| Viewer preference | Dashboard `useState('light')` (`DashboardPage.jsx:260`), no persistence | `theme:pref:v1` in localStorage, `useSyncExternalStore` pref-store (WS2) | — |
| Native controls / scrollbars | No `color-scheme` anywhere | `color-scheme` per generated mode block | — |
| `::selection`, focus ring | none (0 `::selection`; 5 `:focus-visible`; many `outline:none`) | `--t-selection-bg/-fg`, `--t-focus`; emitted only if `features.selection`/`features.focusRing` (baseline off) | Baseline defect §12.4 #6 |
| Draft preview on site | none | `<style id="theme-draft-css">` appended last, same selectors | admin/dev only |
| Studio chrome | n/a | locked `--ts-*` tokens (never `--t-*`) | by design |

## B. Root stylesheet `colors.css`

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `--yellow-1..12`, `-a*`, P3 oklch override (L118-150, ~345-360) | Radix yellow scale, no consumers | untouched | X11 |
| `--term-*` (L164-186, ~36 vars) | Light-only hex/rgba block | `--term-X: var(--t-term-X)` in `:root, [data-theme-scope]` (bridge); fixed-hue line colours, dark variants added | X4 only for artwork |
| `.cta-pill-btn::before`, `.comet-spinner`, `.nav-avatar-ring::before` conic gradients (`hsla(185…320)`) | 7 fixed hsla stops + alphas | `color-mix(in srgb, var(--t-comet-n) α%, transparent)` (hues follow master via fixed offsets) | animation mechanics X13 |
| `#founders-top-strip` (`rgba(245,241,223,.55)`, blur 24, white inset ring) | colors.css + inline in `Header.jsx:41-47` + `InnerPageShell` override (`rgba(254,253,249,.72)`) | `--t-chrome`, `--t-glass-highlight`; three duplicates collapse to one token reference (WS5 CSS, WS7 inline) | — |
| `#nav-scroll-top` (`rgba(245,241,223,.85)`, `#2a2420`) | literals | `--t-chrome-strong`, `--t-text` | — |
| `#founders-login/logout-link` (`rgba(255,255,255,.34)`, `#2a2420`) | literals | `color-mix(in srgb, var(--t-surface) 34%, transparent)`, `--t-text` | — |
| `#founders-chat-cta` gradient `hsl(185,100%,45%)→hsl(262,100%,55%)→hsl(314,100%,50%)` (L297) | hsl literals | `--t-gradient-accent` / `--t-accent-bright --t-support-1 --t-support-2` | — |
| `.founders-chat-cta--light` (white 85%, `!important`) | literal | `color-mix(in srgb, var(--t-surface) 85%, transparent)` | — |

## C. Dashboard CSS (`styles/dashboard/*.css`, WS5)

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `[data-dashboard-theme="dark"|"light"]` token blocks (`01-base.css:15-37`) | 10 neutral hex vars per mode | single mode-agnostic alias block → `--t-dash-*` (exact legacy values per mode) | — |
| `[data-dashboard-theme]` base (`background:transparent`, `color:var(--text-primary)`, 300ms transition) | tokens + transition | unchanged; transition suppressed during drags by `data-theme-switching` | — |
| `:root --accent #D71921`, `--success #4A9E5C`, `--warning #D4A843` | root hex | `var(--t-danger-solid)`, `--t-success-solid`, `--t-warning-solid` (bridge.css) | open question 5 |
| `#founders-shell` cream gradient + dot grid, top strip `rgba(245,241,223,.18)` | cream rgba | `--t-chrome` family + `--t-dash-dot-grid` | — |
| `.tr--flag td:first-child::before` (`#c03`, light-only) | mode selector | `var(--t-danger-solid)` (no mode selector) | — |
| `.tile-blocked-overlay/-title/-upgrade-btn(:hover)` (`rgba(22,20,18,.42/.72/.88)`, `#faf7f2`) | dark-scoped rules | `--t-overlay`, `--t-text-inverse`, `color-mix(in srgb, var(--t-overlay) …)` | baseline defect §12.4 #4 |
| `--pilot-*` (`03-strategy-builder.css:5-13`) | warm ink + white-alpha | `ink→--t-text`, `ink-soft→--t-text-secondary`, `ink-muted→--t-text-muted`, `line→--t-border-subtle`, `surface*→--t-glass*`, `highlight→--t-glass-highlight` | — |
| `--sg-*` (`09-market-signals.css:6-14`, `.signals-sg`) | same shape; a/b/c `hsl(185/262/314)`; success `#285f3b`, warning `#67533d`, danger `#9f1f17` | `--t-text*`, `--t-border-*`, `--t-glass*`, `a/b/c→--t-accent-bright/--t-support-1/--t-support-2`, status → `--t-success/--t-warning/--t-danger` | — |
| `--vrk-*` (`10-video-remix.css:3-18`, `.vrk-scope`) | duplicate of `--sg-*` | same mapping; highest-leverage edit (re-themes Email Digest, Operating Cost, all dashboard modals) | — |
| `.brief-kit` (`--ink --line --card --hl --brand #116dff --grad`, `11-creative-brief.css:6-11`) | scoped literals, "ported verbatim" kit | keep literals; mount point gets `data-theme-scope="light"` | X2 |
| `#tile-detail-modal-overlay` blur 18, white-alpha glass (02:682-686) | rgba white | `--t-overlay`, `--t-glass*` | — |
| Remaining ≈484 hex / 960 rgba / 157 hsl across 01…11 | literals (top: `#fff` 104, `#2a2420` 86, `rgba(42,36,32,.08/.12/.10)` 86, `rgba(255,255,255,.55/.5/.6)` 60) | rules in contract §10.4 via codemod; unmapped → report + allowlist | X6 for black shadows, traffic-light dots |
| `backdrop-filter` (22) | white/cream alpha backgrounds | tokenize the background alpha, not the blur | — |
| `box-shadow` (187) | inline `rgba(0,0,0|42,36,32,α)` | black stays literal; ink shadows → `--t-shadow-sm/md/lg` or `color-mix` of `--t-text` | X6 |
| `!important` colour rules (of 73) | forced values | audit; convert to variable-consuming declarations | — |
| `.design-sync/ds-styles.css`, `docs/plans/decomposition-baselines/dashboardCss.baseline.css` | copies of the dashboard CSS | baseline file regenerated by WS5; `.design-sync` regenerated in the main checkout later | X9 |

## D. Brain Builder (WS5 CSS + WS6 JSX)

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `--bb-*` tokens (`brain-builder.css:5-16`) | ink `#2a2420`, soft .72, muted .52, line .12, surface `#fff`, page `#f7f7f6` (unused), success/warning/danger, accent `#00adb5` | `--t-text`, `--t-text-secondary`, `--t-text-muted`, `--t-border-subtle`, `--t-surface`, `--t-page`, `--t-success/-warning/-danger`, `--t-accent` | — |
| Page gradient `#fff→#f3f4f6`; `#f3f4f6`, `#f7f7f6`, `#fcfcfb` surfaces | literals | `--t-surface→--t-inset` gradient; `--t-inset` (approx ΔEOK ≤ .012 for `#f3f4f6`) | — |
| `.bb-btn-primary` (ink bg, `#fff` text, hover `#3d352f`) | literals | `--t-text` / `--t-surface` / `color-mix(in srgb, var(--t-text) 88%, var(--t-surface))` | — |
| Pills/notices: `#e9f4ec`, `#f6f0e4`, `#fdf1f0`, `#eef7f0`, `#f9f4ea` + rgba borders | per-status literals | `--t-{success,warning,danger}-bg` / `-border` | — |
| Accent tints `rgba(0,173,181,.1/.25)`, outline `--bb-accent` | literals | `--t-accent-soft`, `--t-accent-soft-border`; outline stays `var(--bb-accent)` | defect §12.4 #3 |
| Input border `.22`, placeholder `.38`, progress track `.08`, save bar `rgba(255,255,255,.96)` | literals | `--t-control-border`, `--t-text-faint`, `--t-border-faint`, `color-mix(in srgb, var(--t-surface) 96%, transparent)` | defects #1/#2 reported |
| `BrainBuilder.jsx:186,189` inline `rgba(42,36,32,.6/.7)` | inline | `var(--bb-ink-soft)` (WS6) | — |

## E. Terminal / run console

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `.term-line`, `.term-*`, `#intake-modal-terminal-col`, titlebar, scrollbar (`06-intake-onboarding.css:241-285, 649`) | `var(--term-*)` (33 uses) | unchanged call sites; values from `--t-term-*` | — |
| `StudioPage.jsx`, `RemixStudio.jsx`, `LooperTerminal.jsx`, `RecreateTerminal.jsx` (12/12/17/17 uses) | `var(--term-*)` | unchanged; Looper/Recreate are pinned light | X8 (pages), chrome of Studio themes |
| Line colours (info/fetch/ok/ai/build/error/active/screen/mock/countdown) | fixed semantic hues | fixed hue per role, lightness/chroma retuned for dark (pfx L .78 / msg L .84 dark) | status keeps meaning |
| `--term-caret #2f6fed`, `active/screen` blues | blue | caret = `--t-info-solid` link | — |
| Marquee title `#2a2420` (`DashboardPage.jsx ~12938`) | inline | `var(--t-text)` (WS6) | — |
| macOS traffic-light dots (`06:675-677`) | rgba | stay literal | X6 |

## F. Dashboard / admin JSX (WS6)

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `DashboardPage.jsx` (115 hex / 99 rgba / 24 hsl; 68 `var(--)`) | theme state `:260`, attr `:10707`, toggle `:10762-10765`, inline literals | `useResolvedMode`/`setPreference`; codemod; `.brief` srcDoc iframes untouched | X2 (iframes), X6 (X-post preview `#536471`, toast `#f87171/#4ade80`) |
| `components/dashboard/content-ui/ContentUiStyles.jsx` (505) | inline CSS-in-JS | codemod → tokens | — |
| `MediaLibraryCard` 105, `XCalendarCard` 101, `CopywriterCard` 99, `LeadGenDashboard` 94, `XMonitorCard` 91, `SiteRecreateCard` 70, `XProfileCard` 64, `SocialPostingPanel` 47, leadgen modals (≈180 total) | inline | codemod → tokens | `SendPreviewModal` customer email iframe, `SiteRecreateCard` external preview = X2 |
| `InvoiceBuilderCard`/Invoice Studio card chrome | inline | chrome only | document canvas, print, HoloPaper = X3 |
| `MonthCalendarPanel.jsx` `createPortal` fallback to `document.body` | scoped tokens lost | irrelevant: tokens are on `:root` | — |
| `OpsOverviewPage.jsx` (`/admin`, `:root{--page --text --green…}`, 33 rgba / 7 hex) | global generic var names | scope to `#ops-overview-page`; map to `--t-*` (contract §10.3) | optional hygiene |
| `AdminPage.jsx` (`[data-admin-theme="dark"]`, 29 hex status banners) | always dark | untouched | X7 |
| `AdminCostView.jsx` (`--oc-*` → `--vrk-*`, `#8a6d1f` estimate chip) | aliases + 2 literals | inherits; chip → `--t-warning` | chart/provider colours X6 |
| `AdminEmailModals.jsx` (21 hex: size-tier banners, Run&Send `#2a2420`, preview wrapper `#fff`) | inline | banners → status tokens; button → `--t-text`/`--t-surface` | preview iframe + white wrapper X1 |
| `DashboardCreationFailedModal`, `BrandSystemChat`, `WebsiteUrlGate`, `CalendarPane` | inline | codemod | — |

## G. Public site (WS7 unless noted)

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `pageSurfaceSystem.js` (`rgba(255,255,255,.5)`, `rgba(212,196,171,.82)`, white insets) | 4 rgba | `--t-glass-soft`, `--t-glass-border`, `--t-glass-highlight` (single seam for all inner pages) | — |
| `InnerPageShell.jsx` (bg `rgba(254,253,249,1)`, nav `rgba(254,253,249,.72)`+blur 14, CTA gradient) | 2 hex / 19 rgba / 3 hsl | `--t-raised`, `color-mix(in srgb, var(--t-raised) 72%, transparent)`, `--t-gradient-accent` | — |
| 14 inner `*Page.jsx` (h2 `#0a0a0a`, body `rgba(26,26,26,.8)`, eyebrow `rgba(90,83,70,.7)`, dividers `rgba(0,0,0,.05)`) | 3-6 hex / 6-7 rgba each | `--t-text-strong`, `--t-text-body` @80%, `--t-text-eyebrow` @70%, `--t-text-strong` @5% | — |
| `FAQPage.jsx` (9/28/3, 5 gradients, 2 blurs), `CaseStudiesPage`, `ContactPage` | inline | codemod + manual gradients | — |
| `Header.jsx` (strip rgba, signature `mixBlendMode:'darken'`, `/img/sig.png`) | 3 rgba | `--t-chrome`; blend `var(--t-logo-blend)`, filter `var(--t-logo-filter)` via class | pixels of sig.png X5 |
| `SiteFooter.jsx` (4/15/3: CTA gradient, hover `#2a2420`, marquee text) | inline | `--t-gradient-accent`, `--t-text` | — |
| `StackedSlidesSection.jsx` (103/263/30, 24 gradients, 7 blurs, GSAP-created nodes ≈ L1685-1695) | inline + `<style>` + imperative `style` | tokens; GSAP nodes use `'var(--t-…)'` strings; agency logos `grayscale(1) opacity(.45)` → `var(--t-logo-filter-muted)` | logos X5 |
| `AuthPage.jsx` (9/33/3), `PortfolioModal.jsx` (10/33/3) | inputs `rgba(255,255,255,.72)`, back btn `.34`, teal/lavender tints | `color-mix` of `--t-surface`; tints → `--t-deco-2/-4` | — |
| `HeroHeadline.jsx` (text fill gradient `#bda7b4,#a09fc0,#8294b6`, glass card) | inline | text-fill stops → `color-mix` of `--t-support-1` / literals kept as artwork until designer decision (recorded) ; glass → `--t-glass*` | gradient text fill allowlisted (decorative) |
| `HeroFooter.jsx` slate panel `rgba(15,23,42,.95)`, `#d1d5db`; `ReelPlayer.jsx` dark overlay; `TextOverlay.jsx` | dark surfaces with light text | stay dark in both modes (allowlist) | intentional dark media chrome |
| `HomePage.jsx` (WS4): `canvasBackground '#ffffff'`, `textColor '#000000'`, `heroGradientStyle` (terracotta/teal/gold/lavender, multiply) | useState literals + rgba | `'theme'` scene bg, `var(--t-text-default)`, `--t-deco-1..4` @.22/.18/.14/.12, `mix-blend-mode: var(--t-blend-deco)` | — |
| `HeroSchematicOverlay.jsx` (WS4) hex→rgba runtime | `color='#2a2420'` prop | `readToken('--t-text')` + `onTokensChanged` | — |
| `ColorPalette.jsx` swatch page (51 hex) | content hexes | untouched | X10 |
| `/looper` (107 hex / 156 rgba), `/recreate` (28/55), `/archive` (63), `/capture` (60), `/post-approval` (20), `/preview/*` | own hardcoded palettes | outermost element `data-theme-scope="light"`; scene `sceneMode` `'off'`/`'light'`; no literal migration in v1 | X8 |
| `app/not-found.jsx` + `sharedParticleGalleryRenderer.js` (SYSTEM_PRESETS hues) | HSL presets | optional S1: add `hueShift` | X12 if skipped |

## H. Three.js scene (WS4)

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| `ox.jsx` particle colour (`setHSL(hue, sat, light+wave*.15)`, L584-585) | `hueOffset/saturation/lightness` params, hue span hardcoded `t*0.8` | `hue += scene.hueShift`, `sat *= saturationMul`, `light += lightnessDelta`, `span = scene.hueSpan`; raw display-space writes unchanged | — |
| `ox.jsx` shader (L367-392): `uOpacity` only | `vColor * facing` | + `uHighlight` (Vector3) / `uHighlightMix` (default 0 ⇒ identical) | — |
| `SceneBackground` (L48-60) | `new THREE.Color(hex)` / `null` | `'theme'` ⇒ `scene.background.set(scene.background)` in place | fixed hex / `null` still accepted |
| Home start/end params (`HomePage.jsx:22-71`) | `.36/.75/.40/.23` → `.5/1/.55/.18` | deltas over the interpolated values (scroll animation preserved) | — |
| Inner pages `BACKGROUND_PARAMS` (`.44/.9/.52/.16`) | module constant, no `liveParamsRef` | deltas read from `sceneBridge` ref inside `useFrame` (no params-prop change ⇒ no smoothing reset) | — |
| `InternalPageBackground` wash (`rgba(245,241,223,.08)`, blur 18, inset white rings) | literals | `--t-scene-wash`, `--t-glass-highlight` | — |
| Text over animation (hero headline, schematic, URL row) | opaque white canvas, black text | `#hero-text-scrim` with `--t-scrim` (alpha 0 in baseline) | — |
| Static fallback / context loss / WebGL failure | none (blank canvas) | `SceneBoundary` + `SceneFallback` (`--t-scene-fallback`) | — |
| `bloom*` params | accepted, unused | not exposed | dead params |
| Tone mapping / output colour space | R3F defaults, particles bypass | unchanged | `/looper` OutputPass path differs by design |
| `emissive` | not applicable | not in schema v1 | no bloom pass |

## I. Data and status semantics

| Surface | Current source | Proposed mapping | Exception |
|---|---|---|---|
| Success `#285f3b`/`#4A9E5C`/`#22763a`/`#22c55e`/`#15803d`/`#0cce6b` | five divergent greens | `--t-success` (fg) / `--t-success-solid` (fills) / `-bg` / `-border` | stray one-offs to allowlist if data-viz |
| Warning `#67533d`/`#D4A843`/`#92400e`/`#b45309`/`#8a6d1f` | divergent ambers/browns | `--t-warning` / `--t-warning-solid` | — |
| Danger `#9f1f17`/`#b91c1c`/`#c03`/`#D71921` | divergent reds | `--t-danger` / `--t-danger-solid` | — |
| Info `#1d4ed8`/`#2f6fed`/`#3b82f6` | blues | `--t-info` / `--t-info-solid` | — |
| Categorical accents (`#0ea5e9 #f97316 #f59e0b #ec4899 #a855f7 #6366f1 #14b8a6 #10b981`) | one-off card/showcase colours | keep fixed | X6/X10 |
| Operating Cost providers/charts | data colours | keep fixed | X6 |

## J. Out-of-scope artifacts (never touched)

| Surface | Reason |
|---|---|
| `features/email-digest/render.js`, `__fixtures__/*.html`, `leadgen/email-template.js`, daily-digest route `color-scheme: light` | X1 |
| `app/briefs/**`, `brief-preview` route, Brief Composer iframe, `brief-design-system-reference/` | X2 |
| Invoice Studio document + print + HoloPaper | X3 |
| ClothStudio/T-shirt/Glass/holo scene palettes | X4 |
| `ds-bundle/`, `.design-sync/ds-styles.css` | X9 |
