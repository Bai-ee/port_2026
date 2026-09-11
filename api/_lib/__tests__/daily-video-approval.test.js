const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../../../app/api/admin/daily-digest/route.js'), 'utf8');
const enqueueStart = source.indexOf('async function enqueueAutoPublishVideoPost(');
const enqueueEnd = source.indexOf('// \u2500\u2500 Route handler', enqueueStart);
const renderStart = source.indexOf('function buildAutoPublishRow(');
const renderEnd = source.indexOf('/** ONE "Post content" row', renderStart);
assert.ok(enqueueStart >= 0 && enqueueEnd > enqueueStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);

function harness(existing = []) {
  const calls = [];
  const context = vm.createContext({
    fb: { adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ companyName: 'Undergroundexistence' }) }) }) }) } },
    getSocialAccount: async () => ({ connected: true, username: 'UGExistence' }),
    toPublicAccount: (value) => value,
    readSocialQueue: async () => existing,
    createSocialPost: async (clientId, post) => { calls.push({ clientId, post }); return { id: 'post-1' }; },
    signApprovalToken: async (input) => { calls.push({ token: input }); return { token: 'test-token' }; },
    postNow: () => { throw new Error('Scheduled send must never publish'); },
    generatePromoCopy: () => { throw new Error('Scheduled send must never generate'); },
    appOrigin: () => 'https://hitloop.agency',
    logInfo: () => {}, logWarn: () => {},
    escapeHtml: (value) => String(value), DT: {},
  });
  vm.runInContext(source.slice(enqueueStart, enqueueEnd), context);
  vm.runInContext(source.slice(renderStart, renderEnd), context);
  return { context, calls };
}

const args = {
  clientId: 'video-owner', platform: 'x', timestamp: '2026-09-11T13:00:00Z',
  videoItems: { remix: { url: 'https://example.com/video.mp4', caption: 'TYREL WILLIAMS\nMix Tape', stale: false } },
  digestCfg: { autoPublish: { platforms: { x: { mode: 'approval' } } } },
  approvalOnly: true, allowInlineLlm: false,
};

test('scheduled video creates a pending owner-scoped approval and renders its Post button', async () => {
  const { context, calls } = harness();
  const result = await context.enqueueAutoPublishVideoPost(args);
  assert.equal(calls[0].clientId, 'video-owner');
  assert.equal(calls[0].post.status, 'awaiting_approval');
  assert.equal(calls[0].post.mediaUrl, args.videoItems.remix.url);
  assert.equal(calls[0].post.content, args.videoItems.remix.caption);
  assert.equal(calls[1].token.clientId, 'video-owner');
  const html = context.buildAutoPublishRow(result);
  assert.match(html, /POST TO X/);
  assert.match(html, /post-approval\?token=test-token/);
  assert.doesNotMatch(html, /Preview/);
});

test('scheduled approval-only invocation refuses auto mode before any social writes', async () => {
  const { context, calls } = harness();
  const result = await context.enqueueAutoPublishVideoPost({ ...args, digestCfg: { autoPublish: { platforms: { x: { mode: 'auto' } } } } });
  assert.equal(result.skipped, 'scheduled-publish-disabled');
  assert.equal(calls.length, 0);
});

test('missing saved caption never triggers generation on scheduled sends', async () => {
  const { context, calls } = harness();
  const result = await context.enqueueAutoPublishVideoPost({ ...args, videoItems: { remix: { ...args.videoItems.remix, caption: '' } } });
  assert.equal(result.skipped, 'no-caption');
  assert.equal(calls.length, 0);
});

test('repeat send reuses the pending video post and mints a new approval token', async () => {
  const { context, calls } = harness([{ id: 'existing', source: 'daily-video:x:2026-09-11', status: 'awaiting_approval', content: args.videoItems.remix.caption }]);
  const result = await context.enqueueAutoPublishVideoPost(args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token.postId, 'existing');
  assert.match(result.approvalUrl, /test-token/);
});
