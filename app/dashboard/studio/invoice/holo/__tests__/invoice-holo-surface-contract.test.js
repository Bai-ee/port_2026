// Invoice Studio HoloPaper — InvoiceHoloSurface.jsx static contract tests
// (Lane S). Plain node:test has no JSX transform/DOM, so this file cannot
// be imported and rendered directly here (same constraint as every other
// Studio JSX file in this repo's suite — see numbering-reservation-
// contract.test.js for the established fs.readFileSync + assertion
// pattern, reused below). A real mount/unmount/fallback-rendering pass
// needs a real browser and is explicitly NOT claimed by this file — see
// the lane's own final report for the unit vs. contract vs. needs-browser
// split.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, '../InvoiceHoloSurface.jsx'), 'utf8');

test('exports a default function component named InvoiceHoloSurface', () => {
  assert.match(SOURCE, /export default function InvoiceHoloSurface\(/);
});

test('never imports InvoiceCanvas/InvoiceStudio/InvoiceRail/CoverCard/useInvoiceDraft/useInvoicePresentation — stays self-contained per the ownership boundary', () => {
  // Matches an actual import specifier path or JSX tag usage, not a prose
  // comment explaining the boundary itself (this file's own header names
  // all six precisely because it must NOT import them — mirrors
  // numbering-reservation-contract.test.js's own "match usage, not prose"
  // pattern). Anchored to a single `from '...'` string / `<Tag` so it can't
  // accidentally bridge across unrelated lines the way a `[^;]*` span can.
  for (const forbidden of [
    'InvoiceCanvas', 'InvoiceStudio', 'InvoiceRail', 'CoverCard', 'useInvoiceDraft', 'useInvoicePresentation',
  ]) {
    const importPathPattern = new RegExp(`from\\s+['"][^'"]*${forbidden}[^'"]*['"]`);
    const jsxPattern = new RegExp(`<${forbidden}[\\s/>]`);
    assert.ok(!importPathPattern.test(SOURCE), `must not import a module path referencing ${forbidden}`);
    assert.ok(!jsxPattern.test(SOURCE), `must not render <${forbidden}>`);
  }
});

test('dynamically imports invoice-holo-scene.js (never a static top-of-file import) so Standard mode never pays the Three.js cost', () => {
  assert.ok(!/^import .*invoice-holo-scene/m.test(SOURCE), 'must not statically import invoice-holo-scene.js');
  assert.match(SOURCE, /import\(['"]\.\/invoice-holo-scene\.js['"]\)/);
});

test('does not statically import three or three-stdlib itself', () => {
  assert.ok(!/from ['"]three['"]/.test(SOURCE));
  assert.ok(!/from ['"]three-stdlib['"]/.test(SOURCE));
});

test('calls scene.dispose() in the mount effect\'s cleanup function', () => {
  assert.match(SOURCE, /scene\.dispose\(\)/);
});

test('feature-detects WebGL before ever calling createInvoiceHoloScene, and only mounts the scene while supported', () => {
  assert.match(SOURCE, /getContext\(['"]webgl2?['"]\)/);
  assert.match(SOURCE, /createInvoiceHoloScene/);
});

test('renders an honest, visible inline fallback notice (never a blank canvas) for both unsupported WebGL and a reported context loss', () => {
  assert.match(SOURCE, /invoice-holo-surface-fallback/);
  assert.match(SOURCE, /role="status"/);
  assert.ok(SOURCE.includes('unavailable'), 'fallback copy should be honest/visible, not a blank state');
  assert.match(SOURCE, /surfaceStatus === 'unsupported'/);
  assert.match(SOURCE, /surfaceStatus === 'context-lost'/);
});

test('exposes onFallback so a later phase can switch presentation modes on unsupported/context-lost', () => {
  assert.match(SOURCE, /onFallback\s*=\s*null/);
  assert.match(SOURCE, /onFallbackRef\.current\(['"]unsupported['"]\)/);
  assert.match(SOURCE, /onFallbackRef\.current\(['"]context-lost['"]\)/);
});

test('forwards onContextLost from the caller in addition to its own onFallback bookkeeping', () => {
  assert.match(SOURCE, /onContextLost\s*=\s*null/);
  assert.match(SOURCE, /onContextLost\(\)/);
});

test('never adds a document/window-level listener of its own — pointer/resize/context-lost listeners all live in invoice-holo-scene.js', () => {
  assert.ok(!SOURCE.includes('document.addEventListener'));
  assert.ok(!SOURCE.includes('window.addEventListener'));
});

test('the live container carries a stable, descriptive DOM id (not a generic "container"/"wrapper")', () => {
  assert.match(SOURCE, /id="invoice-holo-surface-container"/);
});

test('forwards the texture prop to scene.setTexture keyed on its revision', () => {
  assert.match(SOURCE, /scene\.setTexture\(/);
  assert.match(SOURCE, /texture\.revision/);
});

test('forwards interactive/reducedMotion/active to their matching scene methods', () => {
  assert.match(SOURCE, /\.setInteractive\(/);
  assert.match(SOURCE, /\.setReducedMotion\(/);
  assert.match(SOURCE, /\.pause\(\)/);
  assert.match(SOURCE, /\.resume\(\)/);
});
