import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeTodayPlan } from '../today-plan.js';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const planDoc = { version: 3, plan: { authoredPerDay: 4 } };
const post = (over) => ({ status: 'scheduled', engine: 'client', content: 'hello', scheduledAt: '2026-10-13T15:00:00.000Z', ...over });

test('shapeTodayPlan: per-track target = authoredPerDay * share; scheduledToday counts that track only', () => {
  const out = shapeTodayPlan({
    planDoc, now: NOW, pendingProposals: 2,
    posts: [post({}), post({ engine: 'ue' }), post({ scheduledAt: '2026-10-14T15:00:00.000Z' }), post({ status: 'draft' })],
  });
  assert.deepEqual(out.tracks.map((t) => [t.label, t.targetPerDay, t.scheduledToday]),
    [['Design & client work', 2, 1], ['Music (UE mixes, Discogs)', 2, 1]]);
  assert.equal(out.pendingProposals, 2);
});

test('shapeTodayPlan: next = upcoming only, ascending, max 5, excerpt <=120', () => {
  const posts = Array.from({ length: 7 }, (_, i) => post({ scheduledAt: `2026-10-13T${13 + i}:00:00.000Z`, content: 'x'.repeat(300) }));
  posts.push(post({ scheduledAt: '2026-10-13T09:00:00.000Z' })); // past
  const out = shapeTodayPlan({ planDoc, posts, now: NOW });
  assert.equal(out.next.length, 5);
  assert.equal(out.next[0].scheduledAt, '2026-10-13T13:00:00.000Z');
  assert.ok(out.next.every((n) => n.excerpt.length <= 120));
});

test('shapeTodayPlan: missing inputs degrade to empty/null, never throw', () => {
  const out = shapeTodayPlan({ now: NOW });
  assert.deepEqual(out.tracks, []);
  assert.deepEqual(out.next, []);
  assert.equal(out.pendingProposals, null);
  const noPosts = shapeTodayPlan({ planDoc, now: NOW });
  assert.equal(noPosts.tracks[0].scheduledToday, null);
});
