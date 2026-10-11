import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPostResults, LIST_CAP } from '../results.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const P = (id, status, extra = {}) => ({ id, status, content: `c${id}`, ...extra });
const posted = (id, extra = {}) => P(id, 'posted', { twitterId: `t${id}`, postedAt: '2026-10-05T10:00:00Z', ...extra });

test('missing metrics are null with note, never 0', () => {
  const r = buildPostResults({ posts: [posted('a')], now: NOW });
  assert.equal(r.posted[0].metrics, null);
  assert.equal(r.posted[0].metricsNote, 'not measured yet');
  assert.equal(r.counts.unmeasured, 1);
  assert.ok(r.caveats.includes('1 posted post(s) have no captured metrics yet.'));
});

test('real zero views stays 0; absent fields stay null', () => {
  const r = buildPostResults({
    posts: [posted('a', { performance: { views: 0, likes: 2, capturedAt: '2026-10-05T22:00:00Z' } })],
    now: NOW,
  });
  const m = r.posted[0].metrics;
  assert.equal(m.views, 0);
  assert.equal(m.likes, 2);
  assert.equal(m.replies, null);
  assert.equal(m.bookmarks, null);
  assert.equal(r.posted[0].metricsNote, 'captured 2026-10-05T22:00:00.000Z (12h after posting)');
  assert.equal(r.lastCapturedAt, '2026-10-05T22:00:00.000Z');
});

test('all-null performance object counts as unmeasured', () => {
  const r = buildPostResults({ posts: [posted('a', { performance: { views: null } })], now: NOW });
  assert.equal(r.posted[0].metrics, null);
});

test('separates posted / pending / failed; needs_review held, expired failed', () => {
  const r = buildPostResults({
    posts: [
      posted('a'),
      P('b', 'scheduled', { scheduledAt: '2026-10-07T10:00:00Z' }),
      P('c', 'needs_review', { errorClass: 'edited_after_approval' }),
      P('d', 'failed', { errorClass: 'rate_limit', error: 'x'.repeat(500), retryable: true }),
      P('e', 'expired'),
      P('f', 'draft'),
      P('g', 'rejected'),
    ],
    now: NOW,
  });
  assert.deepEqual(r.posted.map((x) => x.id), ['a']);
  assert.deepEqual(r.pending.map((x) => x.id).sort(), ['b', 'c']);
  assert.equal(r.pending.find((x) => x.id === 'c').heldReason, 'edited_after_approval');
  assert.deepEqual(r.failed.map((x) => x.id).sort(), ['d', 'e']);
  assert.equal(r.failed.find((x) => x.id === 'd').failure.error.length <= 200, true);
  assert.equal(r.failed.find((x) => x.id === 'd').failure.retryable, true);
  assert.deepEqual(r.counts, { posted: 1, pending: 2, failed: 2, needsReview: 1, unmeasured: 1 });
});

test('provenance and package title carried', () => {
  const r = buildPostResults({
    posts: [posted('a', { packageId: 'pk1', runId: 'run9', suggestionId: 's1', strategyVersion: 4, source: 'daily', sourceRef: { kind: 'quote-target' } })],
    packages: [{ id: 'pk1', title: 'Pkg One' }],
    now: NOW,
  });
  const row = r.posted[0];
  assert.equal(row.packageTitle, 'Pkg One');
  assert.deepEqual(row.origin, { runId: 'run9', suggestionId: 's1', strategyVersion: 4, source: 'daily', sourceRefKind: 'quote-target' });
});

test('sorting: posted newest first, pending by scheduledAt with nulls last', () => {
  const r = buildPostResults({
    posts: [
      posted('old', { postedAt: '2026-10-01T00:00:00Z' }),
      posted('new', { postedAt: '2026-10-05T00:00:00Z' }),
      P('p2', 'queued', { scheduledAt: '2026-10-09T00:00:00Z' }),
      P('p0', 'queued'),
      P('p1', 'approved', { scheduledAt: '2026-10-08T00:00:00Z' }),
    ],
    now: NOW,
  });
  assert.deepEqual(r.posted.map((x) => x.id), ['new', 'old']);
  assert.deepEqual(r.pending.map((x) => x.id), ['p1', 'p2', 'p0']);
});

test('caps lists but counts stay full; excerpt capped', () => {
  const posts = Array.from({ length: 60 }, (_, i) => posted(`x${i}`, { content: 'y'.repeat(300) }));
  const r = buildPostResults({ posts, now: NOW });
  assert.equal(r.posted.length, LIST_CAP);
  assert.equal(r.counts.posted, 60);
  assert.ok(r.posted[0].content.length <= 140);
});

test('sample-size caveat only when <5 measured; always-on caveats', () => {
  const mk = (i) => posted(`m${i}`, { performance: { views: 10, capturedAt: '2026-10-05T20:00:00Z' } });
  const few = buildPostResults({ posts: [mk(1)], now: NOW });
  assert.ok(few.caveats.some((c) => /fewer than 5/.test(c)));
  const many = buildPostResults({ posts: [1, 2, 3, 4, 5].map(mk), now: NOW });
  assert.ok(!many.caveats.some((c) => /fewer than 5/.test(c)));
  assert.ok(!many.caveats.some((c) => /no captured metrics/.test(c)));
  for (const r of [few, many]) {
    assert.ok(r.caveats.includes('Views/engagement come from stored captures only; a refresh does not backfill them.'));
    assert.ok(r.caveats.includes('Lift is likes-based and does not measure causal effect.'));
  }
});

test('deterministic, tolerates rows without id and empty input', () => {
  const posts = [null, { status: 'posted' }, posted('a')];
  assert.deepEqual(buildPostResults({ posts, now: NOW }), buildPostResults({ posts, now: NOW }));
  assert.equal(buildPostResults({ posts, now: NOW }).counts.posted, 1);
  assert.equal(buildPostResults().counts.posted, 0);
});
