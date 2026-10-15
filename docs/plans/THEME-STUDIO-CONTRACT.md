# Theme Studio — Implementation Contract (v1, binding)

Worktree: `/Users/bballi/Documents/Repos/Bballi_Portfolio-theme-studio` (base `2635d4e8`). Never edit the main checkout.
Companion: [`THEME-STUDIO-COVERAGE-MAP.md`](THEME-STUDIO-COVERAGE-MAP.md) (surface → current source → token → exception).

This contract is followed by 7 parallel workstreams that do **not** talk to each other. If something here is ambiguous, take the more conservative reading, record it in your final report, and do not edit files you do not own. Anything written "MUST" is checked by the acceptance tests in §15.

---

## 0. Locked decisions (read first)

| # | Decision |
|---|---|
| D1 | One canonical **theme definition** (JSON, `schema:"hitloop.theme"`, `version:1`) holds both palettes in OKLCH. Production default = checked-in `lib/theme/production/production-theme.json`. No publishing backend. |
| D2 | `resolveTheme(definition, mode)` is pure and deterministic and returns **sRGB hex/rgba strings** for every CSS token plus a numeric scene palette. CSS and Three.js both consume that one result. |
| D3 | All new CSS variables are namespaced `--t-*`. Legacy var families (`--page/--surface/--text-*`, `--bb-*`, `--vrk-*`, `--sg-*`, `--pilot-*`, `--term-*`, `--oc-*`, `--accent/--success/--warning`) are kept as **aliases** of `--t-*` ("bridge first"), so ~900 existing `var(--legacy)` call sites do not change. |
| D4 | `<html>` carries `data-theme="light|dark"` (resolved mode), `data-theme-pref="light|dark|system"` and inline `color-scheme`. Pinned subtrees use `data-theme-scope="light|dark"`. |
| D5 | **Baseline preset reproduces today's look.** Today the public site and dashboard are light-only. The dashboard's hidden `#theme-toggle` is the only dark switch and it defaults to `light` (`DashboardPage.jsx:260`). Therefore `defaults.viewerPreference = "light"` in the baseline (not `system`). Dark palettes are **new design**, authored to this contract; they ship but are reachable only via the viewer preference/Studio until the owner flips the default. |
| D6 | Pre-paint bootstrap = a **static ES5 inline script** in `<head>`, generated from `lib/theme/bootstrap-source.js` (same module family as `mode.js`), parity-tested against the runtime. There is **no CSP** on regular pages today (only `frame-ancestors` on `/oauth/*`, `next.config.mjs` `headers()`; `proxy.js` sets none), so an inline script is allowed; the script is constant per build so a sha256 can be pinned later. |
| D7 | Authoring UI is admin-only (existing `AuthContext` `isAdmin && adminReady`), lazy-loaded; dev-only escape hatch `?theme-studio=1` guarded by `process.env.NODE_ENV === 'development'`. |
| D8 | Baseline ships with `features.focusRing=false`, `features.selection=false` (pixel-identical). Known a11y defects are reported, not silently fixed (§12.4). |
| D9 | Out of v1 theming scope (pinned `data-theme-scope="light"`): `/looper`, `/recreate`, `/archive`, `/capture`, `/post-approval`, `/preview/*`. Listed in §13. |
| D10 | No new npm dependency. OKLCH math in-house (§6). Tests use `node --test` + `node:assert/strict`, ESM, explicit `.js` import extensions. |

### 0.1 Verified facts the design depends on (re-verified in the worktree)

- `app/layout.jsx`: `<html lang="en" className=…>` has **no** `suppressHydrationWarning` (body has); body has inline style but no background/color; only global CSS import is `../colors.css`; no `viewport` export; no `<head>` content.
- `ox.jsx`: `SceneBackground` (≈L48-60) does `scene.background = new THREE.Color(color)` or `null`; per-instance color `pColor.setHSL(hue, saturation, lightness + wave*0.15)` with `hue = (hueOffset + t*0.8 + timeHue + wave*0.05) % 1` (L584-585); a numeric-key exponential smoother over `liveParamsRef.current` runs each frame, key list cached per object identity (L440-470). three is pinned `0.165.0`; R3F 9.5 defaults (`ACESFilmicToneMapping`, sRGB output) do **not** touch these particles because the `ShaderMaterial` has no `colorspace_fragment`/`tonemapping_fragment` — instance colors are written and displayed as **raw display-space RGB**. Baseline per-surface params: inner pages `hueOffset .44 sat .9 light .52 opacity .16` (`InternalPageBackground.jsx` `BACKGROUND_PARAMS`); home `.36/.75/.40/.23` → `.5/1/.55/.18` (`HomePage.jsx` `HERO_PARAMS_START/END`).
- Test script globs include `lib/**/__tests__/**/*.test.{js,mjs}`, `app/**`, `features/**`, `components/dashboard/**` — **not** `components/<other>/__tests__`. All new tests MUST live under `lib/**/__tests__/`.
- `ds-bundle/` does not exist in this worktree (gitignored, generated). Do not create or edit it. `.design-sync/ds-styles.css` and `docs/plans/decomposition-baselines/dashboardCss.baseline.css` are duplicates of dashboard CSS (the latter is a byte-compare gate) — see WS5.
- `useSyncExternalStore` is not used anywhere yet; greenfield, React 19.2 supports it.
- Tokens already consumed: `--text-secondary` 87×, `--text-display` 61×, `--text-primary` 39×, `--border` 37×, `--text-disabled` 23×, `--border-visible` 14×, `--accent` 12×, `--warning` 9×, `--success` 8×, `--surface` 7×, `--surface-raised` 6×; `--page` 0×.

---

## 1. Precedence (the only resolution order)

For one role in one mode, `resolveTheme` applies, in order:

1. **Preset defaults** — the definition's authored `base {l,c,a}` for the role (baseline values in §12).
2. **Linked palette generation** — hue from the role's rule (master hue + offset, tint hue + offset, or fixed hue), chroma scaled by `master.intensity` (accent-family) or `neutral.tintStrength` (neutral-family); `link:{to,…}` roles derive from their target's *final* value after steps 1–3 of the target.
3. **Mode settings** — `modes.<mode>.settings.lightnessShift` and `chromaScale`, applied only to roles flagged `modeSettings:true` that are `auto` or `link` and not `locked`.
4. **Explicit overrides** — `link:"custom"` roles (`custom {l,c,h,a}`) win last and ignore master hue, intensity, tint and mode settings. `locked:true` roles must be `custom`; locked roles are never changed by master moves, mode settings, copy-between-modes, reset-mode, or auto-fix suggestions.

Gamut mapping to sRGB happens once, **after** step 4, per role (§6.2). Alpha is carried through unchanged.

---

## 2. Module layout and file ownership

Rule: **no two workstreams edit the same file.** `DashboardPage.jsx` is owned by WS6 only. Tie-break for unlisted files: WS4 > WS6 > WS2 > WS3 > WS5 > WS7 (specific beats general). Before editing, run `git ls-files` for the globs below; if a file you need to touch is not yours, record it in your report instead.

Dependencies: **WS1 first.** After WS1 gate **G1** (§15.1) the others run in parallel and may only depend on (a) the WS1 public API in §7 and (b) token names in §5.

| WS | Name | Owns (create/edit) |
|---|---|---|
| **WS1** | Core engine | `lib/theme/**` (everything under it incl. `__tests__`, `dev/`, `production/`), `scripts/theme/**`, `styles/theme/theme.generated.css`, `docs/source-of-truth/THEME-STUDIO.md` (schema/API/export/exceptions), `package.json` (**only** to add scripts `theme:build`, `theme:check`; no deps) |
| **WS2** | Runtime | `app/layout.jsx`, `lib/theme-runtime/**` (+ `__tests__`), `components/theme/ThemeRuntime.jsx`, `components/theme/ThemeStudioMount.jsx` |
| **WS3** | Studio UI | `components/theme-studio/**`, `lib/theme-studio/**` (pure UI logic + `__tests__`), `docs/source-of-truth/THEME-STUDIO-DESIGNER-GUIDE.md` |
| **WS4** | Scene | `ox.jsx`, `InternalPageBackground.jsx`, `HomePage.jsx`, `HeroSchematicOverlay.jsx`, `sharedParticleGalleryRenderer.js` (optional S1), `lib/theme-scene/**` (+ `__tests__`), `components/theme-scene/**` |
| **WS5** | CSS migration | `colors.css`, `styles/dashboard/*.css` (`index.css` import order MUST NOT change), `styles/brain-builder.css`, `styles/theme/bridge.css` (new), `docs/plans/decomposition-baselines/dashboardCss.baseline.css` and the byte-compare gate script if one exists, `lib/theme-migration/__tests__/ws5-*.test.js`, `lib/theme-migration/allowlists/ws5.json` |
| **WS6** | Dashboard/admin JSX | `DashboardPage.jsx`, `components/dashboard/**`, `components/brain-builder/**`, `components/AdminCostView.jsx`, `components/AdminEmailModals.jsx`, other `components/Admin*.jsx`, `AdminPage.jsx`, `OpsOverviewPage.jsx`, `app/dashboard/**`, `app/admin/**`, `app/ops/**`, `lib/theme-migration/__tests__/ws6-*.test.js`, `lib/theme-migration/allowlists/ws6.json` |
| **WS7** | Public JSX | Every other root-level `*.jsx`/`*.js` public file not claimed above — at minimum `Header.jsx`, `SiteFooter.jsx`, `InnerPageShell.jsx`, `pageSurfaceSystem.js`, `StackedSlidesSection.jsx`, `HorizontalGallery.jsx`, `HorizontalTextSection.jsx`, `HoverRevealList.jsx`, `PortfolioModal.jsx`, `ReelPlayer.jsx`, `TextOverlay.jsx`, `HeroHeadline.jsx`, `HeroFooter.jsx`, `AuthPage.jsx`, the 14 marketing `*Page.jsx` files — plus `components/home/**`, `components/looper/**`, `components/recreate/**`, `components/ui/**`, `app/archive/**`, `app/capture/**`, `app/not-found.jsx`, `app/post-approval/**`, `app/preview/**`, `lib/theme-migration/__tests__/ws7-*.test.js`, `lib/theme-migration/allowlists/ws7.json` |

Untouchable by everyone (exceptions, §13): `features/email-digest/**` and its `__fixtures__`, `app/api/**`, brief renderers, `brief-design-system-reference/`, invoice document/print/HoloPaper files, `ControlPanel.jsx`, `ColorPalette.jsx`, `LoopControls.jsx`, `BrainParticleWindow.jsx`, `*Swarm*.js(x)`, `AuthContext.jsx`, `ds-bundle/`, `CLAUDE.md`.

Directory shape (new files only):

```
lib/theme/            index, constants, mode, color, contrast, contrast-pairs, roles, tokens, baseline,
                      resolve, scene, validate, migrate, edit, css, export, guide, report, bootstrap-source
lib/theme/dev/        legacy-map.js, scan-literals.js
lib/theme/production/ production-theme.json, resolved.generated.json, baseline.report.json
lib/theme-runtime/    pref-store, draft-store, history, applier, storage, cross-tab, hooks, read-token, studio-gate, index
lib/theme-scene/      scene-bridge, apply-scene
lib/theme-studio/     reducer/selectors/keymap/view-models (pure)
lib/theme-migration/  allowlists/ws{5,6,7}.json, __tests__/ws{5,6,7}-*.test.js
components/theme/     ThemeRuntime.jsx, ThemeStudioMount.jsx
components/theme-studio/   ThemeStudio.jsx + sections/ controls/ preview/
components/theme-scene/    SceneBoundary.jsx, SceneFallback.jsx
scripts/theme/        build-theme.mjs, check-theme.mjs, codemod-literals.mjs, e2e-theme.mjs
styles/theme/         theme.generated.css (WS1, generated), bridge.css (WS5)
```

---

## 3. Theme definition JSON schema v1

All numbers finite. After `validateDefinition`, definitions are **canonical**: `l,c,a` rounded to 4 dp, hue/degree fields to 2 dp, hue wrapped to `[0,360)`, key order = `ROLE_DEFS` order. Canonicalisation is idempotent (this is what makes export→import drift-free).

```ts
type Mode = 'light' | 'dark';
type Preference = 'light' | 'dark' | 'system';

interface ThemeDefinition {
  schema: 'hitloop.theme';
  version: 1;
  meta: { id: string; name: string; description?: string; status: 'draft'|'validated';
          baselineOf?: string; updatedAt?: string /* ISO; export only, NOT used by resolve/hash */ };
  defaults: { viewerPreference: Preference };            // baseline: 'light'
  features: { focusRing: boolean; selection: boolean };  // baseline: false/false
  master:  { hue: number /*0..360, wraps*/; intensity: number /*0..1.5, default 1*/ };
  offsets: { accentBright: number; support1: number; support2: number };  // deg, -180..180; baseline 6 / 86 / 142
  neutral: { tintStrength: number /*0..2, default 1*/; hueSource: 'fixed'|'master'; hue: number };
                                  // fixed: absolute tint hue (baseline 56). master: hue = master.hue + neutral.hue (offset)
  modes: { light: ModeDef; dark: ModeDef };
  scene: { light: SceneDef; dark: SceneDef };
}
interface ModeDef {
  settings: { lightnessShift: number /*-0.15..0.15*/; chromaScale: number /*0..2*/ };  // baseline 0 / 1
  roles: { [roleId: string]: RoleState };                                              // every role in ROLE_DEFS
}
interface RoleState {
  link: 'auto' | 'custom' | LinkSpec;
  base: { l: number; c: number; a: number };         // authored values; used when link==='auto' (and as the reset target of record)
  custom?: { l: number; c: number; h: number; a: number };   // REQUIRED when link==='custom'
  locked?: boolean;                                   // true => link MUST be 'custom'
}
interface LinkSpec { to: string /*roleId*/; mode?: Mode /*default: same mode; use to link dark→light*/;
                     dL?: number; dC?: number; dH?: number; a?: number /*absolute alpha override*/ }
interface SceneDef {
  source: 'follow' | 'custom';
  follow: { hueShiftDeg: number /*-180..180*/; saturationMul: number /*0..1.5*/; lightnessDelta: number /*-0.5..0.5*/;
            opacityMul: number /*0..3*/; hueSpan: number /*0.05..1 turns*/ };
  custom: { base: Oklch; secondary: Oklch | null; highlight: Oklch; highlightStrength: number /*0..1*/; opacityMul: number };
}
type Oklch = { l: number; c: number; h: number };
```

