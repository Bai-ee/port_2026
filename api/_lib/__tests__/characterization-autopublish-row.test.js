// CHARACTERIZATION: pins CURRENT behaviour of enqueueAutoPublishVideoPost
// (app/api/admin/daily-digest/route.js). The function is not exported and the
// route must not be edited, so it is extracted by source slice into a vm
// context with injected fakes -- same technique as daily-video-approval.test.js,
// covering the branches that file does not (media-URL dedupe, status filters,
// auto mode, skip reasons, cap ordering).
//
// GAP: GET handler / full route flow is NOT covered (needs Next + Firestore +
// Resend); only this helper and buildAutoPublishRow are reachable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../../../app/api/admin/daily-digest/route.js'), 'utf8');
const start = source.indexOf('async function enqueueAutoPublishVideoPost(');
const end = source.indexOf('// ── Route handler', start);
assert.ok(start >= 0 && end > start);

function harness({ existing = [], connected = true, postNowImpl } = {}) {
  const calls = { created: [], tokens: [], updates: [], postNow: [], steps: [] };
  const context = vm.createContext({
    fb: { adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ companyName: 'Acme' }) }) }) }) } },
    getSocialAccount: async () => ({ connected, username: 'acme_x' }),
    toPublicAccount: (v) => ({ connected: !!v?.connected, username: v?.username }),
    readSocialQueue: async () => existing,
    createSocialPost: async (clientId, post) => { calls.created.push({ clientId, post }); return { id: 'new-post' }; },
    updateSocialPost: async (clientId, id, patch) => { calls.updates.push({ clientId, id, patch }); return { content: patch.content }; },
    signApprovalToken: async (input) => { calls.tokens.push(input); return { token: 'tok' }; },
    postNow: async (clientId, payload) => {
      calls.postNow.push({ clientId, payload });
      if (postNowImpl) return postNowImpl();
      return { id: 'now-post', postedAt: '2026-10-01T13:00:00.000Z' };
    },
    generatePromoCopy: async () => { throw new Error('LLM must not run in these cases'); },
    appOrigin: () => 'https://app.test',
    logInfo: () => {}, logWarn: () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  return { run: (over = {}) => context.enqueueAutoPublishVideoPost({ ...base(), step: (l, m) => calls.steps.push([l, m]), ...over }), calls };
}

const base = () => ({
  clientId: 'c1', platform: 'x', timestamp: '2026-10-01T13:00:00Z',
  videoItems: { remix: { url: 'https://v.test/a.mp4', caption: 'Caption', stale: false, mediaJobId: 'job1', assetSourceClientId: 'owner' } },
  digestCfg: { autoPublish: { platforms: { x: { mode: 'approval' } } } },
});

test('mode off / unset or no clientId returns null without any write', async () => {
  const h = harness();
  assert.equal(await h.run({ digestCfg: { autoPublish: { platforms: { x: { mode: 'off' } } } } }), null);
  assert.equal(await h.run({ digestCfg: {} }), null);
  assert.equal(await h.run({ clientId: '' }), null);
  assert.equal(h.calls.created.length, 0);
});

test('skip reasons: no-video, stale video, not-connected -- none write a post', async () => {
  let h = harness();
  assert.equal((await h.run({ videoItems: {} })).skipped, 'no-video');
  assert.equal((await h.run({ videoItems: { remix: { url: '' } } })).skipped, 'no-video');
  assert.equal((await h.run({ videoItems: { remix: { ...base().videoItems.remix, stale: true } } })).skipped, 'stale');
  h = harness({ connected: false });
  assert.equal((await h.run()).skipped, 'not-connected');
  assert.equal(h.calls.created.length, 0);
});

test('approval mode creates an awaiting_approval post with source daily-video:<platform>:<UTC date> and media metadata', async () => {
  const h = harness();
  const out = await h.run();
  assert.equal(h.calls.created.length, 1);
  const { clientId, post } = h.calls.created[0];
  assert.equal(clientId, 'c1');
  assert.equal(post.source, 'daily-video:x:2026-10-01');
  assert.equal(post.status, 'awaiting_approval');
  assert.equal(post.platform, 'x');
  assert.equal(post.mediaUrl, 'https://v.test/a.mp4');
  assert.equal(post.mediaType, 'video');
  assert.equal(post.mediaContentType, 'video/mp4');
  assert.equal(post.mediaJobId, 'job1');
  assert.equal(post.mediaAssetClientId, 'owner');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.tokens)), [{ postId: 'new-post', clientId: 'c1', platform: 'x' }]);
  assert.equal(out.approvalUrl, 'https://app.test/post-approval?token=tok');
  assert.equal(out.handle, 'acme_x');
});

