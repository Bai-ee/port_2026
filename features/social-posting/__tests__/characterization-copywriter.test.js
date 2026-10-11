// CHARACTERIZATION: pins CURRENT behaviour of the Copywriter card actions on
// app/api/social-posting/route.js (score / enhance / update) and the feature
// functions behind them. No network (global fetch is replaced by a recorder),
// no real X/Anthropic/Firestore. Auth is stubbed by patching the CJS exports
// BEFORE the route is imported (the route destructures them at import time).
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../app/api/archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const auth = require('../../../api/_lib/auth.cjs');
const provisioning = require('../../../api/_lib/client-provisioning.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

let currentClient = 'c1';
auth.verifyRequestUser = async () => ({ uid: 'u1', email: 'u@test.dev' });
provisioning.getEffectiveClientContext = async () => ({ clientId: currentClient });

const svc = await import('../twitter-service.js');
const { scoreXPost } = await import('../../x-growth/index.js');
const route = await import('../../../app/api/social-posting/route.js');

let ctx;
let fetchCalls;
let anthropicText;
let originalDbDescriptor;
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  currentClient = 'c1';
  fetchCalls = [];
  anthropicText = JSON.stringify({ voice: 'Voice rewrite.', algo: 'Algo rewrite.' });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith('https://api.anthropic.com/')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: anthropicText }] }), { status: 200 });
    }
    throw new Error(`unexpected network call in test: ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

const call = async (body) => {
  const res = await route.POST(new Request('http://localhost/api/social-posting', {
    method: 'POST',
    headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

// ── score ───────────────────────────────────────────────────────────────────

test('score: returns the deterministic scoreXPost result with zero network calls (no KB, no LLM)', async () => {
  const content = 'Shipped a new dashboard today. What would you change?';
  const res = await call({ action: 'score', content });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.score, JSON.parse(JSON.stringify(scoreXPost(content, { mediaType: 'none' }))));
  assert.equal(fetchCalls.length, 0);
  // Deterministic: same input, same output.
  assert.deepEqual((await call({ action: 'score', content })).body.score, res.body.score);
});

test('score: mediaType is forwarded to the scorer; empty content still returns ok', async () => {
  const withVideo = await call({ action: 'score', content: 'Clip.', mediaType: 'video' });
  assert.deepEqual(withVideo.body.score, JSON.parse(JSON.stringify(scoreXPost('Clip.', { mediaType: 'video' }))));
  const empty = await call({ action: 'score' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
});

test('score: writes nothing to Firestore', async () => {
  await call({ action: 'score', content: 'Anything.' });
  assert.equal(ctx.adminDb._store.size, 0);
});

// ── enhance ─────────────────────────────────────────────────────────────────

test('enhance (route): two candidates {voice, algo}, each scored, one Anthropic call on claude-sonnet-4-6, no KB fetch', async () => {
  const res = await call({ action: 'enhance', content: 'teh draft post' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.candidates.map((c) => [c.id, c.label, c.text]), [
    ['voice', 'Brand Voice', 'Voice rewrite.'],
    ['algo', 'Best for X', 'Algo rewrite.'],
  ]);
  for (const c of res.body.candidates) {
    assert.deepEqual(c.score, JSON.parse(JSON.stringify(scoreXPost(c.text, { mediaType: 'none' }))));
  }
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(fetchCalls[0].body.model, 'claude-sonnet-4-6');
  assert.match(fetchCalls[0].body.messages[0].content, /teh draft post/);
});

test('enhancePost strips code fences, trims quotes, clamps to 280 chars, falls back per-field when one is empty', async () => {
  anthropicText = '```json\n{"voice":"\\"Quoted voice\\"","algo":""}\n```';
  const out = await svc.enhancePost('Original text');
  assert.equal(out.voice, 'Quoted voice');
  assert.equal(out.algo, 'Original text'); // empty field => original
  anthropicText = JSON.stringify({ voice: 'v'.repeat(400), algo: 'a' });
  const long = await svc.enhancePost('Original text');
  assert.equal(long.voice.length, 280);
});

test('enhancePost falls back to the normalized original for BOTH options when there is no API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const out = await svc.enhancePost('  Keep   me.  \n\n\n\nOk ');
  assert.deepEqual(out, { voice: 'Keep   me.\nOk', algo: 'Keep   me.\nOk' });
  assert.equal(fetchCalls.length, 0);
});

test('enhancePost falls back to the original on a non-OK API response, non-JSON reply, or empty content', async () => {
  anthropicText = 'not json at all';
  assert.deepEqual(await svc.enhancePost('Hello'), { voice: 'Hello', algo: 'Hello' });
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  assert.deepEqual(await svc.enhancePost('Hello'), { voice: 'Hello', algo: 'Hello' });
  assert.deepEqual(await svc.enhancePost('   '), { voice: '', algo: '' }); // empty => no call
});

test('enhancePost clamps an over-long original to 280 chars before fallback', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const out = await svc.enhancePost('z'.repeat(500));
  assert.equal(out.voice.length, 280);
});

// ── update ──────────────────────────────────────────────────────────────────

test('update (route): edits the draft in place -- same id, no duplicate row, re-scored agents attached', async () => {
  const draft = await svc.createSocialPost('c1', { content: 'First draft.', status: 'draft' });
  const res = await call({ action: 'update', postId: draft.id, content: 'Second draft.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.post.id, draft.id);
  assert.equal(res.body.post.content, 'Second draft.');
  assert.equal(res.body.post.status, 'draft');
  assert.ok(res.body.post.agents, 'agents pass is re-run by the route');
  assert.equal((await svc.readSocialQueue('c1')).length, 1);
  assert.equal(raw(draft.id).content, 'Second draft.');
});

test('update is ownership-checked: another client\'s post is 404 and untouched', async () => {
  const foreign = await svc.createSocialPost('c2', { content: 'Not yours.', status: 'draft' });
  const res = await call({ action: 'update', postId: foreign.id, content: 'Hijacked.' });
  assert.equal(res.status, 404);
  assert.equal(raw(foreign.id).content, 'Not yours.');
  await assert.rejects(() => svc.updateSocialPost('c1', foreign.id, { content: 'x' }), (e) => e.status === 404);
});

test('update guards: missing postId 400, empty content 400, >280 chars 400, posted/posting 409', async () => {
  await assert.rejects(() => svc.updateSocialPost('c1', '', { content: 'x' }), (e) => e.status === 400);
  const d = await svc.createSocialPost('c1', { content: 'Keep.', status: 'draft' });
  await assert.rejects(() => svc.updateSocialPost('c1', d.id, { content: '   ' }), (e) => e.status === 400);
  await assert.rejects(() => svc.updateSocialPost('c1', d.id, { content: 'x'.repeat(281) }), (e) => e.status === 400);
  for (const status of ['posted', 'posting']) {
    const p = await svc.createSocialPost('c1', { content: `Live ${status}.`, status });
    await assert.rejects(() => svc.updateSocialPost('c1', p.id, { content: 'edit' }), (e) => e.status === 409, status);
  }
});

test('update: editing an approved draft\'s text voids the approval back to draft; unchanged text keeps it', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Approve me.', status: 'draft' });
  await svc.approveDraft('c1', d.id, { reviewedBy: 'u@test.dev' });
  const same = await svc.updateSocialPost('c1', d.id, { content: 'Approve me.' });
  assert.equal(same.status, 'approved');
  const edited = await svc.updateSocialPost('c1', d.id, { content: 'Approve me, edited.' });
  assert.equal(edited.status, 'draft');
  assert.equal(edited.reviewedAt, null);
  assert.equal(edited.reviewedBy, null);
});

test('CURRENT (known gap): editing a SCHEDULED post\'s text does not void approval or change status', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Reviewed.', status: 'draft' });
  await svc.approveDraft('c1', d.id, { reviewedBy: 'u@test.dev' });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const sched = await svc.updateSocialPost('c1', d.id, { scheduledAt: future });
  assert.equal(sched.status, 'scheduled');
  const edited = await svc.updateSocialPost('c1', d.id, { content: 'Totally different text.' });
  assert.equal(edited.status, 'scheduled');
  assert.ok(edited.reviewedAt);
});

test('update with scheduledAt: future => scheduled, past => queued, ""/null clears back to draft/approved', async () => {
  const d = await svc.createSocialPost('c1', { content: 'Time me.', status: 'draft', needsApproval: false });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal((await svc.updateSocialPost('c1', d.id, { scheduledAt: future })).status, 'scheduled');
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal((await svc.updateSocialPost('c1', d.id, { scheduledAt: past })).status, 'queued');
  const cleared = await svc.updateSocialPost('c1', d.id, { scheduledAt: '' });
  assert.equal(cleared.status, 'draft');
  assert.equal(cleared.scheduledAt, null);
  await assert.rejects(() => svc.updateSocialPost('c1', d.id, { scheduledAt: 'not-a-date' }), (e) => e.status === 400);
});

test('update does not call Anthropic (only enhance does)', async () => {
  const d = await svc.createSocialPost('c1', { content: 'No LLM.', status: 'draft' });
  await call({ action: 'update', postId: d.id, content: 'Still no LLM.' });
  assert.equal(fetchCalls.filter((c) => c.url.includes('anthropic')).length, 0);
});
