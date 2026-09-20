import test from 'node:test';
import assert from 'node:assert/strict';
import { engineUrl, isEngineOffline } from '../loopcore-client.js';

// ── engineUrl ────────────────────────────────────────────────────────────

test('engineUrl: an /api/-prefixed engine route is appended straight onto BASE', () => {
  assert.equal(
    engineUrl('/api/audio?path=services/loopcore/outputs/repair/loop_0000_crossfade.wav'),
    'http://127.0.0.1:8766/api/audio?path=services/loopcore/outputs/repair/loop_0000_crossfade.wav',
  );
});

test('engineUrl: a bare RELATIVE file path is wrapped in ?path=', () => {
  assert.equal(
    engineUrl('services/loopcore/inputs/track.wav'),
    'http://127.0.0.1:8766/api/audio?path=services%2Floopcore%2Finputs%2Ftrack.wav',
  );
});

test('engineUrl: an ABSOLUTE filesystem path (also starts with "/", but is NOT a route) is wrapped in ?path=, not appended to BASE', () => {
  const absPath = '/Users/you/repo/services/loopcore/outputs/loops/loop_0000.wav';
  const url = engineUrl(absPath);
  assert.equal(url, `http://127.0.0.1:8766/api/audio?path=${encodeURIComponent(absPath)}`);
  // The historical bug: treating any leading "/" as "already a route" would
  // instead produce this broken, doubled-up URL.
  assert.notEqual(url, `http://127.0.0.1:8766${absPath}`);
});

test('engineUrl: empty/nullish input degrades to an empty path= query, never throws', () => {
  assert.equal(engineUrl(''), 'http://127.0.0.1:8766/api/audio?path=');
  assert.equal(engineUrl(null), 'http://127.0.0.1:8766/api/audio?path=');
  assert.equal(engineUrl(undefined), 'http://127.0.0.1:8766/api/audio?path=');
});

// ── isEngineOffline ──────────────────────────────────────────────────────

test('isEngineOffline: true for a TypeError (fetch\'s own network-failure type)', () => {
  assert.equal(isEngineOffline(new TypeError('Failed to fetch')), true);
});

test('isEngineOffline: true for known offline-shaped messages regardless of error type', () => {
  assert.equal(isEngineOffline(new Error('NetworkError when attempting to fetch resource')), true);
  assert.equal(isEngineOffline(new Error('Load failed')), true);
  assert.equal(isEngineOffline({ message: 'failed to fetch' }), true);
});

test('isEngineOffline: false for a real analysis/application error', () => {
  assert.equal(isEngineOffline(new Error('engine analyze failed (500)')), false);
  assert.equal(isEngineOffline(new Error('no manifest.json yet, run /api/slice first')), false);
});
