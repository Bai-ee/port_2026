import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, ROUTE_MODULES, findActions, getAction, validateAction } from '../agent/action-registry.js';
import { invokeAction, createActionRuntime } from '../agent/action-runtime.js';
import { createMemoryActionStores } from '../agent/action-stores.js';
import { createMemoryCounters, DAILY_CLIENT_BRIEF_CAP } from '../../mcp/limits.js';

const CLIENT = 'not-the-rug-abc123';
const ORIGIN = 'https://hitloop.test';
const SLUG = 'client-brief-20261118-0123456789abcdef';
const brief = { briefSlug: SLUG, title: 'Weekly', public: true, publicUrl: `${ORIGIN}/briefs/notrug/cb-1`, pdfDownloadUrl: `${ORIGIN}/briefs/notrug/cb-1/pdf`, ogImageUrl: `${ORIGIN}/briefs/notrug/cb-1/og-image`, updatedAt: 't', sourceText: 'SECRET BIG BODY' };

function fakeRoute({ respondClientId = CLIENT } = {}) {
  const calls = [];
  const mk = (method) => async (req) => {
    const body = method === 'GET' ? null : await req.json();
    calls.push({ method, url: new URL(req.url), authorization: req.headers.get('authorization'), body, hasNextUrl: !!req.nextUrl });
    const json = method === 'GET' ? { clientId: respondClientId, briefs: [brief] } : { ok: true, clientId: respondClientId, updated: false, brief };
    return new Response(JSON.stringify(json), { status: 200 });
  };
  return { calls, routeModules: { 'custom-briefs': async () => ({ GET: mk('GET'), POST: mk('POST'), PATCH: mk('PATCH') }) } };
}
const ctx = { clientId: CLIENT, authorization: 'Bearer owner', impersonating: true, origin: ORIGIN, by: 'o@x.com' };

test('registry: briefs entries are valid, route registered', () => {
  const ids = ACTIONS.filter((a) => a.group === 'briefs').map((a) => a.id).sort();
  assert.deepEqual(ids, ['briefs.client.list', 'briefs.client.publish', 'briefs.client.republish', 'briefs.client.unpublish']);
  for (const id of ids) assert.deepEqual(validateAction(getAction(id)), [], id);
  assert.equal(typeof ROUTE_MODULES['custom-briefs'], 'function');
  const pub = getAction('briefs.client.publish');
  assert.equal(pub.tier, 1);
  assert.equal(pub.external, null);
  assert.equal(pub.fixed.kind, 'client-brief');
  assert.deepEqual(pub.undo, { actionId: 'briefs.client.unpublish', argsFrom: { briefSlug: 'result.briefSlug' } });
  assert.equal(getAction('briefs.client.list').tier, 0);
  assert.ok(!('kind' in pub.args.properties), 'agent cannot choose the kind');
});

test('find_actions: natural phrasings reach briefs.client.publish', () => {
  for (const q of ['create or save client brief report for Not The Rug', 'create client brief', 'save client brief', 'publish brief report', 'client performance brief', 'share link PDF client brief']) {
    assert.ok(findActions(q).slice(0, 3).some((r) => r.id === 'briefs.client.publish'), q);
  }
  assert.equal(findActions('create or save client brief report for Not The Rug')[0].id, 'briefs.client.publish');
  assert.deepEqual(findActions('zzzznotathing qqqq'), []);
});

test('invoke publish: POST, owner auth, ?as=, fixed kind, default public on create, picked links', async () => {
  const r = fakeRoute();
  const out = await invokeAction(getAction('briefs.client.publish'), { text: '# Hi', kind: 'invoice' }, ctx, { routeModules: r.routeModules });
  const c = r.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.authorization, 'Bearer owner');
  assert.equal(c.url.searchParams.get('as'), CLIENT);
  assert.equal(c.url.origin, ORIGIN);
  assert.ok(c.hasNextUrl);
  assert.equal(c.body.kind, 'client-brief', 'fixed kind beats agent args');
  assert.equal(c.body.public, true);
  assert.equal(out.ok, true);
  assert.equal(out.json.publicUrl, brief.publicUrl);
  assert.equal(out.json.pdfUrl, brief.pdfDownloadUrl);
  assert.equal(out.json.briefSlug, SLUG);
  assert.ok(!('sourceText' in out.json));
});

test('invoke publish: optional built-in theme is forwarded; the arg schema only allows built-in ids', async () => {
  const r = fakeRoute();
  await invokeAction(getAction('briefs.client.publish'), { text: '# Hi', theme: 'ledger' }, ctx, { routeModules: r.routeModules });
  assert.equal(r.calls[0].body.theme, 'ledger');
  assert.deepEqual(getAction('briefs.client.publish').args.properties.theme.enum, ['ledger', 'editorial', 'studio-dark']);
  assert.ok(!getAction('briefs.client.publish').args.required.includes('theme'));
});

test('invoke publish UPDATE: never sends public unless the agent passes it', async () => {
  const r = fakeRoute();
  await invokeAction(getAction('briefs.client.publish'), { text: 'x', briefSlug: SLUG }, ctx, { routeModules: r.routeModules });
  assert.ok(!('public' in r.calls[0].body));
  assert.equal(r.calls[0].body.briefSlug, SLUG);
  await invokeAction(getAction('briefs.client.publish'), { text: 'x', briefSlug: SLUG, public: false }, ctx, { routeModules: r.routeModules });
  assert.equal(r.calls[1].body.public, false);
});

