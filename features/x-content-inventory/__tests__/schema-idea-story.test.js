import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage } from '../schema.js';

const base = { id: 'a', series: 'C1', pillar: 'found-this', title: 't', story: '', mediaState: 'video', effort: '10-min', rights: 'owned', status: 'idea' };

test('empty story allowed only for idea', () => {
  assert.equal(validatePackage(base).ok, true);
  for (const status of ['drafted', 'scheduled', 'posted', 'retired']) {
    const r = validatePackage({ ...base, status });
    assert.equal(r.ok, false, status);
    assert.ok(r.errors.some((e) => e.includes('story')));
  }
  assert.equal(validatePackage({ ...base, status: undefined }).ok, false);
  assert.equal(validatePackage({ ...base, story: undefined }).ok, false);
});
