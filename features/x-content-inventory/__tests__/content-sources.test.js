import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContentSources, mergeSourceRows, MAX_CONTENT_SOURCES } from '../content-sources.js';

test('normalizeContentSources: valid, trimmed, unique ids; never self; capped', () => {
  assert.deepEqual(normalizeContentSources(null), []);
  assert.deepEqual(normalizeContentSources([' ue-client ', 'ue-client', 'self-id', 'a/b', 7, ''], 'self-id'), ['ue-client']);
  const many = Array.from({ length: MAX_CONTENT_SOURCES + 5 }, (_, i) => `client-${i}`);
  assert.equal(normalizeContentSources(many).length, MAX_CONTENT_SOURCES);
});

test('mergeSourceRows: own row wins an id clash; source rows marked read-only with their owner', () => {
  const merged = mergeSourceRows(
    [{ id: 'same', clientId: 'me' }, { id: 'mine', clientId: 'me' }],
    [{ id: 'same', clientId: 'ue' }, { id: 'ue-1', clientId: 'ue' }, { id: 'ue-1', clientId: 'discogs' }],
  );
  assert.deepEqual(merged.map((r) => [r.id, r.clientId, r.readOnly ?? false]), [
    ['same', 'me', false], ['mine', 'me', false], ['ue-1', 'ue', true],
  ]);
  assert.equal(merged[2].sharedFrom, 'ue');
});
