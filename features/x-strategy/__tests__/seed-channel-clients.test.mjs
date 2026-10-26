import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planChannelSeed, parseClientIds, channelEngineTargets, CHANNEL_IDS, HOME_CLIENT_ID,
} from '../../../scripts/x-content/seed-channel-clients.mjs';
import { tracksOf } from '../content-tracks.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { mergeEngineConfig } from '../../x-content-inventory/engine-quota.js';

const [DISCOGS, UE] = CHANNEL_IDS;
const track = (id, extra = {}) => ({ id, label: id, engines: [id], buckets: [id], benchmarks: ['slimeysmine'], lists: [], share: 0.5, topics: ['t'], promotions: [{ id, label: id, engine: id, url: 'https://example.com/', weeklyTarget: 7 }], ...extra });
const homePlanDoc = { version: 9, plan: { contentTracks: [track('record'), track('ue'), track('client', { share: 0 }), track('identity', { share: 0 })] } };
const base = (clientId, o = {}) => ({ clientId, homePlanDoc, homeXGrowth: { timezone: 'America/Chicago' }, client: { name: 'x' }, clientConfig: null, planDoc: null, storedBuckets: [], ...o });

test('fills everything on a blank client: loop flag, handle, timezone, valid plan with one-engine allowance', () => {
  for (const [id, engine, handle] of [[DISCOGS, 'record', 'Bai_ee_Discogs'], [UE, 'ue', 'UGExistence']]) {
    const p = planChannelSeed(base(id));
    assert.deepEqual(p.errors, []);
    assert.deepEqual(p.contentLoop, { enabled: true });
    assert.deepEqual(p.xGrowth, { ownHandle: handle, timezone: 'America/Chicago' });
    const tracks = tracksOf(p.plan.result);
    assert.equal(tracks.find((t) => t.id === engine).share, 1);
    assert.equal(tracks.reduce((s, t) => s + t.share, 0), 1);
    assert.deepEqual(tracks.find((t) => t.id === engine).promotions[0].url, 'https://example.com/');
    assert.equal(p.plan.expectedVersion, 0);
    assert.ok(p.warnings.some((w) => /watchlist/.test(w)));
  }
});

test('never overwrites: existing flag, handle, timezone and plan are kept', () => {
  const p = planChannelSeed(base(UE, {
    client: { contentLoop: { enabled: true } },
    clientConfig: { marketingBriefConfig: { xGrowth: { ownHandle: 'mine', timezone: 'Europe/Paris', watchlist: [{ handle: 'a' }] } } },
    planDoc: { version: 3, plan: {} },
  }));
  assert.equal(p.contentLoop, null);
  assert.equal(p.xGrowth, null);
  assert.equal(p.plan, null);
  assert.deepEqual(p.fill, []);
  assert.ok(!p.warnings.some((w) => /watchlist/.test(w)));
});

test('an explicit contentLoop.enabled=false is kept and warned, not flipped', () => {
  const p = planChannelSeed(base(UE, { client: { contentLoop: { enabled: false } } }));
  assert.equal(p.contentLoop, null);
  assert.ok(p.warnings.some((w) => /explicitly false/.test(w)));
});

test('refuses home, unknown clients, missing client doc, missing home track', () => {
  assert.match(planChannelSeed(base(HOME_CLIENT_ID)).errors[0], /unknown channel client|home/);
  assert.match(planChannelSeed(base('nope-12345')).errors[0], /unknown/);
  assert.match(planChannelSeed(base(UE, { client: null })).errors[0], /does not exist/);
  assert.match(planChannelSeed(base(UE, { homePlanDoc: { plan: { contentTracks: [] } } })).errors[0], /no 'ue' track/);
});

test('the seeded plan is stable under bucket sync (a second sync changes nothing) and applies to the plan store', async () => {
  const { syncBucketTracks } = await import('../bucket-tracks.js');
  const { mergeBuckets } = await import('../../x-content-inventory/buckets.js');
  const p = planChannelSeed(base(DISCOGS));
  const store = createMemoryPlanStore();
  await store.apply(DISCOGS, { changes: p.plan.changes, by: 't', source: 'manual', expectedVersion: 0 });
  const r = await syncBucketTracks(DISCOGS, { planStore: store, readBuckets: async () => mergeBuckets([]) });
  assert.equal(r.changed, false);
});

test('engine targets give the whole allowance to the one engine and are accepted by mergeEngineConfig', () => {
  const rec = mergeEngineConfig(channelEngineTargets('record'));
  assert.equal(rec.engines.record.maxSharePct, 100);
  assert.equal(rec.engines.identity.minPerDay, 0);
  assert.equal(rec.engines.ue.weeklyMin, 0);
  const ue = mergeEngineConfig(channelEngineTargets('ue'));
  assert.equal(ue.engines.ue.weeklyMax, 7);
  assert.equal(ue.engines.record.minPerDay, 0);
  assert.throws(() => channelEngineTargets('client'));
});

test('parseClientIds: --channels, repeatable and comma --client, de-duplicated, validated', () => {
  assert.deepEqual(parseClientIds(['--channels']), CHANNEL_IDS);
  assert.deepEqual(parseClientIds(['--client', `${UE},abc`, '--client', UE]), [UE, 'abc']);
  assert.deepEqual(parseClientIds([]), []);
  assert.throws(() => parseClientIds(['--client', 'a/b']));
});
