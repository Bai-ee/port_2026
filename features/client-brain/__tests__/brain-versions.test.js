import assert from 'node:assert/strict';
import test from 'node:test';
import store from '../store.cjs';

test('version log API is exported', () => {
  for (const fn of ['recordBrainVersion', 'listBrainVersions', 'readBrainVersion']) {
    assert.equal(typeof store[fn], 'function');
  }
});

test('recordBrainVersion skips when there is no prior markdown', async () => {
  assert.equal(await store.recordBrainVersion('c1', { prior: { markdownSource: '' } }), null);
});
