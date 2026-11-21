import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createFakeDb } from './fake-db.js';

const CLIENT = 'paradice-dbBQCHUX';
const ORIGIN = 'https://hitloop.test';
const DL = 'https://firebasestorage.googleapis.com/v0/b/b/o/clients%2Fparadice%2Fep-v02.mp4?alt=media&token=1234-5678';

function setup(respond) {
  const calls = [];
  const POST = async (req) => {
    const body = await req.json();
    calls.push({ url: new URL(req.url), authorization: req.headers.get('authorization'), body });
    const [status, json] = respond(body);
    return new Response(JSON.stringify(json), { status });
  };
  const services = { ownerAuthorization: async () => 'Bearer tok', socialPostingRoute: async () => ({ POST }) };
  const ctx = { db: createFakeDb({ [`clients/${CLIENT}`]: { name: 'CQ' } }), email: 'owner@example.com', origin: ORIGIN, now: () => 0, services };
  const call = async (name, args) => (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' })).body.result;
  return { call, calls };
}
const out = (r) => JSON.parse(r.content[0].text);
const brief = {
  postId: 'p1', postStatus: 'draft', revision: 9, briefVersion: 2, meta: { status: 'approved' }, v2: { title: 'T' }, template: 'creative',
  directorNotes: { status: 'accepted', briefHash: 'h', stale: false, notes: null, items: [] },
  storyboard: { status: 'ready', outline: 'o', frames: [{ label: 'Open', url: 'https://img/1.png', note: 'n' }], episode: { outlineHash: 'oh', storagePath: 'clients/x/ep-v02.mp4' } },
  episodeVideoUrl: 'https://preview',
};

test('registry has creative_brief_get and creative_brief_review', () => {
  for (const n of ['creative_brief_get', 'creative_brief_review']) assert.ok(registry.find((t) => t.name === n), n);
});

test('get: reads the brief + download as the owner for that client; frames, episode, nextStep', async () => {
  const s = setup((b) => (b.action === 'video-brief-get' ? [200, { ok: true, brief }] : [200, { ok: true, video: { downloadUrl: 'https://preview', preview: true } }]));
  const r = out(await s.call('creative_brief_get', { clientId: CLIENT, postId: 'p1' }));
  assert.equal(s.calls[0].authorization, 'Bearer tok');
  assert.equal(s.calls[0].url.searchParams.get('as'), CLIENT);
  assert.deepEqual(s.calls.map((c) => c.body.action), ['video-brief-get', 'video-brief-download']);
  assert.equal(r.revision, 9);
  assert.equal(r.storyboard.frames[0].imageUrl, 'https://img/1.png');
  assert.equal(r.storyboard.episode.storagePath, 'clients/x/ep-v02.mp4');
  assert.equal(r.attachedVideo, null, 'a preview is not an attached video');
  assert.match(r.nextStep, /storyboard/);
});

test('review: passes exactly the decision fields and returns the download link (not redacted)', async () => {
  const s = setup(() => [200, { ok: true, step: 'storyboard', decision: 'approve', post: { revision: 10 }, brief: { ...brief, revision: 10 }, video: { downloadUrl: DL, posterUrl: null, v: 2, outlineHash: 'oh' } }]);
  const r = out(await s.call('creative_brief_review', { clientId: CLIENT, postId: 'p1', step: 'storyboard', decision: 'approve', expectedRevision: 9, outlineHash: 'oh', storagePath: 'clients/x/ep-v02.mp4' }));
  assert.deepEqual(s.calls[0].body, { action: 'video-brief-owner-review', postId: 'p1', step: 'storyboard', decision: 'approve', expectedRevision: 9, outlineHash: 'oh', storagePath: 'clients/x/ep-v02.mp4' });
  assert.equal(r.download.downloadUrl, DL);
  assert.equal(r.revision, 10);
});

test('review: a route refusal is an error with its code', async () => {
  const s = setup(() => [409, { error: 'The Director has not accepted this version of the brief yet.', code: 'director-not-accepted' }]);
  const r = await s.call('creative_brief_review', { clientId: CLIENT, postId: 'p1', step: 'brief', decision: 'approve', expectedRevision: 9 });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /director-not-accepted/);
});

test('review: expectedRevision is required by the schema', async () => {
  const s = setup(() => [200, { ok: true }]);
  const r = await s.call('creative_brief_review', { clientId: CLIENT, postId: 'p1', step: 'brief', decision: 'approve' });
  assert.equal(r.isError, true);
  assert.equal(s.calls.length, 0);
});
