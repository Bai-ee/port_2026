import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStory, storySyncPlan } from '../draft-builder.js';

const head = 'Deep Touch – Deep Touch\nLabel · CAT1 · 1995';

test('extractStory: story after header and meta', () => {
  assert.equal(extractStory(`${head}\n\nBought this in Chicago.`), 'Bought this in Chicago.');
});
test('extractStory: no meta line', () => {
  assert.equal(extractStory('A – B\n\nMy story\nline two'), 'My story\nline two');
});
test('extractStory: placeholder (any case) or empty -> null', () => {
  assert.equal(extractStory(`${head}\n\n[add your memory]`), null);
  assert.equal(extractStory(`${head}\n\n[Add Your Memory] soon`), null);
  assert.equal(extractStory(`${head}\n\n  `), null);
  assert.equal(extractStory(`${head}`), null);
});
test('extractStory: unrecognised shape or non-string -> null', () => {
  assert.equal(extractStory('Just a plain tweet with no header'), null);
  assert.equal(extractStory(null), null);
  assert.equal(extractStory(''), null);
});

const post = { source: 'discogs-ingest', sourceRef: { releaseId: 74379 }, needsStory: true };
const withStory = `${head}\n\nMy memory.`;

test('storySyncPlan: ignores non-discogs posts', () => {
  assert.equal(storySyncPlan({ source: 'manual' }, withStory, null), null);
  assert.equal(storySyncPlan({ source: 'discogs-ingest' }, withStory, null), null);
});
test('storySyncPlan: story on idea package -> drafted', () => {
  const plan = storySyncPlan(post, withStory, { status: 'idea', story: '' });
  assert.deepEqual(plan.postPatch, { needsStory: false });
  assert.deepEqual(plan.packagePatch, { id: 'discogs-74379', story: 'My memory.', status: 'drafted' });
});
test('storySyncPlan: never downgrades status', () => {
  for (const status of ['drafted', 'scheduled', 'posted', 'retired']) {
    const plan = storySyncPlan({ ...post, needsStory: false }, withStory, { status, story: 'old' });
    assert.equal(plan.packagePatch.status, undefined);
    assert.equal(plan.packagePatch.story, 'My memory.');
    assert.equal(plan.postPatch, null);
  }
});
test('storySyncPlan: unchanged story and status -> no package patch', () => {
  const plan = storySyncPlan({ ...post, needsStory: false }, withStory, { status: 'drafted', story: 'My memory.' });
  assert.equal(plan.packagePatch, null);
});
test('storySyncPlan: placeholder back -> needsStory true, package untouched', () => {
  const plan = storySyncPlan({ ...post, needsStory: false }, `${head}\n\n[add your memory]`, { status: 'drafted', story: 'old' });
  assert.deepEqual(plan, { postPatch: { needsStory: true }, packagePatch: null });
});
test('storySyncPlan: no story yet (current draft state)', () => {
  const plan = storySyncPlan(post, `${head}\n\n[add your memory]`, { status: 'idea', story: '' });
  assert.deepEqual(plan, { postPatch: null, packagePatch: null });
});
