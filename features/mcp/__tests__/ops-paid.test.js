import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, OWNER, OTHER, NOW } from './ops-world.js';
import { opsCapKey, opsPaidGlobalKey } from '../ops/runs.js';
import { dailyPaidKey, auditEntry } from '../limits.js';
import { PREVIEW_TTL_MS } from '../ops/preview.js';

const SHOWCASE = { focusId: 'hero-line', format: 'feed' };
const paramsFor = (id) => (id === 'site-showcase' ? { params: SHOWCASE } : {});
const preview = async (w, refreshId, extra = {}) => w.json(await w.call('run_refresh', { refreshId, ...paramsFor(refreshId), ...extra }));
const confirm = (w, refreshId, previewToken, extra = {}) => w.call('run_refresh', { refreshId, ...paramsFor(refreshId), confirm: true, previewToken, ...extra });
const go = async (w, refreshId, extra = {}) => { const p = await preview(w, refreshId, extra); return confirm(w, refreshId, p.previewToken, extra); };
const untouched = (w) => w.spies.digest.length + w.spies.xmonitor.length + w.spies.showcase.length + w.spies.agent.length === 0 && w.counters._raw.size === 0 && w.stores.runs._raw.size === 0 && w.stores.locks._raw.size === 0 && w.stores.previews._raw.size === 0;
const PAID_IDS = ['market-signals', 'analysis', 'renders', 'x-monitor', 'strategy-review', 'site-showcase'];

test('preview: every paid id returns estimate + effects + token and invokes / reserves / locks / consumes NOTHING', async () => {
  const w = makeWorld();
  for (const id of PAID_IDS) {
    const p = await preview(w, id);
    assert.equal(p.needsConfirm, true, id); assert.equal(p.ran, false, id);
    assert.ok(p.estimate && p.effects.length && p.previewToken && p.expiresAt, id);
    assert.equal(p.needsOwnerSignoff, undefined);
    assert.equal(Date.parse(p.expiresAt), NOW + PREVIEW_TTL_MS);
  }
  assert.ok(untouched(w));
  assert.equal(w.spies.shared.length, 0);
});

test('preview: analysis states BOTH the digest delivery record and the possible hosted Executive Brief publication', async () => {
  const p = await preview(makeWorld(), 'analysis');
  const text = p.effects.join(' ');
  assert.match(text, /digest delivery record/); assert.match(text, /MAY PUBLISH a fresh hosted Executive Brief/);
});

test('preview: market-signals names the metered X watchlist reads; x-monitor prices the call count', async () => {
  const w = makeWorld();
  assert.match((await preview(w, 'market-signals')).effects.join(' '), /metered X watchlist reads/);
  const x = await preview(w, 'x-monitor', { params: { include: ['profile', 'posts', 'audience'] } });
  assert.match(x.estimate, /Up to 5 metered X API READ calls/);
});

test('confirm refusals: no token, garbage, tampered, other client, other refresh, other user, expired: nothing runs, nothing burned', async () => {
  const w = makeWorld();
  const p = await preview(w, 'analysis');
  const cases = [
    ['no token', () => w.call('run_refresh', { refreshId: 'analysis', confirm: true }), /needs the previewToken/],
    ['garbage token', () => confirm(w, 'analysis', 'abc.def'), /not valid/],
    ['tampered signature', () => confirm(w, 'analysis', `${p.previewToken.split('.')[0]}.AAAA`), /not valid/],
    ['different client', () => confirm(w, 'analysis', p.previewToken, { clientId: OTHER }), /different client/],
    ['different refresh', () => confirm(w, 'renders', p.previewToken), /different refresh/],
    ['different user', () => w.call('run_refresh', { refreshId: 'analysis', clientId: OWNER, confirm: true, previewToken: p.previewToken }, { ...w.ctx, email: 'other-admin@example.com' }), /different user/],
  ];
  for (const [name, fn, re] of cases) {
    const r = await fn();
    assert.equal(r.isError, true, name); assert.match(r.content[0].text, re, name);
  }
  assert.ok(untouched(w));
  w.clock.now += PREVIEW_TTL_MS + 1000;
  const late = await confirm(w, 'analysis', p.previewToken);
  assert.equal(late.isError, true); assert.match(late.content[0].text, /expired/);
  assert.ok(untouched(w));
});

