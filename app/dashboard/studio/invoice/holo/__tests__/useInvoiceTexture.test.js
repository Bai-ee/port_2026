// Invoice Studio HoloPaper — useInvoiceTexture.js (handoff §4, Lane R).
//
// This file is a React hook ('use client', built on useState/useEffect/
// useRef) — this repo's plain node:test runner has no DOM or React
// renderer (same constraint as useInvoicePresentation.js's own test file:
// "The React hook itself... is verified by hand in a real browser once a
// later phase actually renders it"). All of the hook's actual LOGIC —
// generation-token gating, the debounce scheduler, bounded waits, and the
// "keep the last good texture" shaping of a fallback result — lives in the
// pure, directly-tested exports of invoice-dom-snapshot.js (see that file's
// own test file); this hook is a thin React orchestration layer on top of
// those pure pieces.
//
// What IS safe and useful to check here, without a DOM: importing the
// module must not throw (proves clean ESM import — merely importing
// '../useInvoiceTexture.js' pulls in 'react', which is a plain npm
// dependency with no DOM requirement at module-load time; only calling the
// hook itself would need a component tree), the documented status
// vocabulary is exactly right, and — mirroring the H0 precedent in
// __tests__/presentation-seam.test.js — a light source-content check that
// this lane stayed inside its ownership (no import of any file owned by
// Lane S or the H2 integration phase).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useInvoiceTexture, TEXTURE_STATUS, default as defaultExport } from '../useInvoiceTexture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('module imports cleanly and exports the documented shape', () => {
  assert.equal(typeof useInvoiceTexture, 'function');
  assert.equal(defaultExport, useInvoiceTexture);
});

test('TEXTURE_STATUS mirrors useInvoicePresentation.js\'s SCENE_STATUS vocabulary exactly', () => {
  assert.deepEqual(Object.values(TEXTURE_STATUS).sort(), ['fallback', 'idle', 'loading', 'ready']);
  assert.equal(TEXTURE_STATUS.IDLE, 'idle');
  assert.equal(TEXTURE_STATUS.LOADING, 'loading');
  assert.equal(TEXTURE_STATUS.READY, 'ready');
  assert.equal(TEXTURE_STATUS.FALLBACK, 'fallback');
});

test('ownership boundary: this lane\'s hook only ever imports react + its own invoice-dom-snapshot.js sibling', () => {
  // Scoped to actual import SPECIFIERS (not a whole-file text search) —
  // this file's own header comments legitimately name InvoiceCanvas.jsx and
  // friends in prose (documenting the LATER integration this hook is built
  // for), so a blunt whole-source substring search would false-positive on
  // its own documentation. Import specifiers are the only thing that
  // actually matters for the ownership boundary.
  const source = fs.readFileSync(path.join(__dirname, '../useInvoiceTexture.js'), 'utf8');
  const specifiers = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, 'expected at least one import in the file');
  const nonReactSpecifiers = specifiers.filter((s) => s !== 'react');
  assert.deepEqual(nonReactSpecifiers, ['./invoice-dom-snapshot.js']);
});
