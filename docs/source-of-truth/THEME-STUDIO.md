# Theme Studio: core engine (source of truth)

Status: WS1 (core engine) as built. Binding spec: [`docs/plans/THEME-STUDIO-CONTRACT.md`](../plans/THEME-STUDIO-CONTRACT.md) (section 19 there lists every place this implementation refines it). Coverage map: [`THEME-STUDIO-COVERAGE-MAP.md`](../plans/THEME-STUDIO-COVERAGE-MAP.md). Designer-facing guide (WS3): `THEME-STUDIO-DESIGNER-GUIDE.md`.

One theme definition (JSON, both palettes in OKLCH) is resolved by one pure function into sRGB strings for CSS and a numeric palette for Three.js. Everything here is plain ESM, has no dependencies, and touches no `window`/`document` at import time.

## 1. Files

| Path | Purpose |
|---|---|
| `lib/theme/index.js` | Public API (re-exports everything below). Client code that ships in the main bundle must import `constants.js` / `mode.js` directly, not the index. |
| `lib/theme/{constants,mode}.js` | Schema ids, storage keys, `normalizePreference`, `resolveMode` (shared with the bootstrap). |
| `lib/theme/color.js`, `contrast.js` | OKLab/OKLCH math, CSS Color 4 gamut mapping, WCAG contrast with alpha compositing. |
| `lib/theme/roles.js`, `tokens.js` | `ROLE_DEFS` (hue rule, scale, ranges, usage) and `TOKEN_NAMES`. |
| `lib/theme/baseline.js` | `BASELINE_DEFINITION` (deep-frozen) and `createBaseline()`. |
| `lib/theme/validate.js`, `migrate.js` | `validateDefinition`, `parseDefinition`, `normalizeDefinition`/`canonicalize`, `hashDefinition`, `migrate`. |
| `lib/theme/resolve.js`, `scene.js` | `resolveTheme`, `resolveBoth`, `resolveScene`. |
| `lib/theme/edit.js` | Immutable edit helpers used by the Studio. |
| `lib/theme/css.js` | `toCss`. |
| `lib/theme/report.js`, `contrast-pairs.js` | `buildReport`, `evaluateContrast`, `suggestFix`, the pair list. |
| `lib/theme/guide.js`, `export.js` | Colour guide, `exportThemeJson`, `importThemeJson`, `buildExportBundle`. |
| `lib/theme/bootstrap-source.js` | `getBootstrapScript` (pre-paint ES5 inline script). |
| `lib/theme/dev/` | `scan-literals.js`, `legacy-map.js`, `codemod.js`: dev tooling for the migration (never imported by app code). |
| `lib/theme/production/` | `production-theme.json` (the shipped default, canonical), the generated artefacts (section 11) and `build-outputs.js`. |
| `scripts/theme/` | `build-theme.mjs`, `check-theme.mjs`, `codemod-literals.mjs`, `e2e-theme.mjs`. |
| `styles/theme/theme.generated.css` | Generated CSS for the production theme. |

## 2. Theme definition schema (v1)

```
{ schema:'hitloop.theme', version:1,
  meta:{ id, name, description?, status:'draft'|'validated', baselineOf?, updatedAt? },   // updatedAt: export only, never hashed
  defaults:{ viewerPreference:'light'|'dark'|'system' },        // baseline: 'light'
  features:{ focusRing:boolean, selection:boolean },            // baseline: false / false
  master:{ hue:0..360 (wraps), intensity:0..1.5 },              // baseline: 201 / 1
  offsets:{ accentBright, support1, support2 },                 // degrees -180..180; baseline 6 / 86 / 142
  neutral:{ tintStrength:0..2, hueSource:'fixed'|'master', hue },   // fixed: absolute hue (56); master: hue is an offset to master.hue
  modes:{ light:{ settings:{ lightnessShift:-.15..+.15, chromaScale:0..2 }, roles:{ [roleId]: RoleState } }, dark:{ ... } },
  scene:{ light: SceneDef, dark: SceneDef } }

RoleState = { link:'auto'|'custom'|LinkSpec, base:{l,c,a}, custom?:{l,c,h,a}, locked?:true }
LinkSpec  = { to:roleId, mode?:'light'|'dark', dL?, dC?, dH?, a? }
SceneDef  = { source:'follow'|'custom',
              follow:{ hueShiftDeg, saturationMul, lightnessDelta, opacityMul, hueSpan },
              custom:{ base:{l,c,h}, secondary:{l,c,h}|null, highlight:{l,c,h}, highlightStrength, opacityMul } }
```

Canonical form (what `validateDefinition` returns and `exportThemeJson` writes): fixed key order (`ROLE_DEFS` order for roles), `l`, `c`, `a` and other dimensionless numbers rounded to 4 dp, degrees to 2 dp, hue wrapped to `[0,360)`, `locked` present only when `true`. Canonicalisation is idempotent, which is what makes export, import and re-export byte-identical.

### Validation codes