test('confirm refusals: params bound for params-taking refreshes (x-monitor include, showcase focus) and estimate changes', async () => {
  const w = makeWorld();
  const p = await preview(w, 'x-monitor', { params: { include: ['profile'] } });
  const bad = await w.call('run_refresh', { refreshId: 'x-monitor', params: { include: ['profile', 'posts'] }, confirm: true, previewToken: p.previewToken });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /does not match these params/);
  const s = await preview(w, 'site-showcase');
  const bad2 = await w.call('run_refresh', { refreshId: 'site-showcase', params: { focusId: 'site-tour', format: 'feed' }, confirm: true, previewToken: s.previewToken });
  assert.equal(bad2.isError, true);
  const a = await preview(w, 'x-monitor', { params: { include: ['audience'] } });
  const realXm = w.ops.paid.xMonitor;
  w.ops.paid.xMonitor = async (c) => ({ ...(await realXm(c)), estimateAudienceCalls: async () => ({ pages: 9 }) });
  const stale = await w.call('run_refresh', { refreshId: 'x-monitor', params: { include: ['audience'] }, confirm: true, previewToken: a.previewToken });
  assert.equal(stale.isError, true); assert.match(stale.content[0].text, /estimate changed/);
  assert.ok(untouched(w));
});

test('single use: a reused token is refused, and two concurrent confirms start exactly ONE run', async () => {
  const w = makeWorld();
  const p = await preview(w, 'analysis');
  const [a, b] = await Promise.all([confirm(w, 'analysis', p.previewToken), confirm(w, 'analysis', p.previewToken)]);
  const results = [a, b];
  assert.equal(results.filter((r) => r.isError).length, 1);
  assert.match(results.find((r) => r.isError).content[0].text, /already used/);
  await w.runDeferred();
  assert.equal(w.spies.digest.length, 1);
  assert.equal(w.stores.previews._raw.size, 1);
  assert.ok([...w.stores.previews._raw.keys()].every((k) => /^[0-9a-f]{64}$/.test(k)), 'only a hash is stored');
  const again = await confirm(w, 'analysis', p.previewToken);
  assert.match(again.content[0].text, /already used/);
});

test('defer: confirm returns {runId, running} at once; the work finishes later and updates the run', async () => {
  const w = makeWorld();
  const r = w.json(await go(w, 'analysis'));
  assert.equal(r.ran, true); assert.equal(r.status, 'running'); assert.match(r.runId, /^run_/);
  assert.equal(w.spies.digest.length, 0, 'not started yet: returned before the work');
  assert.equal(w.json(await w.call('get_run_status', { runId: r.runId })).status, 'running');
  assert.equal(w.stores.locks._raw.size, 1, 'lock held while active');
  await w.runDeferred();
  assert.equal(w.spies.digest.length, 1);
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'done');
  assert.equal(w.stores.locks._raw.size, 0, 'lock released');
  assert.equal(w.counters._raw.get(opsCapKey('analysis', OWNER, NOW)), 1);
  assert.equal(w.counters._raw.get(opsPaidGlobalKey(NOW)), 1);
});

test('digest groups: ONE single-item Set per run, the right phase, source mcp-ops, and never allowX / allowXWatchlist / x-search', async () => {
  const w = makeWorld();
  for (const [id, phase] of [['market-signals', 'signals'], ['analysis', 'analysis'], ['renders', 'modules']]) {
    await go(w, id); await w.runDeferred();
    const call = w.spies.digest.at(-1);
    assert.equal(call.clientId, OWNER);
    assert.ok(call.args.groups instanceof Set); assert.deepEqual([...call.args.groups], [id]);
    assert.equal(call.args.phase, phase); assert.equal(call.args.source, 'mcp-ops');
    assert.ok(!('allowX' in call.args) && !('allowXWatchlist' in call.args), 'no paid X flags');
    assert.ok(!call.args.groups.has('x-search'));
    assert.deepEqual(call.args.include, { signals: true }); assert.equal(call.args.briefLinkMode, 'latest');
  }
  assert.equal(w.spies.agent.length, 0, 'the free agent engine is not involved');
});

