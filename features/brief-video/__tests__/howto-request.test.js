import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { validateHowtoRequest, submitHowtoRequest, getHowtoRequest } = await import('../howto-request.js');
const { classifyBrief, howtoSpecHash } = await import('../howto.js');
const { parseArgs, planApproval, applyApproval } = await import('../../../scripts/cq-howto/approve-request.mjs');
const { getAction, validateAction, ACTIONS } = await import('../../x-strategy/agent/action-registry.js');

const CLIENT = 'paradice-dbBQCHUX';
const good = () => ({
  request_version: 3, id: 'gather-first-decision', review_on: '2026-11-18', type: 'how-to', game_commit: '3d70fa48f',
  goal: 'g', audience: 'new player', public_copy: 'The first decision in Critters Quest.', hook: 'What do you gather first?', banner: 'GATHER NOW',
  host: { name: 'mayor' }, arrival: { say: 'Let me show you.' },
  steps: [
    { say: 'Tap a spot, then the axe.', panel: 'spotTile', surface: 'canvas', clicks: [{ target: 'spot', handler: 'Spots.ts:856' }] },
    { say: 'Pick a critter and send it.', panel: 'critterSelection', surface: 'card', clicks: [{ target: 'GO', handler: 'C.tsx:1412' }] },
  ],
  payoff: { say: 'Every haul stocks your town!', spot_art: 'images/Sapling.png', town: { name: 'Maple Hollow', level: 3 } },
});
let ctx;
beforeEach(() => { ctx = makeFakeContext(); });
const db = () => ctx.adminDb;
const submit = (request, clientId = CLIENT) => submitHowtoRequest(db(), { clientId, request, by: 'o@x.com', now: () => '2026-11-18T10:00:00Z' });

test('valid request: no errors or warnings', () => {
  assert.deepEqual(validateHowtoRequest(good()), { errors: [], warnings: [] });
});

test('validation errors', () => {
  const bad = (mut) => { const r = good(); mut(r); return validateHowtoRequest(r).errors.join('|'); };
  assert.match(bad((r) => { r.request_version = 2; }), /request_version/);
  assert.match(bad((r) => { r.id = 'AB'; }), /id must match/);
  assert.match(bad((r) => { r.review_on = '18-11-2026'; }), /review_on/);
  assert.match(bad((r) => { r.type = 'ad'; }), /type/);
  assert.match(bad((r) => { r.public_copy = 'x'.repeat(281); }), /280/);
  assert.match(bad((r) => { delete r.hook; }), /hook is required/);
  assert.match(bad((r) => { r.host = {}; }), /host.name/);
  assert.match(bad((r) => { r.steps = [r.steps[0]]; }), /2 to 4/);
  assert.match(bad((r) => { r.steps[0].clicks = []; }), /at least 1 click/);
  assert.match(bad((r) => { delete r.steps[1].clicks[0].handler; }), /handler is required/);
  assert.match(bad((r) => { r.payoff.town.level = 16; }), /1-15/);
  assert.match(bad((r) => { r.payoff.town.level = '3'; }), /1-15/);
  assert.match(bad((r) => { r.extra = 'x'.repeat(33 * 1024); }), /bytes/);
  assert.match(validateHowtoRequest(null).errors[0], /object/);
});

test('copy budget is warnings, not errors', () => {
  const r = good();
  r.arrival.say = 'Let me show you all of this now';
  r.steps[0].say = 'Tap it';
  r.payoff.say = 'Good';
  r.banner = 'gather';
  const v = validateHowtoRequest(r);
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings.length, 5);
});

test('submit writes the record, returns briefLine that classifies as howto', async () => {
  const out = await submit(good());
  assert.equal(out.ok, true);
  assert.equal(out.briefLine, 'INTERNAL VIDEO BRIEF: howto=gather-first-decision');
  assert.match(out.next, /queue\.draft\.create/);
  const rec = db()._raw('howto_requests', 'gather-first-decision');
  assert.equal(rec.status, 'submitted');
  assert.equal(rec.clientId, CLIENT);
  assert.equal(rec.requestVersion, 3);
  assert.equal(rec.submittedBy, 'o@x.com');
  const content = `${good().public_copy}\n\n${out.briefLine}`;
  const brief = content.split(/INTERNAL VIDEO BRIEF:/i)[1].trim();
  assert.deepEqual(classifyBrief(brief), { kind: 'howto', howtoId: 'gather-first-decision' });
});

test('resubmit allowed while submitted (keeps submittedAt); locked after owner status', async () => {
  await submit(good());
  const again = good(); again.hook = 'New hook?';
  const out = await submitHowtoRequest(db(), { clientId: CLIENT, request: again, by: 'o', now: () => '2026-11-19T00:00:00Z' });
  assert.equal(out.ok, true);
  const rec = db()._raw('howto_requests', 'gather-first-decision');
  assert.equal(rec.request.hook, 'New hook?');
  assert.equal(rec.submittedAt, '2026-11-18T10:00:00Z');
  for (const status of ['approved', 'building', 'rejected']) {
    await db().collection('howto_requests').doc('gather-first-decision').set({ ...rec, status });
    const locked = await submit(good());
    assert.deepEqual([locked.ok, locked.error, locked.status], [false, `request-locked:${status}`, 409]);
    assert.equal(db()._raw('howto_requests', 'gather-first-decision').status, status);
  }
});

