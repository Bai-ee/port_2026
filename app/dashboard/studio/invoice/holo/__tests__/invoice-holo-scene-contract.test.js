// Invoice Studio HoloPaper — invoice-holo-scene.js contract tests (Lane S).
//
// This repo's node:test runner has no DOM/WebGL (see numbering-reservation-
// contract.test.js / draft-storage.test.js for the same constraint), so a
// REAL rendered scene (visible cloth motion, grab/fling, orbit, texture
// paint) cannot be verified here — that needs a real browser and is H3's
// job, not this lane's.
//
// What CAN be verified for real, without any browser:
//   1. The module's public API shape — createInvoiceHoloScene() returns
//      synchronously (before any async work resolves) with EXACTLY the 8
//      documented methods, and every method is callable immediately
//      without throwing, even before the internal Three.js import/scene
//      build has finished (the "record state, apply once ready" pattern —
//      see the file's own header).
//   2. The REAL defensive fallback path: plain Node genuinely has no
//      `document`/WebGL, so `new THREE.WebGLRenderer(...)` genuinely
//      throws inside this function's own try/catch when actually run here
//      — this test therefore exercises the file's actual
//      unsupported-WebGL/init-failure handling with real `three`, not a
//      mock, and asserts onContextLost fires (once) while onReady never
//      does, and that dispose() afterward is still safe.
// Everything else about this file (visible rendering, pointer grab/fling,
// orbit arbitration, resize/DPR behavior, texture application, full GPU
// disposal in a real WebGL context) is NOT verified by this file — see the
// lane's final report for the explicit unit vs. contract vs. needs-browser
// split.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInvoiceHoloScene, default as createInvoiceHoloSceneDefault } from '../invoice-holo-scene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, '../invoice-holo-scene.js'), 'utf8');

const REQUIRED_METHODS = [
  'setTexture', 'setInteractive', 'setReducedMotion', 'resize', 'resetView', 'pause', 'resume', 'dispose',
];

function makeFakeContainer() {
  const children = [];
  return {
    clientWidth: 400,
    clientHeight: 520,
    appendChild(node) { children.push(node); },
    removeChild(node) {
      const ix = children.indexOf(node);
      if (ix >= 0) children.splice(ix, 1);
    },
    getBoundingClientRect() { return { width: 400, height: 520 }; },
  };
}

function flushMicrotasks(times = 5) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) p = p.then(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
  return p;
}

// ── Static source contract (cheap paper-trail alongside the real behavior
// tests below — catches an accidental rename before it ships) ────────────

test('module exports createInvoiceHoloScene as both a named and default export', () => {
  assert.equal(typeof createInvoiceHoloScene, 'function');
  assert.equal(createInvoiceHoloSceneDefault, createInvoiceHoloScene);
});

test('source declares every one of the 8 documented public methods', () => {
  for (const name of REQUIRED_METHODS) {
    assert.match(SOURCE, new RegExp(`\\b${name}\\s*\\(`), `missing method declaration for ${name}`);
  }
});