| Code | Severity | Meaning |
|---|---|---|
| `JSON_PARSE` | error | Text is not JSON (from `parseDefinition`). |
| `NOT_AN_OBJECT` | error | Top level (or a section / role) is not an object. |
| `BAD_SCHEMA` | error | `schema` present but not `hitloop.theme`. |
| `BAD_VERSION` / `UNSUPPORTED_VERSION` | error | `version` missing or not a positive integer / newer than 1. |
| `NONFINITE` | error | A number field holds NaN, Infinity, a string, `null`, ... Never coerced. |
| `BAD_ENUM`, `BAD_TYPE`, `BAD_LINK` | error | Wrong enum value / type / link shape. |
| `LINK_TARGET_MISSING` | error | `link.to` is not a known role id. |
| `LINK_CYCLE` | error | Links form a loop (including cross-mode, e.g. `dark.text -> light.text -> dark.text`). One error per cycle. |
| `CUSTOM_MISSING` | error | `link:'custom'` without `custom`. |
| `LOCKED_NOT_CUSTOM` | error | `locked:true` while `link` is not `'custom'`. |
| `MISSING_FIELD_DEFAULTED` | warning | Field or role missing; filled from the baseline. |
| `CLAMPED` | warning | Number outside its schema range; clamped. |
| `UNKNOWN_KEY` | warning | Unknown key or role id; dropped. |

Hue anywhere finite is wrapped silently. When there are errors `definition` is `null`; `resolveTheme`/`toCss` canonicalise their input themselves and never throw.

## 3. Precedence (the only resolution order)

For one role in one mode, `resolveTheme`:

