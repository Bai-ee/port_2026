// Static guarantees about the Studio components (no DOM needed): token hygiene,
// locked chrome, imports that resolve, ids the e2e scenarios rely on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_NAMES } from '../../theme/index.js';
import { STUDIO_CHROME_TOKENS } from '../chrome-tokens.js';
import { STUDIO_CSS, PREVIEW_CSS } from '../../../components/theme-studio/studio-chrome-css.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); } else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const sources = [...walk(path.join(root, 'components/theme-studio')), ...walk(path.join(root, 'lib/theme-studio'))];
const read = (f) => fs.readFileSync(f, 'utf8');
const allText = sources.map((f) => [f, read(f)]);

test('every --t-* token referenced by the Studio exists in the manifest', () => {
  const known = new Set(TOKEN_NAMES);
  const missing = [];
  for (const [f, text] of allText) {
    for (const m of text.matchAll(/--t-[a-z0-9-]+/g)) if (!known.has(m[0])) missing.push(`${path.relative(root, f)}: ${m[0]}`);
  }
  assert.deepEqual(missing, []);
});

test('inspector chrome CSS never reads --t-*, only locked --ts-* tokens', () => {
  assert.doesNotMatch(STUDIO_CSS, /--t-[a-z]/);
  const defined = new Set([...Object.keys(STUDIO_CHROME_TOKENS), '--ts-radius', '--ts-radius-sm', '--ts-font', '--ts-mono', '--ts-track']);
  for (const m of STUDIO_CSS.matchAll(/var\((--ts-[a-z0-9-]+)/g)) assert.ok(defined.has(m[1]), `undefined ${m[1]}`);
});

test('the chrome has no literal colors of its own beyond the locked token declarations', () => {
  const body = STUDIO_CSS.split('\n').filter((l) => !l.includes('--ts-')).join('\n');
  // Allowed: the translucent scrim and the system keywords for forced-colors mode.
  const stripped = body.replace(/rgba\(0, 0, 0, 0\.38\)/g, '').replace(/\b(CanvasText|transparent)\b/g, '');
  assert.doesNotMatch(stripped, /#[0-9a-fA-F]{3,8}\b/);
});

test('the sample preview only uses real --t-* tokens (and the chrome font)', () => {
  const used = [...PREVIEW_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 40);
  for (const u of used) assert.ok(TOKEN_NAMES.includes(u) || u === '--ts-font' || u === '--ts-mono', u);
});

test('relative imports resolve to real files', () => {
  const bad = [];
  for (const [f, text] of allText) {
    for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(f), m[1]);
      if (!fs.existsSync(target)) bad.push(`${path.relative(root, f)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no second canvas or scene engine, no framework coupling, no conformance claims', () => {
  for (const [f, text] of allText) {
    const rel = path.relative(root, f);
    assert.doesNotMatch(text, /<canvas|from 'three'|@react-three/, `${rel} must not create canvases`);
    assert.doesNotMatch(text, /from 'next\//, `${rel} must stay framework-free`);
    assert.doesNotMatch(text, /WCAG[- ]compliant|fully accessible|passes WCAG/i, rel);
  }
});

test('stable DOM ids used by the e2e scenarios exist', () => {
  const joined = allText.map(([, t]) => t).join('\n');
  for (const id of [
    'theme-studio-root', 'theme-studio-drawer', 'theme-studio-heading', 'theme-studio-header', 'theme-studio-close',
    'theme-studio-undo', 'theme-studio-redo', 'theme-studio-save', 'theme-studio-master-hue', 'theme-studio-master-intensity',
    'theme-studio-editing-switch', 'theme-studio-preview-switch', 'theme-studio-live-region', 'theme-studio-scroll',
    'theme-studio-export-status', 'theme-studio-import-text', 'theme-studio-reset-draft', 'theme-studio-compare-panes',
    'theme-studio-neutral-strength',
  ]) assert.ok(joined.includes(id), id);
});

test('the dialog is labelled, the drawer is non-modal and the sheet is modal', () => {
  const shell = read(path.join(root, 'components/theme-studio/ThemeStudioShell.jsx'));
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /aria-labelledby="theme-studio-heading"/);
  assert.match(shell, /aria-modal=\{mobile \? 'true' : 'false'\}/);
  assert.match(shell, /overflow = 'hidden'/);
  assert.match(shell, /trapNextIndex/);
});

test('every range input goes through the shared slider (labels, valuetext, keyboard)', () => {
  for (const [f, text] of allText) {
    if (f.endsWith('LabeledSlider.jsx')) continue;
    assert.doesNotMatch(text, /type="range"/, `${path.relative(root, f)} must use LabeledSlider`);
  }
  const slider = read(path.join(root, 'components/theme-studio/controls/LabeledSlider.jsx'));
  assert.match(slider, /aria-valuetext/);
  assert.match(slider, /sliderKeyStep/);
  assert.match(slider, /htmlFor=\{id\}/);
});

test('ThemeStudio default export accepts the props ThemeStudioMount passes', () => {
  const entry = read(path.join(root, 'components/theme-studio/ThemeStudio.jsx'));
  assert.match(entry, /export default function ThemeStudio/);
  assert.match(entry, /onClose/);
  assert.match(entry, /launcherId/);
});