Rules enforced by `validateDefinition` (§7.4):
- Unknown keys dropped (warning `UNKNOWN_KEY`); unknown role ids dropped (warning); **missing** roles/fields are filled from `BASELINE` with warning `MISSING_FIELD_DEFAULTED`.
- `version > 1` → error `UNSUPPORTED_VERSION`; `version` missing/not an integer → error `BAD_VERSION`; malformed JSON text → `JSON_PARSE`.
- Non-finite / non-number where a number is required → error `NONFINITE` (never silently coerced). Out of range → clamped + warning `CLAMPED`. Hue anywhere finite → wrapped silently.
- `link` cycles (including cross-mode: `dark.X → light.X`) → error `LINK_CYCLE`. `link.to` unknown → error `LINK_TARGET_MISSING`.
- `link:'custom'` without `custom` → error `CUSTOM_MISSING`. `locked:true` with `link !== 'custom'` → error `LOCKED_NOT_CUSTOM`.
- `neutral.hueSource:'master'` → `neutral.hue` interpreted as offset.
- Zero-chroma hue preservation: `custom.h` and the resolved `oklch.h` are **kept** when `c` is 0 (never overwritten by `atan2(0,0)`); hex→OKLCH conversion takes a `fallbackHue` (§7.1).

**Modes of linking (UI vocabulary):** *Linked* = `auto` or `link:{…}`; *Custom* = `custom`; *Locked* = custom + `locked`. "Reset" = set `link` back to the `BASELINE` role state (or to `auto` with the role's baseline `base`). Moving the master hue touches only `auto`/`link` roles and the master/offset fields; it never rewrites `custom`.

---

## 4. Roles → tokens

CSS variable for role `id` is always `--t-<id>`. Order in this section is the canonical emit order (`ROLE_DEFS` order). `kind:'solid'` roles emit `#rrggbb`; `kind:'alpha'` roles (any role whose resolved alpha < 1, or flagged alpha) emit `rgba(r, g, b, a)` with `a` trimmed to ≤3 dp. All values are gamut-mapped sRGB.

Hue rule codes: `T±n` = tint hue (`neutral`) + n; `M±n` = master hue + n; `Mo(k)` = master + `offsets.k`; `F=n` = fixed hue n (status/semantic: never follows master).
Scale codes: `tint` = chroma × `neutral.tintStrength`; `int` = chroma × `master.intensity`; `—` = none. `ms` = honours `modes.<mode>.settings`.

### 4.1 Surfaces

| id | hue | scale | ms | L range light / dark | C max | note |
|---|---|---|---|---|---|---|
| `page` | T+40 | tint | – | .94–1.00 / .10–.26 | .03 | body/canvas bg |
| `surface` | T+40 | tint | – | .92–1.00 / .14–.32 | .03 | cards, inputs, modals |
| `raised` | T+39 | tint | – | .92–1.00 / .18–.36 | .03 | popovers, floating panels |
| `inset` | T+50 | tint | – | .88–.99 / .08–.24 | .03 | wells, code, guidance rows |
| `overlay` | T+12 | tint | – | .05–.30 / 0–.20 | .03 | scrim behind modals (alpha .2–.9) |
| `chrome` | T+41 | tint | – | .90–.99 / .14–.34 | .05 | nav strip glass (alpha .3–.9) |
| `chrome-strong` | link→`chrome` a.85 | | | | | scroll-top, pinned nav |
| `glass-soft` | link→`surface` a.50 | | | | | |
| `glass` | link→`surface` a.62 | | | | | |
| `glass-strong` | link→`surface` a.78 | | | | | |
| `glass-border` | T+23 | tint | – | .70–.92 / .25–.55 | .05 | sand panel border |
| `glass-highlight` | auto white, a.45 | tint | – | .90–1 / .85–1 | .02 | inset hairlines |
| `scrim` | link→`page` | | | | | text-over-animation scrim, light a=0, dark a=.55 |

### 4.2 Text and borders

| id | hue | scale | L range light / dark | C max | alpha range | note |
|---|---|---|---|---|---|---|
| `text-default` | T+0 | tint | 0–.30 / .82–.98 | .03 | | inherited body color (UA default black today) |
| `text-strong` | T+0 | tint | .05–.30 / .90–1.0 | .03 | | headings (`#0a0a0a`) |
| `text-body` | T+0 | tint | .10–.35 / .80–.96 | .03 | | `#1a1a1a` inner-page body |
| `text` | T+0 | tint | .15–.40 / .82–.98 | .03 | | warm ink `#2a2420`, the workhorse |
| `text-secondary` | link→`text` | | | | .60–.85 | ink @.72 |
| `text-muted` | link→`text` | | | | .40–.65 | ink @.52 |
| `text-faint` | link→`text` | | | | .25–.50 | ink @.38 (placeholders) |
| `text-eyebrow` | T+27 | tint | .30–.55 / .62–.82 | .03 | .5–1 | `rgba(90,83,70,α)` eyebrow labels |
| `text-inverse` | T+25 | tint | .90–1 / .10–.30 | .03 | | inverse ink (on an ink-coloured fill such as a primary button); dark ink in dark mode — **not** for overlays, see `on-overlay` (§19) |
| `on-overlay` | T+25 | tint | .90–1 / .90–1 | .03 | | **added by WS1 (§19):** text on overlay scrims / blocked tiles; light in BOTH modes |
| `on-accent` | T+0 | tint | .10–1 / .10–1 | .03 | | text on accent fills (validated by contrast, not range) |
| `on-solid` | T+0 | tint | .10–1 / .10–1 | .03 | | text on status solids |
| `text-disabled` | link→`text` a.30 | | | | .2–.5 | excluded from contrast |
| `accent-text` | Mo(0) | int | .40–.58 / .72–.90 | .18 | | links/accent text on page |
| `border-faint` | link→`text` a.08 | | | | .04–.14 | decorative |
| `border-subtle` | link→`text` a.12 | | | | .06–.20 | dividers, card hairlines (decorative) |
| `control-border` | link→`text` a.22 | | | | .15–.40 | input/button boundary (baseline; fails 3:1, see §12.4) |
| `control-border-strong` | link→`text` a.55 | | | | .40–.80 | 3.57:1 vs white (meets 3:1) |
| `focus` | M+0 | int | .40–.62 / .70–.90 | .18 | | focus ring |

### 4.3 Accent and supporting

| id | hue | scale | ms | L range light / dark | C max |
|---|---|---|---|---|---|
| `accent` | M+0 | int | ✓ | .55–.80 / .65–.85 | .20 |
| `accent-hover` | link→`accent` dL −.05 (dark +.05) | | | | |
| `accent-pressed` | link→`accent` dL −.09 (dark +.09) | | | | |
| `accent-soft` | link→`accent` a.10 (dark .16) | | | | |
| `accent-soft-border` | link→`accent` a.25 (dark .35) | | | | |
| `accent-bright` | Mo(accentBright) | int | ✓ | .70–.90 / .70–.90 | .22 |
| `support-1` | Mo(support1) | int | ✓ | .45–.80 / .60–.85 | .32 |
| `support-2` | Mo(support2) | int | ✓ | .45–.80 / .60–.85 | .32 |
| `selection-bg` | link→`accent` a.25 (dark .35) | | | | |
| `selection-fg` | link→`text` | | | | |

### 4.4 Decorative ramps (follow master via fixed offsets; excluded from contrast)

| ids | hue | scale | ms | L range | C max |
|---|---|---|---|---|---|
| `comet-1`…`comet-7` | M+4, +35, +65, +82, +107, +127, +139 | int | ✓ | .55–.90 / .55–.90 | .30 |
| `deco-1`…`deco-4` (hero tint blobs) | M−153, M−25, M−110, M+98 | int | ✓ | .60–.85 / .50–.80 | .14 |

`comet-n` are the 7 conic-gradient hues in `colors.css` (`hsla(185…320)`); the per-stop alphas (.12….97) stay in CSS and are applied with `color-mix(in srgb, var(--t-comet-n) 12%, transparent)`.

### 4.5 Status (hue fixed, never follows master; lightness/chroma vary per mode)

| id | F hue | scale | L light / dark | C max | note |
|---|---|---|---|---|---|
| `success` | 152.7 | — | .35–.55 / .68–.85 | .22 | fg on surface |
| `success-bg` | link→`success` a.10 (dark .16) | | | | |
| `success-border` | link→`success` a.25 (dark .35) | | | | |
| `success-solid` | 148.6 | — | .50–.80 / .60–.82 | .24 | fills, icons |
| `warning` | 69.1 | — | .35–.55 / .68–.85 | .22 | |
| `warning-bg` / `warning-border` | link→`warning` a.12/.30 (dark .16/.35) | | | | |
| `warning-solid` | 84.9 | — | .50–.82 / .60–.85 | .24 | |
| `danger` | 29.0 | — | .35–.55 / .68–.85 | .22 | |
| `danger-bg` / `danger-border` | link→`danger` a.08/.25 (dark .14/.35) | | | | |
| `danger-solid` | 26.8 | — | .50–.80 / .60–.82 | .24 | legacy dashboard `--accent` red |
| `info` | 264.4 | — | .35–.55 / .68–.85 | .22 | |
| `info-bg` / `info-border` | link→`info` a.08/.25 (dark .14/.35) | | | | |
| `info-solid` | 262.0 | — | .50–.80 / .60–.82 | .24 | |

Status roles are `ms:false`, `scale:—`, and are shown in the Studio as **Locked-by-meaning** (editable L/C only; hue field disabled). Status never relies on color alone: Studio preview and any new status UI must pair color with text/icon.

### 4.6 State, shadow, scene

| id | spec |
|---|---|
| `disabled-bg` | link→`text` a.06 (dark .08) |
| `shadow` | alpha black `l0 c0`, a.10 light / a.45 dark (range .04–.60) |
| `scene-wash` | alpha, `T+41` tint chrome color: light `rgba(245,241,223,.08)`, dark `rgba(20,18,16,.08)` |

### 4.7 Dashboard neutral group (exact legacy values, `scale:—`, hue preserved at tint hue, c = 0)

`dash-page`, `dash-surface`, `dash-surface-raised`, `dash-border`, `dash-border-visible`, `dash-text-disabled`, `dash-text-secondary`, `dash-text-primary`, `dash-text-display`, `dash-dot-grid` (alpha). Values in §12.2. These back the `[data-dashboard-theme]` aliases and are NOT tinted by default (the dashboard greys are pure neutrals today). Range: unrestricted `0–1`.

### 4.8 Terminal group (names mirror `colors.css:164-186`; legacy `--term-X` = `var(--t-term-X)`)

Neutral shell (tint-scaled): `term-bg-top`, `term-bg-bottom`, `term-border` (link→`text` a.10), `term-border-top` (a.06), `term-titlebar-bg` (a.035), `term-titlebar-border` (a.07), `term-title-fg` (a.42), `term-scroll-thumb` (a.16), `term-fg` (link→`text`), `term-dim`, `term-shadow-1` (link→`text` a.05), `term-shadow-2` (a.08).
Semantic lines (**fixed hue, never follow master**, `ms:false`): `term-{info,fetch,ok,ai,build,error,active,screen,mock,countdown}-{pfx,msg}` and `term-caret` (link→`info-solid`).
Ranges: pfx L .45–.65 light / .70–.85 dark; msg L .28–.58 light / .78–.90 dark; C ≤ .26.

### 4.9 Composite (non-role) tokens emitted by `toCss`

| token | value |
|---|---|
| `--t-gradient-accent` | `linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%)` (matches `colors.css:297`) |
| `--t-term-bg` | `linear-gradient(180deg, var(--t-term-bg-top) 0%, var(--t-term-bg-bottom) 100%)` |
| `--t-term-shadow` | `0px 4px 10px var(--t-term-shadow-1), 0px 14px 30px var(--t-term-shadow-2)` |
| `--t-shadow-sm/md/lg` | `0 1px 2px S`, `0 4px 12px S`, `0 14px 30px S` where `S = var(--t-shadow)` |
| `--t-blend-deco` | `multiply` (light) / `screen` (dark) — hero tint overlay blend |
| `--t-logo-blend` | `darken` (light) / `lighten` (dark) — for `/img/sig.png` |
| `--t-logo-filter` | `none` (light) / `invert(1)` (dark) |
| `--t-logo-filter-muted` | `grayscale(1) opacity(.45)` (light) / `grayscale(1) invert(1) opacity(.45)` (dark) |
| `--t-scene-bg` | = `--t-page` value (opaque scene surfaces) |
| `--t-scene-base` / `--t-scene-secondary` / `--t-scene-highlight` | representative hex swatches from `resolveScene` (informational; fallback + Studio) |
| `--t-scene-fallback` | `radial-gradient(60% 50% at 30% 20%, <base>33, transparent), radial-gradient(50% 50% at 75% 70%, <secondary>26, transparent)` over `--t-page` — static fallback when WebGL is unavailable |

`TOKEN_NAMES` (exported from `lib/theme/tokens.js`) is the ordered union of all role vars and composite vars. A test asserts `toCss` emits exactly `TOKEN_NAMES`, once per mode block, and that every `--t-*` referenced anywhere in `styles/**`, `*.jsx`, `*.css` exists in it.

### 4.10 Alpha-token usage rule (what migrators write)

- Opaque role: `var(--t-text)`.
- A non-tokenised alpha of a role: `color-mix(in srgb, var(--t-text) 14%, transparent)` — exactly equals today's `rgba(42,36,32,.14)` and works in dark. Same for `--t-surface` (white family), `--t-text-strong`, `--t-text-body`, `--t-text-eyebrow`.
- **Black shadows stay literal**: `rgba(0,0,0,α)` inside `box-shadow`/`text-shadow`/`filter: drop-shadow` is mode-agnostic and is NOT migrated (documented exception X6). Non-shadow `rgba(0,0,0,α)` dividers → `color-mix(in srgb, var(--t-text-strong) α%, transparent)`.

---

## 5. Generated CSS format (`toCss`)

```css
/* theme: <meta.id> hash:<fnv1a32 hex> — GENERATED by lib/theme (scripts/theme/build-theme.mjs). DO NOT EDIT. */
:root {                                   /* no-JS fallback = defaults.viewerPreference (or light if 'system') */
  color-scheme: light;
  --t-page: #ffffff;  /* …all TOKEN_NAMES… */
}
:root[data-theme="light"], [data-theme-scope="light"] { color-scheme: light; /* all light tokens */ }
:root[data-theme="dark"],  [data-theme-scope="dark"]  { color-scheme: dark;  /* all dark tokens  */ }
/* only when defaults.viewerPreference === 'system': */
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { color-scheme: dark; /* dark tokens */ } }
/* transition suppression while dragging/switching: */
:root[data-theme-switching], :root[data-theme-switching] *, :root[data-theme-switching] *::before, :root[data-theme-switching] *::after { transition: none !important; }
/* only when features.selection: */  :root[data-theme] ::selection, [data-theme-scope] ::selection { background: var(--t-selection-bg); color: var(--t-selection-fg); }
/* only when features.focusRing: */  :where(:focus-visible) { outline: 2px solid var(--t-focus); outline-offset: 2px; }
```

- `!important` is used in exactly one place (transition suppression). `:where()` keeps the focus rule zero-specificity so existing `outline` rules win.
- Specificity: `:root[data-theme]` (0,2,0) beats the bare `:root` fallback; the draft `<style id="theme-draft-css">` reuses identical selectors and is appended last → wins by order.
- `toCss` options: `{ noJsFallback=true, selectors?, scopeOnly=false, header=true }`. `scopeOnly:true` emits only the `[data-theme-scope=…]` blocks (used for Studio previews).
- Output is byte-deterministic (fixed ordering, no timestamps). `scripts/theme/check-theme.mjs` fails if `styles/theme/theme.generated.css` ≠ `toCss(production)`.

**Alias gotcha (MUST):** a custom property declared as `--x: var(--t-y)` is resolved where it is *declared*, then inherited as a computed value. Root-level legacy aliases therefore MUST be declared with the selector list `:root, [data-theme-scope]` so a pinned subtree recomputes them. Aliases declared on a descendant (`.vrk-scope`, `#brain-builder-page`, `[data-dashboard-theme]`) inherit the right `--t-*` automatically.

---

## 6. Color math (WS1, `lib/theme/color.js`, no dependencies)

### 6.1 Conversions (Björn Ottosson OKLab constants — use exactly these)

```
srgb→linear:  c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4        linear→srgb: inverse (c<=0.0031308 ? 12.92c : 1.055c^(1/2.4)-0.055)
linear sRGB → LMS:  l = 0.4122214708r + 0.5363325363g + 0.0514459929b
                    m = 0.2119034982r + 0.6806995451g + 0.1073969566b
                    s = 0.0883024619r + 0.2817188376g + 0.6299787005b       (then cube roots l',m',s')
LMS' → Lab:  L = 0.2104542553l' + 0.7936177850m' − 0.0040720468s'
             a = 1.9779984951l' − 2.4285922050m' + 0.4505937099s'
             b = 0.0259040371l' + 0.7827717662m' − 0.8086757660s'
Lab → LMS':  l' = L + 0.3963377774a + 0.2158037573b
             m' = L − 0.1055613458a − 0.0638541728b
             s' = L − 0.0894841775a − 1.2914855480b      (cube them)
LMS → linear sRGB:  r = +4.0767416621l − 3.3077115913m + 0.2309699292s
                    g = −1.2684380046l + 2.6097574011m − 0.3413193965s
                    b = −0.0041960863l − 0.7034186147m + 1.7076147010s
OKLCH: c = hypot(a,b); h = atan2(b,a) in degrees wrapped to [0,360); achromatic if c < 1e-4 (hue then comes from the caller).
```
Sanity vectors (tests): `#ffffff` → L≈1, c<1e-4; `#2a2420` → (0.266, 0.012, 55.8); `#00adb5` → (0.680, 0.116, 200.7); `#6e1aff` → (0.520, 0.286, 287.4); `#D71921` → (0.561, 0.218, 26.8) (±0.002).

### 6.2 Gamut mapping (CSS Color Module 4 §13.2, OKLCH chroma reduction)

```
inputs: oklch {l,c,h}; JND = 0.02 (deltaEOK); ε = 0.0001
if l >= 1 → white; if l <= 0 → black
if inGamut(candidate) → return candidate            (inGamut: all linear channels within [−1e-6, 1+1e-6])
min = 0, max = c, minInGamut = true
while (max − min > ε):
   chroma = (min+max)/2; cur = {l, chroma, h}
   if (minInGamut && inGamut(cur)) { min = chroma; continue }
   clipped = clip(cur)                              (clip = clamp linear sRGB channels to [0,1])
   E = deltaEOK(clipped, cur)
   if (E < JND) { if (JND − E < ε) return clipped; minInGamut = false; min = chroma }
   else max = chroma
return clipped
```
`deltaEOK` = Euclidean distance in OKLab. Result is encoded to sRGB and rounded to 8-bit (`Math.round(c*255)`), producing the hex used for **both** CSS and contrast. Return `{ oklch (mapped), rgb255:[r,g,b], mapped:boolean, deltaE:number }`. Document this method in `docs/source-of-truth/THEME-STUDIO.md`.

### 6.3 Contrast (WCAG 2.x)

- Relative luminance from 8-bit sRGB: `0.2126R+0.7152G+0.0722B` with `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4` (identical to 0.04045 for all 8-bit values).
- Ratio `(L1+0.05)/(L2+0.05)` with L1 ≥ L2.
- **Alpha compositing before measuring:** layers are composited bottom→top over the opaque `page` colour in **gamma-encoded sRGB**, per channel `out = a·fg + (1−a)·bg`, rounded to 8-bit (this matches browser blending). Foregrounds with alpha are composited over the *actual* resulting background of the pair (e.g. `text-muted` over `glass` over `page`). Evaluate **after** gamut mapping.
- Thresholds: `text` 4.5, `large` 3.0, `nontext` 3.0. Decorative, disabled, and pure-decoration roles are excluded and listed as `excluded` in the report with a reason.
- The report states: "Automated contrast checks only; this is not a WCAG conformance claim."

---

## 7. JS API (all ESM, pure, no `window`/`document` at import time, explicit `.js` extensions)

### 7.1 `lib/theme/index.js` exports

```js
// constants.js
SCHEMA_ID = 'hitloop.theme'; SCHEMA_VERSION = 1; MODES = ['light','dark']; PREFERENCES = ['light','dark','system']
BASELINE_MASTER_HUE = 201
STORAGE_KEYS = {
  pref:        'theme:pref:v1',               // 'light'|'dark'|'system'
  draft:       'theme-studio:draft:v1',       // JSON { v:1, savedAt, baseHash, definition }
  active:      'theme-studio:active:v1',      // '1' => apply draft site-wide pre-paint (admin preview-on-site)
  draftCss:    'theme-studio:draftcss:v1',    // generated CSS text for pre-paint injection (starts with '/* theme-draft v1 ')
  draftScene:  'theme-studio:draftscene:v1',  // JSON { light: ResolvedScene, dark: ResolvedScene }
  devStudio:   'theme-studio:dev:v1',         // sessionStorage, dev only ('1' after ?theme-studio=1)
  debug:       'theme-studio:debug:v1',       // '1' => ox exposes window.__themeSceneStats
}
CHANNEL_NAME = 'theme-studio'                   // BroadcastChannel
// mode.js  (shared rule used by runtime AND mirrored by the bootstrap)
normalizePreference(value, fallback) -> Preference
resolveMode(preference, systemPrefersDark:boolean) -> 'light'|'dark'
// color.js
parseHex(str) -> {r,g,b,a}|null ; formatHex({r,g,b}) -> '#rrggbb' ; formatRgba({r,g,b,a}) -> 'rgba(r, g, b, a)'
srgbToLinear(c) ; linearToSrgb(c) ; oklchToOklab(o) ; oklabToOklch(o, fallbackHue=0)
linearSrgbToOklab(rgb) ; oklabToLinearSrgb(lab) ; hexToOklch(hex, fallbackHue=0) -> {l,c,h}   // keeps fallbackHue when c<1e-4
oklchToRgb255(oklch) -> {r,g,b,inGamut}          // unmapped, may be out of range
gamutMap(oklch) -> { oklch, rgb255:[r,g,b], mapped:boolean, deltaE:number }
oklchToHex(oklch) -> '#rrggbb'                    // gamut-mapped
deltaEOK(a,b) ; wrapHue(h) -> [0,360) ; hueDelta(a,b) -> shortest signed (-180,180] ; wrapTurns(t) -> (-0.5,0.5]
// contrast.js
relativeLuminance({r,g,b}) ; contrastRatio(fg, bg) ; composite(fg:{r,g,b,a}, bg:{r,g,b,a}) -> {r,g,b,a}
// roles.js
ROLE_DEFS: Array<{ id, css:'--t-…', group, kind:'solid'|'alpha', hue:{src:'tint'|'master'|'offset'|'fixed', value|key}, scale:'tint'|'int'|'none',
                   modeSettings:boolean, ranges:{light:{l:[a,b],c:[0,max],a?:[a,b]},dark:{…}}, usage:string, contrast:boolean }>
ROLE_IDS ; GROUPS
// tokens.js
TOKEN_NAMES ; tokenForRole(id) -> '--t-…'
// baseline.js
BASELINE_DEFINITION (deep-frozen) ; createBaseline() -> deep clone
// resolve.js
resolveTheme(definition, mode, options?) -> ResolvedTheme ; resolveBoth(definition) -> { light, dark }
// scene.js
resolveScene(definition, mode, resolvedRoles) -> ResolvedScene ; SCENE_REFERENCE = { hue: 0.44, saturation: 0.9, lightness: 0.52 }
// validate.js / migrate.js
validateDefinition(input) -> ValidationResult ; parseDefinition(text) -> ValidationResult ; normalizeDefinition(def) -> ThemeDefinition ; canonicalize(def) ; hashDefinition(def) -> 8-hex FNV-1a32 of canonical JSON (excl. meta.updatedAt)
migrate(raw) -> { ok, definition|null, fromVersion, toVersion, steps:string[], errors:[] }     // v1 only today; MIGRATIONS registry ready
// edit.js  (immutable helpers; return new definitions with structural sharing; used by Studio + tests)
setMasterHue(def, hue) ; setIntensity(def, v) ; setOffset(def, key, deg) ; setNeutral(def, patch) ; setModeSettings(def, mode, patch)
setRoleBase(def, mode, roleId, {l?,c?,a?}) ; setRoleCustom(def, mode, roleId, {l,c,h,a}) ; setRoleLink(def, mode, roleId, linkSpec|'auto')
setLocked(def, mode, roleId, bool) ; resetRole(def, mode, roleId) ; resetMode(def, mode) ; copyMode(def, from, to, {roleIds?, skipLocked:true}) ; linkModes(def, from, to, roleIds)
setSceneSource(def, mode, 'follow'|'custom') ; setSceneFollow(def, mode, patch) ; setSceneCustom(def, mode, patch)
// css.js
toCss(definitionOrResolvedPair, options?) -> string
// report.js
buildReport(definition) -> ThemeReport ; evaluateContrast(resolved, definition?) -> ContrastReport ; suggestFix(resolved, pairResult) -> Suggestion|null
// guide.js
toColorGuide(definition) -> { rows:[{ token, roleId, group, usage, light:{hex,oklch}, dark:{hex,oklch}, linked:string|null }] } ; toColorGuideMarkdown(definition) -> string
// export.js
exportThemeJson(def) -> string (canonical, 2-space, trailing \n) ; importThemeJson(text) -> ValidationResult
buildExportBundle(def) -> { json, css, guideMarkdown, reportJson, status:'draft'|'validated' }
// bootstrap-source.js
getBootstrapScript({ defaultPreference }) -> string        // ES5, no template literals, <= 1.6KB, constant per defaultPreference
BOOTSTRAP_SCRIPT_HASH_NOTE -> doc string only (sha256 computed by scripts/theme/check-theme.mjs)
```

### 7.2 `ResolvedTheme`

```ts
{
  version: 1; mode: Mode; definitionId: string; hash: string;
  meta: { masterHue: number; intensity: number; tintStrength: number };
  tokens: Record<string /*--t-…, in TOKEN_NAMES order*/, string /*'#rrggbb' | 'rgba(r, g, b, a)' | composite*/>;
  roles: Record<RoleId, { id; css; kind: 'solid'|'alpha';
        oklch: { l; c; h; a };           // final, pre-gamut-map values (h preserved for c=0)
        mapped: { l; c; h };             // post gamut map
        hex: '#rrggbb'; rgba: [r,g,b,a]; value: string;   // value = token string
        gamut: { mapped: boolean; deltaE: number };
        source: 'auto'|'link'|'custom'; locked: boolean }>;
  scene: ResolvedScene;
}
```
`resolveTheme` MUST NOT read `Date`, `Math.random`, locale, `window`, or the object identity of its input. `resolveTheme(d, m)` deep-equals `resolveTheme(importThemeJson(exportThemeJson(d)).definition, m)`.

### 7.3 `ResolvedScene` (§9) and `ThemeReport`

```ts
ThemeReport = {
  schemaVersion: 1; definitionId; hash;
  structure: { errors: Issue[]; warnings: Issue[] };          // from validateDefinition
  modes: { light: ContrastReport; dark: ContrastReport };
  gamut: Array<{ mode; roleId; mapped: boolean; deltaE: number }>;   // only mapped ones
  ranges: Array<{ mode; roleId; field:'l'|'c'|'a'; value; min; max }>;       // out-of-range warnings
  summary: { pass: number; fail: number; advisoryFail: number; excluded: number; failRequired: number };
  statement: 'Automated contrast checks only; this is not a WCAG conformance claim.';
}
ContrastReport = { mode; results: Array<{
    id; label; kind:'text'|'large'|'nontext'; min: 4.5|3; required: boolean;
    fg: RoleId; bg: RoleId[] /* bottom→top layers over page */;
    fgHex: string /* composited */; bgHex: string /* composited */; ratio: number /*2 dp*/; pass: boolean;
    fgLocked: boolean; bgLocked: boolean;
    suggestion?: { role: RoleId; set: { l?; c?; a? }; resultingRatio: number; blockedByLock?: true } }>;
  excluded: Array<{ roleId; reason: string }> }
Issue = { path: string; code: string; message: string }
ValidationResult = { ok: boolean; definition: ThemeDefinition|null; errors: Issue[]; warnings: Issue[] }
```
`suggestFix` binary-searches OKLCH **L** (keeping c,h; gamut-mapped) on the first non-locked, non-custom-protected role of the pair until `ratio ≥ min + 0.05`; alpha roles suggest a higher `a`. It never mutates a definition; locked roles produce `blockedByLock:true` and the Studio shows the suggestion as informational only.

**Contrast pairs** (`lib/theme/contrast-pairs.js`; each evaluated per mode): `text|text-strong|text-body|text-default` on `page|surface|raised|inset|glass-strong(over page)`; `text-secondary`, `text-muted`, `text-faint` on `surface` and `glass-strong`; `text-eyebrow` on `surface`; `text-inverse` on `overlay(over page)` and `chrome-strong(over page)`; `on-accent` on `accent|accent-hover|accent-pressed`; `accent-text` on `page|surface|accent-soft(over surface)`; `on-solid` on each `*-solid`; each status fg on `surface` and on its own `*-bg(over surface)`; `selection-fg` on `selection-bg(over page)`; `term-fg|term-dim|term-<kind>-pfx|msg` on `term-bg-top` and `term-bg-bottom`; `dash-text-primary|secondary` on `dash-surface|dash-page`; `text` on `page + scrim + scene-peak` (scene-peak = `scene-base` at alpha 0.23, an approximation, not a sample of every particle); **non-text 3:1**: `focus` on `page|surface`, `control-border` and `control-border-strong` on `surface`, `accent` on `surface` (meaningful graphic), each `*-solid` on `surface`. **Excluded:** `border-faint|subtle`, `glass-border`, `text-disabled`, `disabled-bg`, `shadow`, `deco-*`, `comet-*`, `support-*` (decorative), `overlay`, `scrim`, `glass-highlight`.

### 7.4 `validateDefinition(input)`

Accepts an object (already parsed). Returns normalized canonical definition + issues per §3. `parseDefinition(text)` wraps `JSON.parse` in try/catch → `JSON_PARSE`. Neither throws. Inputs of wrong top-level type (`null`, array, string) → `NOT_AN_OBJECT`.

### 7.5 Client stores (WS2; `useSyncExternalStore`-compatible; plain modules, no React imports)

Two stores, so the public bundle never pulls the authoring engine:

**`lib/theme-runtime/pref-store.js`** (main bundle; imports only `lib/theme/{constants,mode}.js` and the generated `production/resolved.generated.json`)
```js
getPrefStore() -> {
  subscribe(listener) -> unsubscribe,
  getSnapshot() -> PrefSnapshot,              // referentially stable until a field changes
  getServerSnapshot() -> PrefSnapshot,        // { preference: DEFAULT, systemMode:'light', resolvedMode: DEFAULT==='dark'?'dark':'light', storageAvailable:true }
  setPreference(pref) -> void,                // normalise → write localStorage (try/catch) → set html attrs → rAF-batched notify
}
PrefSnapshot = { preference: Preference; systemMode: Mode; resolvedMode: Mode; storageAvailable: boolean }
createPrefStore({ storage, matchMedia, document, defaultPreference }) -> store   // injectable for tests
```
Initial client value is read from `document.documentElement.getAttribute('data-theme-pref')` (set by the bootstrap), falling back to storage, falling back to the production default. `matchMedia('(prefers-color-scheme: dark)')` change updates `systemMode` always but re-applies attributes **only when preference === 'system'**. `storage` events on `STORAGE_KEYS.pref` sync other tabs.

**`lib/theme-runtime/draft-store.js`** (lazy; imported only from `ThemeStudioMount`/Studio and by `ThemeRuntime` when `active` flag set)
```js
getDraftStore() -> {
  subscribe, getSnapshot() -> DraftSnapshot, getServerSnapshot(),
  // lifecycle
  startDraft(fromDefinition?) , discardDraft(), saveDraft() -> {ok, savedAt, error?}, loadSaved() ,
  setApplied(bool),                    // apply draft site-wide (writes active flag + draftCss + draftScene) / revert to production
  // edit (all go through history; definitions are immutable)
  updateDraft(updater:(def)=>def, opts?: { transient?: boolean; coalesceKey?: string; label?: string }),
  commitTransient(),                   // closes a drag => exactly one undo entry
  undo(), redo(), resetRole(mode, roleId), resetMode(mode), resetDraft(),
  // view state
  setEditingMode(mode), setPreviewMode('light'|'dark'|'system'|null), setCompare('draft'|'production'),
  // io
  exportBundle() -> buildExportBundle(draft), importText(text) -> ValidationResult,
}
DraftSnapshot = {
  active: boolean; applied: boolean;
  draft: ThemeDefinition|null; production: ThemeDefinition;
  dirty: boolean;                       // draft hash !== last saved hash
  differsFromProduction: boolean;
  savedAt: string|null; canUndo: boolean; canRedo: boolean;
  editingMode: Mode; previewMode: 'light'|'dark'|'system'|null;
  resolved: { light: ResolvedTheme; dark: ResolvedTheme }|null;
  report: ThemeReport|null;             // computed lazily, debounced 150ms, never on every drag frame
  externalChange: boolean;              // another tab saved a draft while this one is dirty
  storageAvailable: boolean;
}
```
Behaviours (MUST):
- **Undo granularity:** `transient:true` updates mutate the live draft + apply CSS but push no history; `commitTransient()` pushes one entry. Keyboard arrow on a slider uses `coalesceKey` and merges presses within 400 ms. History cap 100.
- **Apply pipeline:** every draft change schedules one `requestAnimationFrame`; in it: `resolveBoth` → `toCss` → `document.getElementById('theme-draft-css').textContent = css` → `sceneBridge.setDraft(scenes)` → dispatch `theme:tokens-changed`. While a transient drag is open, `data-theme-switching` is set on `<html>` and cleared 2 rAFs after `commitTransient`.
- **Debounce:** autosave of `draft` to localStorage trailing 400 ms, flushed on `commitTransient`, `pagehide`, and `saveDraft()`. `draftCss`/`draftScene`/`active` written only when `applied`.
- **Cross-tab:** `BroadcastChannel(CHANNEL_NAME)` + `storage` events. A tab with `dirty === true` sets `externalChange=true` and **never overwrites** its in-memory draft; the Studio offers *Load other draft / Keep mine*. A clean tab adopts the incoming draft.
- **Storage failure:** every storage access is wrapped in try/catch; failure sets `storageAvailable:false`, the Studio shows an inline warning, nothing throws.

### 7.6 Hooks (`lib/theme-runtime/hooks.js`, client only)

```js
useThemePreference() -> { preference, setPreference }        // useSyncExternalStore(pref.subscribe, pref.getSnapshot, pref.getServerSnapshot)
useResolvedMode() -> 'light'|'dark'
useThemeSelector(selector) -> value                           // selector over PrefSnapshot; re-renders only when the selected value changes
readToken(name, el?) -> string                                // getComputedStyle(documentElement).getPropertyValue(name).trim(), memoised per tokens-changed epoch
onTokensChanged(fn) -> unsubscribe                            // wraps the `theme:tokens-changed` CustomEvent on document
```
Any component that needs a colour in JS (canvas 2D, GSAP-created nodes, `new THREE.Color`) MUST call `readToken` at draw/creation time **and** re-read on `onTokensChanged`; or, preferably, use `'var(--t-…)'` strings. Components MUST NOT render different markup by mode on first render (hydration safety) — use CSS variables.

---

## 8. Runtime and pre-paint

### 8.1 `<html>` contract

- Attributes: `data-theme` (resolved mode), `data-theme-pref` (preference), `data-theme-switching` (transient). Inline `style="color-scheme:light|dark"` set by the bootstrap. Server renders `data-theme="light"` and `data-theme-pref="light"` **only when** the production default is not `system`; for `system` it renders neither (the generated `@media` fallback handles no-JS). `<html suppressHydrationWarning>` is mandatory.
- `app/layout.jsx` (WS2): add `suppressHydrationWarning`; add explicit `<head>` with `<script dangerouslySetInnerHTML={{ __html: getBootstrapScript({ defaultPreference }) }} />` as the first child; import `../styles/theme/theme.generated.css` then `../styles/theme/bridge.css` **after** `../colors.css`; add `background: 'var(--t-page)'` and `color: 'var(--t-text-default)'` to the existing body style (baseline: `#ffffff` / `#000000` = current look); add `export const viewport = { colorScheme: <'light' | 'light dark'>, themeColor: [{ media:'(prefers-color-scheme: light)', color:<page light hex> }, { media:'(prefers-color-scheme: dark)', color:<page dark hex> }] }` computed from `resolved.generated.json` (note: `themeColor` follows the OS, not an explicit override — accepted limitation); mount `<ThemeRuntime />` before `<SmoothScroll />` and `<ThemeStudioMount />` inside `<AuthProvider>`.

### 8.2 Bootstrap (ES5, built by `getBootstrapScript`, no data from the request)

```js
(function(){var d=document.documentElement,P='<DEFAULT>';try{
 var p=P;try{var s=localStorage.getItem('theme:pref:v1');if(s==='light'||s==='dark'||s==='system')p=s}catch(e){}
 var m=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;
 d.setAttribute('data-theme',m);d.setAttribute('data-theme-pref',p);d.style.colorScheme=m;
 try{if(localStorage.getItem('theme-studio:active:v1')==='1'){var c=localStorage.getItem('theme-studio:draftcss:v1');
  if(c&&c.indexOf('/* theme-draft v1 ')===0){var t=document.createElement('style');t.id='theme-draft-css';t.textContent=c;(document.head||d).appendChild(t)}}}catch(e){}
}catch(e){d.setAttribute('data-theme',P==='dark'?'dark':'light')}})();
```
Rules shared with runtime: `normalizePreference`/`resolveMode` in `lib/theme/mode.js`. **Parity test (`lib/theme-runtime/__tests__/bootstrap-parity.test.js`)** executes the script in `node:vm` with fake `document`/`localStorage`/`matchMedia` across the matrix {default pref light|dark|system} × {stored value valid|invalid|absent|storage throws} × {OS dark|light|no matchMedia} × {active flag ± draftCss valid|invalid} and asserts the same `(data-theme, data-theme-pref, colorScheme)` as `createPrefStore`'s initial snapshot. The draft CSS is accepted only when it begins with the exact marker (self-authored data in the viewer's own storage; an attacker able to write it already has script execution).
CSP note: if a CSP is ever added, pin `sha256` of the constant script (printed by `scripts/theme/check-theme.mjs`); avoid per-request nonces because they force dynamic rendering of this static layout.

