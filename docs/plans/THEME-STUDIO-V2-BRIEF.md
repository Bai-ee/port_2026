# Theme Studio v2 — controls brief (2026-10-15)

Branch `feat/theme-studio-v2` off `main` `ea5e2fb7`, worktree `/Users/bballi/Documents/Repos/Bballi_Portfolio-theme-studio`. Dev server already running at http://localhost:3107 (webpack, hot reload) — use it, never start or kill another, never touch ports 3000/3001. Open the Studio at `http://localhost:3107/?theme-studio=1` (dev gate) or Alt+Shift+T.

Owner's ask, verbatim intent: "complete theme sliders and colour manipulators, customise colours to extremes, set combinations."

## Non-negotiables
- Engine stays pure and unchanged in meaning: `lib/theme/{resolve,color,validate,css,roles,tokens}.js` are NOT edited. New master knobs are expressed as **patches over existing definition fields** via `lib/theme/edit.js` helpers (add helpers there if needed; keep them pure, tested).
- Baseline parity must hold: with no draft, every page renders exactly as today. `npm run theme:check` must pass; `generated-drift` test must pass (do not regenerate production artefacts unless the definition schema is untouched and output is byte-identical).
- No new npm dependency. Tests: `node --test`, ESM, under `lib/theme-studio/__tests__/` or `lib/theme/__tests__/`.
- Studio chrome uses `--ts-*` tokens (never `--t-*`). Mobile sheet layout must still work (`studio-mobile-sheet` e2e).
- Every new section/control container gets a stable `id` (kebab-case, by purpose, e.g. `id="ts-master-v2-section"`, `id="ts-color-picker-popover"`).
- Keep `scripts/theme/e2e-theme.mjs` green (15 PASS). Add e2e checks for new controls only if cheap; unit tests are the gate.
- Do not commit. Leave changes in the worktree and report.

## As-built anchors
- Definition: `{schema, version, meta, defaults, features, master:{hue,intensity}, offsets:{accentBright,support1,support2}, neutral:{tintStrength,hueSource,hue}, modes:{light,dark}:{settings, roles:{[id]:{link:'auto'|..., base:{l,c,a}, ...}}}, scene}` — see `lib/theme/production/production-theme.json` and `docs/source-of-truth/THEME-STUDIO.md` §2–§4.
- Edit helpers: `lib/theme/edit.js` (`setMasterHue setIntensity setOffset setNeutral setModeSettings setFeatures setRoleBase setRoleCustom setRoleLink setLocked resetRole resetMode copyMode linkModes applyPalettePreset …`).
- Studio state: `lib/theme-studio/{edit-session,ui-state,view-models,role-state,color-fields,palette-presets,io,store-adapter,keymap}.js`; React: `components/theme-studio/{ThemeStudioShell.jsx (section order L249–257), StudioContext.jsx, sections/*.jsx, controls/*.jsx}`.
- Roles: 54 in `lib/theme/roles.js` (ranges are advisory only; validation clamps only hard bounds L 0–1, C 0–0.4, H wrap).
- Draft persistence: `lib/theme-runtime/draft-store.js`, keys in `lib/theme/constants.js` (`STORAGE_KEYS`).

## Phases and ownership

| Phase | Scope | Owns (only these files + new files it creates) |
|---|---|---|
| P1 Master v2 + reorder | Master section first in the inspector (after PresetMode). Sliders: Master hue, Intensity (existing), **Lightness shift**, **Contrast**, **Chroma multiplier**, **Warmth** (= neutral tint hue + strength exposed), **Hue spread** (support1/support2 offsets, accentBright), **Dark depth** (dark-mode surface lightness shift). Each maps to existing fields (`master`, `offsets`, `neutral`, `modes.*.settings`) or to a documented new `settings` field consumed via `edit.js` patches on linked roles. Live update, one undo entry per gesture, reset per slider. | `components/theme-studio/sections/MasterSection.jsx`, `ThemeStudioShell.jsx` (order only), `lib/theme/edit.js` (additive), `lib/theme-studio/view-models.js` (additive), tests |
| P2 Direct colour editing | Click any swatch → `ColorPicker` popover: 2D L×C pad + hue strip, OKLCH / hex / RGB / HSL fields, paste hex, `EyeDropper` when `window.EyeDropper` exists. Editing a linked role switches it to custom in the same undo entry. "Full range" toggle (ui-state) hides advisory range warnings and widens slider bounds to hard bounds. | new `controls/ColorPicker.jsx`, `controls/RoleRow.jsx`, `controls/OklchEditor.jsx`, `controls/Swatch.jsx`, `lib/theme-studio/color-fields.js` (additive), `ui-state.js` (additive), tests |
| P3 Combination builder | Harmony generator: complementary, split, triad, analogous, mono, seeded from master hue or a chosen hue; **Shuffle** with per-role lock respected; applies through `applyPalettePreset`-style patch, one undo entry. Lives in the Palette combos section under the built-in combos. | new `lib/theme-studio/harmony.js` (pure), `sections/PaletteCombosSection.jsx`, tests |
| P4 My Themes library | Save named snapshot of the current draft, list, load (one undo entry), duplicate, rename, delete, star. localStorage key `theme-studio:library:v1` (add to `STORAGE_KEYS`), capped at 50, export-all / import-all JSON via existing `io.js` helpers. New section placed after Palette combos. | new `lib/theme-studio/library.js` (pure, storage injected), new `sections/LibrarySection.jsx`, `lib/theme/constants.js` (one key), `ThemeStudioShell.jsx` (insert section only), `StudioContext.jsx` (additive), tests |
| P5 Integration | Wire-up conflicts, mobile layout, keyboard, a11y labels, e2e green, `npm test` green (8 pre-existing failures on main only), SSOT section "Studio v2 controls" in `docs/source-of-truth/THEME-STUDIO.md`, final pixel compare 0.00% on baseline. | anything, with a report of every file touched |

P2, P3, P4 run in parallel after P1 lands. They must not edit each other's owned files; shared files (`ThemeStudioShell.jsx`, `StudioContext.jsx`, `ui-state.js`, `constants.js`) are append-only at clearly separated spots.

## Verification commands
- Theme suites: `node --test "lib/theme*/__tests__/**/*.test.{js,mjs}"`
- `npm run theme:check`
- e2e: `THEME_E2E_BASE_URL=http://localhost:3107 THEME_E2E_OUT_DIR=/tmp/theme-e2e-v2 node scripts/theme/e2e-theme.mjs --sweep quick`
- Full: `npm test` (expect only the 8 pre-existing failures: 2 vendor-sync, 5 telegram bot, 1 chat-queue)

## Report format (each agent)
Files changed · Exact behaviour added · What stayed untouched · Tests added + counts · Not done / risks.
