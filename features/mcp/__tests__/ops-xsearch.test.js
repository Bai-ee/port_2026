import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, OWNER, OTHER, NOW } from './ops-world.js';
import { opsCapKey, opsPaidGlobalKey } from '../ops/runs.js';
import { buildDigestRefreshArgs, buildXSearchRefreshArgs } from '../ops/paid.js';
import { REFRESHES } from '../ops/catalog.js';
import { planXSearch, xSearchOutcome } from '../ops/xsearch.js';

const preview = async (w, extra = {}) => w.json(await w.call('run_refresh', { refreshId: 'x-search', ...extra }));
const confirm = (w, previewToken, extra = {}) => w.call('run_refresh', { refreshId: 'x-search', confirm: true, previewToken, ...extra });
const go = async (w, extra = {}) => { const p = await preview(w, extra); return confirm(w, p.previewToken, extra); };
const nothingHappened = (w) => w.spies.digest.length === 0 && w.counters._raw.size === 0 && w.stores.runs._raw.size === 0 && w.stores.locks._raw.size === 0 && w.stores.previews._raw.size === 0;
const setOpp = (w, patch) => { w.xsearch.marketingBriefConfig.opportunitySignals = { ...w.xsearch.marketingBriefConfig.opportunitySignals, ...patch }; };

test('list_refreshes: x-search is paid, preview-then-confirm, capped 3/day, with the disclosure; no longer excluded', async () => {
  const w = makeWorld();
  const out = w.json(await w.call('list_refreshes'));
  const r = out.refreshes.find((x) => x.id === 'x-search');
  assert.equal(r.costClass, 'paid'); assert.equal(r.availability, 'preview-then-confirm'); assert.equal(r.runnable, true); assert.equal(r.maxPerDay, 3); assert.equal(r.usedToday, 0);
  const text = r.effects.join(' ');
  assert.match(text, /owner\/app X credentials/); assert.match(text, /ScrapeCreators key/); assert.match(text, /Reddit\/Instagram/); assert.match(text, /delivery record/); assert.match(text, /dashboard_state/);
  assert.ok(!out.excluded.some((e) => e.id === 'x-search'));
  assert.ok(out.paidCaps.appliesTo.includes('x-search'));
  assert.equal(w.spies.digest.length, 0);
});

