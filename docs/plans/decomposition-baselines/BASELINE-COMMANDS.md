# DashboardPage.jsx Decomposition — Phase 0 Baseline

**Captured:** 2026-07-18
**Purpose:** repeatable command sequence + artifacts a later phase re-runs to prove neutrality (no behavior/visual change). Re-run this exact sequence after each decomposition phase and diff against the files in this directory.

## 1. Build / test / smoke — repeatable commands

```bash
npm run build        > docs/plans/decomposition-baselines/build.log 2>&1
npm test              > docs/plans/decomposition-baselines/test.log 2>&1
npm run smoke:routes  > docs/plans/decomposition-baselines/smoke-routes.log 2>&1   # requires `npm run dev` running on :3000
```

**Baseline results (2026-07-18):**
- `build.log` — clean, exit 0.
- `test.log` — 633/633 pass, exit 0.
- `smoke-routes.log` — 24/25 pass, exit 1. **Known pre-existing failure: `/admin/control` does not redirect to `/login`** (unrelated to any dashboard-decomposition or M1 media work — confirmed by file scope, `/admin/control` shares no code with the touched files). A later phase reproducing this *exact same single failure* is neutral. If the failure count/route changes, that's a real regression.

## 2. `dashboardCss` byte-hash — the primary mechanical gate

```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('DashboardPage.jsx', 'utf8');
const startMarker = 'const dashboardCss = \`';
const startIdx = src.indexOf(startMarker);
const bodyStart = startIdx + startMarker.length;
let i = bodyStart;
while (i < src.length) {
  if (src[i] === '\\\\') { i += 2; continue; }
  if (src[i] === '\`') break;
  i++;
}
fs.writeFileSync('/tmp/dashboardCss.check.css', src.slice(bodyStart, i));
"
shasum -a 256 /tmp/dashboardCss.check.css
```

**Baseline (2026-07-18):**
- `dashboardCss.baseline.css` — 365,997 chars / 11,089 lines (matches the decomposition plan's measured line count exactly). Verified zero `${}` interpolations.
- SHA-256: see `dashboardCss.baseline.sha256`

**Phase 1 gate:** concatenating the split `styles/dashboard/*.css` files in import order MUST byte-match `dashboardCss.baseline.css` (same hash) before switching `DashboardPage.jsx` to import them. This is the plan's stated primary gate — mechanical, not a judgment call.

**Known intentional delta #2 (2026-07-20, prod-regression fix):** all 18 hand-written `-webkit-backdrop-filter` source lines were REMOVED from `styles/dashboard/*.css`. Reason: Turbopack's Lightning CSS minifier consolidates a prefixed+unprefixed pair by keeping only the LAST declaration (`-webkit-`), which stripped unprefixed `backdrop-filter` from every production modal/scrim rule — the "card modal lost its background" bug. The pre-D1 runtime never hit this because `dashboardCss` was a JS string the CSS pipeline never processed. With `browserslist` now set in `package.json` (chrome/edge ≥100, firefox ≥115, safari ≥15.6), Lightning auto-generates the `-webkit-` form from the solo unprefixed declaration — production output now contains BOTH forms, i.e. parity with the pre-D1 runtime is restored. Never re-add manual `-webkit-backdrop-filter` lines; write the unprefixed property only.

**Known intentional delta (post-D1, reviewer-verified 2026-07-18):** the shipped split deviates from the baseline by exactly ONE comment — `10-video-remix.css` line ~10,123, where the original two-line comment ("Keep this inside dashboardCss because DashboardPage injects this string directly; external dashboard.css is not guaranteed here.") was shortened to "Video Remix modal kit." because its rationale died with the literal. Zero CSS-rule effect. Re-running the gate against the current tree therefore yields concat hash `2cfc01ad…` (≠ baseline `a4e26c68…`); a `diff` must show only this one comment change and nothing else. Any additional diff line = real regression.

## 3. Screenshot baselines

**Captured this session:** `screenshots/mobile-audit_desktop-1299w.jpg` — `/preview/mobile-audit` (Market Signals modal shell, real `dashboardCss`) at ~1299px CSS width, the max viewport this session's browser-automation tooling could reach (window resize requests to both larger (1440/1581) and smaller (768) targets were silently clamped back to 1299×877 — an environment constraint, not a app bug).

**Still needed — manual capture** (per the approved plan, these were always meant to be manual, not automated):
1. Open `http://localhost:3000/preview/mobile-audit` in a real desktop browser.
2. DevTools responsive/device-toolbar mode → capture at exactly **375px**, **768px**, **1440px** widths.
3. Save as `screenshots/mobile-audit_375w.png`, `screenshots/mobile-audit_768w.png`, `screenshots/mobile-audit_1440w.png` in this directory.
4. Re-capture the same three after each later phase (esp. Phase 1's CSS split) and diff visually — pixel-identical is the bar.

Card-modal coverage beyond the one hardcoded in the harness (Market Signals) is not captured — the harness reproduces one representative modal shell chain, which is what Phase 1 (CSS-only, no JSX change) needs. Broader per-card modal coverage would require an authenticated `/dashboard` session, out of scope for D0.

## Exit criteria status

- [x] Build/test/smoke baseline captured and logged (1 known pre-existing failure documented).
- [x] `dashboardCss` serialized + hashed — mechanical Phase-1 gate ready.
- [x] One real-cascade screenshot captured (desktop-width, via the harness).
- [ ] Manual 375/768/1440 screenshots — flagged above, not blocking D0 sign-off (the plan specifies these as manual/non-automated), but should land before Phase 1's visual-parity check.