test('date key is the UTC date of the timestamp', async () => {
  const h = harness();
  await h.run({ timestamp: '2026-10-01T23:30:00-05:00' });
  assert.equal(h.calls.created[0].post.source, 'daily-video:x:2026-10-02');
});

test('soft idempotency by source: awaiting_approval/scheduled/posting/posted are reused; draft/failed/rejected/expired are NOT', async () => {
  for (const status of ['awaiting_approval', 'scheduled', 'posting', 'posted']) {
    const h = harness({ existing: [{ id: 'e1', source: 'daily-video:x:2026-10-01', status, content: 'Caption' }] });
    const out = await h.run();
    assert.equal(out.skipped, 'duplicate', status);
    assert.equal(h.calls.created.length, 0, status);
  }
  for (const status of ['draft', 'failed', 'rejected', 'expired', 'needs_review']) {
    const h = harness({ existing: [{ id: 'e1', source: 'daily-video:x:2026-10-01', status }] });
    const out = await h.run();
    assert.equal(out.skipped, undefined, status);
    assert.equal(h.calls.created.length, 1, status);
  }
});

test('soft idempotency by mediaUrl: same video under a different source/day is still a duplicate', async () => {
  const h = harness({ existing: [{ id: 'old', source: 'daily-video:x:2026-09-30', mediaUrl: 'https://v.test/a.mp4', status: 'posted', postedAt: '2026-09-30T13:00:00Z', content: 'Old' }] });
  const out = await h.run();
  assert.equal(out.skipped, 'duplicate');
  assert.equal(out.publishedAt, '2026-09-30T13:00:00Z');
  assert.equal(out.postContent, 'Old');
  assert.equal(h.calls.created.length, 0);
  assert.equal(h.calls.tokens.length, 0); // posted => no new approval token
});

test('a different source with a different video is not a duplicate', async () => {
  const h = harness({ existing: [{ id: 'old', source: 'daily-video:x:2026-09-30', mediaUrl: 'https://v.test/other.mp4', status: 'posted' }] });
  await h.run();
  assert.equal(h.calls.created.length, 1);
});

test('duplicate awaiting_approval post adopts the new caption and mints a fresh token', async () => {
  const h = harness({ existing: [{ id: 'e1', source: 'daily-video:x:2026-10-01', status: 'awaiting_approval', content: 'Old caption' }] });
  const out = await h.run();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.updates)), [{ clientId: 'c1', id: 'e1', patch: { content: 'Caption' } }]);
  assert.equal(h.calls.tokens[0].postId, 'e1');
  assert.equal(out.postContent, 'Caption');
  assert.match(out.approvalUrl, /token=tok$/);
});

test('CURRENT (known gap): maxPerDay is unreachable for the same-day source -- the duplicate check fires first', async () => {
  const h = harness({ existing: [{ id: 'e1', source: 'daily-video:x:2026-10-01', status: 'posted' }] });
  const out = await h.run({ digestCfg: { autoPublish: { platforms: { x: { mode: 'approval', maxPerDay: 1 } } } } });
  assert.equal(out.skipped, 'duplicate');
  assert.notEqual(out.skipped, 'max-per-day');
});

test('empty caption without inline LLM => no-caption skip; with approvalOnly and mode auto => scheduled-publish-disabled', async () => {
  const h = harness();
  const item = { ...base().videoItems.remix, caption: '  ' };
  assert.equal((await h.run({ videoItems: { remix: item }, allowInlineLlm: false })).skipped, 'no-caption');
  const auto = { autoPublish: { platforms: { x: { mode: 'auto' } } } };
  assert.equal((await h.run({ digestCfg: auto, approvalOnly: true })).skipped, 'scheduled-publish-disabled');
  assert.equal(h.calls.postNow.length, 0);
  assert.equal(h.calls.created.length, 0);
});

test('auto mode publishes through postNow with source + media and never creates an approval token', async () => {
  const h = harness();
  const out = await h.run({ digestCfg: { autoPublish: { platforms: { x: { mode: 'auto' } } } } });
  assert.equal(h.calls.postNow.length, 1);
  const { clientId, payload } = h.calls.postNow[0];
  assert.equal(clientId, 'c1');
  assert.equal(payload.source, 'daily-video:x:2026-10-01');
  assert.equal(payload.content, 'Caption');
  assert.equal(payload.mediaUrl, 'https://v.test/a.mp4');
  assert.equal(h.calls.tokens.length, 0);
  assert.equal(out.publishedAt, '2026-10-01T13:00:00.000Z');
});

test('auto mode publish failure is swallowed into skipped:publish-failed (digest still sends)', async () => {
  const h = harness({ postNowImpl: () => { throw new Error('X down'); } });
  const out = await h.run({ digestCfg: { autoPublish: { platforms: { x: { mode: 'auto' } } } } });
  assert.equal(out.skipped, 'publish-failed');
  assert.equal(out.error, 'X down');
});
