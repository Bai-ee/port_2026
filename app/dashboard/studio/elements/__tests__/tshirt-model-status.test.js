import test from 'node:test';
import assert from 'node:assert/strict';
import { tshirtModelLoadStatusView } from '../tshirt-model-status.js';

// Pure Inspector-view logic for tshirt-model's async load state (Codex P1
// review, Part B round 2). Tested directly (no JSX/DOM render environment
// exists in this repo — npm test's glob only picks up .test.{js,mjs}) so
// the actual decisions StudioElementInspector.jsx's LoadStatusBanner makes
// are provably correct: what's visible, what the message says, and —
// critically — that Retry is only ever offered in the 'error' state, never
// while a request is already in flight.

test('no loadStatus at all (nothing ever reported, or no tshirt-model selected) renders nothing', () => {
  assert.deepEqual(tshirtModelLoadStatusView(undefined), { visible: false });
  assert.deepEqual(tshirtModelLoadStatusView(null), { visible: false });
});

test("'idle' renders nothing — nothing has happened yet, no explanation needed", () => {
  assert.deepEqual(tshirtModelLoadStatusView({ state: 'idle', error: null }), { visible: false });
});

test("'loaded' renders nothing — a working model needs no banner", () => {
  assert.deepEqual(tshirtModelLoadStatusView({ state: 'loaded', error: null }), { visible: false });
});

test("'disposed' renders nothing — the element is gone, there's nothing to show a status for", () => {
  assert.deepEqual(tshirtModelLoadStatusView({ state: 'disposed', error: null }), { visible: false });
});

test("'loading' shows a restrained status line and NEVER offers Retry", () => {
  const view = tshirtModelLoadStatusView({ state: 'loading', error: null });
  assert.equal(view.visible, true);
  assert.equal(view.kind, 'loading');
  assert.equal(view.message, 'Loading 3D T-shirt…');
  assert.notEqual(view.showRetry, true, 'a Retry action must never be offered while a request is already in flight');
});

test("'error' with a message shows it verbatim and offers Retry", () => {
  const view = tshirtModelLoadStatusView({ state: 'error', error: 'network down' });
  assert.equal(view.visible, true);
  assert.equal(view.kind, 'error');
  assert.equal(view.message, 'Model failed to load: network down');
  assert.equal(view.showRetry, true);
});

test("'error' with no message (e.g. a non-Error rejection) still shows an honest, actionable banner", () => {
  const view = tshirtModelLoadStatusView({ state: 'error', error: null });
  assert.equal(view.visible, true);
  assert.equal(view.kind, 'error');
  assert.equal(view.message, 'Model failed to load.');
  assert.equal(view.showRetry, true);
});