test('invoke unpublish / republish: PATCH with fixed public', async () => {
  const r = fakeRoute();
  await invokeAction(getAction('briefs.client.unpublish'), { briefSlug: SLUG, public: true }, ctx, { routeModules: r.routeModules });
  await invokeAction(getAction('briefs.client.republish'), { briefSlug: SLUG }, ctx, { routeModules: r.routeModules });
  assert.equal(r.calls[0].method, 'PATCH');
  assert.equal(r.calls[0].body.public, false, 'fixed wins over agent');
  assert.equal(r.calls[0].body.briefSlug, SLUG);
  assert.equal(r.calls[0].url.searchParams.get('as'), CLIENT);
  assert.equal(r.calls[1].body.public, true);
});

test('invoke list: GET ?kind=client-brief&as=, picked rows', async () => {
  const r = fakeRoute();
  const out = await invokeAction(getAction('briefs.client.list'), {}, ctx, { routeModules: r.routeModules });
  const c = r.calls[0];
  assert.equal(c.method, 'GET');
  assert.equal(c.url.searchParams.get('kind'), 'client-brief');
  assert.equal(c.url.searchParams.get('as'), CLIENT);
  assert.deepEqual(out.json.briefs[0], { briefSlug: SLUG, title: 'Weekly', public: true, publicUrl: brief.publicUrl, pdfUrl: brief.pdfDownloadUrl, updatedAt: 't' });
});

test('invoke: a route answering for another client is refused; no origin is refused', async () => {
  const bad = fakeRoute({ respondClientId: 'bryan-balli-home' });
  const out = await invokeAction(getAction('briefs.client.publish'), { text: 'x' }, ctx, { routeModules: bad.routeModules });
  assert.equal(out.ok, false);
  assert.match(out.json.error, /not "not-the-rug-abc123"/);
  await assert.rejects(invokeAction(getAction('briefs.client.list'), {}, { ...ctx, origin: null }, { routeModules: bad.routeModules }), /public origin/);
});

const mkRuntime = (r, counters) => createActionRuntime({ ...createMemoryActionStores(), counters, invoke: (e, a, c) => invokeAction(e, a, c, { routeModules: r.routeModules }), registry: { ACTIONS, getAction, findActions } });

test('runtime: tier-1 publish runs, result carries links, undo unpublishes via PATCH', async () => {
  const r = fakeRoute();
  const rt = mkRuntime(r, createMemoryCounters());
  const res = await rt.run(ctx, { actionId: 'briefs.client.publish', args: { text: '# Hi' } });
  assert.equal(res.kind, 'result');
  assert.equal(res.result.output.publicUrl, brief.publicUrl);
  assert.equal(res.result.output.pdfUrl, brief.pdfDownloadUrl);
  assert.ok(res.result.undoId);
  const undone = await rt.undo(ctx, res.result.undoId);
  assert.equal(undone.ok, true);
  const last = r.calls.at(-1);
  assert.equal(last.method, 'PATCH');
  assert.deepEqual(last.body, { briefSlug: SLUG, public: false, clientId: CLIENT });
});

test('runtime: batch publish is refused (one brief per call), nothing is called', async () => {
  const r = fakeRoute();
  const rt = mkRuntime(r, createMemoryCounters());
  const res = await rt.run(ctx, { actionId: 'briefs.client.publish', items: [{ text: 'a' }, { text: 'b' }] });
  assert.equal(res.kind, 'error');
  assert.match(res.error, /one item per call/);
  assert.equal(r.calls.length, 0);
});

test('runtime: the shared daily cap refuses the 21st publish; no counters fails closed', async () => {
  const r = fakeRoute();
  const counters = createMemoryCounters();
  const rt = mkRuntime(r, counters);
  for (let i = 0; i < DAILY_CLIENT_BRIEF_CAP; i += 1) assert.equal((await rt.run(ctx, { actionId: 'briefs.client.publish', args: { text: 'x' } })).result.ok, true);
  const over = await rt.run(ctx, { actionId: 'briefs.client.publish', args: { text: 'x' } });
  assert.equal(over.result.ok, false);
  assert.equal(r.calls.length, DAILY_CLIENT_BRIEF_CAP, 'route not called past the cap');
  const r2 = fakeRoute();
  const none = await mkRuntime(r2, undefined).run(ctx, { actionId: 'briefs.client.publish', args: { text: 'x' } });
  assert.equal(none.result.ok, false);
  assert.equal(r2.calls.length, 0);
});

test('runtime: an UPDATE is not undoable and says so; a CREATE is', async () => {
  const r = fakeRoute();
  const rt = mkRuntime(r, createMemoryCounters());
  const upd = await rt.run(ctx, { actionId: 'briefs.client.publish', args: { text: 'x', briefSlug: SLUG } });
  assert.equal(upd.result.ok, true);
  assert.ok(!upd.result.undoId);
  assert.match(upd.result.undoNote, /updated in place; previous text is overwritten \(no undo\)/);
  assert.equal(upd.result.output.publicUrl, brief.publicUrl);
  const created = await rt.run(ctx, { actionId: 'briefs.client.publish', args: { text: 'x' } });
  assert.ok(created.result.undoId);
});