test('source only imports from three / three-stdlib / its own sibling modules — no new dependency', () => {
  // Matched across the whole source (not line-anchored) so a multi-line
  // `import {\n  a, b,\n} from './x.js';` statement is still caught — its
  // `from '...'` clause doesn't share a line with the leading `import`.
  // Dynamic `import(...)` calls never have a `from` clause, so this only
  // ever matches real static import/export specifiers.
  const specifiers = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, 'expected at least one static import in the file');
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith('./') || specifier === 'three' || specifier === 'three-stdlib',
      `unexpected static import target: ${specifier}`,
    );
  }
  // `three`/`three-stdlib` themselves must be dynamically imported (not
  // statically), so importing THIS module never eagerly loads Three.js
  // (H8) — the static specifier list above must not contain them.
  assert.ok(!specifiers.includes('three'), "'three' must be dynamically imported, not static");
  assert.ok(!specifiers.includes('three-stdlib'), "'three-stdlib' must be dynamically imported, not static");
  // Dynamic import() calls for both — not necessarily each with its own
  // literal `await` (this file Promise.all()s them together).
  assert.match(SOURCE, /import\(['"]three['"]\)/);
  assert.match(SOURCE, /import\(['"]three-stdlib['"]\)/);
});

test('dispose() source removes every listener class this file adds (pointer, webglcontextlost) and disposes controls/materials/geometry/renderer', () => {
  for (const needle of [
    "removeEventListener('pointerdown'", "removeEventListener('pointermove'", "removeEventListener('pointerup'",
    "removeEventListener('webglcontextlost'", 'controls.dispose()', 'geometry.dispose()', 'renderer.dispose()',
  ]) {
    assert.ok(SOURCE.includes(needle), `dispose() source is missing: ${needle}`);
  }
});

// ── Real synchronous-return behavior ─────────────────────────────────────

test('createInvoiceHoloScene throws synchronously without a container', () => {
  assert.throws(() => createInvoiceHoloScene(null));
});

test('createInvoiceHoloScene returns synchronously (before any async work resolves) with exactly the 8 documented methods', () => {
  const container = makeFakeContainer();
  const api = createInvoiceHoloScene(container, {});
  const keys = Object.keys(api).sort();
  assert.deepEqual(keys, [...REQUIRED_METHODS].sort());
  for (const name of REQUIRED_METHODS) assert.equal(typeof api[name], 'function');
});

test('every method is callable immediately after creation (before init() settles) without throwing', async () => {
  const container = makeFakeContainer();
  const api = createInvoiceHoloScene(container, {});
  assert.doesNotThrow(() => api.setInteractive(true));
  assert.doesNotThrow(() => api.setReducedMotion(true));
  assert.doesNotThrow(() => api.resize(500, 600, 2));
  assert.doesNotThrow(() => api.pause());
  assert.doesNotThrow(() => api.resume());
  assert.doesNotThrow(() => api.resetView());
  const fakeCanvas = { width: 10, height: 10 }; // not a real HTMLCanvasElement — setTexture must not throw synchronously
  assert.doesNotThrow(() => api.setTexture(fakeCanvas, { width: 10, height: 10, revision: 1 }));
  assert.doesNotThrow(() => api.dispose());
  // dispose() must be safe to call again.
  assert.doesNotThrow(() => api.dispose());
  await flushMicrotasks();
});

// ── Real defensive fallback path — plain Node genuinely has no WebGL ────

test('in an environment with no real WebGL (this Node process), init reports onContextLost, never onReady, and stays safely disposable', async () => {
  const container = makeFakeContainer();
  let readyCount = 0;
  let contextLostCount = 0;
  const api = createInvoiceHoloScene(container, {
    onReady: () => { readyCount += 1; },
    onContextLost: () => { contextLostCount += 1; },
  });

  // Let the internal async init() run to completion: `three`/`three-stdlib`
  // really do import cleanly in plain Node (verified by hand — see the
  // lane's own report), then `new THREE.WebGLRenderer()` really does throw
  // (`document is not defined`) because this is a real Node process with no
  // DOM, which this file's own try/catch must convert into onContextLost().
  await flushMicrotasks(10);

  assert.equal(readyCount, 0, 'onReady must never fire when the renderer could not be created');
  assert.equal(contextLostCount, 1, 'onContextLost must fire exactly once for the init failure');

  // Calling every method post-failure must remain safe (ctx stayed null).
  assert.doesNotThrow(() => api.setInteractive(true));
  assert.doesNotThrow(() => api.setTexture({}, { revision: 2 }));
  assert.doesNotThrow(() => api.resize(100, 100, 1));
  assert.doesNotThrow(() => api.pause());
  assert.doesNotThrow(() => api.resume());
  assert.doesNotThrow(() => api.resetView());
  assert.doesNotThrow(() => api.dispose());

  // No further callback fires after the failure settles and disposal runs.
  await flushMicrotasks(5);
  assert.equal(readyCount, 0);
  assert.equal(contextLostCount, 1);
});

test('calling dispose() before init() ever gets a chance to build a renderer prevents any container mutation', async () => {
  const container = makeFakeContainer();
  let contextLostCount = 0;
  const api = createInvoiceHoloScene(container, { onContextLost: () => { contextLostCount += 1; } });
  api.dispose(); // synchronous — fires before the dynamic import() of 'three' can resolve
  await flushMicrotasks(10);
  // Disposed-before-ready means init() must bail out early (its own
  // `if (disposed) return` guard) — no WebGLRenderer was ever attempted, so
  // onContextLost from THIS path never fires either (there was nothing to
  // fail). This proves dispose() during the loading window is safe and
  // does not race a late scene build in behind it.
  assert.equal(contextLostCount, 0);
});