test('failure: a throwing runner marks the run failed and releases the lock; a preflight refusal is failed, step errors are done with a note', async () => {
  const w = makeWorld();
  w.ops.paid.digestRefresh = async () => { throw new Error('model down'); };
  const r = w.json(await go(w, 'renders'));
  await w.runDeferred();
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'failed'); assert.match(st.detail, /model down/);
  assert.equal(w.stores.locks._raw.size, 0);
  w.ops.paid.digestRefresh = async () => ({ ok: false, sendable: false, skipped: true, reason: 'delivery-breaker-paused', modules: { ok: false, skipped: true, reason: 'other-phase' } });
  const r2 = w.json(await go(w, 'renders')); await w.runDeferred();
  const st2 = w.json(await w.call('get_run_status', { runId: r2.runId }));
  assert.equal(st2.status, 'failed'); assert.match(st2.detail, /Not run: delivery-breaker-paused/);
});

test('digest outcome: when any step ran the run is DONE with a per-step summary, step errors and freshBriefPath noted', async () => {
  const w = makeWorld();
  w.ops.paid.digestRefresh = async () => ({
    ok: false, sendable: true, phase: 'analysis',
    modules: { ok: true, skipped: true, reason: 'other-phase' }, scout: { ok: true, skipped: true, reason: 'other-phase' },
    strategy: { ok: false, error: 'strategy blew up' }, executiveSummary: { ok: true, written: ['a'] },
    digestFreshness: { freshBriefPath: '/briefs/abc' }, freshBrief: { ok: true, path: '/briefs/abc' },
  });
  const r = w.json(await go(w, 'analysis')); await w.runDeferred();
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'done');
  assert.match(st.detail, /with 1 step error/); assert.match(st.detail, /strategy failed \(strategy blew up\)/); assert.match(st.detail, /executiveSummary ok/); assert.match(st.detail, /freshBriefPath \/briefs\/abc/);
  assert.ok(!/modules|scout/.test(st.detail.replace(/Analysis[^.]*ran/, '')), 'other-phase steps are not listed');
});

test('defer that throws synchronously: the run is marked failed, the lock is released, nothing is reported as started', async () => {
  const w = makeWorld();
  w.services.defer = () => { throw new Error('after() unavailable'); };
  const r = w.json(await go(w, 'analysis'));
  assert.equal(r.ran, false); assert.equal(r.status, 'failed'); assert.equal(r.reason, 'defer-failed');
  assert.equal(w.stores.locks._raw.size, 0, 'lock released');
  const row = await w.stores.runs.get(r.runId);
  assert.equal(row.status, 'failed'); assert.match(row.detail, /after\(\) unavailable/);
  assert.equal(w.spies.digest.length, 0);
});

test('preview consume: only ALREADY_EXISTS means "used"; any other store error fails closed with a generic message', async () => {
  const w = makeWorld();
  const p = await preview(w, 'analysis');
  w.stores.previews.create = async () => { throw new Error('firestore unavailable'); };
  const r = await confirm(w, 'analysis', p.previewToken);
  assert.equal(r.isError, true); assert.match(r.content[0].text, /Could not record the confirmation/); assert.ok(!/already used/.test(r.content[0].text));
  assert.equal(w.spies.digest.length, 0); assert.equal(w.stores.locks._raw.size, 0); assert.equal(w.counters._raw.size, 0);
});

test('token MAC key is derived from the secret (a token signed with the raw secret is rejected)', async () => {
  const { createHmac } = await import('node:crypto');
  const w = makeWorld();
  const p = await preview(w, 'analysis');
  const body = p.previewToken.split('.')[0];
  const forged = `${body}.${createHmac('sha256', w.ops.secret).update(body).digest('base64url')}`;
  const r = await confirm(w, 'analysis', forged);
  assert.equal(r.isError, true); assert.match(r.content[0].text, /not valid/);
  assert.equal(w.spies.digest.length, 0);
});