test('client allowlist and validation errors write nothing', async () => {
  const other = await submit(good(), 'other-client');
  assert.equal(other.ok, false);
  assert.match(other.error, /client-not-allowed/);
  const bad = good(); bad.id = 'X';
  const inv = await submit(bad);
  assert.equal(inv.error, 'invalid-request');
  assert.ok(inv.errors.length);
  assert.equal(db()._store.get('howto_requests'), undefined);
});

test('get: record with recomputed warnings; other client / missing refused', async () => {
  await submit(good());
  const g = await getHowtoRequest(db(), { clientId: CLIENT, id: 'gather-first-decision' });
  assert.equal(g.ok, true);
  assert.equal(g.status, 'submitted');
  assert.deepEqual(g.warnings, []);
  assert.equal(g.briefLine, 'INTERNAL VIDEO BRIEF: howto=gather-first-decision');
  assert.equal((await getHowtoRequest(db(), { clientId: CLIENT, id: 'nope-nope' })).status, 404);
  assert.equal((await getHowtoRequest(db(), { clientId: 'x', id: 'gather-first-decision' })).status, 403);
  assert.equal((await getHowtoRequest(db(), { clientId: CLIENT, id: 'A' })).status, 400);
});

test('catalog: entries valid, routed to howto-requests, tiers', () => {
  const s = getAction('video.howto.request.submit');
  const g = getAction('video.howto.request.get');
  assert.deepEqual(validateAction(s), []);
  assert.deepEqual(validateAction(g), []);
  assert.deepEqual([s.tier, s.method, s.action, s.route], [1, 'POST', 'submit', 'howto-requests']);
  assert.deepEqual([g.tier, g.method, g.query.action], [0, 'GET', 'get']);
  assert.match(getAction('queue.draft.create').description, /INTERNAL VIDEO BRIEF: howto=<id>/);
  assert.ok(ACTIONS.filter((a) => a.group === 'video').length === 2);
});

test('approve script: parseArgs + planApproval (pure)', () => {
  assert.deepEqual(parseArgs(['--id', 'abc', '--spec', 'p.json', '--image-revision', 'r1', '--write']), { write: true, id: 'abc', spec: 'p.json', imageRevision: 'r1' });
  const spec = { id: 'abc-def', mode: 'final', x: 1 };
  const cur = { id: 'abc-def', status: 'submitted' };
  const now = '2026-11-18T00:00:00Z';
  const ok = planApproval({ args: { id: 'abc-def', imageRevision: 'r1', note: 'ok' }, spec, current: cur, now });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.update, { status: 'approved', updatedAt: now, specHash: howtoSpecHash(spec), approvedAt: now, approvedBy: 'owner-script', imageRevision: 'r1', note: 'ok' });
  const no = (a, s, c = cur) => planApproval({ args: a, spec: s, current: c, now }).error;
  assert.match(no({ id: 'abc-def' }, { ...spec, mode: 'review' }), /final/);
  assert.match(no({ id: 'abc-def' }, { ...spec, id: 'zzz' }), /does not match/);
  assert.match(no({ id: 'abc-def' }, null), /--spec/);
  assert.match(no({ id: 'abc-def' }, spec, null), /does not exist/);
  assert.match(no({ id: 'abc-def', status: 'live' }, spec), /status must be/);
  const rej = planApproval({ args: { id: 'abc-def', status: 'rejected', note: 'no' }, spec: null, current: cur, now });
  assert.deepEqual(rej.update, { status: 'rejected', updatedAt: now, note: 'no' });
});

test('approve script: applyApproval --write runs read+update in one transaction', async () => {
  const spec = { id: 'abc-def', mode: 'final' };
  const mk = (data) => {
    const log = [];
    const ref = { get: async () => { log.push('plain-get'); return { exists: !!data, data: () => data }; } };
    const tx = { get: async () => { log.push('tx-get'); return { exists: !!data, data: () => data }; }, update: (r, u) => log.push(['tx-update', u.status]) };
    const db = { collection: () => ({ doc: () => ref }), runTransaction: async (fn) => fn(tx) };
    return { db, log };
  };
  const now = '2026-11-18T00:00:00Z';
  let f = mk({ id: 'abc-def', status: 'submitted' });
  assert.equal((await applyApproval({ db: f.db, args: { id: 'abc-def', write: true }, spec, now })).ok, true);
  assert.deepEqual(f.log, ['tx-get', ['tx-update', 'approved']]);
  f = mk(null);
  assert.match((await applyApproval({ db: f.db, args: { id: 'abc-def', write: true }, spec, now })).error, /does not exist/);
  assert.deepEqual(f.log, ['tx-get']);
  f = mk({ id: 'abc-def' });
  await applyApproval({ db: f.db, args: { id: 'abc-def' }, spec, now });
  assert.deepEqual(f.log, ['plain-get']);
});