### 8.3 Behaviours (MUST)

- Navigation: attributes live on `<html>` and survive client-side routing; `ThemeRuntime` mounts once in the root layout.
- OS changes apply only while `preference === 'system'`. Explicit `light|dark` ignores OS changes.
- Cross-tab: `storage` event on `theme:pref:v1` updates preference; draft sync per §7.5.
- No-JS: native `color-scheme` + generated fallback (§5) — page is readable and consistent with the default preference.
- Reduced motion: no theme transition animation is introduced; `data-theme-switching` removes existing transitions during mode switches/drags.
- Public viewer UI for preference: **none added** (layout preserved). Entry points are the dashboard's existing hidden `#theme-toggle` (WS6 rewires it to `setPreference`) and the Studio. Open question for owner (§17).

### 8.4 Studio gating (`lib/theme-runtime/studio-gate.js`, `components/theme/ThemeStudioMount.jsx`)

```js
isStudioEnabled({ isAdmin, adminReady, search, nodeEnv, sessionStorage }) -> boolean
// prod:  adminReady && isAdmin
// dev:   (adminReady && isAdmin) || search has theme-studio=1 (persisted to sessionStorage devStudio) — evaluated only when nodeEnv === 'development'
```
`process.env.NODE_ENV` is inlined by Next so the dev branch is eliminated from production bundles; add a unit test with `nodeEnv:'production'` + `?theme-studio=1` → `false`. The mount renders nothing until enabled, then a small fixed launcher `#theme-studio-launcher` (hidden for non-admin), shortcut `Alt+Shift+T`; on open it `dynamic(() => import('../theme-studio/ThemeStudio'), { ssr:false })` and imports `draft-store`. Non-admin bundles never load the Studio chunk. Server-side persistence is not part of v1.