test('list_refreshes paidCaps: ops global cap scope vs the shared request_sync slots', async () => {
  const w = makeWorld();
  const out = w.json(await w.call('list_refreshes'));
  assert.deepEqual(out.paidCaps.appliesTo, ['market-signals', 'analysis', 'renders', 'x-search', 'site-showcase']);
  assert.equal(out.paidCaps.syncKindsShareDailyPaidSlots, 10);
  assert.match(out.paidCaps.syncKindsNote, /x-monitor and strategy-review .*share the existing 10\/day request_sync paid slots/);
});

test('redaction: refreshId is shown, but refresh_token / refreshToken / token-ish keys stay redacted', async () => {
  const { redactValue } = await import('../redact.js');
  const out = redactValue({ refreshId: 'analysis', refresh_token: 'rt-secret-1', refreshToken: 'rt-secret-2', previewToken: 'p.q', refreshes: 'x' });
  assert.equal(out.refreshId, 'analysis');
  assert.equal(out.refresh_token, '[redacted]'); assert.equal(out.refreshToken, '[redacted]'); assert.equal(out.previewToken, '[redacted]');
  const row = auditEntry({ now: NOW, email: 'o@example.com', tool: 'run_refresh', args: { refreshId: 'analysis', previewToken: 'abc.def' }, ok: true, ms: 1 });
  assert.match(row.args, /"refreshId":"analysis"/); assert.ok(!row.args.includes('abc.def'));
});

test('lock: a second run for the same client+refresh is refused while active; other refresh / other client are fine; lease expiry frees it', async () => {
  const w = makeWorld();
  let release; w.holds.digest = new Promise((r) => { release = r; });
  const first = w.json(await go(w, 'analysis'));
  assert.equal(first.ran, true);
  const second = w.json(await go(w, 'analysis'));
  assert.equal(second.ran, false); assert.equal(second.reason, 'already-running');
  assert.equal(w.counters._raw.get(opsCapKey('analysis', OWNER, NOW)), 1, 'the refusal did not burn the cap');
  assert.equal(w.json(await go(w, 'renders')).ran, true, 'other refresh, same client');
  assert.equal(w.json(await go(w, 'analysis', { clientId: OTHER })).ran, true, 'other client, same refresh');
  w.clock.now += 6 * 60_000 + 1; // lease (6 min) expired: a crashed run cannot block forever
  assert.equal(w.json(await go(w, 'analysis')).ran, true);
  release();
  await w.runDeferred();
});

test('lock: released when anything throws before the work is handed off', async () => {
  const w = makeWorld();
  const realCreate = w.stores.runs.create;
  w.stores.runs.create = async () => { throw new Error('store down'); };
  const r = await go(w, 'analysis');
  assert.equal(r.isError, true);
  assert.equal(w.stores.locks._raw.size, 0, 'lock released on throw');
  w.stores.runs.create = realCreate;
  assert.equal(w.json(await go(w, 'analysis')).ran, true);
});

test('status: a paid run past its lease that never finished reads timed-out, never running', async () => {
  const w = makeWorld();
  const r = w.json(await go(w, 'analysis')); // deferred work never runs (killed)
  w.clock.now += 6 * 60_000 + 1;
  assert.equal(w.json(await w.call('get_run_status', { runId: r.runId })).status, 'timed-out');
  const cross = await w.call('get_run_status', { runId: r.runId, clientId: OTHER });
  assert.equal(cross.isError, true);
});

test('caps: per refresh per client per day (3), refused at preview time without burning anything', async () => {
  const w = makeWorld();
  for (let i = 0; i < 3; i += 1) { assert.equal(w.json(await go(w, 'market-signals')).ran, true); await w.runDeferred(); }
  const over = await w.call('run_refresh', { refreshId: 'market-signals' });
  assert.equal(over.isError, true); assert.match(over.content[0].text, /Daily limit reached: 3/);
  assert.equal(w.counters._raw.get(opsCapKey('market-signals', OWNER, NOW)), 3);
  assert.equal(w.stores.previews._raw.size, 3, 'no token was issued or consumed for the refused call');
  assert.equal(w.json(await go(w, 'market-signals', { clientId: OTHER })).ran, true, 'another client is independent');
  await w.runDeferred();
  w.clock.now += 86400000;
  assert.equal(w.json(await go(w, 'market-signals')).ran, true, 'next UTC day');
});