test('preview: no calls, nothing reserved; estimate math in POSTS at the ledger rate; effects disclose everything', async () => {
  const w = makeWorld();
  const p = await preview(w);
  assert.equal(p.needsConfirm, true); assert.ok(p.previewToken);
  // Market Talk: @acme + 2 keywords = 3 searches x 10 = 30 posts; Opportunity: 2 rows x max(10,10) = 20 posts; 5 calls, 50 posts x 0.005.
  assert.match(p.estimate, /Up to 5 paid X search call\(s\) reading up to 50 posts/);
  assert.match(p.estimate, /Market Talk 3 search\(es\) x 10 posts \+ Opportunity 2 call\(s\) x 10 posts/);
  assert.match(p.estimate, /\$0\.25 at \$0\.005 per post \(ledger rate\)/);
  const text = p.effects.join(' ');
  assert.match(text, /HITLOOP's X app/); assert.match(text, /needs no X connection|no client X connection/); assert.match(text, /metered to this client/); assert.match(text, /assertXBudget/);
  assert.match(text, /ScrapeCreators key \(present\)/); assert.match(text, /Reddit\/Instagram/); assert.match(text, /delivery record/); assert.match(text, /writes dashboard_state/);
  assert.ok(nothingHappened(w));
  assert.deepEqual(w.spies.xsearchInputs, [OWNER]);
});

test('estimate math: row caps, maxItemsPerPlatform, keyword cap, include on/off, placeholder price', async () => {
  const w = makeWorld();
  // 9 enabled rows are capped by maxQueriesPerRun (clamped to 8); maxItems 25 -> 25 posts per call.
  setOpp(w, { maxQueriesPerRun: 50, maxItemsPerPlatform: 25, queries: Array.from({ length: 9 }, (_, i) => ({ query: `row ${i}` })).concat([{ query: 'off', enabled: false }]) });
  w.xsearch.marketingBriefConfig.brandKeywords = ['k1', 'k2', 'k3', 'k4']; // market talk caps at 3 searches
  let p = await preview(w);
  assert.match(p.estimate, /Up to 11 paid X search call\(s\) reading up to 230 posts/); // 3x10 + 8x25
  w.xsearch.marketingBriefConfig.opportunitySignals.maxItemsPerPlatform = 4; // X minimum is 10 posts per call
  p = await preview(w);
  assert.match(p.estimate, /reading up to 110 posts/); // 30 + 8x10
  // include.xMarketTalk off: the route does not check it on this path, so Market Talk is still priced and the preview says so.
  w.xsearch.include = { xMarketTalk: false };
  p = await preview(w);
  assert.match(p.estimate, /Market Talk 3 search/);
  assert.match(p.effects.join(' '), /toggle is OFF for this client, but this run does not check it/);
  // No ledger rate: a labelled placeholder.
  w.xsearch.pricing = { perPostReadUsd: null };
  p = await preview(w);
  assert.match(p.estimate, /PLACEHOLDER/); assert.match(p.effects.join(' '), /Price is a PLACEHOLDER/);
  assert.ok(nothingHappened(w));
});

test('estimate math: Opportunity needs the ScrapeCreators key, the x platform, the feature and rows; Market Talk needs an X source and handle', () => {
  const base = { marketingBriefConfig: { sourcePlatforms: ['x'], brandXHandle: '@acme', opportunitySignals: { enabled: true, platforms: ['x'], queries: [{ query: 'a' }] } }, hasScrapeKey: true, pricing: { perPostReadUsd: 0.01 } };
  assert.equal(planXSearch(base).calls, 2);
  assert.equal(planXSearch({ ...base, hasScrapeKey: false }).opportunity.calls, 0);
  assert.equal(planXSearch({ ...base, marketingBriefConfig: { ...base.marketingBriefConfig, opportunitySignals: { enabled: false, platforms: ['x'], queries: [{ query: 'a' }] } } }).opportunity.calls, 0);
  assert.equal(planXSearch({ ...base, marketingBriefConfig: { ...base.marketingBriefConfig, opportunitySignals: { enabled: true, platforms: ['reddit'], queries: [{ query: 'a' }] } } }).opportunity.calls, 0);
  assert.equal(planXSearch({ ...base, marketingBriefConfig: { ...base.marketingBriefConfig, sourcePlatforms: ['reddit'] } }).marketTalk.calls, 0);
  assert.equal(planXSearch({ ...base, marketingBriefConfig: { ...base.marketingBriefConfig, brandXHandle: '' } }).marketTalk.calls, 0);
});

test('confirm runs refreshDigestClient with EXACTLY groups Set([x-search]), phase signals, for the requested client only; no allowX', async () => {
  const w = makeWorld({ defer: 'queue' });
  const r = w.json(await go(w, { clientId: OTHER }));
  assert.equal(r.ran, true); assert.equal(r.status, 'running');
  assert.equal(w.spies.digest.length, 0, 'returns before the work');
  await w.runDeferred();
  assert.equal(w.spies.digest.length, 1);
  const { clientId, args } = w.spies.digest[0];
  assert.equal(clientId, OTHER);
  assert.ok(args.groups instanceof Set); assert.deepEqual([...args.groups], ['x-search']);
  assert.equal(args.phase, 'signals'); assert.equal(args.source, 'mcp-ops');
  assert.ok(!('allowX' in args) && !('allowXWatchlist' in args));
  assert.deepEqual(w.spies.xsearchInputs, [OTHER, OTHER, OTHER]); // preview, confirm re-price, execute: only ever the requested client
  assert.equal(w.counters._raw.get(opsCapKey('x-search', OTHER, NOW)), 1);
  assert.equal(w.counters._raw.get(opsPaidGlobalKey(NOW)), 1);
  assert.equal(w.stores.locks._raw.size, 0);
});

test('digest kinds never produce x-search groups or allowX', () => {
  for (const entry of REFRESHES.filter((x) => x.kind === 'digest')) {
    const args = buildDigestRefreshArgs({ clientId: OWNER, entry, cfg: { include: {} }, actorUid: null, now: NOW });
    assert.deepEqual([...args.groups], [entry.id], entry.id);
    assert.ok(!args.groups.has('x-search'), entry.id);
    assert.ok(!('allowX' in args) && !('allowXWatchlist' in args), entry.id);
  }
  assert.deepEqual(REFRESHES.filter((x) => x.kind === 'digest').map((x) => x.id), ['market-signals', 'analysis', 'renders']);
  const xs = REFRESHES.find((x) => x.id === 'x-search');
  assert.notEqual(xs.kind, 'digest');
  assert.throws(() => buildDigestRefreshArgs({ clientId: OWNER, entry: xs, cfg: {}, actorUid: null, now: NOW }), /digest kinds only/);
  assert.deepEqual([...buildXSearchRefreshArgs({ clientId: OWNER, cfg: {}, actorUid: null, now: NOW }).groups], ['x-search']);
});

test('digest kinds run through run_refresh never reach x-search', async () => {
  const w = makeWorld({ defer: 'inline' });
  for (const id of ['market-signals', 'analysis', 'renders']) {
    const p = w.json(await w.call('run_refresh', { refreshId: id }));
    await w.call('run_refresh', { refreshId: id, confirm: true, previewToken: p.previewToken });
    await w.runDeferred();
  }
  assert.equal(w.spies.digest.length, 3);
  for (const c of w.spies.digest) { assert.ok(!c.args.groups.has('x-search')); assert.ok(!('allowX' in c.args)); }
  assert.equal(w.spies.xsearchInputs, undefined, 'x-search was never priced or run');
});

test('token is bound to the client and the refresh; and to the estimate', async () => {
  const w = makeWorld();
  const p = await preview(w);
  const other = await confirm(w, p.previewToken, { clientId: OTHER });
  assert.equal(other.isError, true); assert.match(other.content[0].text, /different client/);
  const wrong = await w.call('run_refresh', { refreshId: 'analysis', confirm: true, previewToken: p.previewToken });
  assert.equal(wrong.isError, true); assert.match(wrong.content[0].text, /different refresh/);
  setOpp(w, { queries: [{ query: 'q1' }] }); // config changed since the preview -> estimate changed
  const stale = await confirm(w, p.previewToken);
  assert.equal(stale.isError, true); assert.match(stale.content[0].text, /estimate changed/);
  assert.ok(nothingHappened(w));
});

test('per-client cap of 3 per day (never burned by previews); a 4th is refused; other clients are unaffected', async () => {
  const w = makeWorld({ defer: 'inline' });
  for (let i = 0; i < 3; i += 1) { const r = w.json(await go(w)); assert.equal(r.ran, true, `run ${i + 1}`); await w.runDeferred(); }
  assert.equal(w.counters._raw.get(opsCapKey('x-search', OWNER, NOW)), 3);
  const p4 = await w.call('run_refresh', { refreshId: 'x-search' });
  assert.equal(p4.isError, true); assert.match(p4.content[0].text, /Daily limit reached: 3 "x-search" runs per client per day/);
  assert.equal(w.spies.digest.length, 3);
  const o = await w.call('run_refresh', { refreshId: 'x-search', clientId: OTHER });
  assert.equal(w.json(o).needsConfirm, true);
  const listed = w.json(await w.call('list_refreshes')).refreshes.find((x) => x.id === 'x-search');
  assert.equal(listed.usedToday, 3);
});

test('global cap of 10 per day holds for x-search', async () => {
  const w = makeWorld();
  for (let i = 0; i < 10; i += 1) assert.equal((await w.counters.reserve(opsPaidGlobalKey(NOW), 10, NOW + 86400000)).ok, true);
  const r = await w.call('run_refresh', { refreshId: 'x-search' });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /10 paid MCP refreshes per day/);
  assert.equal(w.spies.digest.length, 0);
});