---

## 9. Scene (WS4) — Three.js integration

### 9.1 `ResolvedScene`

```ts
{ source: 'follow'|'custom';
  background: '#rrggbb';                 // = page hex; used only by opaque surfaces
  hueShift: number;                      // turns in (-0.5, 0.5]; ADDED to the surface's hueOffset (then wrapped)
  saturationMul: number;                 // multiplies surface saturation, clamp [0,1]
  lightnessDelta: number;                // added to surface lightness, clamp [0,1]
  opacityMul: number;                    // multiplies surface opacity, clamp [0,1]
  hueSpan: number;                       // turns; baseline 0.8 (ox.jsx currently hardcodes t*0.8)
  highlight: { srgb: [r,g,b] /*0..1 display-space*/, mix: number /*0..1*/ };
  swatches: { base: '#hex'; secondary: '#hex'; highlight: '#hex' };
  wash: 'rgba(…)'; }
```
`follow`: `hueShift = wrapTurns((master.hue − 201)/360 + follow.hueShiftDeg/360)`; the other fields come straight from `follow`. `custom`: reference is `SCENE_REFERENCE` (the inner-page params): convert `custom.base` (sRGB, via gamut map) to HSL → `hueShift = wrapTurns(h_hsl − 0.44)`, `saturationMul = s/0.9`, `lightnessDelta = l − 0.52`; `hueSpan` = ccw turns from base hue to `secondary` hue clamped `[0.05,1]` (null secondary ⇒ 0.8); `highlight = custom.highlight`, `mix = highlightStrength`. Both models are *deltas over the surface's own params*, so Home's scroll interpolation (`HERO_PARAMS_START→END`) keeps working. **`emissive` is intentionally not in schema v1**: `bloom*` params are dead in `ox.jsx` (no bloom pass exists), so there is nothing relevant to drive. Gradient stops are the `deco-1…4` roles.