test('caps: site-showcase is 2 per client per day', async () => {
  const w = makeWorld();
  for (let i = 0; i < 2; i += 1) { assert.equal(w.json(await go(w, 'site-showcase')).ran, true); await w.runDeferred(); }
  assert.match((await w.call('run_refresh', { refreshId: 'site-showcase', params: SHOWCASE })).content[0].text, /Daily limit reached: 2/);
});

test('caps: global paid cap (10 a day) across refreshes and clients', async () => {
  const w = makeWorld();
  for (const id of ['market-signals', 'analysis', 'renders']) for (let i = 0; i < 3; i += 1) { assert.equal(w.json(await go(w, id)).ran, true, id); await w.runDeferred(); }
  assert.equal(w.json(await go(w, 'analysis', { clientId: OTHER })).ran, true);
  await w.runDeferred();
  assert.equal(w.counters._raw.get(opsPaidGlobalKey(NOW)), 10);
  const over = await w.call('run_refresh', { refreshId: 'renders', clientId: OTHER });
  assert.equal(over.isError, true); assert.match(over.content[0].text, /10 paid MCP refreshes/);
  assert.equal(w.counters._raw.get(opsPaidGlobalKey(NOW)), 10);
});

test('x-monitor: runs through executePaidSync and uses the EXISTING daily paid slot once (no ops caps double-counted)', async () => {
  const w = makeWorld();
  const r = w.json(await go(w, 'x-monitor'));
  assert.equal(r.status, 'running');
  await w.runDeferred();
  assert.deepEqual(w.spies.xmonitor, ['profile', 'posts']);
  assert.equal(w.counters._raw.get(dailyPaidKey(NOW)), 1);
  assert.equal(w.counters._raw.get(opsCapKey('x-monitor', OWNER, NOW)), undefined);
  assert.equal(w.counters._raw.get(opsPaidGlobalKey(NOW)), undefined);
  assert.equal(w.json(await w.call('get_run_status', { runId: r.runId })).status, 'done');
});

test('x-monitor / strategy-review: refused at preview time when the shared daily paid slots are used up', async () => {
  const w = makeWorld();
  w.counters._raw.set(dailyPaidKey(NOW), 10);
  for (const id of ['x-monitor', 'strategy-review']) {
    const r = await w.call('run_refresh', { refreshId: id });
    assert.equal(r.isError, true, id); assert.match(r.content[0].text, /Daily limit reached: 10 paid syncs/);
  }
  assert.equal(w.spies.xmonitor.length, 0);
});

test('strategy-review: executePaidSync path with the existing handlers (one slot), result recorded', async () => {
  const w = makeWorld();
  w.services.strategyHandlers = () => ({ handle: async (action, body, context) => { w.spies.sync.push([action, body, context]); return { ok: true, threadId: 'th1', proposals: [] }; } });
  const r = w.json(await go(w, 'strategy-review'));
  await w.runDeferred();
  assert.deepEqual(w.spies.sync[0].slice(0, 2), ['strategy-review', { clientId: OWNER }]);
  assert.equal(w.counters._raw.get(dailyPaidKey(NOW)), 1);
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'done'); assert.match(st.detail, /th1/);
});

test('site-showcase: validated params, owner auth + ?as=clientId, job client verified, status via the route GET (healing path)', async () => {
  const w = makeWorld();
  const bad = await w.call('run_refresh', { refreshId: 'site-showcase', params: { focusId: 'nope', format: 'feed' } });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /Unknown focus/);
  const notHome = await w.call('run_refresh', { refreshId: 'site-showcase', params: SHOWCASE, clientId: OTHER });
  assert.equal(notHome.isError, true); assert.match(notHome.content[0].text, /not enabled for this client/);
  const r = w.json(await go(w, 'site-showcase'));
  await w.runDeferred();
  assert.equal(w.spies.showcase.length, 1);
  assert.deepEqual(w.spies.showcase[0], { as: OWNER, action: 'create', authorization: 'Bearer test-owner', body: { focusId: 'hero-line', format: 'feed', theme: 'cycle' } });
  let st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'running'); assert.equal(st.requestId, 'sc_test_job1');
  w.showcaseJobs.get('sc_test_job1').status = 'rendering';
  assert.equal(w.json(await w.call('get_run_status', { runId: r.runId })).status, 'running');
  w.showcaseJobs.get('sc_test_job1').status = 'done';
  Object.assign(w.showcaseJobs.get('sc_test_job1'), { downloadUrl: 'https://cdn.test/v.mp4', sizeBytes: 1234, durationInFrames: 300 });
  st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'done');
  assert.deepEqual(st.result, { url: 'https://cdn.test/v.mp4', sizeBytes: 1234, durationInFrames: 300 });
  assert.equal(w.spies.showcase.length, 1, 'status never creates another job (POST not called again)');
  assert.ok(w.spies.showcaseStatus.length >= 3, 'status goes through the route GET (healing path)');
  assert.deepEqual(w.spies.showcaseStatus[0], { as: OWNER, action: 'status', jobId: 'sc_test_job1', method: 'GET' });
  assert.equal(w.stores.locks._raw.size, 0);
});

