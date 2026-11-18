import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createFakeDb } from './fake-db.js';

const CLIENT = 'not-the-rug-abc123';
const ORIGIN = 'https://hitloop.test';

function setup({ auth = 'Bearer tok', respondClientId = CLIENT, status = 200, extra = {} } = {}) {
  const calls = [];
  const brief = { briefSlug: 'client-brief-20261118-0123456789abcdef', ogImageUrl: `${ORIGIN}/briefs/notrug/cb-1/og-image`, title: 'Weekly', kind: 'client-brief', public: true, publicUrl: `${ORIGIN}/briefs/notrug/cb-1`, pdfDownloadUrl: `${ORIGIN}/briefs/notrug/cb-1/pdf`, createdAt: '2026-11-18T00:00:00Z' };
  const mk = (method) => async (req) => {
    const body = method === 'GET' ? null : await req.json();
    calls.push({ method, url: new URL(req.url), authorization: req.headers.get('authorization'), body });
    const json = method === 'GET' ? { clientId: respondClientId, briefs: [brief, { ...brief, briefSlug: 'inv', kind: 'invoice' }] }
      : { ok: true, clientId: respondClientId, brief, pdf: { ok: true }, ...extra };
    return new Response(JSON.stringify(json), { status });
  };
  const services = { ownerAuthorization: async () => auth, customBriefsRoute: async () => ({ GET: mk('GET'), POST: mk('POST'), PATCH: mk('PATCH') }) };
  const ctx = { db: createFakeDb({ [`clients/${CLIENT}`]: { name: 'Not The Rug' } }), email: 'bryanballi@gmail.com', origin: ORIGIN, now: () => 0, services };
  const call = async (name, args) => (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' })).body.result;
  return { call, calls };
}
const out = (r) => JSON.parse(r.content[0].text);

test('registry includes the three client brief tools', () => {
  for (const n of ['publish_client_brief', 'unpublish_client_brief', 'list_client_briefs']) assert.ok(registry.find((t) => t.name === n), n);
});

test('publish: auth + as=clientId + kind client-brief + text/title; returns URLs', async () => {
  const s = setup({ extra: { pdf: { ok: false, warning: { message: 'PDF later' } } } });
  const r = out(await s.call('publish_client_brief', { clientId: CLIENT, text: '# Hi\nA: 1', title: 'Weekly' }));
  const c = s.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.authorization, 'Bearer tok');
  assert.equal(c.url.searchParams.get('as'), CLIENT);
  assert.deepEqual(c.body, { kind: 'client-brief', text: '# Hi\nA: 1', public: true, title: 'Weekly' });
  assert.equal(r.ogImageUrl, `${ORIGIN}/briefs/notrug/cb-1/og-image`);
  assert.equal(r.publicUrl, `${ORIGIN}/briefs/notrug/cb-1`);
  assert.equal(r.pdfUrl, `${ORIGIN}/briefs/notrug/cb-1/pdf`);
  assert.equal(r.briefSlug, 'client-brief-20261118-0123456789abcdef');
  assert.equal(r.clientId, CLIENT);
  assert.deepEqual(r.warnings, ['PDF later']);
});

