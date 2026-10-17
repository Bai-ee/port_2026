// Bucket colors: theme hue tokens by bucket order (calendar chips/rows, legend, Content Center dots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketColorMap, bucketColorFor, bucketOfPost, BUCKET_COLOR_TOKENS, NEUTRAL_BUCKET_COLOR } from '../bucket-colors.js';
import { buildMonthCalendar } from '../month-calendar.js';

const BUCKETS = [
  { id: 'nas', name: 'Throwback Content', order: 4, active: true },
  { id: 'record', name: 'Record Collection Videos', order: 0, active: true },
  { id: 'ue', name: 'Dj Mix Videos', order: 1, active: false },
  { id: 'client', name: 'Video Editing', order: 2, active: true },
];

test('colors follow bucket order, are theme tokens only, and an inactive bucket keeps its slot', () => {
  const map = bucketColorMap(BUCKETS);
  assert.deepEqual(map, {
    record: `var(${BUCKET_COLOR_TOKENS[0]})`, ue: `var(${BUCKET_COLOR_TOKENS[1]})`,
    client: `var(${BUCKET_COLOR_TOKENS[2]})`, nas: `var(${BUCKET_COLOR_TOKENS[3]})`,
  });
  for (const c of Object.values(map)) assert.match(c, /^var\(--t-[a-z0-9-]+\)$/);
  assert.ok(!BUCKET_COLOR_TOKENS.some((t) => /danger|support-1/.test(t)), 'red means failed');
  assert.equal(new Set(BUCKET_COLOR_TOKENS).size, 12);
  assert.equal(bucketColorFor('gone', BUCKETS), NEUTRAL_BUCKET_COLOR);
});

test('bucketOfPost: own bucketId, else the package bucket (or its engine), else the post engine', () => {
  assert.equal(bucketOfPost({ bucketId: 'nas', engine: 'record' }), 'nas');
  assert.equal(bucketOfPost({ packageId: 'p' }, { bucketId: 'nas', engine: 'record' }), 'nas');
  assert.equal(bucketOfPost({ packageId: 'p' }, { engine: 'ue' }), 'ue');
  assert.equal(bucketOfPost({ engine: 'identity' }), 'identity');
  assert.equal(bucketOfPost({}), null);
});

test('month calendar: rows carry bucket color, legend lists active buckets (+ inactive with posts) with counts', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const posts = [
    { id: 'a', status: 'scheduled', content: 'x', scheduledAt: '2026-10-12T15:00:00Z', bucketId: 'nas' },
    { id: 'b', status: 'scheduled', content: 'y', scheduledAt: '2026-10-13T15:00:00Z', engine: 'ue' },
    { id: 'c', status: 'scheduled', content: 'z', scheduledAt: '2026-10-14T15:00:00Z' },
  ];
  const cal = buildMonthCalendar({ posts, month: '2026-10', now, buckets: BUCKETS });
  const rows = Object.fromEntries(cal.weeks.flat().flatMap((d) => d.posts).map((p) => [p.id, p]));
  assert.equal(rows.a.bucketId, 'nas');
  assert.equal(rows.a.bucketColor, bucketColorFor('nas', BUCKETS));
  assert.equal(rows.c.bucketId, null);
  assert.equal(rows.c.bucketColor, NEUTRAL_BUCKET_COLOR);
  assert.deepEqual(cal.legend.map((l) => [l.id, l.count]), [['record', 0], ['ue', 1], ['client', 0], ['nas', 1], ['none', 1]]);
  // Without buckets (e.g. Telegram) nothing changes: no colors, no legend.
  const plain = buildMonthCalendar({ posts, month: '2026-10', now });
  assert.deepEqual(plain.legend, []);
  assert.equal(plain.weeks.flat().flatMap((d) => d.posts)[0].bucketColor, null);
});