test('site-showcase: a job that belongs to another client is reported as a refusal, not success', async () => {
  const w = makeWorld();
  w.world.showcaseJobClient = OTHER;
  const r = w.json(await go(w, 'site-showcase'));
  await w.runDeferred();
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'failed'); assert.match(st.detail, /not for client/);
});

test('site-showcase: a route refusal (409 / 429) marks the run failed with the route message', async () => {
  const w = makeWorld();
  w.services.showcaseRoute = async () => ({ POST: async () => new Response(JSON.stringify({ error: 'A showcase render is already running.' }), { status: 409 }) });
  const r = w.json(await go(w, 'site-showcase')); await w.runDeferred();
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'failed'); assert.match(st.detail, /already running/);
});

test('no defer available: the work runs inline and the real final status is returned', async () => {
  const w = makeWorld({ defer: 'none' });
  const r = w.json(await go(w, 'analysis'));
  assert.equal(r.status, 'done'); assert.equal(w.spies.digest.length, 1); assert.equal(w.stores.locks._raw.size, 0);
});

test('no signing secret: paid previews are refused (fail closed)', async () => {
  const w = makeWorld();
  w.ops.secret = null;
  const r = await w.call('run_refresh', { refreshId: 'analysis' });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /signing secret/);
  assert.ok(untouched(w));
});

test('audit: previewToken is redacted in mcp_audit rows', () => {
  const token = 'eyJqIjoiYWJjIn0.SIGNATURE-VALUE-123';
  const row = auditEntry({ now: NOW, email: 'o@example.com', tool: 'run_refresh', args: { refreshId: 'analysis', confirm: true, previewToken: token }, ok: true, ms: 5 });
  assert.ok(!row.args.includes(token) && !row.args.includes('SIGNATURE'));
  assert.match(row.args, /\[redacted\]/);
  assert.match(row.args, /"confirm":true/);
});

test('free path is unchanged: free ids ignore confirm / token and need none', async () => {
  const w = makeWorld();
  const r = w.json(await w.call('run_refresh', { refreshId: 'bookmarks' }));
  assert.equal(r.ran, true); assert.equal(w.stores.previews._raw.size, 0);
});

test('site-showcase status: falls back to the job doc only when the route call fails; error shape {stage,message} is mapped; job client verified', async () => {
  const w = makeWorld();
  const r = w.json(await go(w, 'site-showcase')); await w.runDeferred();
  w.routeMode.statusFails = true;
  Object.assign(w.showcaseJobs.get('sc_test_job1'), { status: 'failed', error: { stage: 'render', message: 'boom' } });
  const st = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(st.status, 'failed'); assert.deepEqual(st.underlying, { status: 'failed', error: 'boom', stage: 'render' });
  w.showcaseJobs.get('sc_test_job1').clientId = OTHER; // doc fallback also verifies the client
  const again = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(again.status, 'failed', 'already terminal: unchanged');
  const w2 = makeWorld();
  const r2 = w2.json(await go(w2, 'site-showcase')); await w2.runDeferred();
  w2.showcaseJobs.get('sc_test_job1').clientId = OTHER;
  w2.routeMode.statusFails = true;
  const st2 = w2.json(await w2.call('get_run_status', { runId: r2.runId }));
  assert.equal(st2.status, 'running', 'foreign job doc is ignored, run stays unresolved (never marked done)');
});
