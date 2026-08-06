import test from 'node:test';
import assert from 'node:assert/strict';
import { getCapabilityState, getCapabilityLabel, CAPABILITY_STATES } from '../capability.js';
import { getElementDefinition } from '../catalog.js';

test('getCapabilityState: glass-petal-sphere is FULL since the Phase 5 glass-parity pass (server art-scene renders the primary glass)', () => {
  const def = getElementDefinition('glass-petal-sphere');
  assert.equal(getCapabilityState(def), CAPABILITY_STATES.FULL);
  assert.equal(getCapabilityLabel(def), null, 'fully supported elements carry no capability badge');
});

test('getCapabilityState: preview-supported + final-render-unsupported -> preview-only', () => {
  const def = { previewSupported: true, finalRenderSupported: false };
  assert.equal(getCapabilityState(def), CAPABILITY_STATES.PREVIEW_ONLY);
  assert.equal(getCapabilityLabel(def), 'PREVIEW ONLY');
});

test('getCapabilityState: previewSupported false -> unsupported-in-preview regardless of finalRenderSupported', () => {
  const def = { previewSupported: false, finalRenderSupported: false };
  assert.equal(getCapabilityState(def), CAPABILITY_STATES.UNSUPPORTED_IN_PREVIEW);
  assert.equal(getCapabilityLabel(def), 'UNSUPPORTED IN PREVIEW');

  const def2 = { previewSupported: false, finalRenderSupported: true };
  assert.equal(getCapabilityState(def2), CAPABILITY_STATES.UNSUPPORTED_IN_PREVIEW);
});

test('getCapabilityState: both supported -> full, no badge label', () => {
  const def = { previewSupported: true, finalRenderSupported: true };
  assert.equal(getCapabilityState(def), CAPABILITY_STATES.FULL);
  assert.equal(getCapabilityLabel(def), null);
});

test('getCapabilityState: missing/unknown definition -> unknown, treated as unsupported for messaging', () => {
  assert.equal(getCapabilityState(null), CAPABILITY_STATES.UNKNOWN);
  assert.equal(getCapabilityLabel(null), 'UNSUPPORTED IN PREVIEW');
});
