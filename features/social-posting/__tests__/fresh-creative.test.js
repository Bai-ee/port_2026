import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFreshRender, pickFreshItem, usedCreative, changeToFreshCreative, isRenderPost } from '../fresh-creative.js';
import { buildMonthCalendar } from '../../x-content-inventory/month-calendar.js';

const NOW = Date.parse('2026-11-16T13:00:00Z');
const cap = (d, url, extra = {}) => ({ type: 'video_remix', downloadUrl: url, createdAt: `${d}T06:10:00Z`, jobId: `j-${url}`, createdWith: { artist: 'BAI-EE', mix: `Mix ${url}` }, ...extra });
const first = () => 0;

test('pickFreshRender: today\'s unused render wins; else random unused recent; never used, never old', () => {
  const caps = [cap('2026-11-16', 'today'), cap('2026-11-14', 'a'), cap('2026-11-10', 'b'), cap('2026-10-01', 'old')];
  assert.equal(pickFreshRender(caps, usedCreative([]), { nowMs: NOW, todayKey: '2026-11-16' }).capture.downloadUrl, 'today');
  const used = usedCreative([{ mediaUrl: 'today' }, { mediaUrl: 'a' }]);
  const r = pickFreshRender(caps, used, { nowMs: NOW, todayKey: '2026-11-16', rand: first });
  assert.deepEqual([r.capture.downloadUrl, r.reason], ['b', 'random-recent']);
  assert.equal(pickFreshRender(caps, usedCreative([{ mediaUrl: 'today' }, { mediaUrl: 'a' }, { mediaUrl: 'b' }]), { nowMs: NOW }), null); // 'old' is never picked
});

test('pickFreshItem: same bucket, has media, unused, not never-public; recent first', () => {
  const pkgs = [
    { id: 'p1', bucketId: 'b1', createdAt: '2026-11-15T00:00:00Z' },
    { id: 'p2', bucketId: 'b1', createdAt: '2025-01-01T00:00:00Z' },
    { id: 'p3', bucketId: 'b2', createdAt: '2026-11-15T00:00:00Z' },
    { id: 'p4', bucketId: 'b1', createdAt: '2026-11-15T00:00:00Z', rights: 'never-public' },
  ];
  assert.equal(pickFreshItem(pkgs, usedCreative([]), { bucketId: 'b1', nowMs: NOW, rand: first }).id, 'p1');
  assert.equal(pickFreshItem(pkgs, usedCreative([{ packageId: 'p1' }]), { bucketId: 'b1', nowMs: NOW }).id, 'p2');
  assert.equal(pickFreshItem(pkgs, usedCreative([{ packageId: 'p1' }, { packageId: 'p2' }]), { bucketId: 'b1', nowMs: NOW }), null);
});

const deps = (post, extra = {}) => {
  const swaps = [];
  return {
    swaps,
    getPost: async (id) => (id === post.id ? post : null),
    readPosts: async () => [post, { id: 'o', mediaUrl: 'a' }],
    readCaptures: async () => ({ captures: [cap('2026-11-14', 'a'), cap('2026-11-12', 'b')], assetClientId: 'asset' }),
    readPackages: async () => [],
    pickMediaRef: () => null,
    pickMedia: async () => null,
    swapPostMedia: async (id, patch) => { swaps.push(patch); return { approvalVoided: false }; },
    rowOf: async () => ({ id: post.id }),
    copyFor: (w) => `${w.artist}\n${w.mix}\n#mixtapesfromchicago`,
    ...extra,
  };
};

test('changeToFreshCreative: a UE video post gets an unused recent render + matching copy', async () => {
  const post = { id: 'p', source: 'daily-video:x:2026-11-01', mediaUrl: 'old-url', mediaType: 'video' };
  const d = deps(post);
  const r = await changeToFreshCreative(d, { postId: 'p', nowMs: NOW });
  assert.equal(r.ok, true);
  assert.equal(d.swaps[0].mediaUrl, 'b'); // 'a' is on another post
  assert.equal(d.swaps[0].content, 'BAI-EE\nMix b\n#mixtapesfromchicago');
  assert.equal(d.swaps[0].mediaAssetClientId, 'asset');
});

test('changeToFreshCreative: refuses record posts and empty stock; rv items count as renders', async () => {
  assert.equal((await changeToFreshCreative(deps({ id: 'r', packageId: 'discogs-1' }), { postId: 'r', nowMs: NOW })).code, 'record-post');
  const none = deps({ id: 'p', mediaJobId: 'j' }, { readCaptures: async () => ({ captures: [cap('2026-11-14', 'a')] }) });
  assert.equal((await changeToFreshCreative(none, { postId: 'p', nowMs: NOW })).code, 'no-fresh-render');
  assert.equal(isRenderPost({ packageId: 'rv-123' }), true);
  assert.equal((await changeToFreshCreative(deps({ id: 'x' }), { postId: 'nope' })).code, 'not-found');
});

test('calendar: each daily video sits on its own day (past days too), never re-proposed as backlog', () => {
  const dv = (d) => ({ id: `dv-${d}`, status: 'awaiting_approval', scheduledAt: null, source: `daily-video:x:${d}`, content: 'v', createdAt: `${d}T13:00:00Z` });
  const cal = buildMonthCalendar({ month: '2026-11', now: NOW, posts: [dv('2026-11-03'), dv('2026-11-04'), dv('2026-11-16')] });
  const days = cal.weeks.flat();
  for (const d of ['2026-11-03', '2026-11-04', '2026-11-16']) {
    const rows = days.find((x) => x.date === d).posts.filter((p) => p.kind === 'post');
    assert.deepEqual(rows.map((p) => p.id), [`dv-${d}`], d);
  }
  assert.equal(days.filter((x) => x.date > '2026-11-16').some((x) => x.posts.some((p) => String(p.id).startsWith('dv-'))), false);
});
