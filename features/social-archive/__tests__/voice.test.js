import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFingerprint, pickExemplars, timelineContext } from '../voice.js';

let n = 0;
const E = (o = {}) => {
  n += 1;
  const day = o.day || `2019-05-${String(1 + (n % 28)).padStart(2, '0')}`;
  return {
    id: `e${n}`, platform: 'instagram', account: 'a', kind: 'post', audience: 'public',
    ts: `${day}T12:00:00.000Z`, day, text: `post number ${n}`, hashtags: [], mentions: [], ...o,
  };
};

test('fingerprint filters to public voice kinds with text', () => {
  const rows = [
    E({ text: 'Hello there!' }), E({ text: 'lowercase one? yes' }),
    E({ audience: 'friends', text: 'private' }), E({ audience: 'unknown', text: 'unk' }),
    E({ kind: 'media', text: 'photo' }), E({ kind: 'comment', text: 'cmt' }),
    E({ text: '   ' }), E({ platform: 'x', text: 'other platform' }),
  ];
  const fp = computeFingerprint(rows, { platform: 'instagram' });
  assert.equal(fp.sample, 2);
  assert.equal(fp.platform, 'instagram');
  assert.equal(fp.lowerStartRate, 0.5);
  assert.equal(fp.questions, 0.5);
  assert.equal(fp.exclaims, 0.5);
});

test('fingerprint stats: window, median, hashtags, openers', () => {
  const rows = [
    E({ day: '2018-04-02', text: 'late night set #house #chi', hashtags: ['house', 'chi'] }),
    E({ day: '2019-01-02', text: 'late night again #house', hashtags: ['house'] }),
    E({ day: '2020-06-30', text: 'something else entirely, longer text here', hashtags: [] }),
  ];
  const fp = computeFingerprint(rows, { platform: 'instagram' });
  assert.deepEqual(fp.window, { from: '2018-04-02', to: '2020-06-30' });
  assert.equal(fp.len.median, rows[0].text.length);
  assert.equal(fp.topHashtags[0], 'house');
  assert.deepEqual(fp.openers, ['late night']);
});

test('fingerprint of nothing is a zero sample, no throw', () => {
  const fp = computeFingerprint([], { platform: 'x' });
  assert.equal(fp.sample, 0);
  assert.equal(computeFingerprint(null).sample, 0);
});

test('pickExemplars: public only, deterministic, limit, topic filter', () => {
  const rows = [
    E({ id: 'a', day: '2019-01-01', text: 'short', engagement: { likes: 1 } }),
    E({ id: 'b', day: '2019-02-01', text: 'a medium length house post', engagement: { likes: 50 } }),
    E({ id: 'c', day: '2019-03-01', text: 'x'.repeat(120), engagement: { likes: 2 } }),
    E({ id: 'd', day: '2019-04-01', text: 'secret house', audience: 'friends', engagement: { likes: 999 } }),
    E({ id: 'e', day: '2019-05-01', text: 'tagged', hashtags: ['house'] }),
  ];
  const a = pickExemplars(rows, { platform: 'instagram', limit: 3 });
  const b = pickExemplars([...rows].reverse(), { platform: 'instagram', limit: 3 });
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.equal(a.length, 3);
  assert.ok(!a.some((x) => x.id === 'd'));
  assert.ok(a.some((x) => x.id === 'b'));
  const t = pickExemplars(rows, { platform: 'instagram', topic: 'HOUSE', limit: 10 });
  assert.deepEqual(t.map((x) => x.id).sort(), ['b', 'e']);
  assert.deepEqual(pickExemplars(rows, { limit: 0 }), []);
});

function fakeStore(entries, dayEntries = []) {
  return {
    searchEntries: async () => entries,
    getDay: async () => ({ entries: dayEntries }),
  };
}

test('timelineContext block format', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => E({ day: `2019-05-0${i + 1}`, text: `Night ${i} at the house` }));
  const out = await timelineContext({ clientId: 'c', platform: 'instagram', store: fakeStore(rows), maxChars: 1800 });
  const lines = out.split('\n');
  assert.match(lines[0], /^PLATFORM VOICE \(instagram, 6 public posts, 2019-05\.\.2019-05\): median \d+ chars, \d+% caps, [\d.]+ emoji\/post, hashtags [\d.]+\/post, lowercase starts \d+%$/);
  assert.equal(lines[1], 'EXAMPLES:');
  assert.match(lines[2], /^- \[2019-05-\d\d post\] "Night \d at the house"$/);
  assert.ok(!out.includes('ON '));
});

test('timelineContext day facts: public only, locked label, kind and time', async () => {
  const rows = [E({ text: 'hello world' })];
  const dayRows = [
    E({ kind: 'event', ts: '2019-05-24T21:00:00.000Z', text: 'Show at Subterranean' }),
    E({ audience: 'friends', text: 'private thing' }),
  ];
  const out = await timelineContext({ clientId: 'c', platform: 'instagram', day: '2019-05-24', store: fakeStore(rows, dayRows) });
  assert.ok(out.includes('ON 2019-05-24 (locked facts: do not change dates):'));
  assert.ok(out.includes('- event 21:00Z [instagram]: "Show at Subterranean"'));
  assert.ok(!out.includes('private thing'));
});

test('timelineContext respects maxChars and keeps day facts', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => E({ text: `${'word '.repeat(40)}${i}` }));
  const dayRows = [E({ kind: 'event', text: 'Gig' })];
  const out = await timelineContext({ clientId: 'c', platform: 'instagram', day: '2019-05-24', maxChars: 500, store: fakeStore(rows, dayRows) });
  assert.ok(out.length <= 500, String(out.length));
  assert.ok(out.includes('locked facts'));
});

test('timelineContext: empty and never throws', async () => {
  assert.equal(await timelineContext({ clientId: 'c', platform: 'instagram', store: fakeStore([]) }), '');
  assert.equal(await timelineContext({ clientId: 'c', platform: 'instagram', store: { searchEntries: async () => { throw new Error('boom'); } } }), '');
  assert.equal(await timelineContext({}), '');
  assert.equal(await timelineContext({ clientId: 'c', platform: 'instagram', store: fakeStore([E({ audience: 'friends' })]) }), '');
});

test('timelineContext: topic with no match falls back to representative posts', async () => {
  const rows = [E({ text: 'plain post one' }), E({ text: 'plain post two' })];
  const out = await timelineContext({ clientId: 'c', platform: 'instagram', topic: 'zzz', store: fakeStore(rows) });
  assert.ok(out.includes('EXAMPLES:'));
});

test('pickExemplars: the same caption posted twice yields one example (the better-performing copy)', () => {
  const mk = (id, ts, text, likes) => ({ id, platform: 'instagram', kind: 'post', audience: 'public', ts, day: ts.slice(0, 10), text, engagement: likes ? { likes } : undefined, hashtags: [] });
  const rows = [
    mk('a', '2024-02-09T12:00:00.000Z', 'From the depths. A Secret Studio composition.', 3),
    mk('b', '2024-02-14T12:00:00.000Z', 'from the depths.   A Secret Studio composition.', 9),
    mk('c', '2024-03-01T12:00:00.000Z', 'Different post entirely about Saturday.', 0),
  ];
  const out = pickExemplars(rows, { platform: 'instagram', limit: 3 });
  assert.equal(out.length, 2);
  assert.ok(out.some((e) => e.id === 'b') && !out.some((e) => e.id === 'a'));
});
