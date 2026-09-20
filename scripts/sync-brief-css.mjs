#!/usr/bin/env node
// features/scout-intake/brief-css.js is GENERATED — a client-safe ESM mirror of
// features/scout-intake/brief-css.cjs (the source of truth, still consumed
// unchanged by its 4 existing server-side CommonJS-context callers). Edit the
// .cjs, then re-run this script (node scripts/sync-brief-css.mjs). Never
// hand-edit the .js mirror — it is overwritten on every sync, and a
// drift-guard test (features/invoices/__tests__/brief-css-drift.test.js)
// fails the suite if the two ever diverge.
//
// Why a mirror exists at all: features/invoices/render.js needs the same
// BRIEF_CSS string, but it must stay import-clean enough to run in a public
// client bundle (the Invoice Studio tool), and a client bundle cannot follow
// createRequire()/require(). Mirrors the lib/gbpReputationReport.js idiom
// (a precomputed ESM copy of CommonJS analyzer output, kept in sync by a
// test) and the public/edittrax-player/ generated-copy idiom in
// scripts/sync-edittrax-player.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SRC = path.join(repoRoot, 'features', 'scout-intake', 'brief-css.cjs');
// The mirror deliberately lives in features/invoices/, NOT beside its source in
// features/scout-intake/: that directory's package.json pins "type":"commonjs",
// which forced the mirror to be CJS and made webpack's react-refresh loader fail
// with "Cannot use 'import.meta' outside a module" the moment a client component
// imported render.js — taking down every route, not just the Studio. The repo
// root is "type":"module", so a mirror here is real ESM and bundles cleanly.
const DEST = path.join(repoRoot, 'features', 'invoices', 'brief-css.js');

function loadBriefCss() {
  const require = createRequire(pathToFileURL(SRC));
  const resolved = require.resolve(SRC);
  // Bust the require cache so repeat runs in the same process (tests,
  // watch scripts) pick up an edited .cjs instead of a stale cached module.
  delete require.cache[resolved];
  const mod = require(SRC);
  return mod.BRIEF_CSS;
}

function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source not found: ${SRC}`);
  }

  const BRIEF_CSS = loadBriefCss();
  if (typeof BRIEF_CSS !== 'string' || !BRIEF_CSS.trim()) {
    throw new Error(`brief-css.cjs did not export a non-empty BRIEF_CSS string (got ${typeof BRIEF_CSS}).`);
  }

  const banner = `// GENERATED FILE — DO NOT HAND-EDIT.
// Client-importable mirror of features/scout-intake/brief-css.cjs, produced by
// scripts/sync-brief-css.mjs. The .cjs stays the source of truth for its 4
// server-side CommonJS consumers (app/api/dashboard/brief-preview/route.js,
// features/leadgen/estimate-renderer.js, features/scout-intake/brief-renderer.js,
// app/preview/invoice/page.jsx). This mirror exists solely so
// features/invoices/render.js can pull in the same CSS string via a plain,
// static \`import { BRIEF_CSS } from './brief-css.js'\` — no createRequire(),
// no runtime require() call — either of which a client bundle cannot follow.
//
// It lives HERE, in features/invoices/, and not beside its source: the
// features/scout-intake/ package.json pins "type":"commonjs", which forced an
// earlier version of this mirror to be CJS. Webpack's react-refresh loader then
// failed on it with "Cannot use 'import.meta' outside a module" as soon as a
// client component imported render.js — and that took down EVERY route, not
// just the Studio. The repo root is "type":"module", so this file is real ESM
// and bundles cleanly on both the server and the client.
//
// To change the CSS: edit brief-css.cjs, then run
//   node scripts/sync-brief-css.mjs
// A drift-guard test (features/invoices/__tests__/brief-css-drift.test.js)
// fails the suite if this file and the .cjs ever diverge.
`;

  // JSON.stringify round-trips the CSS string byte-for-byte (quotes,
  // backslashes, newlines, any stray backtick) as a single-line JS string
  // literal — safer than re-wrapping it in a template literal by hand.
  const out = `${banner}\nexport const BRIEF_CSS = ${JSON.stringify(BRIEF_CSS)};\n`;

  fs.writeFileSync(DEST, out, 'utf8');
  console.log(`Synced ${path.relative(repoRoot, SRC)} -> ${path.relative(repoRoot, DEST)} (${BRIEF_CSS.length} chars)`);
}

main();
