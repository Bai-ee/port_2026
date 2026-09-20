// HoloPaper handoff H2 — integration wiring (docs/plans/
// INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §6). This repo's node:test has no
// DOM/jsdom (see numbering-reservation-contract.test.js and
// presentation-seam.test.js for the same precedent), so these are
// static-source-content assertions for the wiring H2 added: InvoiceCanvas's
// lazy-loaded Holo surface + texture pipeline, the iframe inert/aria-hidden
// wiring, the H8 lazy-load boundary, the H14 render-options guard, and
// CoverCard's new Holo/Interact/Reset-View controls. Real interaction
// (visual rendering, drag/orbit, mode switching) is verified in a real
// browser separately — see this lane's final report for what was observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoiceDir = path.resolve(__dirname, '../..');

function readSource(relPath) {
  return fs.readFileSync(path.join(invoiceDir, relPath), 'utf8');
}

// ── InvoiceStudio.jsx: presentation prop wiring to InvoiceCanvas ──────────

test('InvoiceStudio.jsx passes presentation.presentation (not the full hook return) to InvoiceCanvas', () => {
  const source = readSource('InvoiceStudio.jsx');
  assert.match(source, /<InvoiceCanvas[\s\S]*?presentation=\{presentation\.presentation\}[\s\S]*?\/>/);
});

test('InvoiceStudio.jsx passes setSceneStatus and setSceneInteractive to InvoiceCanvas', () => {
  const source = readSource('InvoiceStudio.jsx');
  assert.match(source, /<InvoiceCanvas[\s\S]*?setSceneStatus=\{presentation\.setSceneStatus\}[\s\S]*?\/>/);
  assert.match(source, /<InvoiceCanvas[\s\S]*?setSceneInteractive=\{presentation\.setSceneInteractive\}[\s\S]*?\/>/);
});

test('InvoiceStudio.jsx still passes the full presentation object to InvoiceRail (unchanged H0 wiring)', () => {
  const source = readSource('InvoiceStudio.jsx');
  assert.match(source, /<InvoiceRail[\s\S]*?presentation=\{presentation\}[\s\S]*?\/>/);
});

// ── InvoiceCanvas.jsx: H8 lazy-load boundary ───────────────────────────────
//
// Post-integration fix (orchestrator, after H2's own diff): a plain
// `useInvoiceTexture()` call cannot itself be deferred without breaking the
// Rules of Hooks, so the hook call was moved into its own component
// (InvoiceHoloOverlay.jsx) that InvoiceCanvas.jsx reaches ONLY via
// `lazy(() => import('./holo/InvoiceHoloOverlay'))` — this keeps BOTH the
// snapshot pipeline (Lane R) and the Three.js scene (Lane S) out of
// InvoiceCanvas.jsx's own static import graph, satisfying H8's literal
// "...or snapshot code" wording, not just the three/three-stdlib half of it.

test('InvoiceCanvas.jsx reaches the Holo overlay only through React.lazy, never a static import of the surface or texture hook', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(
    source,
    /const InvoiceHoloOverlayLazy = lazy\(\(\) => import\('\.\/holo\/InvoiceHoloOverlay'\)\);/,
    'the Holo overlay must be reached via lazy(() => import(...)), not a static top-of-file import',
  );
  assert.ok(
    !/^import\s+InvoiceHoloSurface\s+from/m.test(source),
    'InvoiceCanvas.jsx must not statically default-import InvoiceHoloSurface.jsx',
  );
  assert.ok(
    !/^import\s*\{\s*useInvoiceTexture\s*\}\s*from/m.test(source),
    'InvoiceCanvas.jsx must not statically import useInvoiceTexture — that call now lives inside the lazy-loaded InvoiceHoloOverlay',
  );
});

