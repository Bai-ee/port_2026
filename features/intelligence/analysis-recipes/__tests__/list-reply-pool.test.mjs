import test from 'node:test';
import assert from 'node:assert/strict';
import { listPostsForReplyPool, hasUsableListSignals, collectPoolIds, LIST_REPLY_POOL_CAP } from '../list-reply-pool.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

// Mirror of recipe-run/route.js withVelocity (same formula) used as the enrich callback.
function enrich(it, nowMs) {
  const ts = Date.parse(it.createdAt);
  if (!Number.isFinite(ts)) return it;
  const ageHours = Math.max(0, (nowMs - ts) / 3_600_000);
  const engagementTotal = it.engagementTotal;
  return {
    ...it,
    ageHours: Math.round(ageHours * 10) / 10,
    engagementTotal,
    velocityPerHour: Math.round((engagementTotal / Math.max(ageHours, 0.25)) * 10) / 10,
    replyWindowOpen: ageHours <= 6,
  };
}

const post = (id, hoursAgo, likes, extra = {}) => ({
  id, url: `https://x.com/a/status/${id}`, author: 'a', authorName: 'A', text: `t${id}`,
  createdAt: iso(hoursAgo), likes, reposts: 1, replies: 1, score: 999, source: 'list', listId: 'L1', ...extra,
});
const sig = (posts, generatedAt = iso(1)) => ({ generatedAt, byTrack: { design: { lists: [], posts } } });

test('enrichment: fields, tags, and engagement ignore scan score', () => {
  const out = listPostsForReplyPool(sig([post('1', 2, 8)]), { nowMs: NOW, enrich });
  assert.equal(out.length, 1);
  assert.equal(out[0].ageHours, 2);
  assert.equal(out[0].engagementTotal, 10); // 8+1+1, not 999
  assert.equal(out[0].velocityPerHour, 5);
  assert.equal(out[0].replyWindowOpen, true);
  assert.equal(out[0].trackId, 'design');
  assert.equal(out[0].listId, 'L1');
  assert.equal(out[0].source, 'list');
  assert.equal(listPostsForReplyPool(sig([post('2', 9, 8)]), { nowMs: NOW, enrich })[0].replyWindowOpen, false);
});

test('stale or missing listSignals yields []', () => {
  assert.deepEqual(listPostsForReplyPool(sig([post('1', 2, 8)], iso(13)), { nowMs: NOW, enrich }), []);
  assert.deepEqual(listPostsForReplyPool(null, { nowMs: NOW, enrich }), []);
  assert.deepEqual(listPostsForReplyPool({ generatedAt: iso(1) }, { nowMs: NOW, enrich }), []);
  assert.equal(hasUsableListSignals(sig([post('1', 2, 8)], iso(13)), { nowMs: NOW }), false);
  assert.equal(hasUsableListSignals(sig([post('1', 2, 8)]), { nowMs: NOW }), true);
});

test('dedupes within lists and against existing pool ids (id or status url)', () => {
  const s = { generatedAt: iso(1), byTrack: { a: { posts: [post('1', 2, 5), post('2', 2, 5)] }, b: { posts: [post('1', 2, 5), post('3', 2, 5)] } } };
  const pool = { watchlistMentions: [{ mentions: [{ url: 'https://x.com/z/status/3' }] }], brandMentions: [], redditSignals: [], kolActivity: [] };
  const out = listPostsForReplyPool(s, { nowMs: NOW, existingIds: collectPoolIds(pool), enrich });
  assert.deepEqual(out.map((p) => p.id).sort(), ['1', '2']);
});

test('orders by velocity desc and caps', () => {
  const posts = Array.from({ length: 50 }, (_, i) => post(String(i + 1), 2, i));
  const out = listPostsForReplyPool(sig(posts), { nowMs: NOW, enrich });
  assert.equal(out.length, LIST_REPLY_POOL_CAP);
  assert.equal(out[0].id, '50');
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].velocityPerHour >= out[i].velocityPerHour);
  assert.equal(listPostsForReplyPool(sig(posts), { nowMs: NOW, enrich, cap: 3 }).length, 3);
});
