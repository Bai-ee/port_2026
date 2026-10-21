'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractBrainFacts, checkCopyAgainstBrain } = require('../brain-facts');

const NOW = new Date('2026-10-20T12:00:00Z');
const brain = (over = {}) => ({
  status: 'approved',
  identity: { description: 'Dog walkers in Williamsburg since 2011.' },
  offers: { services: ['Daily group dog walks in Williamsburg (priority 1): max 3 dogs; 45 minutes; from $33'] },
  ...over,
});
const realPost = () => ({
  x_post: "Brooklyn dog owners are asking Reddit who to trust with their dog right now. We've been walking Williamsburg dogs for 15 years. Max 4 per walk. GPS every time. We're here. @nottherug",
});

test('real NTR case: "Max 4 per walk" vs Brain "max 3 dogs" is flagged and corrected', () => {
  const content = realPost();
  const r = checkCopyAgainstBrain(content, brain(), { now: NOW });
  assert.match(content.x_post, /Max 3 per walk\./);
  assert.match(content.x_post, /for 15 years/);
  assert.equal(r.checked, true);
  assert.deepEqual(r.contradictions.map((c) => [c.kind, c.found, c.action]), [['cap', 4, 'corrected']]);
});

test('no Brain or unapproved Brain leaves copy untouched', () => {
  for (const b of [null, undefined, brain({ status: 'draft' })]) {
    const content = realPost();
    const r = checkCopyAgainstBrain(content, b, { now: NOW });
    assert.deepEqual(content, realPost());
    assert.equal(r.checked, false);
  }
});

test('matching copy is untouched', () => {
  const content = { x_post: 'Max 3 dogs per walk. 45 minutes. From $33. 15 years in Williamsburg.' };
  const r = checkCopyAgainstBrain(content, brain(), { now: NOW });
  assert.equal(content.x_post, 'Max 3 dogs per walk. 45 minutes. From $33. 15 years in Williamsburg.');
  assert.deepEqual(r.contradictions, []);
});

test('years: tolerance of 1, wrong counts and since-years corrected', () => {
  const ok = { a: 'Walking for 14 years.', b: 'Walking for 16 years.' };
  assert.deepEqual(checkCopyAgainstBrain(ok, brain(), { now: NOW }).contradictions, []);
  const bad = { a: 'Walking dogs for 13+ years.', b: 'Since 2008, we walk dogs.', c: 'Over the last 3 years we grew.' };
  const r = checkCopyAgainstBrain(bad, brain(), { now: NOW });
  assert.equal(bad.a, 'Walking dogs for 15+ years.');
  assert.equal(bad.b, 'Since 2011, we walk dogs.');
  assert.equal(bad.c, 'Over the last 3 years we grew.');
  assert.equal(r.contradictions.length, 2);
});

test('left alone: bare durations and non-tenure "N years"', () => {
  const src = { x_post: 'The park is 10 minutes away. It takes 10 minutes to book. 2 years of data, a 3 years plan, 5 years ago, a 9 years old pup.' };
  const content = { ...src };
  const r = checkCopyAgainstBrain(content, brain(), { now: NOW });
  assert.deepEqual(content, src);
  assert.deepEqual(r.contradictions, []);
});

test('service-tied durations and tenure phrasings are checked', () => {
  const content = { a: 'A 60-minute walk.', b: 'Walks are 20 minutes.', c: '30 minutes per walk.', d: "We've been at this 9 years.", e: '9 years in business.' };
  checkCopyAgainstBrain(content, brain(), { now: NOW });
  assert.deepEqual(content, { a: 'A 45-minute walk.', b: 'Walks are 45 minutes.', c: '45 minutes per walk.', d: "We've been at this 15 years.", e: '15 years in business.' });
});

test('price and duration are corrected when the Brain has one value', () => {
  const content = { x_post: 'Walks from $40, 60-minute walk.' };
  checkCopyAgainstBrain(content, brain(), { now: NOW });
  assert.equal(content.x_post, 'Walks from $33, 45-minute walk.');
});

test('ambiguous Brain values: field is dropped, not guessed; nested/array copy is covered', () => {
  const b = brain({ offers: { services: ['Group walks: max 3 dogs', 'Pack hikes: max 6 dogs'] } });
  const content = { x_post: 'Max 4 dogs per walk.', thread: ['fine', 'Up to 9 dogs'] };
  const r = checkCopyAgainstBrain(content, b, { now: NOW });
  assert.equal(content.x_post, '');
  assert.equal(content.thread[1], '');
  assert.equal(content.thread[0], 'fine');
  assert.ok(r.contradictions.every((c) => c.action === 'dropped'));
});

test('extractBrainFacts ignores voice examples and returns null with no hard facts', () => {
  assert.equal(extractBrainFacts({ status: 'approved', voice: { toneSummary: 'max 2 dogs' } }), null);
  const f = extractBrainFacts(brain());
  assert.equal(f.foundedYear, 2011);
  assert.deepEqual([...f.caps.get('group')], [3]);
});