1. **Preset base**: the authored `base {l,c,a}`.
2. **Linked generation**: hue from the role's rule (tint hue + n, master + n, master + offset, or a fixed hue), chroma x `master.intensity` (scale `int`) or x `neutral.tintStrength` (scale `tint`). `link:{to,...}` derives from the target's FINAL value (after the target's steps 1 to 3): `l + dL`, `c + dC`, `h + dH`, alpha = `a` or the target's.
3. **Mode settings**: `lightnessShift` and `chromaScale`, only for roles with `modeSettings:true` that are `auto` or `link` and not locked. (Only `accent`, `accent-bright`, `support-*`, `comet-*`, `deco-*` have it; derived roles inherit through their target, so nothing is applied twice.)
4. **Explicit overrides**: `link:'custom'` wins last and ignores master hue, intensity, tint and mode settings. `locked` roles must be custom and are never touched by master moves, mode settings, `copyMode`, `resetMode`, `linkModes` or suggestions.

Gamut mapping happens once, after step 4, per role. Alpha is carried through unchanged. Zero chroma never loses its hue: `oklch.h` stays the rule hue (or `custom.h`) for greys.

Edge handling: a link cycle in an unvalidated input is broken at the closing role (it falls back to `auto`), so `resolveTheme` always terminates.

## 4. Roles and tokens

The CSS variable for role `id` is `--t-<id>`. `TOKEN_NAMES` is the ordered union of the role variables (in `ROLE_DEFS` order, as listed below) and the composite variables of section 4.1. Hue codes: `T+n` neutral tint hue + n, `M+n` master hue + n, `Mo(k)` master + `offsets.k`, `F=n` fixed hue. Scale: `tint` / `int` / `none`. Alpha-kind roles always emit `rgba(r, g, b, a)`; any other role emits `rgba()` only when its alpha is below 1.

### Surfaces

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-page` | T+40 | tint | - | auto 1/0 | auto 0.165/0.008 | Body and canvas background |
| `--t-surface` | T+40 | tint | - | auto 1/0 | auto 0.205/0.009 | Cards, inputs, modals |
| `--t-raised` | T+39 | tint | - | auto 0.9937/0.0054 | auto 0.245/0.01 | Popovers, floating panels, inner-page shell |
| `--t-inset` | T+50 | tint | - | auto 0.9759/0.0013 | auto 0.135/0.006 | Wells, code blocks, guidance rows |
| `--t-overlay` | T+12 | tint | - | auto 0.1928/0.0051 a0.42 | auto 0.08/0.004 a0.62 | Scrim behind modals and blocked tiles |
| `--t-chrome` | T+41 | tint | - | auto 0.9564/0.0241 a0.55 | auto 0.22/0.012 a0.6 | Navigation strip glass |
| `--t-chrome-strong` | T+41 | none | - | link chrome a0.85 | link chrome a0.85 | Scroll-top button, pinned nav |
| `--t-glass-soft` | T+40 | none | - | link surface a0.5 | link surface dL0.04 a0.5 | Lightest glass panel |
| `--t-glass` | T+40 | none | - | link surface a0.62 | link surface dL0.04 a0.62 | Standard glass panel |
| `--t-glass-strong` | T+40 | none | - | link surface a0.78 | link surface dL0.04 a0.78 | Dense glass panel, text-bearing |
| `--t-glass-border` | T+23 | tint | - | auto 0.8269/0.0384 a0.82 | auto 0.42/0.02 a0.5 | Sand panel border |
| `--t-glass-highlight` | T+40 | tint | - | auto 1/0 a0.45 | auto 0.95/0 a0.1 | Inset hairlines on glass |
| `--t-scrim` | T+40 | none | - | link page a0 | link page a0.55 | Text-over-animation scrim (invisible in the baseline) |

### Text and borders

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-text-default` | T+0 | tint | - | auto 0/0 | auto 0.93/0.01 | Inherited body colour |
| `--t-text-strong` | T+0 | tint | - | auto 0.1448/0 | auto 0.975/0.004 | Headings |
| `--t-text-body` | T+0 | tint | - | auto 0.2178/0 | auto 0.9/0.006 | Inner-page body copy |
| `--t-text` | T+0 | tint | - | auto 0.2656/0.0117 | auto 0.93/0.01 | Primary ink, the workhorse |
| `--t-text-secondary` | T+0 | none | - | link text a0.72 | link text a0.72 | Secondary text |
| `--t-text-muted` | T+0 | none | - | link text a0.52 | link text a0.58 | Muted text and hints |
| `--t-text-faint` | T+0 | none | - | link text a0.38 | link text a0.5 | Placeholders |
| `--t-text-eyebrow` | T+27 | tint | - | auto 0.445/0.0225 | auto 0.72/0.014 | Eyebrow labels |
| `--t-text-inverse` | T+25 | tint | - | auto 0.9771/0.0074 | auto 0.2/0.008 | Text on dark chrome and overlays |
| `--t-on-overlay` | T+25 | tint | - | auto 0.9771/0.0074 | auto 0.95/0.006 | Text on overlay scrims and blocked tiles (light in both modes) |
| `--t-on-accent` | T+0 | tint | - | auto 0.1448/0.006 | auto 0.18/0.01 | Text on accent fills |
| `--t-on-solid` | T+0 | tint | - | auto 1/0 | auto 0.15/0.01 | Text on status solid fills |
| `--t-text-disabled` | T+0 | none | - | link text a0.3 | link text a0.3 | Disabled text |
| `--t-accent-text` | M+0 | int | - | auto 0.5/0.105 | auto 0.8/0.12 | Links and accent text on page |
| `--t-border-faint` | T+0 | none | - | link text a0.08 | link text a0.1 | Decorative hairlines |
| `--t-border-subtle` | T+0 | none | - | link text a0.12 | link text a0.14 | Dividers and card hairlines |
| `--t-control-border` | T+0 | none | - | link text a0.22 | link text a0.38 | Input and button boundary |
| `--t-control-border-strong` | T+0 | none | - | link text a0.55 | link text a0.62 | Emphasised control boundary |
| `--t-focus` | M+0 | int | - | auto 0.52/0.11 | auto 0.8/0.12 | Keyboard focus ring |

### Accent and supporting

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-accent` | M+0 | int | yes | auto 0.6799/0.1156 | auto 0.76/0.12 | Primary accent fill |
| `--t-accent-hover` | M+0 | none | - | link accent dL-0.05 | link accent dL0.05 | Accent hover state |
| `--t-accent-pressed` | M+0 | none | - | link accent dL-0.09 | link accent dL0.09 | Accent pressed state |
| `--t-accent-soft` | M+0 | none | - | link accent a0.1 | link accent a0.16 | Accent tint background |
| `--t-accent-soft-border` | M+0 | none | - | link accent a0.25 | link accent a0.35 | Accent tint border |
| `--t-accent-bright` | Mo(accentBright) | int | yes | auto 0.7894/0.1353 | auto 0.8/0.135 | Gradient start, bright accent |
| `--t-support-1` | Mo(support1) | int | yes | auto 0.5199/0.286 | auto 0.7/0.2 | Supporting colour 1 (gradient middle) |
| `--t-support-2` | Mo(support2) | int | yes | auto 0.6703/0.2877 | auto 0.74/0.22 | Supporting colour 2 (gradient end) |
| `--t-selection-bg` | M+0 | none | - | link accent a0.25 | link accent a0.35 | Text selection background |
| `--t-selection-fg` | T+0 | none | - | link text | link text | Text selection foreground |

### Decorative ramps

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-comet-1` | M+4 | int | yes | auto 0.8656/0.1424 | auto 0.8656/0.1424 | Conic gradient stop 1 (CTA ring, spinner) |
| `--t-comet-2` | M+35 | int | yes | auto 0.7602/0.1433 | auto 0.7602/0.1433 | Conic gradient stop 2 (CTA ring, spinner) |
| `--t-comet-3` | M+65 | int | yes | auto 0.6081/0.2114 | auto 0.6081/0.2114 | Conic gradient stop 3 (CTA ring, spinner) |
| `--t-comet-4` | M+82 | int | yes | auto 0.5734/0.2427 | auto 0.5734/0.2427 | Conic gradient stop 4 (CTA ring, spinner) |
| `--t-comet-5` | M+107 | int | yes | auto 0.6459/0.2478 | auto 0.6459/0.2478 | Conic gradient stop 5 (CTA ring, spinner) |
| `--t-comet-6` | M+127 | int | yes | auto 0.7465/0.2637 | auto 0.7465/0.2637 | Conic gradient stop 6 (CTA ring, spinner) |
| `--t-comet-7` | M+139 | int | yes | auto 0.8123/0.1186 | auto 0.8123/0.1186 | Conic gradient stop 7 (CTA ring, spinner) |
| `--t-deco-1` | M-153 | int | yes | auto 0.6539/0.1042 | auto 0.5939/0.1042 | Hero tint blob 1 |
| `--t-deco-2` | M-25 | int | yes | auto 0.7246/0.0863 | auto 0.6646/0.0863 | Hero tint blob 2 |
| `--t-deco-3` | M-110 | int | yes | auto 0.8089/0.0909 | auto 0.7489/0.0909 | Hero tint blob 3 |
| `--t-deco-4` | M+98 | int | yes | auto 0.713/0.1028 | auto 0.653/0.1028 | Hero tint blob 4 |

### Status

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-success` | F=152.7 | none | - | auto 0.4379/0.0835 | auto 0.78/0.14 | success text and icons on surface |
| `--t-success-bg` | F=152.7 | none | - | link success a0.1 | link success a0.16 | success tinted background |
| `--t-success-border` | F=152.7 | none | - | link success a0.25 | link success a0.35 | success tinted border |
| `--t-success-solid` | F=148.6 | none | - | auto 0.6299/0.1279 | auto 0.7/0.14 | success fills and icons |
| `--t-warning` | F=69.1 | none | - | auto 0.4566/0.0428 | auto 0.8/0.1 | warning text and icons on surface |
| `--t-warning-bg` | F=69.1 | none | - | link warning a0.12 | link warning a0.16 | warning tinted background |
| `--t-warning-border` | F=69.1 | none | - | link warning a0.3 | link warning a0.35 | warning tinted border |
| `--t-warning-solid` | F=84.9 | none | - | auto 0.7534/0.1274 | auto 0.8/0.13 | warning fills and icons |
| `--t-danger` | F=29 | none | - | auto 0.4578/0.1648 | auto 0.72/0.17 | danger text and icons on surface |
| `--t-danger-bg` | F=29 | none | - | link danger a0.08 | link danger a0.14 | danger tinted background |
| `--t-danger-border` | F=29 | none | - | link danger a0.25 | link danger a0.35 | danger tinted border |
| `--t-danger-solid` | F=26.8 | none | - | auto 0.5607/0.2177 | auto 0.68/0.2 | danger fills and icons |
| `--t-info` | F=264.4 | none | - | auto 0.4882/0.2172 | auto 0.76/0.13 | info text and icons on surface |
| `--t-info-bg` | F=264.4 | none | - | link info a0.08 | link info a0.14 | info tinted background |
| `--t-info-border` | F=264.4 | none | - | link info a0.25 | link info a0.35 | info tinted border |
| `--t-info-solid` | F=262 | none | - | auto 0.5741/0.2015 | auto 0.68/0.17 | info fills and icons |

### State, shadow, scene

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-disabled-bg` | T+0 | none | - | link text a0.06 | link text a0.08 | Disabled control background |
| `--t-shadow` | F=0 | none | - | auto 0/0 a0.1 | auto 0/0 a0.45 | Drop-shadow colour |
| `--t-scene-wash` | T+41 | tint | - | auto 0.9564/0.0241 a0.08 | auto 0.1838/0.0045 a0.08 | Wash over the animated background |

### Dashboard neutrals

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-dash-page` | T+0 | none | - | auto 0.9702/0 | auto 0/0 | Dashboard page background |
| `--t-dash-surface` | T+0 | none | - | auto 1/0 | auto 0.1776/0 | Dashboard card surface |
| `--t-dash-surface-raised` | T+0 | none | - | auto 0.9551/0 | auto 0.2178/0 | Dashboard raised surface |
| `--t-dash-border` | T+0 | none | - | auto 0.9189/0 | auto 0.252/0 | Dashboard border |
| `--t-dash-border-visible` | T+0 | none | - | auto 0.8328/0 | auto 0.3211/0 | Dashboard visible border |
| `--t-dash-text-disabled` | T+0 | none | - | auto 0.7155/0 | auto 0.5103/0 | Dashboard disabled text |
| `--t-dash-text-secondary` | T+0 | none | - | auto 0.5103/0 | auto 0.683/0 | Dashboard secondary text |
| `--t-dash-text-primary` | T+0 | none | - | auto 0.252/0 | auto 0.931/0 | Dashboard primary text |
| `--t-dash-text-display` | T+0 | none | - | auto 0/0 | auto 1/0 | Dashboard display text |
| `--t-dash-dot-grid` | T+0 | none | - | auto 0/0 a0.065 | auto 1/0 a0.045 | Dashboard dot-grid texture |
| `--t-dash-accent` | F=26.8 | none | - | custom | custom | Dashboard brand highlight (legacy --accent red) |

### Terminal

| Token | Hue | Scale | Mode settings | Light default | Dark default | Usage |
|---|---|---|---|---|---|---|
| `--t-term-bg-top` | T+23 | tint | - | auto 0.9858/0.0045 | auto 0.15/0.006 | Terminal background (top stop) |
| `--t-term-bg-bottom` | T+23 | tint | - | auto 0.9425/0.0165 | auto 0.12/0.006 | Terminal background (bottom stop) |
| `--t-term-border` | T+0 | none | - | link text a0.1 | link text a0.12 | Terminal border |
| `--t-term-border-top` | T+0 | none | - | link text a0.06 | link text a0.08 | Terminal top highlight border |
| `--t-term-titlebar-bg` | T+0 | none | - | link text a0.035 | link text a0.05 | Terminal titlebar background |
| `--t-term-titlebar-border` | T+0 | none | - | link text a0.07 | link text a0.09 | Terminal titlebar border |
| `--t-term-title-fg` | T+0 | none | - | link text a0.42 | link text a0.5 | Terminal title text |
| `--t-term-scroll-thumb` | T+0 | none | - | link text a0.16 | link text a0.22 | Terminal scrollbar thumb |
| `--t-term-fg` | T+0 | none | - | link text | link text | Terminal default line text |
| `--t-term-dim` | T+23 | tint | - | auto 0.6129/0.0183 | auto 0.66/0.012 | Terminal system / dim text |
| `--t-term-shadow-1` | T+0 | none | - | link text a0.05 | link shadow a0.3 | Terminal shadow, near |
| `--t-term-shadow-2` | T+0 | none | - | link text a0.08 | link shadow a0.45 | Terminal shadow, far |
| `--t-term-info-pfx` | F=256 | none | - | auto 0.5226/0.0419 | auto 0.78/0.0335 | Terminal info line prefix |
| `--t-term-info-msg` | F=256.8 | none | - | auto 0.4461/0.0263 | auto 0.84/0.021 | Terminal info line message |
| `--t-term-fetch-pfx` | F=210 | none | - | auto 0.5383/0.0903 | auto 0.78/0.0722 | Terminal fetch line prefix |
| `--t-term-fetch-msg` | F=208.5 | none | - | auto 0.4863/0.0756 | auto 0.84/0.0605 | Terminal fetch line message |
| `--t-term-ok-pfx` | F=139.5 | none | - | auto 0.5299/0.1298 | auto 0.78/0.1038 | Terminal ok line prefix |
| `--t-term-ok-msg` | F=136.3 | none | - | auto 0.5066/0.1103 | auto 0.84/0.0882 | Terminal ok line message |
| `--t-term-ai-pfx` | F=312.8 | none | - | auto 0.5177/0.1797 | auto 0.78/0.1438 | Terminal ai line prefix |
| `--t-term-ai-msg` | F=312.3 | none | - | auto 0.4726/0.1585 | auto 0.84/0.1268 | Terminal ai line message |
| `--t-term-build-pfx` | F=77.6 | none | - | auto 0.6158/0.122 | auto 0.78/0.0976 | Terminal build line prefix |
| `--t-term-build-msg` | F=78.2 | none | - | auto 0.5372/0.1058 | auto 0.84/0.0846 | Terminal build line message |
| `--t-term-error-pfx` | F=29.7 | none | - | auto 0.5433/0.174 | auto 0.78/0.1392 | Terminal error line prefix |
| `--t-term-error-msg` | F=29.5 | none | - | auto 0.4937/0.1561 | auto 0.84/0.1249 | Terminal error line message |
| `--t-term-active-pfx` | F=262 | none | - | auto 0.5741/0.2015 | auto 0.78/0.1612 | Terminal active line prefix |
| `--t-term-active-msg` | F=250.7 | none | - | auto 0.3035/0.0332 | auto 0.84/0.0266 | Terminal active line message |
| `--t-term-screen-pfx` | F=267 | none | - | auto 0.5036/0.1613 | auto 0.78/0.129 | Terminal screen line prefix |
| `--t-term-screen-msg` | F=268.3 | none | - | auto 0.379/0.0847 | auto 0.84/0.0678 | Terminal screen line message |
| `--t-term-mock-pfx` | F=47 | none | - | auto 0.6213/0.1333 | auto 0.78/0.1066 | Terminal mock line prefix |
| `--t-term-mock-msg` | F=45.3 | none | - | auto 0.5443/0.1235 | auto 0.84/0.0988 | Terminal mock line message |
| `--t-term-countdown-pfx` | F=77.6 | none | - | auto 0.6158/0.122 | auto 0.78/0.0976 | Terminal countdown line prefix |
| `--t-term-countdown-msg` | F=78.2 | none | - | auto 0.5372/0.1058 | auto 0.84/0.0846 | Terminal countdown line message |
| `--t-term-caret` | F=262 | none | - | link info-solid | link info-solid | Terminal caret |

### 4.1 Composite tokens

`--t-gradient-accent`, `--t-term-bg`, `--t-term-shadow`, `--t-shadow-sm/md/lg`, `--t-blend-deco` (`multiply` light / `screen` dark), `--t-logo-blend` (`darken` / `lighten`), `--t-logo-filter` (`none` / `invert(1)`), `--t-logo-filter-muted`, `--t-scene-bg` (= page), `--t-scene-base/secondary/highlight` (swatches from `resolveScene`), `--t-scene-fallback` (two radial gradients meant to be painted over `var(--t-page)`). Exact strings are asserted in `resolve.test.js`.

### 4.2 Alpha-token usage rule (for migrators)

Opaque role: `var(--t-text)`. A non-tokenised alpha of an opaque role: `color-mix(in srgb, var(--t-text) 14%, transparent)`. Do NOT `color-mix` the alpha-baked tokens (`--t-chrome`, `--t-overlay`, `--t-glass*`, `--t-text-secondary`, ...): their alpha is already in the token, so mixing would multiply alphas. Black shadows stay literal (exception X6).

## 5. Gamut mapping

Method: CSS Color Module 4 section 13.2 (OKLCH chroma reduction), implemented in `lib/theme/color.js` `gamutMap`:

- `JND = 0.02` (delta-E-OK), `epsilon = 0.0001`; in-gamut test is "all linear channels within [-1e-6, 1 + 1e-6]".
- `L >= 1` is white, `L <= 0` is black, in-gamut input is returned unchanged.
- Otherwise: if clipping the input already costs less than JND it is clipped; else bisect chroma between 0 and the input chroma keeping `L` and `h`, accepting the clipped candidate once its distance to the unclipped candidate is within `epsilon` of the JND.
- Result `{ oklch (mapped, continuous), rgb255 (rounded 8-bit), mapped, deltaE (input to mapped), candidate }`. The 8-bit hex is used for BOTH the CSS and the contrast checks.
- Input is sanitised (NaN/Infinity become 0), so the result is always finite.

Known consequence (contract risk 9): near-boundary colours such as the baseline `support-1/2` flag `mapped:true` with a tiny `deltaE` (about 0.0006) purely from 8-bit rounding; extreme hues or intensity 1.5 map by reducing chroma and look less vivid than the authored value. `buildReport` lists every mapped role.

## 6. Contrast

WCAG 2.x relative luminance from 8-bit sRGB; ratio `(L1+0.05)/(L2+0.05)`. Layers are composited bottom to top over the opaque `page` colour in gamma-encoded sRGB, per channel `a*fg + (1-a)*bg`, rounded to 8-bit at each step, after gamut mapping. Thresholds: text 4.5, large 3, non-text 3. `pass` is decided on the unrounded ratio; `ratio` is rounded to 2 dp for display. The report always states: "Automated contrast checks only; this is not a WCAG conformance claim."

### 6.1 Pairs (`contrast-pairs.js`), per mode

- `text-default|text-strong|text-body|text` on `page|surface|raised|inset|glass-strong`; `text-secondary` on `surface|glass-strong`; `text-eyebrow` on `surface`; `text` on `chrome-strong`.
- `text-inverse` on `text` (inverse ink on an ink fill, e.g. a primary button); `on-overlay` on `overlay` (over page); `on-accent` on `accent|accent-hover|accent-pressed`; `accent-text` on `page|surface|accent-soft (over surface)`.
- `on-solid` on each `*-solid`; each status fg on `surface` and on its own `*-bg` (over surface); `selection-fg` on `selection-bg`.
- Terminal: `term-fg`, `term-dim`, `term-<kind>-pfx|msg` on `term-bg-top` and `term-bg-bottom`. Dashboard: `dash-text-primary|secondary` on `dash-surface|dash-page`.
- Scene: `text` on `page + scrim + scene-peak` (scene-peak = the scene base swatch at alpha 0.23; an approximation, not a sample of every particle).
- Non-text 3:1: `focus` on `page|surface`; `control-border`, `control-border-strong`, `accent` and each `*-solid` on `surface`.
- Excluded (listed with a reason in every report): `border-faint|subtle`, `glass-border`, `text-disabled`, `disabled-bg`, `shadow`, `overlay`, `scrim`, `glass-highlight`, `support-*`, `comet-*`, `deco-*`.

### 6.2 Required vs advisory

Only failing REQUIRED pairs block the "validated" status. Advisory (still measured and reported as `advisoryFail`): `text-muted`, `text-faint` (tertiary text and placeholders), `term-dim`, every `term-*-pfx` (prefix tags; the message carries the content), `control-border` (default input hairline), `accent` as a graphic, and the `*-solid` fills as graphics (status is never colour-only). Everything else is required.

### 6.3 `suggestFix`

Never mutates anything. Candidate order: the foreground, then the background layers top-down; the first non-locked role is adjusted (if all are locked the foreground gets the suggestion with `blockedByLock:true`, informational only). An alpha-kind foreground first tries a higher alpha (`set:{a}`); otherwise it binary-searches OKLCH `L` (keeping `c`,`h`, gamut mapped) toward whichever end gives more contrast until `ratio >= min + 0.05` (`set:{l}`). It returns `null` when even the extreme cannot reach the target. For a linked role, an `l` suggestion implies "Make custom" in the Studio; an `a` suggestion is `setRoleLink(def, mode, id, {to, a})`.

## 7. Baseline preset

`BASELINE_DEFINITION` reproduces today's look in light mode. `baseline-parity.test.js` asserts every cited legacy colour within +-1 per 8-bit channel (alpha exact) and the legacy dark dashboard neutrals exactly. Dark palettes are new design; they ship but are reachable only through the viewer preference or the Studio (D5).

Refinements to contract 12 made while implementing (all inside the section 4 ranges, all asserted by tests):

- Terminal message hues are per role (a few differ from their prefix by 1 to 3 degrees in the legacy file), so every `--term-*` legacy value is matched exactly; `term-bg-*` and `term-dim` use hue `T+23` (the legacy hue is about 79), not `T+41`.
- `on-accent` light is `(0.1448, 0.006)` (not `(0.266, 0.012)`): the old ink fails 4.5:1 on `accent-pressed`. Dark `text-faint` alpha .50 and `control-border` alpha .38 (both at the top of their ranges) so the dark palette has no failing REQUIRED pair and only one advisory miss (`text-faint` on `glass-strong`, 4.41).
- New role `on-overlay` (light `#faf7f2`, dark near white): text on overlays must be light in BOTH modes, which `text-inverse` (dark ink in dark mode) cannot be. WS5/WS6 map `.tile-blocked-title` and `.tile-blocked-upgrade-btn` text to `--t-on-overlay`.
- New role `dash-accent` (contract section 18, item 5): custom `#D71921` in both modes, not locked, not aliased to `danger-solid`.
- `#fcfcfb` is 0.0149 deltaE-OK from `--t-inset` but 0.0050 from `--t-raised`; migrators map it to `--t-raised`. `#f3f4f6` stays `--t-inset` (0.0098).

### 7.1 Known baseline accessibility findings (reported, not hidden)

`production/baseline.report.json` (asserted by `baseline-report.test.js`) records, for the light baseline: `control-border` 1.56:1 (advisory), `text-muted` 3.30 and `text-faint` 2.26 (advisory), `accent #00adb5` as graphic 2.75 (advisory), `on-overlay` on the blocked-tile overlay 2.56 (required), white on `success-solid` 3.31 and on `warning-solid` 2.21 (required), plus three terminal message colours on the bottom gradient stop at 4.39 to 4.41 (required: `term-build-msg`, `term-mock-msg`, `term-countdown-msg`) and `warning-solid` as a graphic on white 2.21 (advisory). The baseline is therefore a **Draft**. A single shared `on-solid` cannot be both white-on-red and dark-on-amber; the fix is to darken the `success-solid`/`warning-solid` fills (see `roundtrip.test.js`).

## 8. Scene

`resolveScene(definition, mode, resolvedRoles)` returns the numeric palette Three.js applies as deltas over each surface's own params (contract 9.1): `follow` uses `hueShift = wrapTurns((master.hue - 201)/360 + hueShiftDeg/360)`; `custom` converts the gamut-mapped base to HSL and compares with `SCENE_REFERENCE {hue .44, saturation .9, lightness .52}`; `hueSpan` is the counter-clockwise HSL turns from base to secondary hue clamped to `[0.05, 1]` (`0.8` without a secondary); `highlight.srgb` is display-space 0..1; `swatches` and `wash` feed `--t-scene-*`. The baseline custom defaults resolve to (almost) the follow identity.

## 9. Runtime contract that depends on this module

- Import budget: `lib/theme-runtime/pref-store.js` imports only `constants.js`, `mode.js` and `production/resolved.runtime.generated.js` (13 KB). `resolved.generated.json` (150 KB, full `ResolvedTheme` pair) is for tests and tools, not the bundle.
- Pre-paint: `getBootstrapScript({ defaultPreference })` returns the constant ES5 script (about 720 bytes). `check-theme` prints its CSP hash.
- Draft CSS for pre-paint injection must begin with `DRAFT_CSS_MARKER` (`/* theme-draft v1 `), e.g. `` `${DRAFT_CSS_MARKER}hash:${hash} */\n${toCss(def, { header: false })}` ``.

## 10. Export, publish, rollback

- **Bundle** (`buildExportBundle`): `theme.json` (canonical; `meta.status` stamped), `theme.css` (`toCss`), `theme-guide.md` (token, light, dark, usage, linked-to; plus composite tokens), `theme-report.json` (`ThemeReport`) and `status`: `draft` until the structure is sound and no REQUIRED check fails, then `validated` ("validated against the in-app checks", never "WCAG compliant").
- **Round trip**: `importThemeJson(exportThemeJson(d))` yields the same canonical definition and byte-identical `toCss`.
- **Replace the production default**: (1) export JSON from the Studio; (2) overwrite `lib/theme/production/production-theme.json`; (3) `npm run theme:build` (add `--baseline` only to refresh `baseline.report.json`); (4) `npm run theme:check` and `npm test`; (5) commit and deploy through the normal pipeline.
- **Rollback**: `git revert` that commit (or restore the previous JSON and rebuild); the previous Vercel deployment id is the rollback target. Browser drafts live in `localStorage` and never reach other viewers.

## 11. Generated artefacts and scripts

| Command | Effect |
|---|---|
| `npm run theme:build` | Regenerates `styles/theme/theme.generated.css`, `lib/theme/production/resolved.generated.json`, `resolved.runtime.generated.json`, `resolved.runtime.generated.js` (and `baseline.report.json` with `--baseline`). Pure Node. |
| `npm run theme:check` | Fails if `production-theme.json` is invalid or not canonical, or any generated file differs from a fresh build; prints the bootstrap CSP hash and the contrast summary (`--strict` also fails on REQUIRED contrast failures). |
| `node scripts/theme/codemod-literals.mjs --paths a,b [--write] [--report out.json]` | Dry run by default. See section 12. Stop the dev server first. |
| `node scripts/theme/e2e-theme.mjs` | Playwright checks (first paint, system/OS rules, soft navigation, cross-tab, dark readability, hue sweep, scene stats, context loss, Studio scenarios). Needs a running app; reports SKIP with a reason for anything it cannot exercise. |

`generated-drift.test.js` enforces the same equality inside `npm test`.

## 12. Migration tooling (`lib/theme/dev`)

`scanLiterals(source, { file, type })` finds hex, `rgb()`, `rgba()`, `hsl()`, `hsla()` and `0x` literals (CSS selectors, comments, `url()` fragments, HTML entities, `var()` and `${}` values are ignored) with line, column and property. `findUnallowed(source, { file, type, allowlist })` is what the WS5/6/7 scan tests use: it drops mode-agnostic black shadows (`rgba(0,0,0,a)` / `#000` inside `box-shadow`, `text-shadow`, `drop-shadow`) and allowlisted literals. `loadAllowlist` accepts an array or `{ entries: [] }` of `{ file, literal, reason, exceptionId }`; `file` is a repo-relative path (or `*`) and `literal` is matched after normalisation (`#FFF` equals `#ffffff`, `rgba(0, 0, 0, 0.5)` equals `rgba(0,0,0,.5)`).

`mapLiteral` / `applyCodemod` rewrite only EXACT legacy matches (contract 10.4 rule 1): `#2a2420`, `#0a0a0a`, `#1a1a1a`, `#faf7f2`, the status hexes, `rgba(42,36,32,a)` (named tokens at .08/.12/.22/.38/.52/.72, otherwise `color-mix(... var(--t-text) a%, transparent)`), `rgba(255,255,255,a)` (.5/.62/.78 named, else mix with `--t-surface`), `rgba(26,26,26,a)`, `rgba(90,83,70,a)`, `rgba(0,0,0,a)` outside shadows, `rgba(212,196,171,.82)`, `rgba(22,20,18,.42)`, `rgba(245,241,223,.55/.85/.08)`, `hsl(185/262/314 ...)` and the seven comet `hsla` stops. Opaque `#fff` becomes `--t-surface` only in background, border or outline properties; as text or icon colour it is reported as ambiguous (`--t-on-accent` vs `--t-on-solid`). Reported, never changed: `#d71921` (danger-solid or dash-accent), opaque `#f5f1df`, `#e7d9c3`, other `rgba(245,241,223,a)`, anything unmapped, and any literal outside the allowed JSX style keys (`not-attempted`). Mapped tokens are asserted equal to the baseline light value of the literal they replace (`scan-literals.test.js`).

Protected paths (`features/email-digest`, `app/api`, `app/briefs`, `brief-design-system-reference`, `ds-bundle`, `.design-sync`, `lib/theme`, the orphan files, `AuthContext.jsx`) are skipped by the CLI.

## 13. Intentional exceptions

Unchanged from contract section 13 (X1 email HTML, X2 briefs and published artefacts and `srcDoc` iframes, X3 Invoice documents, X4 Studio artwork, X5 logos and media, X6 black shadows and mimicry colours, X7 `AdminPage` dark console, X8 pinned-light routes, X9 generated bundles, X10 orphans, X11 `--yellow-*`, X12 shared particle presets if S1 is skipped, X13 non-colour mechanics). Engine-level additions: baseline accessibility findings are reported not fixed (D8, section 7.1); `scene` has no `emissive`; `scene-peak` is an approximation.

## 14. Tests

`node --test 'lib/theme/__tests__/*.test.js'` (also part of `npm test`). Files: `color-math`, `gamut`, `contrast`, `resolve`, `hue-boundaries`, `neutrals`, `baseline-parity`, `baseline-report`, `validate`, `migrate`, `css-export`, `roundtrip`, `scene-resolve`, `edit`, `report`, `guide`, `tokens-manifest`, `bootstrap-source`, `generated-drift`, `scan-literals`, `fuzz`, `docs-coverage`.
