import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toIdeaPackage, hasOwnerStory, IDEAS_BUCKET_ID } from '../ideas.js';
import { validatePackage } from '../schema.js';
import { resolveBucket, DEFAULT_BUCKETS } from '../buckets.js';

const clientRows = JSON.parse(readFileSync(new URL('../client-stories.json', import.meta.url), 'utf8'));
const buildRows = JSON.parse(readFileSync(new URL('../../ue-content/build-stories.json', import.meta.url), 'utf8'));

test('client rows keep approval/rights, go to the Ideas bucket, valid', () => {
  for (const row of clientRows) {
    const p = toIdeaPackage(row, { kind: 'client' });
    assert.equal(p.bucketId, 'client');
    assert.equal(resolveBucket(p, DEFAULT_BUCKETS), 'client');
    assert.deepEqual(p.approval, row.approval);
    assert.equal(p.rights, row.rights);
    assert.ok(p.tags.includes('client'));
    assert.ok(p.facets.people.length >= 1);
    assert.equal(validatePackage(p).ok, true, row.id);
  }
});

test('build rows stay valid and tagged build', () => {
  for (const row of buildRows) {
    const p = toIdeaPackage(row, { kind: 'build' });
    assert.equal(p.bucketId, IDEAS_BUCKET_ID);
    assert.ok(p.tags.includes('build'));
    assert.deepEqual(p.approval, row.approval);
    assert.equal(validatePackage(p).ok, true, row.id);
  }
});

test('story: placeholder unless owner-written; never invented', () => {
  assert.equal(toIdeaPackage({ title: 'X', story: 'todo write' }, { kind: 'client' }).story, '[add your memory]');
  assert.equal(toIdeaPackage({ title: 'X', story: 'I rebuilt it in a week.' }, { kind: 'client' }).story, 'I rebuilt it in a week.');
  assert.equal(hasOwnerStory({ story: '[add your memory]' }), false);
});

test('growth idea: template, owned, valid, angle is a prompt not the story', () => {
  const p = toIdeaPackage({ title: 'Reply to 3 builders daily', angle: 'show one build detail', tags: ['reply'] }, { kind: 'growth' });
  assert.equal(p.bucketId, 'client');
  assert.equal(p.story, '[add your memory]');
  assert.equal(p.variants.x.suggestedStory, 'show one build detail');
  assert.deepEqual(p.tags, ['growth', 'reply']);
  assert.equal(validatePackage(p).ok, true);
});

test('bad kind / missing title throw', () => {
  assert.throws(() => toIdeaPackage({ title: 'x' }, { kind: 'nope' }));
  assert.throws(() => toIdeaPackage({}, { kind: 'growth' }));
});