test('publish: wrong client in the response is refused', async () => {
  const s = setup({ respondClientId: 'bryan-balli-WUoltG84' });
  const r = await s.call('publish_client_brief', { clientId: CLIENT, text: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not "not-the-rug-abc123"/);
});

test('publish: null owner authorization is a clear error and no route call', async () => {
  const s = setup({ auth: null });
  const r = await s.call('publish_client_brief', { clientId: CLIENT, text: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Could not open the owner's dashboard session/);
  assert.equal(s.calls.length, 0);
});

test('publish: rejects invalid clientId, empty and oversized text', async () => {
  const s = setup();
  assert.equal((await s.call('publish_client_brief', { clientId: '../x', text: 'x' })).isError, true);
  assert.equal((await s.call('publish_client_brief', { clientId: CLIENT, text: '   ' })).isError, true);
  assert.equal((await s.call('publish_client_brief', { clientId: CLIENT, text: 'a'.repeat(50001) })).isError, true);
  assert.equal(s.calls.length, 0);
});

test('unpublish: PATCH {briefSlug, public:false}', async () => {
  const s = setup({ extra: { warning: { message: 'pdf left' } } });
  const r = out(await s.call('unpublish_client_brief', { clientId: CLIENT, briefSlug: 'cb-1' }));
  assert.equal(s.calls[0].method, 'PATCH');
  assert.equal(s.calls[0].url.searchParams.get('as'), CLIENT);
  assert.deepEqual(s.calls[0].body, { briefSlug: 'cb-1', public: false });
  assert.deepEqual(r, { ok: true, briefSlug: 'cb-1', warning: 'pdf left' });
});

test('list: GET ?kind=client-brief&as=clientId, client briefs only', async () => {
  const s = setup();
  const r = out(await s.call('list_client_briefs', { clientId: CLIENT }));
  const u = s.calls[0].url;
  assert.equal(u.searchParams.get('kind'), 'client-brief');
  assert.equal(u.searchParams.get('as'), CLIENT);
  assert.equal(r.briefs.length, 1);
  assert.equal(r.briefs[0].pdfUrl, `${ORIGIN}/briefs/notrug/cb-1/pdf`);
  assert.equal(r.briefs[0].public, true);
});

test('in-process request exposes nextUrl (origin + as= + kind) for the real route shape', async () => {
  const { _buildRequestForTest } = await import('../tools/client-brief.js');
  const r = await _buildRequestForTest('https://hitloop.agency/api/dashboard/custom-briefs?as=not-the-rug-WMmA4G9L&kind=client-brief', { method: 'GET', headers: { authorization: 'Bearer t' } });
  assert.equal(r.nextUrl.origin, 'https://hitloop.agency');
  assert.equal(r.nextUrl.searchParams.get('as'), 'not-the-rug-WMmA4G9L');
  assert.equal(r.nextUrl.searchParams.get('kind'), 'client-brief');
  assert.equal(r.headers.get('authorization'), 'Bearer t');
});

test('publish_client_brief stops at the daily cap (20/UTC day) before calling the route', async () => {
  const { reserveDailyClientBriefSlot, createMemoryCounters, DAILY_CLIENT_BRIEF_CAP } = await import('../limits.js');
  const counters = createMemoryCounters();
  const now = Date.parse('2026-11-18T12:00:00Z');
  for (let i = 0; i < DAILY_CLIENT_BRIEF_CAP; i += 1) await reserveDailyClientBriefSlot(counters, { now });
  await assert.rejects(() => reserveDailyClientBriefSlot(counters, { now }), (e) => e.code === 'daily-cap');
  await reserveDailyClientBriefSlot(counters, { now: now + 86400000 }); // next UTC day resets
});

test('publish: OG args are forwarded (within limits; over-limit arrays rejected by the schema)', async () => {
  const s = setup();
  await s.call('publish_client_brief', {
    clientId: CLIENT, text: '# Hi', ogLabel: 'NTR', ogSubhead: 'Sub', hideOgSubhead: true,
    ogTitleLines: ['a', 'b', 'c'], ogLines: ['x', 'y'],
  });
  assert.deepEqual(s.calls[0].body, {
    kind: 'client-brief', text: '# Hi', public: true, ogLabel: 'NTR', ogSubhead: 'Sub', hideOgSubhead: true,
    ogTitleLines: ['a', 'b', 'c'], ogLines: ['x', 'y'],
  });
  const over = await s.call('publish_client_brief', { clientId: CLIENT, text: '# Hi', ogLines: ['x', 'y', 'z'] });
  assert.equal(over.isError, true);
  assert.equal(s.calls.length, 1);
});

test('publish: briefSlug updates in place (forwarded to the route); non client-brief ids are rejected before any call', async () => {
  const s = setup();
  const slug = 'client-brief-20261118-0123456789abcdef';
  const r = out(await s.call('publish_client_brief', { clientId: CLIENT, text: '# Hi', briefSlug: slug }));
  assert.equal(s.calls[0].body.briefSlug, slug);
  assert.equal(r.briefSlug, slug);
  const bad = await s.call('publish_client_brief', { clientId: CLIENT, text: '# Hi', briefSlug: 'some-invoice' });
  assert.equal(bad.isError, true);
  assert.equal(s.calls.length, 1);
});

test('tool descriptions + guide/instructions mention the OG args and in-place update', async () => {
  const tool = registry.find((t) => t.name === 'publish_client_brief');
  for (const key of ['ogLabel', 'ogSubhead', 'hideOgSubhead', 'ogTitleLines', 'ogLines', 'briefSlug']) assert.ok(tool.inputSchema.properties[key], key);
  assert.match(tool.description, /UPDATE it in place/);
  const { readFile } = await import('node:fs/promises');
  const guide = await readFile(new URL('../guide.js', import.meta.url), 'utf8');
  const instructions = await readFile(new URL('../instructions.js', import.meta.url), 'utf8');
  assert.match(guide, /briefSlug\?/);
  assert.match(instructions, /update an existing one in place/);
});

test('publish with briefSlug (update) never sends public, so an unpublished brief stays unpublished', async () => {
  const s = setup({ extra: { brief: { briefSlug: 'client-brief-20261118-0123456789abcdef', title: 'Weekly', kind: 'client-brief', public: false, publicUrl: `${ORIGIN}/briefs/notrug/cb-1`, pdfDownloadUrl: `${ORIGIN}/briefs/notrug/cb-1/pdf` } } });
  const r = out(await s.call('publish_client_brief', { clientId: CLIENT, text: '# Edited', briefSlug: 'client-brief-20261118-0123456789abcdef' }));
  assert.equal('public' in s.calls[0].body, false);
  assert.equal(s.calls[0].body.briefSlug, 'client-brief-20261118-0123456789abcdef');
  assert.equal(r.public, false);
});
