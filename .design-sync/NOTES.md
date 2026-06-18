# Design Sync Notes — Bballi Portfolio

## Repo quirks

- **Next.js + Firebase**: Components import `next/*` and `firebase/*`. These are shimmed via `.design-sync/overrides/bundle.mjs` (forked from `.ds-sync/lib/bundle.mjs`). The fork adds `nextFirebaseShim` esbuild plugin and is re-exported completely so the converter can import it normally.
- **No dist/**: This is a Next.js app, not a library. Synth-entry mode used with explicit `--entry .design-sync/ds-entry.jsx`. The `componentSrcMap` in config.json defines the 60 components.
- **`@/` path alias**: `jsconfig.json` at repo root maps `@/*` → `./*`. The `tsconfigPathsPlugin` in esbuild picks this up; pass `--tsconfig ./jsconfig.json` (already in `buildCmd`).
- **`AdminEmailModals.jsx`**: Only has named exports (`AdminEmailDigestView`, `AdminEmailSettingsView`, `AdminCreateClientView`) — no default export. `ds-entry.jsx` uses named re-exports for these three.
- **`lib/utils.js`**: Icon components use `@/lib/utils` for `cn()`. Resolves correctly via jsconfig paths plugin.
- **`.design-sync/node_modules`**: Symlink → `../.ds-sync/node_modules`. Required so the forked `bundle.mjs` can resolve bare `esbuild` import. Recreate with: `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`

## Re-sync command

```bash
node .ds-sync/package-build.mjs \
  --config .design-sync/config.json \
  --node-modules ./node_modules \
  --entry .design-sync/ds-entry.jsx \
  --out ./ds-bundle
```

## Adding a component

1. Add export to `.design-sync/ds-entry.jsx`
2. Add entry to `componentSrcMap` in `.design-sync/config.json`
3. Re-run build command above
4. Re-sync to project `594e1625-ff39-4084-a946-c99206325d3e`

## Known issues / not verified

- **Floor-card previews only** — Playwright not installed, so `.html` previews are synthetic floor cards (no screenshot). Rich previews would require `npm install -D playwright` + re-sync.
- Dashboard components that use page-level `<style>` blocks (e.g. `tile-foot-action-btn`) won't have those styles in standalone previews — expected; use inline style overrides in designs.
- GSAP (used by `HeroHeadline`) is shimmed via the bundle and should animate in design context when the full React runtime is present.

## Project URL

https://claude.ai/design/p/594e1625-ff39-4084-a946-c99206325d3e