test('InvoiceCanvas.jsx never statically imports three/three-stdlib itself', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.ok(!/from ['"]three['"]/.test(source), 'no direct three import');
  assert.ok(!/from ['"]three-stdlib['"]/.test(source), 'no direct three-stdlib import');
});

test('InvoiceCanvas.jsx renders the lazy Holo overlay only inside a Suspense boundary, gated on holoEnabled', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /\{holoEnabled && hasLoadedOnce \? \(/);
  assert.match(source, /<Suspense fallback=\{null\}>[\s\S]*?<InvoiceHoloOverlayLazy/);
});

test('InvoiceHoloOverlay.jsx (the lazy-loaded wrapper) owns the actual useInvoiceTexture() call, unconditionally enabled', () => {
  const source = readSource('holo/InvoiceHoloOverlay.jsx');
  assert.match(source, /import \{ useInvoiceTexture \} from '\.\/useInvoiceTexture\.js';/);
  assert.match(source, /import InvoiceHoloSurface from '\.\/InvoiceHoloSurface';/);
  assert.match(source, /const \{ texture \} = useInvoiceTexture\(iframeEl, \{/);
  assert.match(source, /enabled:\s*true/);
});

// ── InvoiceCanvas.jsx: texture pipeline wiring (refreshKey/loadTick only —
// the hook call itself lives in InvoiceHoloOverlay.jsx, see above) ─────────

test('InvoiceCanvas.jsx builds a refreshKey from structureKey and a bridge-edit tick, plus an independent loadTick, and forwards both to the overlay', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /const refreshKey = `\$\{structureKey\}::\$\{bridgeEditTick\}`;/);
  assert.match(source, /const \[loadTick, setLoadTick\] = useState\(0\);/);
  assert.match(source, /setLoadTick\(\(t\) => t \+ 1\);/);
  assert.match(source, /<InvoiceHoloOverlayLazy[\s\S]*?refreshKey=\{refreshKey\}[\s\S]*?loadTick=\{loadTick\}[\s\S]*?\/>/);
});

test('InvoiceCanvas.jsx observes the live iframe document for bridge-driven value edits (no new draft prop threaded down)', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /new MutationObserver\(scheduleBump\)/);
  assert.match(source, /observer\.observe\(doc\.body, \{ subtree: true, childList: true, characterData: true \}\)/);
  // P3's own contract: this component reads/writes no invoice fields and
  // takes no `draft` prop — confirm H2 kept that true.
  assert.ok(!/\bdraft\s*[,)]/.test(source.split('\n').find((l) => l.includes('const InvoiceCanvas = forwardRef')) || ''));
});

// ── InvoiceCanvas.jsx: inert/aria-hidden + overlay pointer-events (H5/H6) ──

test('InvoiceCanvas.jsx marks the iframe inert + aria-hidden only while interaction is on', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /inert=\{holoInteractive \? true : undefined\}/);
  assert.match(source, /aria-hidden=\{holoInteractive \? 'true' : undefined\}/);
});

test('InvoiceCanvas.jsx never remounts the iframe when toggling interaction (srcDoc keyed only on docHtml)', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /srcDoc=\{docHtml\}/);
  assert.ok(!/key=\{.*holoInteractive/.test(source), 'iframe must not be keyed on holoInteractive (would force a remount)');
});

test('InvoiceCanvas.jsx overlay is pointer-events:none non-interactive and auto while interactive', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /pointerEvents: holoInteractive \? 'auto' : 'none'/);
});

// ── InvoiceCanvas.jsx: H14 — Holo state never reaches the renderer ─────────

test('InvoiceCanvas.jsx never adds presentation to the renderInvoiceDocument() options or its effect deps', () => {
  const source = readSource('InvoiceCanvas.jsx');
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*try \{\s*const result = renderInvoiceDocument\(invoice, \{[\s\S]*?\}\);[\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(effectMatch, 'could not locate the renderInvoiceDocument render effect');
  const [fullEffect, deps] = effectMatch;
  assert.ok(!/presentation/i.test(fullEffect), 'render effect body/options must never reference presentation');
  assert.ok(!/presentation/i.test(deps), 'render effect deps must never include presentation');
});

test('InvoiceCanvas.jsx handleDownloadHtml strips only the pre-existing bridge scaffolding, no Holo artifacts added', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /handleDownloadHtml/);
  assert.ok(!/invoice-studio-holo-overlay/.test(source.match(/const handleDownloadHtml[\s\S]*?\}, \[docHtml, invoice\]\);/)?.[0] || ''));
});

