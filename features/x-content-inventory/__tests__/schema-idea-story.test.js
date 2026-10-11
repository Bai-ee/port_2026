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

import { sanitizePostFields } from '../schema.js';

test('sanitizePostFields: untouched without timeline fields, trims and drops junk with them', () => {
  assert.equal(sanitizePostFields(base), base);
  const out = sanitizePostFields({
    ...base,
    post: { platform: ' facebook ', account: 'Housepit', entryId: 'e1', postedAt: '2012-05-04T10:00:00Z', text: 'x'.repeat(500), album: '  A  ', junk: 1 },
    postIds: ['e1', 'e1', '', 7, 'e2'],
    dates: [{ kind: 'posted', date: '2012-05-04', source: 's', platform: 'facebook' }, { kind: 'posted', date: '2012-05-04', source: 's', platform: 'facebook' }, { kind: 'bogus', date: '2012-05-04' }, { kind: 'event', date: 'nope' }],
  });
  assert.equal(out.post.platform, 'facebook');
  assert.equal(out.post.text.length, 300);
  assert.equal(out.post.day, '2012-05-04');
  assert.equal(out.post.album, 'A');
  assert.equal('junk' in out.post, false);
  assert.deepEqual(out.postIds, ['e1', 'e2']);
  assert.equal(out.dates.length, 1);
  assert.equal(sanitizePostFields({ ...base, post: 'x' }).post, undefined);
  assert.equal(validatePackage({ ...base, post: { platform: 'x' } }).ok, false);
  assert.equal(validatePackage({ ...base, dates: [{ kind: 'posted', date: '2012-05-04' }] }).ok, true);
});