Baseline: light `follow {hueShiftDeg 0, saturationMul 1, lightnessDelta 0, opacityMul 1, hueSpan .8}`; dark `follow {0, 0.95, +0.10, 1.5, .8}` (design proposal; tuned visually in Studio; validated only by the text-over-scene contrast pair). Highlight strength 0 in both.

### 9.2 `lib/theme-scene/scene-bridge.js` (WS4 creates it FIRST — WS2 imports it)

```js
sceneBridge.setProduction({ light, dark })   // ResolvedScene×2, from resolved.generated.json, called by ThemeRuntime
sceneBridge.setMode('light'|'dark')          // from pref store resolvedMode
sceneBridge.setDraft({ light, dark } | null) // from draft store applier / draftScene cache
sceneBridge.get(which = 'current')           // 'current'|'light'|'dark' -> ResolvedScene (draft ?? production)
sceneBridge.subscribe(fn) -> unsubscribe     // fn() after any change; no React state
```
`lib/theme-scene/apply-scene.js`: `applySceneToParams(surfaceParams, scene) -> { hueOffset, saturation, lightness, opacity, hueSpan }` (pure; wraps hue; clamps) — unit-tested.

### 9.3 ox.jsx changes (WS4)

1. New prop `sceneMode: 'theme' | 'light' | 'dark' | 'off'`, default **`'off'`** (so `/looper`, `/capture`, `/preview/canvas`, anything unmigrated is byte-for-byte unchanged). `HomePage` and `InternalPageBackground` pass `'theme'` (InternalPageBackground gets a `sceneMode` prop defaulting to `'theme'`; pinned pages such as `/recreate` pass `'light'`).
2. Subscribe via `sceneBridge.subscribe` into a **ref** (no React state, no re-render). In the existing `useFrame` (priority 0 — a positive-priority `useFrame` takes over rendering and blanks the scene), after the existing param smoothing, compute effective values with a small dt-based exponential smoother over `{hueShift, saturationMul, lightnessDelta, opacityMul, hueSpan, highlightMix, highlight rgb, background rgb}` (same `paramSmoothing` constant; snap when `prefers-reduced-motion`). Effective `hue = (hueOffset + hueShift + t*hueSpan + timeHue + wave*0.05) mod 1`, `saturation`/`lightness` per §9.1, `uOpacity` from effective opacity. `hueSpan` absent/`'off'` ⇒ `0.8`, identical to today.
3. **Display-space rule:** keep writing `pColor.setHSL(…)` raw into `instanceColor` (as today). Do NOT route particle colors through `new THREE.Color('#hex')` / `setStyle` (that converts to linear and would visibly darken them). Uniform colors are plain `THREE.Vector3` of display-space numbers (`uHighlight`), not `THREE.Color`.
4. **Shader change (one-time, at material creation):** add `uniforms.uHighlight (Vector3)` and `uHighlightMix (float, 0)`; fragment: `col = mix(col, uHighlight, uHighlightMix * facing);` where `facing` is the existing `pow(dot(vNormal,vec3(0,0,1))*0.5+0.5, 3.0)` term. With mix 0 the output is bit-identical to today. The material is created once; colors/uniforms change only via `.value.set()` / `.value = x` — **never** replace the material, edit GLSL, set `needsUpdate`, or remount `<Canvas>` during theme changes.
5. `SceneBackground`: `backgroundColor` accepts `null` (transparent, as today), a hex string (fixed, as today), or the string **`'theme'`** (opaque from bridge `background`). For `'theme'` create `scene.background = new THREE.Color()` once and `.set(hex)` on bridge change. Clear colour stays `gl.setClearColor(0x000000, 0)`. `HomePage` passes `'theme'`; baseline resolves to `#ffffff` (identical).
6. **Colour management:** do not change `toneMapping`, `outputColorSpace`, `exposure`, or `ColorManagement` globally (R3F defaults ACES + sRGB; `/looper`'s `OutputPass` path already differs and must keep doing so). Only `scene.background` takes a hex string (round-trips correctly). Add `lib/theme-scene/__tests__/srgb-passthrough.test.js` asserting the adapter's HSL numbers equal what `Color.setHSL` would write for the baseline.
7. **Context loss / WebGL failure:** in `onCreated` add `webglcontextlost` (`preventDefault()`, set `data-scene-state="lost"` on the wrapper, show fallback) and `webglcontextrestored` (clear state; colours are rewritten every frame so no re-upload needed). Wrap both mounts in `components/theme-scene/SceneBoundary.jsx` (React error boundary + `SceneFallback`), where `SceneFallback` paints `var(--t-scene-fallback)` over `var(--t-page)` (themed static fallback).
8. **Text over animation:** add `#hero-text-scrim` between canvas and headline in `HomePage.jsx` using `radial-gradient(ellipse at center, var(--t-scrim) 0%, transparent 70%)` (baseline alpha 0 ⇒ invisible). `InternalPageBackground` wash uses `var(--t-scene-wash)` + `var(--t-glass-highlight)`/`var(--t-glass-border)` instead of literals. `HomePage` replaces `useState('#ffffff'/'#000000')` for background/text with `'theme'` and `var(--t-text-default)`; `heroGradientStyle` uses `color-mix(in srgb, var(--t-deco-n) N%, transparent)` with the original alphas (.22/.18/.14/.12) and `mixBlendMode: 'var(--t-blend-deco)'` (CSS `mix-blend-mode: var(...)` is valid in a stylesheet but NOT in a React inline style — apply it via a small `<style>` rule or `className`).
9. `HeroSchematicOverlay.jsx` takes its stroke colour via `readToken('--t-text')` → rgb triplet, re-read on `onTokensChanged`, instead of the `color` prop literal.
10. Optional S1: `sharedParticleGalleryRenderer.js` (used by home slides + 404) adds `sceneBridge` `hueShift` to its preset `hueOffset`; if skipped, record exception X12.
11. **Debug stats** (only when `localStorage[STORAGE_KEYS.debug]==='1'`): `window.__themeSceneStats = { canvasId, materialCount, programCount }` updated on mount and each second, used by `scripts/theme/e2e-theme.mjs` to prove no canvas remount and no program/material churn during a drag.

---

## 10. Bridges (WS5 CSS; JS counterparts in WS6/WS7)

### 10.1 Root aliases — `styles/theme/bridge.css`, selector `:root, [data-theme-scope]`

```
--accent: var(--t-danger-solid);   --success: var(--t-success-solid);   --warning: var(--t-warning-solid);
--term-*: var(--t-term-*)  (every name in colors.css:164-186; --term-bg → var(--t-term-bg); --term-shadow → var(--t-term-shadow))
```
(`colors.css` keeps its `--term-*` block but each value becomes the alias; `--yellow-*` is untouched — no consumers.)

### 10.2 Dashboard shell — `styles/dashboard/01-base.css:15-45`

Replace the two mode blocks with ONE block (mode-agnostic because `--t-dash-*` already differ per root mode):
```
[data-dashboard-theme] { --page: var(--t-dash-page); --surface: var(--t-dash-surface); --surface-raised: var(--t-dash-surface-raised);
  --border: var(--t-dash-border); --border-visible: var(--t-dash-border-visible); --text-disabled: var(--t-dash-text-disabled);
  --text-secondary: var(--t-dash-text-secondary); --text-primary: var(--t-dash-text-primary); --text-display: var(--t-dash-text-display);
  --dot-grid-color: var(--t-dash-dot-grid); }
```
`[data-dashboard-theme] { background: transparent; color: var(--text-primary); … }` stays. `.tr--flag td:first-child::before` (`#c03`) and `.tile-blocked-*` (01-base `:1644`, `:2266-2277`) become `var(--t-danger-solid)` / `var(--t-overlay)` / `var(--t-on-overlay)` (**not** `--t-text-inverse`, which is dark ink in dark mode; see §19) with no mode selectors. The attribute `data-dashboard-theme` is kept (set from `useResolvedMode()` by WS6); visually it is now irrelevant.

### 10.3 Scoped families (re-point, never leave literals)

| Family (scope selector) | Mapping |
|---|---|
| `--bb-*` (`#brain-builder-page`) | `ink→--t-text`, `ink-soft→--t-text-secondary`, `ink-muted→--t-text-muted`, `line→--t-border-subtle`, `surface→--t-surface`, `page→--t-page`, `success→--t-success`, `warning→--t-warning`, `danger→--t-danger`, `accent→--t-accent`. Literals: `#f3f4f6`/`#f7f7f6`/`#fcfcfb`→`--t-inset`; status pill/notice backgrounds→`--t-{success,warning,danger}-bg` + `-border`; `.bb-btn-primary` bg `--t-text` / text `--t-surface` (hover `color-mix(in srgb, var(--t-text) 88%, var(--t-surface))`); accent tints→`--t-accent-soft`, `--t-accent-soft-border`; page gradient `linear-gradient(135deg, var(--t-surface) 0%, var(--t-inset) 100%)`; `outline` colour stays `var(--bb-accent)` (exact baseline). |
| `--vrk-*` (`.vrk-scope`), `--sg-*` (`.signals-sg`), `--pilot-*` (`#strategy-builder-card-shell.dashboard-modal-pilot`) | `ink→--t-text`, `ink-soft→--t-text-secondary`, `ink-muted→--t-text-muted`, `line→--t-border-subtle`, `line-soft→--t-border-faint`, `surface→--t-glass`, `surface-strong→--t-glass-strong`, `surface-soft→--t-glass-soft`, `success/danger→--t-success/--t-danger`, `a/b/c→--t-accent-bright/--t-support-1/--t-support-2`. |
| `--oc-*` (AdminCostView), `.brief-kit` (`--ink --line --card --hl --brand --grad`) | `--oc-*` alias the `--vrk-*` as today. **`.brief-kit` is pinned (briefs are published artifacts)** — keep literal values, add `data-theme-scope="light"` where it is mounted inside the dashboard (WS6) and do not re-point it. |
| `OpsOverviewPage.jsx` `opsOverviewCss` `:root{…}` | optional hygiene: scope to `#ops-overview-page`; map `--page→--t-page --card→--t-glass-soft --card-border→--t-glass-border --text*→--t-text/-secondary/-muted/-faint --divider*→--t-border-subtle/-faint`; status triplets → `--t-{success,danger,warning,info}` + `-bg` + `-border`; `--purple` → `--t-support-1`. |
| `AdminPage.jsx` `[data-admin-theme="dark"]` | **exception X7**: always-dark, untouched. (Its local `--accent` does not collide: new tokens are `--t-*`.) |

Detailed per-surface rows are in the coverage map.

### 10.4 Literal migration rules (WS5/WS6/WS7)

1. Bridge first (aliases above), then replace literals, highest count first: `#fff`/`#ffffff` → `var(--t-surface)` (or `--t-on-accent`/`--t-on-solid` when it is text on a fill); `#2a2420` → `var(--t-text)`; `#0a0a0a` → `--t-text-strong`; `#1a1a1a` → `--t-text-body`; `#faf7f2` → `--t-text-inverse`; `#f5f1df` (nav/cream) → `--t-chrome` family; `rgba(212,196,171,.82)` → `--t-glass-border` (`#e7d9c3` is NOT exactly that colour: reported by the codemod, decide by eye); `rgba(42,36,32,α)` → named tokens at α ∈ {.08 `--t-border-faint`, .12 `--t-border-subtle`, .22 `--t-control-border`, .38 `--t-text-faint`, .52 `--t-text-muted`, .72 `--t-text-secondary`} else `color-mix(in srgb, var(--t-text) α%, transparent)`; `rgba(255,255,255,α)` → `--t-glass-soft/-glass/-glass-strong` at α .5/.62/.78 else `color-mix(in srgb, var(--t-surface) α%, transparent)`; `rgba(26,26,26,α)`, `rgba(90,83,70,α)`, `rgba(245,241,223,α)` likewise via `--t-text-body`, `--t-text-eyebrow`, `--t-chrome`; gradients `hsl(185…)`/`hsl(262…)`/`hsl(314…)` → `--t-accent-bright`/`--t-support-1`/`--t-support-2`; `hsla(185…320,…)` comets → `color-mix(in srgb, var(--t-comet-n) α%, transparent)`.
2. `scripts/theme/codemod-literals.mjs` (WS1) applies rule 1 **only to exact matches** in CSS files and in JSX inside `key: '<literal>'`/`key="<literal>"` for keys in {color, background, backgroundColor, borderColor, border*, outline*, fill, stroke, stopColor, boxShadow (non-black only)}; every non-mapped or ambiguous literal is written to a JSON report instead of being changed. Run it only with the dev server stopped (Fast-Refresh on a 19k-line file hangs). Each WS runs it on its own files with `--paths`.
3. Colours consumed by JS (canvas 2D, `new THREE.Color`, GSAP `Object.assign(el.style, …)` at creation) must use `'var(--t-…)'` strings (CSS vars set on `<html>` reach nodes appended to `document.body`) or `readToken`+`onTokensChanged`. Never capture a resolved colour once.
4. Check before finishing each file: specificity (ID-heavy selectors ≈540 in dashboard CSS beat any class override ⇒ theme **only through variables**), scoped attributes, portals (`MonthCalendarPanel.jsx` `document.body` fallback host loses `[data-dashboard-theme]` — irrelevant now because tokens are on `:root`), iframes (separate documents: do not theme `srcDoc`), `!important` colour rules (73 in dashboard CSS; audit those that set colour).
5. Record every literal left in place in the WS's `allowlists/wsN.json` as `{file, literal, reason, exceptionId}`. The scan test fails on any literal not in the allowlist.

---

## 11. Theme Studio UI (WS3)

### 11.1 Component tree and boundary

```
components/theme/ThemeStudioMount.jsx   (WS2, main bundle; gate + launcher; dynamic import boundary here)
  └─ dynamic(() => import('../theme-studio/ThemeStudio'), { ssr:false })      ← lazy-load boundary
components/theme-studio/
  ThemeStudio.jsx            shell: desktop right drawer (w 420, full height) / mobile (≤640px) bottom sheet (85dvh); focus mgmt; Esc; live regions
  studio-chrome-css.js       STUDIO_CSS string, rendered via <style>; only --ts-* locked tokens (see 11.3)
  sections/PresetModeSection.jsx    preset (Baseline | Draft | Imported), Light / Dark / System preview switch, "editing" mode tabs, copy/link between modes, Before/After
  sections/MasterSection.jsx        master hue slider+numeric (0–360 wraps), intensity
  sections/PaletteSection.jsx       accent (+hover/pressed/soft), supporting 1/2 + offsets, neutral tint strength + hue source
  sections/SceneSection.jsx         per mode: Follow theme | Custom palette (base/secondary/highlight/strength/opacity/hueSpan)
  sections/AdvancedSection.jsx      RoleRow table by group: Linked/Custom/Locked, Reset, OKLCH + HEX, per-mode overrides, validation badge beside each role
  sections/AccessibilitySection.jsx pass/fail list with suggestions (Apply suggestion = explicit user action; disabled for locked)
  sections/ExportSection.jsx        Copy/Download JSON, Download CSS, color guide table (token · value · usage), Import (paste/file) with validation report, "Save draft", "Apply site-wide" toggle
  controls/{HueSlider,LabeledSlider,NumericField,Swatch,LinkToggle,RoleRow,ModeSwitch,BeforeAfter,UnsavedIndicator,LiveRegion}.jsx
  preview/PreviewSurface.jsx        sample buttons, links, inputs, cards, dialog, status badges (with icon+text), focus ring, over page/surface/raised/glass; rendered twice inside <div data-theme-scope="light"> and "dark"> — no second app instance, no second WebGL
  ColorGuide.jsx
lib/theme-studio/                   pure: reducer for UI state, keymap, formatters, view-models, a11y copy (unit-tested)
```

### 11.2 Behaviour requirements

- Distinguish **editing mode** (which palette the controls write) from **preview mode** (what the live site shows); both always visible in the header with text labels, not just color.
- Every slider: visible label, `<input type=range>` + numeric field, arrow/PageUp/PageDown/Home/End, `aria-valuetext` (e.g. "201 degrees"), min 44×44 px touch targets on coarse pointers; hue slider track is a gradient of the current L/C across hues; typing out-of-range numbers wraps (hue) or clamps (others) with a polite announcement.
- Drag = one undo entry (`transient` + `commitTransient` on `pointerup/pointercancel/blur/keyup`). Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z undo/redo when focus is inside the Studio. Reset buttons: per role, per mode, whole draft (confirm).
- `UnsavedIndicator` (dirty dot + text "Unsaved changes"), save feedback via `aria-live="polite"` ("Draft saved 14:02" / "Could not save: storage unavailable").
- Swatches show HEX (read-only copy) and advanced OKLCH L/C/H fields; editing HEX of an achromatic colour keeps the previous hue (`hexToOklch(hex, prevHue)`).
- Linked roles show their source ("follows master hue +86°", "linked to accent −0.05 L"); changing a linked role converts it to Custom explicitly (button *Make custom*); *Reset* returns to Linked. Moving master never converts anything.
- Accessibility results sit **beside** each role row (badge + ratio + required min) and in the Accessibility section. Failing results show the suggestion; nothing is applied automatically. Locked roles show a lock icon and "suggestion not applied". The export panel labels output **Draft** (with the validation report attached) until `buildReport` has `failRequired === 0`, then **Validated against the in-app checks** — never "WCAG compliant".
- Focus: opening focuses the drawer heading; Esc closes the topmost popover, then the drawer; focus returns to `#theme-studio-launcher`. Desktop drawer is non-modal (`role="dialog" aria-modal="false"`, page stays interactive for live preview); mobile sheet is modal (`aria-modal="true"`, focus trap, `overscroll-behavior: contain`, body scroll not lost on close). Inner scroll container only.
- **Bad draft palettes can't break the inspector:** the drawer and all controls use only `--ts-*` tokens (11.3) and sit in a subtree that is `data-theme-scope="light"`-independent; the Studio never reads `--t-*` outside `preview/` and swatches.
- Light/dark compare: the two pinned `PreviewSurface` panes use `toCss(draft, {scopeOnly:true})` injected into `<style id="theme-studio-preview-css">`; no duplicate app instances, no additional `<canvas>`.
- Performance: components subscribe through selectors; slider drags call `updateDraft(…, {transient:true})` (rAF-batched apply); the accessibility report is debounced 150 ms and skipped while a drag is open.

### 11.3 Locked Studio chrome tokens (WS3 defines in `studio-chrome-css.js`)

`--ts-bg:#ffffff; --ts-fg:#1a1a1a; --ts-muted:#5a5a5a; --ts-line:#c8c8c8; --ts-accent:#0b5cd5; --ts-on-accent:#ffffff; --ts-danger:#b00020; --ts-ok:#17692e; --ts-focus:#0b5cd5` (all ≥ 4.5:1 on `--ts-bg`; WS3's test asserts this with `contrastRatio`). No dark variant in v1 (the drawer is always this palette so it stays readable regardless of the draft).

---

## 12. Baseline preset (WS1 `lib/theme/baseline.js`)

`meta.id:"baseline"`, `defaults.viewerPreference:"light"`, `features {focusRing:false, selection:false}`, `master {hue:201, intensity:1}`, `offsets {accentBright:6, support1:86, support2:142}`, `neutral {tintStrength:1, hueSource:'fixed', hue:56}`, `modes.*.settings {0,1}`, scene per §9.1.

### 12.1 Light-mode baseline (derived from real current colors; all within ΔEOK ≤ 0.005 of the cited legacy value after 8-bit rounding)

| role | l | c | a | legacy source |
|---|---|---|---|---|
| page | 1.000 | 0 | 1 | body default / home canvas `#ffffff` |
| surface | 1.000 | 0 | 1 | `#fff` panels, `--bb-surface` |
| raised | .994 | .005 | 1 | `InnerPageShell` bg `#fefdf9` |
| inset | .976 | .001 | 1 | `#f7f7f6` (`--bb-page`, `.bb-guidance`); also stands in for `#f3f4f6`, `#fcfcfb` (approx ΔEOK ≤ 0.012) |
| overlay | .193 | .005 | .42 | `.tile-blocked-overlay rgba(22,20,18,.42)` |
| chrome | .956 | .024 | .55 | `#f5f1df` @ `rgba(245,241,223,.55)` top strip |
| glass-border | .827 | .038 | .82 | `rgba(212,196,171,.82)` |
| glass-highlight | 1.000 | 0 | .45 | `rgba(255,255,255,.45)` |
| scrim | (page) | | 0 | new |
| text-default | 0 | 0 | 1 | UA black |
| text-strong | .145 | 0 | 1 | `#0a0a0a` |
| text-body | .218 | 0 | 1 | `#1a1a1a` |
| text | .266 | .012 | 1 | `#2a2420` |
| text-eyebrow | .445 | .022 | 1 | `rgb(90,83,70)` |
| text-inverse | .977 | .007 | 1 | `#faf7f2` |
| on-accent | .266 | .012 | 1 | new (ink on accent) |
| on-solid | 1.000 | 0 | 1 | white on status fills |
| accent-text | .500 | .105 | 1 | new (link-grade teal, ≥4.5:1 on white) |
| focus | .520 | .110 | 1 | new |
| accent | .680 | .116 | 1 | `--bb-accent #00adb5` |
| accent-bright | .789 | .135 | 1 | `hsl(185,100%,45%)` = `#00d2e6` |
| support-1 | .520 | .286 | 1 | `hsl(262,100%,55%)` = `#6e1aff` |
| support-2 | .670 | .288 | 1 | `hsl(314,100%,50%)` = `#ff00c3` |
| comet-1…7 | (.866,.142) (.760,.143) (.608,.211) (.574,.243) (.646,.248) (.747,.264) (.812,.119) | | | `hsla(185/58%, 200/62, 225/64, 250/66, 275/66, 300/68, 320 80%/80%)` |
| deco-1…4 | (.654,.104) (.725,.086) (.809,.091) (.713,.103) | | | `rgb(196,124,86)` `rgb(102,184,164)` `rgb(214,191,123)` `rgb(171,148,218)` |
| success / solid | (.438,.083) / (.630,.128) | | | `#285f3b` / `#4A9E5C` |
| warning / solid | (.457,.043) / (.753,.127) | | | `#67533d` / `#D4A843` |
| danger / danger-solid | (.458,.165) / (.561,.218) | | | `#9f1f17` / `#D71921` |
| info / info-solid | (.488,.217) / (.574,.202) | | | `#1d4ed8` / `#2f6fed` |
| term-bg-top / bottom | (.986,.005) / (.943,.017) | | | `#fcfaf7` / `#f2ebe0` |
| term-dim | .613 | .018 | | `#8a8378` |
| term pairs (pfx l,c · msg l,c · F hue) | info (.523,.042 · .446,.026 · 256) · fetch (.538,.090 · .486,.076 · 210) · ok (.530,.130 · .507,.110 · 139.5) · ai (.518,.180 · .473,.158 · 312.8) · build (.616,.122 · .537,.106 · 77.6) · error (.543,.174 · .494,.156 · 29.7) · active (.574,.202 · .304,.033 · 262/250.7) · screen (.504,.161 · .379,.085 · 267) · mock (.621,.133 · .544,.123 · 47) · countdown = build | | | `colors.css:176-185` |

Alpha links in light: `text-secondary .72`, `text-muted .52`, `text-faint .38`, `border-faint .08`, `border-subtle .12`, `control-border .22`, `control-border-strong .55`, `text-disabled .30`, `disabled-bg .06`, `glass-soft/glass/glass-strong .50/.62/.78`, `chrome-strong .85`, status `-bg .10/.12/.08/.08`, `-border .25/.30/.25/.25`, `accent-soft .10`, `accent-soft-border .25`, `selection-bg .25`, term alphas per §4.8, `shadow .10`, `scene-wash rgba(245,241,223,.08)`.

### 12.2 Dashboard neutrals (`dash-*`, exact legacy; l values)

| role | light | dark |
|---|---|---|
| dash-page | .970 (`#F5F5F5`) | 0 (`#000`) |
| dash-surface | 1.000 (`#FFF`) | .178 (`#111`) |
| dash-surface-raised | .955 (`#F0F0F0`) | .218 (`#1A1A1A`) |
| dash-border | .919 (`#E4E4E4`) | .252 (`#222`) |
| dash-border-visible | .833 (`#C8C8C8`) | .321 (`#333`) |
| dash-text-disabled | .715 (`#A3A3A3`) | .510 (`#666`) |
| dash-text-secondary | .510 (`#666`) | .683 (`#999`) |
| dash-text-primary | .252 (`#222`) | .931 (`#E8E8E8`) |
| dash-text-display | 0 (`#000`) | 1.000 (`#FFF`) |
| dash-dot-grid | black a.065 | white a.045 |

### 12.3 Dark-mode defaults (new design, not inversion; hue rules as §4; designers tune in Studio)

page (.165,.008) · surface (.205,.009) · raised (.245,.010) · inset (.135,.006) · overlay (.080,.004,a.62) · chrome (.220,.012,a.60) · chrome-strong a.85 · glass-soft/glass/glass-strong = surface with dL +.04 at a .50/.62/.78 · glass-border (.420,.020,a.50) · glass-highlight (.95,0,a.10) · scrim a.55 · text-default (.93,.010) · text-strong (.975,.004) · text-body (.90,.006) · text (.93,.010) · text-eyebrow (.72,.014) · text-inverse (.20,.008) · on-accent (.18,.010) · on-solid (.15,.010) · accent-text (.80,.12) · focus (.80,.12) · accent (.76,.12) · accent-bright (.80,.135) · support-1 (.70,.20) · support-2 (.74,.22) · comet-n = light values · deco-n = light l −.06, same c · success (.78,.14) / solid (.70,.14) · warning (.80,.10) / solid (.80,.13) · danger (.72,.17) / solid (.68,.20) · info (.76,.13) / solid (.68,.17) · term shell (.15/.12, .006) · term-dim (.66,.012) · term pairs: pfx l .78 / msg l .84, c = 0.8 × light c, same fixed hue · alpha links: text-secondary .72, text-muted .58, text-faint .42, border-faint .10, border-subtle .14, control-border .30, control-border-strong .62, disabled-bg .08, status `-bg` .16/.16/.14/.14, `-border` .35, accent-soft .16 / border .35, selection-bg .35, shadow a.45, scene-wash `rgba(20,18,16,.08)`. All must pass the §7.3 required pairs after tuning; if a default fails, WS1 adjusts **within the ranges in §4** and records the change in `docs/source-of-truth/THEME-STUDIO.md`.

### 12.4 Known baseline accessibility defects (reported by `buildReport(BASELINE)`, stored in `production/baseline.report.json`; baseline is NOT altered to hide them)

1. `control-border` (inputs/buttons, `rgba(42,36,32,.22)`) 1.56:1 vs white surface → fails 3:1 non-text.
2. `text-muted` (.52 ink) 3.30:1 and `text-faint` (.38 ink, placeholders) 2.26:1 → fail 4.5:1.
3. `accent` `#00adb5` on white 2.75:1 → fails 3:1 as a graphic/focus ring (`.bb` focus outline) and 4.5:1 as text (hence new `accent-text`).
4. `text-inverse` on `overlay` over white (`.tile-blocked-title` `#faf7f2` on `rgba(22,20,18,.42)` over white) 2.56:1 → fails.
5. `on-solid` white on `success-solid #4A9E5C` 3.31:1 and on `warning-solid #D4A843` 2.21:1 → fail 4.5:1.
6. Focus visibility: `:focus-visible` appears 5× in the dashboard CSS, `outline: none` is common, several controls signal focus only by a 1px border-colour change → recorded as a documentation finding; enabling `features.focusRing` is the fix and is an owner decision (D8).
7. Hero/auth tints and `mix-blend-mode: multiply` assume a light backdrop (dark mode needs `--t-blend-deco`).
The exact ratios are asserted by `baseline-report.test.js` against the stored report so the list cannot drift silently.

---

## 13. Intentional exceptions (also encoded in allowlists)

| id | Exception | Reason |
|---|---|---|
| X1 | Email HTML: `features/email-digest/**`, `__fixtures__/*.html`, the preview iframe `srcDoc` in `AdminEmailModals.jsx:1163-1166` (white wrapper stays), `<meta name="color-scheme" content="light">` in email templates | Sent artifacts; byte-compared golden fixtures |
| X2 | Briefs and published artifacts: `app/briefs/**`, `brief-preview` output, Brief Composer preview iframe, every `srcDoc` iframe in `DashboardPage.jsx` (brief shell, digest preview, newsletter), `.brief-kit` scope, `brief-design-system-reference/` | Client deliverables with their own design system; iframes are separate documents |
| X3 | Invoice Studio document canvas, print/download/publish, HoloPaper, QR, default draft identity | Documents are always light; byte-identity golden fixture |
| X4 | Studio **artwork** (ClothStudio scene palettes, T-shirt, Diffusion/Glass, holo-material, invoice-holo-scene, GlassSculpture) | User content. Only surrounding chrome (incl. `--term-*` consumers `StudioPage.jsx`, `RemixStudio.jsx`) themes |
| X5 | Brand logos/imagery/uploaded media, `/img/sig.png` pixels, agency logos | Fixed art; only their CSS blend/filter go through `--t-logo-*` |
| X6 | Black shadows `rgba(0,0,0,α)` in `box-shadow`/`text-shadow`/`drop-shadow`; macOS traffic-light dots (`06-intake-onboarding.css:675-677`); X-post preview mimicry colours in `DashboardPage.jsx` (`#536471`, `#f87171`/`#4ade80` toast); Operating Cost chart/provider colours | Mode-agnostic or data-semantic |
| X7 | `AdminPage.jsx` `[data-admin-theme="dark"]` console (always dark) | Deliberate ops-console design |
| X8 | Pinned light (v1): `/looper`, `/recreate`, `/archive`, `/capture`, `/post-approval`, `/preview/*` (outermost element gets `data-theme-scope="light"`, scene `sceneMode` `'off'` or `'light'`) | Own hardcoded palettes (looper alone ≈ 107 hex / 156 rgba); decision to adopt is a follow-up |
| X9 | `ds-bundle/`, `.design-sync/ds-styles.css` | Generated; regenerate in the main checkout after merge |
| X10 | Orphans: `ControlPanel.jsx`, `ColorPalette.jsx`, `LoopControls.jsx`, `BrainParticleWindow.jsx`, `*Swarm*.js(x)`, `lavaShaderEngine`/`AnchorLavaShader` | No live importers on routes |
| X11 | `--yellow-*` Radix scale in `colors.css` | No consumers |
| X12 | `sharedParticleGalleryRenderer.js` per-preset hues **if S1 is not done** | Optional follow-up |
| X13 | `@property --cta-angle` / comet animation mechanics, fonts, easing, layout tokens | Not colour |

---

## 14. Export, publishing, rollback

- **Export bundle** (`buildExportBundle`): `theme.json` (canonical, both modes, links, overrides, scene), `theme.css` (`toCss` with explicit `[data-theme=…]` selectors), `theme-guide.md` (token · light · dark · usage · linked-to), `theme-report.json` (`ThemeReport`). `status` is `"draft"` until `failRequired === 0`, then `"validated"`; the report states it is an automated check, not a conformance claim.
- **Round trip:** `importThemeJson(exportThemeJson(d))` → same canonical definition and byte-identical `toCss`.
- **Replace the production default:** (1) in the Studio export JSON, (2) overwrite `lib/theme/production/production-theme.json`, (3) `npm run theme:build` (regenerates `styles/theme/theme.generated.css`, `lib/theme/production/resolved.generated.json`, and `baseline.report.json` only when `--baseline`), (4) `npm run theme:check` + `npm test`, (5) commit and deploy through the normal pipeline. **Rollback:** `git revert` that commit (or restore the previous JSON and rebuild); the previous deployment id is the Vercel rollback target. The browser drafts (`localStorage`) never reach other viewers.
- `package.json` scripts (WS1 only): `"theme:build": "node scripts/theme/build-theme.mjs"`, `"theme:check": "node scripts/theme/check-theme.mjs"`.

---

## 15. Workstreams: deliverables and acceptance checks

Test command style (repo convention): `node --test lib/theme/__tests__/<file>.test.js` for focus; `npm test` for everything (`node --test` with the globs in `package.json`). Tests are ESM, `import test from 'node:test'; import assert from 'node:assert/strict';`, relative imports with `.js`. Node has no `window`: tests that touch storage/DOM install shims (see `lib/dashboard/__tests__/bootstrap-session.test.js`) or use the injectable factories. Never run `next build` in `/Users/bballi/Documents/Repos/Bballi_Portfolio` (main checkout) — builds clobber its live `.next`; run it in this worktree only.

### 15.1 WS1 — Core engine (BUILT FIRST)

Phases: **1a / gate G1** = `constants, mode, color, roles, tokens, baseline, resolve, scene, css, bootstrap-source` + `scripts/theme/build-theme.mjs` + `production/*` + `styles/theme/theme.generated.css` (so WS2–WS7 can start; token names are already fixed by §4). **1b / gate G2** = `validate, migrate, edit, report, guide, export, contrast-pairs, dev/*, codemod, check-theme, docs`.
Deliverables: everything listed under WS1 in §2/§7. Acceptance (all in `lib/theme/__tests__/`):

| test file | asserts |
|---|---|
| `color-math.test.js` | §6.1 sanity vectors, hex↔OKLCH round trip ≤1/255 over a 4k-colour sweep, hue wrap (−1, 0, 359.999, 360, 721), achromatic hue preserved (`hexToOklch('#808080', 123).h === 123`) |
| `gamut.test.js` | in-gamut unchanged; `oklch(.7 .4 150)` mapped hue-stable with ΔEOK(mapped, clipped) < .02+ε; L≥1→white, L≤0→black; every role of baseline+extreme hues maps to valid 0–255 hex; no NaN |
| `contrast.test.js` | known pairs (#000/#fff = 21; #777/#fff ≈ 4.48; #767676/#fff ≥ 4.54); alpha compositing (`rgba(42,36,32,.52)` on white); composite chain order |
| `resolve.test.js` | determinism (2× equal, input key order irrelevant, frozen input ok); precedence steps 1–4; locked/custom untouched by master move; linked→linked chains; cross-mode link; cycle rejected |
| `hue-boundaries.test.js` | hue 0, 359.999, 360, −1, 721 produce consistent offsets (support-2 at master 270 → 52); status hues unchanged for every master hue; neutrals keep hue at c=0 |
| `neutrals.test.js` | tintStrength 0 ⇒ neutral chroma 0 and hue preserved; strength 2 doubles; `hueSource:'master'` follows master |
| `baseline-parity.test.js` | `resolveTheme(BASELINE,'light')` matches the legacy table (§12.1/§12.2) within ±1/channel (≤ .012 ΔEOK for the 3 approximated stand-ins); `dark` dash-* equals legacy dark |
| `baseline-report.test.js` | `buildReport(BASELINE)` equals `production/baseline.report.json` and lists defects 1–5 of §12.4 |
| `validate.test.js` | malformed JSON, `null`, arrays, unsupported version, missing fields defaulted w/ warning, NaN/Infinity/strings rejected, out-of-range clamped, unknown role dropped, locked-not-custom, link target missing, no throws |
| `migrate.test.js` | v1 identity; v2 rejected; registry shape |
| `css-export.test.js` | emits exactly `TOKEN_NAMES` per mode, selectors per §5, fallback media query only for `system`, deterministic bytes, `scopeOnly`, features gating |
| `roundtrip.test.js` | export→import→export byte-identical; `resolve` deep-equal; hash stable; canonicalisation idempotent |
| `scene-resolve.test.js` | follow baseline ⇒ identity deltas; master +60° ⇒ hueShift 1/6; custom base ⇒ delta model; hueSpan/secondary; highlight sRGB numbers 0..1 |
| `edit.test.js` | structural sharing, copyMode skips locked, resetRole/resetMode, linkModes |
| `report.test.js` | pairs/exclusions, suggestions raise ratio ≥ min+.05, locked ⇒ `blockedByLock`, alpha suggestions |
| `tokens-manifest.test.js` | `TOKEN_NAMES` unique, `--t-` prefix, every role has ranges+usage, ranges contain baseline values |
| `bootstrap-source.test.js` | ES5-only (no `=>`, `let`, template literals), < 1.6 KB, contains marker strings; constant per default pref |
| `generated-drift.test.js` | `styles/theme/theme.generated.css` and `resolved.generated.json` equal fresh output of production JSON |
| `scan-literals.test.js` | helper finds hex/rgb/rgba/hsl/hsla/`0x` literals, respects allowlist and black-shadow rule; codemod maps only exact matches and reports the rest |

### 15.2 WS2 — Runtime

Deliverables: `app/layout.jsx` per §8.1; `pref-store`, `draft-store`, `history`, `applier`, `storage`, `cross-tab`, `hooks`, `read-token`, `studio-gate`, `index`; `ThemeRuntime.jsx` (client, renders `null`: mounts pref store listeners, `sceneBridge.setProduction/setMode`, rehydrates `draftScene` from storage when `active`, dispatches `theme:tokens-changed`); `ThemeStudioMount.jsx`.
Acceptance (`lib/theme-runtime/__tests__/`): `pref-store.test.js` (init from attr/storage/default, invalid stored value, set/get, snapshot identity stability, server snapshot constant), `storage-failure.test.js` (getItem/setItem throw → no throw, `storageAvailable:false`), `system-change.test.js` (OS change applies only when `system`), `bootstrap-parity.test.js` (§8.2 matrix), `cross-tab.test.js` (storage event + BroadcastChannel stub; dirty tab not overwritten), `draft-store.test.js` + `history.test.js` (drag = 1 undo entry via transient/commit; keyboard coalescing 400 ms; cap 100; undo/redo; resetRole/Mode; dirty/differsFromProduction), `applier-raf.test.js` (N updates in one frame → 1 apply; transition-suppression attribute set/cleared), `studio-gate.test.js` (prod+query ⇒ false; admin ⇒ true; dev query ⇒ true). Manual: `next build` in this worktree; view-source of `/` shows the bootstrap script as the first `<head>` child and `<html … data-theme="light" data-theme-pref="light">`; no hydration warnings in console.

### 15.3 WS3 — Studio UI

Deliverables per §11. Acceptance: `lib/theme-studio/__tests__/` (reducer/keymap/view-models, `--ts-*` contrast ≥4.5, copy/format helpers, RoleRow state machine linked↔custom↔locked), plus `scripts/theme/e2e-theme.mjs` Studio checks (owned by WS1 file, WS3 supplies the scenario list in its report): keyboard-only slider control, drag = one undo, undo/redo/reset, mobile 390×844 sheet, Esc/focus return, inspector readable with an intentionally poor draft (hue 0 / intensity 1.5 / tint 2 / dark-on-dark custom), no second `<canvas>`. Designer guide `docs/source-of-truth/THEME-STUDIO-DESIGNER-GUIDE.md` (quick-start, linked/custom/locked, export/replace/rollback).

### 15.4 WS4 — Scene

Deliverables per §9. Acceptance (`lib/theme-scene/__tests__/`): `scene-bridge.test.js` (draft ?? production, mode switch, subscribe/unsubscribe, `get('light')` independent of mode), `apply-scene.test.js` (identity at baseline, wrap, clamp, home scroll interpolation composes with deltas), `srgb-passthrough.test.js`, `no-churn.test.js` (static source assertions: `ox.jsx` has no `needsUpdate`/`new THREE.ShaderMaterial` inside `useFrame`/subscribers; Canvas not keyed by theme). Manual/e2e: with `theme-studio:debug:v1=1`, a 60-frame hue drag leaves `canvasId` unchanged and `programCount`/`materialCount` constant; pixel check that the home canvas centre-bottom pixel equals `--t-page` (#ffffff baseline) ±1 and that default-baseline particle colours are unchanged (screenshot diff ≤ tolerance); reduced-motion and simulated context loss show `SceneFallback`.

### 15.5 WS5 — CSS migration

Deliverables: `styles/theme/bridge.css` (§10.1); `colors.css`, `01-base.css` (§10.2), scoped families (§10.3), literal replacement in `styles/dashboard/01…11` and `brain-builder.css` per §10.4, byte-compare baseline file updated (find the gate: `grep -rn "dashboardCss.baseline" scripts package.json docs lib`; if no script exists, regenerate the baseline by concatenating the ordered `@import`s and say so). `styles/dashboard/index.css` import order unchanged.
Acceptance (`lib/theme-migration/__tests__/ws5-*.test.js`): `ws5-bridge-vars.test.js` (every legacy alias in §10 resolves to a name in `TOKEN_NAMES`; root-level aliases use `:root, [data-theme-scope]`; no `--t-*` reference outside the manifest), `ws5-css-scan.test.js` (scan of owned CSS: remaining colour literals ⊆ `allowlists/ws5.json`; black-shadow literals allowed), `ws5-baseline-visual.md` note in report: with baseline + light mode the computed styles of a sample of selectors equal pre-migration (Playwright script optional). No `!important` added except the transition-suppression rule in generated CSS.

### 15.6 WS6 — Dashboard / admin JSX

Deliverables: `DashboardPage.jsx` minimal wiring edits (line numbers at base commit): `:260` `useState('light')` → `const resolvedMode = useResolvedMode(); const theme = resolvedMode; const setTheme = (m) => getPrefStore().setPreference(m)`; `:10707` keep `data-dashboard-theme={theme}`; `:10762-10765` buttons call `setTheme` (+ existing `trackThemeChanged`); `~12938` marquee `#2a2420` → `var(--t-text)`; the rest of the file's theme-sensitive literals migrated with the codemod (stop dev server first; `DashboardPage.jsx` is 19k lines — one agent, one pass); `components/dashboard/**` literals (priority: `content-ui/ContentUiStyles.jsx`, `MediaLibraryCard`, `XCalendarCard`, `CopywriterCard`, `LeadGenDashboard`, `XMonitorCard`, `SiteRecreateCard`, `XProfileCard`, `SocialPostingPanel`, leadgen modals); Brain Builder JSX (`BrainBuilder.jsx:186,189` → `var(--bb-ink-soft)`); admin pages per §10.3/X-lists; `.brief-kit` mount points get `data-theme-scope="light"`.
Acceptance: `lib/theme-migration/__tests__/ws6-js-scan.test.js` (owned files' remaining literals ⊆ `allowlists/ws6.json`; no `useState('light')` theme state; `data-dashboard-theme` still present), grep proof that X1/X2 files untouched (`git diff --stat` listing in the report), dashboard renders in both modes with no console errors (Playwright, admin session required — if unavailable, say "not verified").

### 15.7 WS7 — Public JSX

Deliverables: replace theme-sensitive literals in owned files with tokens per §10.4 (shared seams first: `pageSurfaceSystem.js` → `--t-glass-soft`/`--t-glass-border`/`--t-glass-highlight`; `InnerPageShell` bg → `--t-raised`, nav `--t-chrome`; `Header.jsx` strip + `mixBlendMode`→`var(--t-logo-blend)` and `/img/sig.png` filter → `var(--t-logo-filter)` via a class; `SiteFooter` gradient → `--t-gradient-accent` stops; `StackedSlidesSection.jsx` 400+ literals incl. GSAP-created nodes (`~1685-1695`) using `var()` strings; FAQ/Auth/Portfolio/Reel/Hero*). Pin X8 pages. Intentional dark surfaces (`ReelPlayer`, `HeroFooter` slate panel `rgba(15,23,42,.95)`) stay dark in both modes → allowlist.
Acceptance: `ws7-js-scan.test.js` (allowlist rule), public route smoke (`ROUTE_SMOKE_BASE_URL=… node scripts/smoke-routes.mjs` against a dev server started from this worktree) passes, and Playwright screenshots of `/`, `/about`, `/work`, `/faq`, `/contact`, `/login` at 1440×900 and 390×844 in light (must match pre-migration within tolerance) and dark (inspected, no unreadable text).

### 15.8 Cross-cutting acceptance (orchestrator after merge, in this worktree)

`npm test` green; `npm run theme:check`; `npx next build` clean (Turbopack) — the dev server uses webpack (`next dev --webpack`), so also load `/`, `/dashboard`, `/dashboard/brain` once under `npm run dev` from this worktree; `node scripts/theme/e2e-theme.mjs` (WS1 owns, modelled on `scripts/smoke-routes.mjs` `launchBrowser()`): first paint has `data-theme` before first contentful paint (MutationObserver/PerformanceObserver), `emulateMedia({colorScheme})` for system, soft navigation keeps attrs, two-page cross-tab sync, hue sweep {0, 90, 180, 270, 359} × intensity {0, 1, 1.5} × tint {0, 2} screenshots of `/` and `/dashboard`, dialogs/forms/status/glass, canvas identity + program count during a drag. Report honestly what could not be verified (e.g. authenticated dashboard without credentials).

---

## 16. Risks

1. **Dark palettes are new design**, not preserved identity; the baseline only guarantees light. Visual QA of dark is required before flipping `defaults.viewerPreference`.
2. **`--accent` bridge**: legacy `--accent` (`#D71921`) is used 12× in the dashboard as a red; it now follows `danger-solid`. If any use is "brand highlight", split it later.
3. **Alias-inheritance trap** (§5): forgetting `[data-theme-scope]` on root aliases leaves pinned pages with the wrong terminal/status colours.
4. **`DashboardPage.jsx` (19k lines)** — single owner, run the codemod with the dev server stopped; Fast-Refresh on this file during a run is a known hang.
5. **Byte-compare gate** on `01-base.css` must be updated in the same change or CI/gate fails.
6. **GSAP-created DOM** (`StackedSlidesSection`) captured literals won't re-theme; must use `var()` strings.
7. **`mix-blend-mode`, `backdrop-filter` glass, white inset rings and multiply gradients** assume a light backdrop — mapped to `--t-blend-deco`, `--t-glass-highlight`, but need dark visual QA.
8. **sig.png** is dark-on-transparent art; dark mode relies on `invert(1)`/`lighten` — verify the result looks intended.
9. **Chroma at extreme hues**: `support-1/2` baseline chroma (.286/.288) is near the sRGB gamut boundary; most hues map via chroma reduction and will look less vivid — expected, documented.
10. **HSL vs OKLCH hue** in the scene: scene follow rotates HSL turns by the OKLCH master delta (approximation, non-uniform).
11. **Admin gating is client-side** (`/api/admin/whoami`); fine because v1 has no server persistence.
12. **Bundle size**: main bundle carries pref-store + `resolved.generated.json` only; if `resolved.generated.json` exceeds ~25 KB, WS2 must slim it to `{ light:{page,…}, dark:{…} }` for viewport/scene only.
13. **`themeColor` meta** can't follow an explicit user override of the OS mode.
14. Fonts, `@property --cta-angle`, and Lenis `SmoothScroll` are unaffected; the only global additions are `<head>` script, one `<style>` draft element, and `html` attributes.

## 17. Open questions for the product owner

1. Ship default `viewerPreference` as `light` (baseline) or `system` once dark is approved?
2. Should public visitors get a visible light/dark control? v1 adds none (layout preserved).
3. Turn on `features.focusRing` / `features.selection` in the production default (changes keyboard focus and text-selection appearance)?
4. Adopt `/looper`, `/recreate`, `/archive` into the theme in a follow-up?
5. Is legacy dashboard `--accent` red a status colour or a brand highlight (decides whether to split it from `danger-solid`)?

## 18. Orchestrator resolutions of §17 (binding for v1; owner may revisit)

1. `defaults.viewerPreference` ships as `light` (baseline). Studio can preview/set `system`.
2. No new public visitor control in v1. Dashboard `#theme-toggle` (WS6) becomes Light / Dark / System via `setPreference`; Studio has its own preview switch.
3. `features.focusRing` / `features.selection` stay `false` in the production default but MUST be toggleable in the Studio (Advanced section) and exported in the definition.
4. `/looper`, `/recreate`, `/archive` stay pinned light (exceptions) in v1.
5. Legacy dashboard `--accent` (#D71921) is a **brand highlight**, not status: add a dedicated role `dash-accent` (custom, exact legacy value in both modes, not locked, Studio-editable) and bridge `--accent` to `var(--t-dash-accent)`. It must NOT alias `danger-solid`. WS1 adds the role + token `--t-dash-accent`; WS5 bridges it.

---

## 19. WS1 as-built amendments (binding; supersede earlier text where they differ)

Everything else in this contract is implemented as written. Full detail: [`docs/source-of-truth/THEME-STUDIO.md`](../source-of-truth/THEME-STUDIO.md).

1. **New role `on-overlay`** (`--t-on-overlay`, §4.2): text on `--t-overlay` scrims and blocked tiles. Light `#faf7f2` (identical to the legacy `#faf7f2`), dark near white. `text-inverse` is dark ink in dark mode, so it cannot be the text colour of a dark scrim. **WS5/WS6**: `.tile-blocked-title` and `.tile-blocked-upgrade-btn` text use `var(--t-on-overlay)`. `text-inverse` is for ink-coloured fills (e.g. `.bb-btn-primary` text could also use `--t-surface`).
2. **New role `dash-accent`** (`--t-dash-accent`, §18 item 5) exists: custom `#D71921`, both modes, not locked.
3. **Generated runtime files.** `lib/theme/production/` also contains `resolved.runtime.generated.json` and `resolved.runtime.generated.js` (`export default {...}`): the slim, bundle-sized view `{ version, definitionId, hash, defaults, features, light:{ mode, meta, tokens, scene }, dark:{...} }` (13 KB). **WS2/WS4 import the `.js` module** (no JSON import attributes needed in Node tests). `resolved.generated.json` is the full `{ version, definitionId, hash, defaults, features, light: ResolvedTheme, dark: ResolvedTheme }` (150 KB, tools and tests only; keep it out of the main bundle, contract risk 12). `ResolvedTheme` additionally carries `defaults` and `features`.
4. **Contrast classification.** Pairs are `required` or advisory (§7.3 left this open). Advisory: `text-muted`, `text-faint`, `term-dim`, `term-*-pfx`, `control-border`, `accent` as a graphic, `*-solid` as graphics. Pair changes vs §7.3: `text-inverse` on `overlay`/`chrome-strong` became `on-overlay` on `overlay` and `text` on `chrome-strong` (cream-on-cream can never pass; dark mode inverts); `text-inverse` is measured on `text`. `ratio` is rounded to 2 dp for display; `pass` uses the unrounded value.
5. **Baseline tuning inside §4 ranges** (§12.3 permission): light `on-accent` `(.1448,.006)`; terminal message hues per role; `term-bg-*`/`term-dim` hue `T+23`; dark `text-faint` alpha .50, dark `control-border` alpha .38. The baseline report therefore also lists, besides defects 1 to 5 of §12.4: three terminal message colours on the bottom stop (4.39 to 4.41, required) and `warning-solid` as a graphic (2.21, advisory). The baseline is a Draft. One shared `on-solid` cannot satisfy both white-on-red and dark-on-amber; fix by darkening the fills.
6. **Stand-ins:** `#fcfcfb` maps to `--t-raised` (0.0050 deltaE-OK), not `--t-inset` (0.0149). `#f3f4f6` stays `--t-inset` (0.0098).
7. **API additions** (all in `lib/theme/index.js`): `gamutMap` also returns `candidate`; `deltaEOK` accepts OKLab or OKLCH operands (an OKLCH operand may carry `a`); `contrastRatio`/`composite` accept hex strings; `rgb255ToHsl`, `hslToSrgb01`, `formatAlpha`; `edit.js` also exports `setFeatures`, `setViewerPreference`, `setMeta`, `resetScene`, `wouldCycle`; `reportStatus(report)`; `describeLink(def, mode, id)`; `toColorGuide` rows also carry `value` (token string) and alpha, and the result has `composites`; `COMPOSITE_TOKENS`, `ROLE_TOKEN_NAMES`, `TERM_KINDS`, `GROUPS`, `getRoleDef`, `isRoleId`, `CONTRAST_PAIRS`, `EXCLUDED_ROLES`, `THRESHOLDS`, `CONTRAST_STATEMENT`, `DRAFT_CSS_MARKER`, `TOKEN_PREFIX`. `toCss` also accepts a resolved `{light, dark}` pair.
8. **Edit-helper semantics** (not specified in §7): helpers return the SAME object on a no-op, ignore invalid arguments and cyclic or unknown links, and always return canonical values. `setRoleLink(…,'custom')` and `setLocked(…,true)` freeze the CURRENT resolved value. A locked role ignores `setRoleLink`. `resetRole` unlocks (explicit action); `resetMode`, `copyMode` (destination), `linkModes` skip locked roles; `copyMode` never copies the lock and rebases cross-mode links to the destination (cycles skipped); `settings:true` also copies mode settings. `resetMode` resets mode settings, not the scene (`resetScene` does).
9. **Dev tooling API** (not in §7): `lib/theme/dev/scan-literals.js` (`scanLiterals`, `findUnallowed(source,{file,type,allowlist})`, `loadAllowlist`, `isAllowed`, `normalizeLiteral`), `legacy-map.js` (`mapLiteral`), `codemod.js` (`applyCodemod`). Allowlist entries are `{ file, literal, reason, exceptionId }` in an array or `{ entries: [] }`.
10. **Validation extras:** `BAD_SCHEMA`, `BAD_ENUM`, `BAD_TYPE`, `BAD_LINK`, `NOT_AN_OBJECT` for sections and roles too. `meta.status` in an exported bundle is stamped with the computed status.
