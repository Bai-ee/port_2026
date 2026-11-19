// Route wiring of the Creative Brief author: video-brief-approve / video-brief-render author a CQ panel brief after the approve save.
// No network: global fetch is a recorder that answers api.anthropic.com with a canned tool_use. Auth stubbed as in characterization-copywriter.test.js.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../app/api/archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const auth = require('../../../api/_lib/auth.cjs');
const provisioning = require('../../../api/_lib/client-provisioning.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const CQ = 'paradice-dbBQCHUX';
auth.verifyRequestUser = async () => ({ uid: 'u1', email: 'u@test.dev' });
provisioning.getEffectiveClientContext = async () => ({ clientId: CQ });

const svc = await import('../twitter-service.js');
const route = await import('../../../app/api/social-posting/route.js');

const CREATIVE = 'Creative ID: CQ-S3-1119\nTitle: Before the Titans\nHost: none\nNarration: off';
const toolInput = () => ({
  unsupported: [],
  request: {
    type: 'how-to', skeleton: 'cursor', host: { name: 'none' }, goal: 'g', audience: 'a', hook: 'Before the Titans.', banner: 'GATHER FIRST', narration: false,
    establish: { caption: 'GATHER FIRST', seconds: 3 },
    steps: [
      { panel: 'spotTile', clicks: [{ action: 'selectSpot' }], caption: '1. SELECT A RESOURCE', seconds: 4 },
      { panel: 'spotClaimReward', clicks: [{ action: 'claim' }], caption: '4. CLAIM', seconds: 4 },
    ],
    end: { caption: 'TOMORROW', cta: 'Return tomorrow.', seconds: 3 },
  },
});

let ctx; let anthropicCalls; let anthropicBody; let originalDbDescriptor;
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  anthropicCalls = 0;
  anthropicBody = { content: [{ type: 'tool_use', id: 'tu_1', name: 'author_request', input: toolInput() }] };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.anthropic.com/')) { anthropicCalls += 1; return new Response(JSON.stringify(anthropicBody), { status: 200 }); }
    throw new Error(`unexpected network call in test: ${url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const call = async (body) => {
  const res = await route.POST(new Request('http://localhost/api/social-posting', { method: 'POST', headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const draft = async (template = CREATIVE) => {
  const d = await svc.createSocialPost(CQ, { content: 'Before the Titans: your first gathering run.', status: 'draft', reviewOn: '2026-11-19' });
  ctx.adminDb._patch('social_posts', d.id, { reviewOn: '2026-11-19' });
  await svc.saveVideoBrief(CQ, d.id, { template, status: 'ready' });
  return d.id;
};

test('video-brief-approve: authors the request after the approve save, sets howto=<id>, keeps the creative', async () => {
  const id = await draft();
  const res = await call({ action: 'video-brief-approve', postId: id });
  assert.equal(res.status, 200);
  assert.equal(anthropicCalls, 1);
  assert.match(res.body.brief.videoBrief, /^howto=cb-/);
  assert.equal(res.body.brief.template, CREATIVE);
  assert.equal(raw(id).videoBriefMeta.status, 'approved');
  assert.equal(raw(id).videoBriefMeta.creative, CREATIVE);
  assert.equal(raw(id).videoBriefMeta.authored.requestId, raw(id).videoBrief.slice(6));
  assert.equal(ctx.adminDb._raw('howto_requests', raw(id).videoBrief.slice(6)).status, 'approved');
  // approving again: no second model call
  assert.equal((await call({ action: 'video-brief-approve', postId: id })).status, 200);
  assert.equal(anthropicCalls, 1);
});

test('video-brief-approve: unsupported shot -> 409 with reasons, authorError stored, brief still approved', async () => {
  anthropicBody = { content: [{ type: 'tool_use', id: 'tu_1', name: 'author_request', input: { unsupported: [{ shot: 'shot 2', what: 'trading screen' }] } }] };
  const id = await draft();
  const res = await call({ action: 'video-brief-approve', postId: id });
  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.reasons, ['unsupported:shot 2:trading screen']);
  assert.match(res.body.error, /unsupported:shot 2:trading screen/);
  assert.deepEqual(raw(id).videoBriefMeta.authorError.reasons, ['unsupported:shot 2:trading screen']);
  assert.equal(raw(id).videoBrief, CREATIVE);
});

test('video-brief-render: authoring runs before the render path; a failure stops it', async () => {
  anthropicBody = { content: [{ type: 'tool_use', id: 'tu_1', name: 'author_request', input: { unsupported: [{ shot: 's', what: 'w' }] } }] };
  const id = await draft();
  const res = await call({ action: 'video-brief-render', postId: id });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.reasons, ['unsupported:s:w']);
  assert.equal(res.body.render, undefined);
});

test('video-brief-approve: a free-text brief is not authored (no model call)', async () => {
  const id = await draft('Short art-led teaser: poster, music, done.');
  const res = await call({ action: 'video-brief-approve', postId: id });
  assert.equal(res.status, 200);
  assert.equal(anthropicCalls, 0);
  assert.equal(raw(id).videoBrief, 'Short art-led teaser: poster, music, done.');
});

test('video-brief-approve / video-brief-render: an invalid brief line still approves but returns warnings', async () => {
  const id = await draft('howto: tap the axe then claim');
  const res = await call({ action: 'video-brief-approve', postId: id });
  assert.equal(res.status, 200);
  assert.match(res.body.warnings[0], /video brief invalid: malformed-howto-line/);
  const rr = await call({ action: 'video-brief-render', postId: id });
  assert.equal(rr.status, 200);
  assert.equal(rr.body.render.ok, false);
  assert.match(rr.body.warnings[0], /malformed-howto-line/);
});

test('video-brief-feedback / -versions / -rollback: owner feedback revises the request and replace-renders the draft', async () => {
  const realEnv = process.env.DAILY_BRIEF_VIDEO_ENABLED;
  const realHowto = process.env.CQ_HOWTO_ENABLED;
  process.env.DAILY_BRIEF_VIDEO_ENABLED = 'true';
  process.env.CQ_HOWTO_ENABLED = 'true';
  try {
    const id = await draft();
    // not authored yet
    assert.equal((await call({ action: 'video-brief-feedback', postId: id, feedback: 'shorter' })).body.reasons[0], 'no-authored-request');
    assert.equal((await call({ action: 'video-brief-approve', postId: id })).status, 200);
    ctx.adminDb._patch('social_posts', id, { mediaUrl: 'https://v/0.mp4', mediaType: 'video', mediaJobId: 'bv_first00000000001', posterUrl: 'https://v/0.jpg' });
    const calls = anthropicCalls;
    const fbRes = await call({ action: 'video-brief-feedback', postId: id, feedback: 'Make the opening banner shorter.' });
    assert.equal(fbRes.status, 200);
    assert.equal(anthropicCalls, calls + 1);
    assert.match(fbRes.body.brief.videoBrief, /^howto=cb-.*-f1$/);
    assert.equal(fbRes.body.render.ok, true);
    assert.deepEqual(fbRes.body.versions.map((v) => v.kind), ['feedback', 'author']);
    assert.equal(raw(id).status, 'draft');
    const list = await call({ action: 'video-brief-versions', postId: id });
    assert.equal(list.body.versions.length, 2);
    const rb = await call({ action: 'video-brief-rollback', postId: id, n: 1 });
    assert.equal(rb.status, 200);
    assert.match(raw(id).videoBrief, /-b1-1$/);
    assert.equal(rb.body.versions[0].kind, 'rollback');
    assert.equal(anthropicCalls, calls + 1, 'rollback makes no model call');
    // refused on a non-draft
    ctx.adminDb._patch('social_posts', id, { status: 'approved' });
    const no = await call({ action: 'video-brief-feedback', postId: id, feedback: 'again' });
    assert.equal(no.status, 409);
    assert.deepEqual(no.body.reasons, ['not-draft']);
  } finally {
    if (realEnv === undefined) delete process.env.DAILY_BRIEF_VIDEO_ENABLED; else process.env.DAILY_BRIEF_VIDEO_ENABLED = realEnv;
    if (realHowto === undefined) delete process.env.CQ_HOWTO_ENABLED; else process.env.CQ_HOWTO_ENABLED = realHowto;
  }
});

test('video-brief-approve: server-side author warnings reach the response (narration-off-no-host)', async () => {
  const input = toolInput(); input.request.narration = true;
  anthropicBody = { content: [{ type: 'tool_use', id: 'tu_1', name: 'author_request', input }] };
  const id = await draft();
  const res = await call({ action: 'video-brief-approve', postId: id });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.warnings, ['narration-off-no-host']);
});