// ── H16: WebGL fallback forces interaction off ─────────────────────────────

test('InvoiceCanvas.jsx forces sceneInteractive off and reports fallback status on InvoiceHoloSurface onFallback', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /const handleHoloFallback = useCallback\(\(\) => \{[\s\S]*?setSceneStatus\('fallback'\)[\s\S]*?setSceneInteractive\(false\)[\s\S]*?\}, \[setSceneStatus, setSceneInteractive\]\);/);
});

// ── Reduced motion + visibility/offscreen pause wiring ─────────────────────

test("InvoiceCanvas.jsx reads prefers-reduced-motion and forwards it to the Holo surface", () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(source, /reducedMotion=\{reducedMotion\}/);
});

test('InvoiceCanvas.jsx pauses on tab-hidden (Page Visibility) and computes an active flag for the Holo surface', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /const holoActive = tabVisible && inViewport;/);
  assert.match(source, /active=\{holoActive\}/);
});

test('InvoiceCanvas.jsx observes the paper shell for offscreen-while-visible pausing', () => {
  const source = readSource('InvoiceCanvas.jsx');
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /paperShellRef/);
});

// ── CoverCard.jsx: the new Holo/Interact/Reset-View subsection ────────────

test('CoverCard.jsx renders the Holo Paper subsection below Design with a stable DOM id', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /id="invoice-rail-cover-holo-section"/);
  // Below Design, not above/inside it.
  const designIdx = source.indexOf('invoice-rail-cover-theme-section');
  const holoIdx = source.indexOf('invoice-rail-cover-holo-section');
  assert.ok(designIdx > -1 && holoIdx > designIdx, 'Holo section must be declared after the Design/theme section');
});

test('CoverCard.jsx wires Holo Paper On/Off through setHoloEnabled', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /label="Holo Paper"/);
  assert.match(source, /if \(typeof setHoloEnabled === 'function'\) setHoloEnabled\(v === 'on'\);/);
});

test('CoverCard.jsx disables Interact with Paper while Holo is off (visually and functionally)', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /id="invoice-rail-cover-holo-interact-row"/);
  assert.match(source, /aria-disabled=\{!holoEnabled\}/);
  assert.match(source, /pointerEvents: holoEnabled \? 'auto' : 'none'/);
  assert.match(source, /if \(!holoEnabled \|\| typeof setSceneInteractive !== 'function'\) return;/);
});

test('CoverCard.jsx shows Reset View only while interaction is on, wired to bumpResetView', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /\{holoEnabled && sceneInteractive \? \(/);
  assert.match(source, /id="invoice-rail-cover-holo-reset-view-btn"/);
  assert.match(source, /if \(typeof bumpResetView === 'function'\) bumpResetView\(\);/);
});

test('CoverCard.jsx carries the plain-language interaction note', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /Turn it off to edit text on the paper\./);
});

test('CoverCard.jsx reads the full useInvoicePresentation() return shape, not just the inner state object', () => {
  const source = readSource('rail/CoverCard.jsx');
  assert.match(source, /const holoState = \(presentation && presentation\.presentation\) \|\| null;/);
  assert.match(source, /presentation && presentation\.setHoloEnabled/);
  assert.match(source, /presentation && presentation\.setSceneInteractive/);
  assert.match(source, /presentation && presentation\.bumpResetView/);
});

// ── InvoiceRail.jsx: verify no change was needed ───────────────────────────

test('InvoiceRail.jsx is untouched by H2 — still forwards presentation uniformly through the one shared CardComponent loop', () => {
  const source = readSource('rail/InvoiceRail.jsx');
  assert.match(source, /presentation\s*=\s*null,/);
  // One shared render call for every section card (including Cover) — no
  // separate/special JSX branch just for CoverCard's presentation prop, and
  // no second/conditional <CoverCard .../> element anywhere in the file.
  assert.match(source, /<CardComponent[\s\S]*?presentation=\{presentation\}[\s\S]*?\/>/);
  assert.ok(!/<CoverCard\b/.test(source), 'InvoiceRail.jsx must not render a dedicated <CoverCard> element outside the shared CardComponent loop');
});