test('lock: a second confirm while a run is active is refused (already-running) and the cap slot is not taken', async () => {
  const w = makeWorld({ defer: 'inline' });
  let release; w.holds.digest = new Promise((r) => { release = r; });
  const first = go(w);
  await new Promise((r) => setTimeout(r, 20));
  const second = w.json(await go(w));
  assert.equal(second.refused, true); assert.equal(second.reason, 'already-running');
  assert.equal(w.counters._raw.get(opsCapKey('x-search', OWNER, NOW)), 1);
  release(); await first; await w.runDeferred();
  assert.equal(w.stores.locks._raw.size, 0);
  assert.equal(w.spies.digest.length, 1);
});

test('zero X calls (no rows and no handle): refused at preview, no token, no lock, no cap slot, nothing run', async () => {
  const w = makeWorld();
  setOpp(w, { queries: [] });
  w.xsearch.marketingBriefConfig.brandXHandle = '';
  const r = w.json(await w.call('run_refresh', { refreshId: 'x-search' }));
  assert.equal(r.ran, false); assert.equal(r.refused, true); assert.equal(r.reason, 'no-x-calls');
  assert.match(r.message, /No paid X calls/); assert.ok(r.effects.join(' ').match(/no enabled Opportunity query rows/));
  assert.ok(nothingHappened(w));
  const c = await w.call('run_refresh', { refreshId: 'x-search', confirm: true, previewToken: 'a.b' });
  assert.equal(w.json(c).reason, 'no-x-calls');
  assert.ok(nothingHappened(w));
  // Market Talk alone (rows empty) still runs.
  w.xsearch.marketingBriefConfig.brandXHandle = 'acme';
  assert.match((await preview(w)).estimate, /Up to 3 paid X search call\(s\) reading up to 30 posts: Market Talk 3 search\(es\) x 10 posts\./);
});

test('get_run_status: the summary lists X calls/posts and per-leg ok/skip from the refreshDigestClient result', async () => {
  const w = makeWorld({ defer: 'inline' });
  w.ops.paid.digestRefresh = async (clientId, args) => { w.spies.digest.push({ clientId, args }); return { ok: true, platformSignals: { ok: true, xMarketTalk: 7 }, opportunitySignalsRefresh: { ok: true, itemCount: 12, platforms: ['x', 'reddit'], warnings: ['X skipped: budget'] }, scout: { ok: true, skipped: true, reason: 'other-phase' } }; };
  const r = w.json(await go(w)); await w.runDeferred();
  const s = w.json(await w.call('get_run_status', { runId: r.runId }));
  assert.equal(s.status, 'done');
  assert.match(s.detail, /X calls up to 5, posts up to 50/); assert.match(s.detail, /Market Talk ok \(7 kept\)/); assert.match(s.detail, /Opportunity ok \(12 items; platforms x, reddit/);
});

test('outcome: skipped legs, budget skips and a refused preflight', () => {
  const plan = planXSearch({ marketingBriefConfig: { sourcePlatforms: ['x'], brandXHandle: 'acme', opportunitySignals: { enabled: true, platforms: ['x'], queries: [{ query: 'a' }, { query: 'b' }] } }, hasScrapeKey: true, pricing: { perPostReadUsd: 0.01 } });
  const skipped = xSearchOutcome(plan, { ok: true, platformSignals: { ok: true, xMarketTalk: 'skip:x-budget' }, opportunitySignalsRefresh: { ok: false, skipped: true, reason: 'x-budget' } });
  assert.equal(skipped.status, 'done'); assert.match(skipped.detail, /X calls up to 0, posts up to 0/); assert.match(skipped.detail, /Market Talk skipped \(skip:x-budget\)/); assert.match(skipped.detail, /Opportunity skipped \(x-budget\)/); assert.match(skipped.detail, /No X search was made/);
  const refused = xSearchOutcome(plan, { ok: false, skipped: true, reason: 'delivery-breaker-paused' });
  assert.equal(refused.status, 'failed'); assert.match(refused.detail, /No X calls were made/);
});

test('outcome: a failed Opportunity leg that listed X still counts as attempted; one without X does not', () => {
  const plan = planXSearch({ marketingBriefConfig: { sourcePlatforms: ['x'], brandXHandle: 'acme', opportunitySignals: { enabled: true, platforms: ['x'], queries: [{ query: 'a' }, { query: 'b' }] } }, hasScrapeKey: true, pricing: { perPostReadUsd: 0.01 } });
  const mt = { ok: true, xMarketTalk: 'skip:x-budget' };
  const failedX = xSearchOutcome(plan, { ok: true, platformSignals: mt, opportunitySignalsRefresh: { ok: false, error: 'boom', platforms: ['x'] } });
  assert.match(failedX.detail, new RegExp(`X calls up to ${plan.opportunity.calls},`)); assert.ok(plan.opportunity.calls > 0); assert.doesNotMatch(failedX.detail, /No X search was made/);
  const failedNoX = xSearchOutcome(plan, { ok: true, platformSignals: mt, opportunitySignalsRefresh: { ok: false, error: 'boom', platforms: ['reddit'] } });
  assert.match(failedNoX.detail, /X calls up to 0,/); assert.match(failedNoX.detail, /No X search was made/);
});

test('settings stay unchanged: turning daily x-search ON is still blocked', async () => {
  const w = makeWorld();
  const r = await w.call('set_setting', { key: 'refresh-daily.group.x-search', value: true });
  const out = w.json(r);
  assert.equal(out.applied, false); assert.equal(out.blocked, true);
  assert.equal(w.settings.writes.daily.length, 0);
});
