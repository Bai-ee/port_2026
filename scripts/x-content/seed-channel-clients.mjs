#!/usr/bin/env node
// Seed the two single-channel clients so the admin can run Content Management (calendar, buckets, daily loop) for them
// from the dashboard client switcher, exactly like home:
//   bai-ees-discogs-TP37NQG0       X @Bai_ee_Discogs (not yet connected)  - Discogs records  (bucket/engine 'record')
//   undergroundexistence-0CsKkpaq  X @UGExistence    (connected)          - DJ mix videos    (bucket/engine 'ue')
//
// Per client it fills ONLY what is absent, never overwrites, and never touches home:
//   clients/{id}.contentLoop.enabled = true              the owner override of the readiness gate (assertClientReady)
//   x_strategy_plans/{id}                                 version 1: the matching track copied from HOME's live plan
//                                                         (share 1.0) + the bucket-synced sibling tracks at share 0,
//                                                         one-engine allowance in engineTargets
//   client_configs/{id}.marketingBriefConfig.xGrowth      ownHandle + timezone (home's); watchlist stays empty
// It does NOT approve a Brain, touch social_accounts, write x_strategy_docs, or create bucket docs (the five default
// buckets always exist through mergeBuckets; stored bucket docs only override name/colour/share).
//
// DRY RUN by default (prints a per-client diff). --write applies: contentLoop and xGrowth in a transaction re-planned
// against the live doc; the plan through the version-checked plan store (expectedVersion 0).
//
// Usage:
//   node scripts/x-content/seed-channel-clients.mjs --channels                  # both clients, dry run
//   node scripts/x-content/seed-channel-clients.mjs --client <id>[,<id>]        # repeatable; dry run
//   node scripts/x-content/seed-channel-clients.mjs --channels --write          # apply (owner go only)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyChange } from '../../features/x-strategy/plan-state.js';
import { bucketTracks } from '../../features/x-strategy/bucket-tracks.js';
import { mergeBuckets } from '../../features/x-content-inventory/buckets.js';
import { createFirestorePlanStore } from '../../features/x-strategy/plan-store.js';

export const HOME_CLIENT_ID = 'bryan-balli-WUoltG84';
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
const BY = 'seed-channel-clients';

/** The channel clients this script knows. `engine` is also the Content Center bucket id and the home track id. */
export const CHANNEL_CLIENTS = Object.freeze({
  'bai-ees-discogs-TP37NQG0': Object.freeze({ engine: 'record', handle: 'Bai_ee_Discogs', label: 'Discogs records' }),
  'undergroundexistence-0CsKkpaq': Object.freeze({ engine: 'ue', handle: 'UGExistence', label: 'DJ mix videos + event archive' }),
});
export const CHANNEL_IDS = Object.freeze(Object.keys(CHANNEL_CLIENTS));

const plain = (v) => JSON.parse(JSON.stringify(v));
const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || String(v).trim() === '');

/**
 * One-engine allowance for engineTargets (read by mergeEngineConfig): the whole day goes to `engine`, the other
 * engines' floors drop to 0. record.maxSharePct (40 by default) would cap a record-only client at 40% of its day, and
 * ue.weeklyMax (4) would cap a daily mix below its 1/day target, so both are lifted. Caps (maxPerDay) are untouched.
 */
export function channelEngineTargets(engine) {
  const engines = {
    identity: { minPerDay: 0, targetPerDay: 0 },
    client: { weeklyMin: 0 },
    record: { minPerDay: 0 },
    ue: { weeklyMin: 0 },
  };
  if (engine === 'record') engines.record = { minPerDay: 1, targetPerDay: 1, maxSharePct: 100 };
  else if (engine === 'ue') engines.ue = { weeklyMin: 3, weeklyMax: 7, targetPerDay: 1 };
  else throw new Error(`channelEngineTargets: unsupported engine ${engine}`);
  return { authored: { targetPerDay: 1, capPerDay: 2 }, engines };
}

/**
 * Pure planner. Nothing is read or written here.
 * @param {object} i
 * @param {string} i.clientId
 * @param {object|null} i.homePlanDoc   home's live x_strategy_plans doc (source of the track)
 * @param {object|null} i.homeXGrowth   home's live xGrowth (source of the timezone)
 * @param {object|null} i.client        clients/{id} data (null = missing)
 * @param {object|null} i.clientConfig  client_configs/{id} data
 * @param {object|null} i.planDoc       x_strategy_plans/{id} (null = absent)
 * @param {object[]}    [i.storedBuckets] content_buckets/{id}/buckets rows (defaults merge under them)
 * @returns {{clientId:string, errors:string[], warnings:string[], fill:string[], keep:string[],
 *   contentLoop:object|null, xGrowth:object|null, plan:object|null}}
 */
export function planChannelSeed({ clientId, homePlanDoc, homeXGrowth, client, clientConfig, planDoc, storedBuckets = [] }) {
  const spec = CHANNEL_CLIENTS[clientId];
  const out = { clientId, errors: [], warnings: [], fill: [], keep: [], contentLoop: null, xGrowth: null, plan: null };
  if (!spec) { out.errors.push(`unknown channel client ${clientId} (known: ${CHANNEL_IDS.join(', ')})`); return out; }
  if (clientId === HOME_CLIENT_ID) { out.errors.push('refusing to seed the home client'); return out; }
  if (!client) { out.errors.push(`clients/${clientId} does not exist`); return out; }

  // 1. readiness override. Only an ABSENT flag is filled; an explicit false is the owner's/signup's value, kept + warned.
  const flag = client.contentLoop?.enabled;
  if (flag === undefined || flag === null) { out.contentLoop = { enabled: true }; out.fill.push('clients.contentLoop.enabled'); }
  else {
    out.keep.push('clients.contentLoop.enabled');
    if (flag !== true) out.warnings.push('clients.contentLoop.enabled is explicitly false: left alone; the content loop stays blocked (node scripts/client-readiness/content-loop.mjs --client <id> --enable-loop --write)');
  }

  // 2. xGrowth ownHandle + timezone (watchlist deliberately untouched).
  const growth = clientConfig?.marketingBriefConfig?.xGrowth || {};
  const patch = {};
  if (isEmpty(growth.ownHandle)) patch.ownHandle = spec.handle; else out.keep.push('xGrowth.ownHandle');
  const tz = String(homeXGrowth?.timezone || '').trim();
  if (isEmpty(growth.timezone)) {
    if (tz) patch.timezone = tz; else out.warnings.push("home has no xGrowth.timezone to copy; timezone not filled");
  } else out.keep.push('xGrowth.timezone');
  if (Object.keys(patch).length) { out.xGrowth = patch; out.fill.push(...Object.keys(patch).map((k) => `xGrowth.${k}`)); }
  if (isEmpty(growth.watchlist)) out.warnings.push('xGrowth.watchlist is empty: the quote-target scan skips this client until one is set');

  // 3. strategy plan: only when the doc is absent. An existing plan is never touched.
  if (planDoc) { out.keep.push('x_strategy_plans'); return out; }
  const homeTrack = (homePlanDoc?.plan?.contentTracks || []).find((t) => t.id === spec.engine);
  if (!homeTrack) { out.errors.push(`home plan has no '${spec.engine}' track to copy`); return out; }
  const own = { ...plain(homeTrack), engines: [spec.engine], buckets: [spec.engine], share: 1 };
  // bucketTracks adds the sibling bucket tracks (share 0) so every engine has an owner and the first Strategy load's
  // syncBucketTracks finds nothing to change; it also sets the label to the bucket name.
  const contentTracks = bucketTracks([own], mergeBuckets(storedBuckets));
  const changes = {
    authoredPerDay: 1,
    typeFloors: {},
    engineTargets: channelEngineTargets(spec.engine),
    contentTracks,
    notes: `Single-channel client: ${spec.label}. One bucket at share 1.0; sibling buckets paused at 0.`,
  };
  const applied = applyChange(null, { changes, by: BY, source: 'manual', reason: `seed channel client (${spec.label})`, expectedVersion: 0, now: 0 });
  if (applied.error) { out.errors.push(`plan rejected: ${applied.error} ${(applied.errors || []).join('; ')}`); return out; }
  out.plan = { changes, expectedVersion: 0, result: applied.plan };
  out.fill.push('x_strategy_plans');
  return out;
}

/** CLI id list: --channels and any number of --client a,b (repeatable); de-duplicated, validated. */
export function parseClientIds(argv) {
  const ids = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--channels') ids.push(...CHANNEL_IDS);
    else if (argv[i] === '--client') ids.push(...String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean));
  }
  const unique = [...new Set(ids)];
  for (const id of unique) if (!CLIENT_ID_RE.test(id)) throw new Error(`bad client id: ${id}`);
  return unique;
}

function describe(p) {
  const r = { client: p.clientId, errors: p.errors, warnings: p.warnings, fill: p.fill, keepExisting: p.keep };
  if (p.contentLoop) r.write_clients_contentLoop = p.contentLoop;
  if (p.xGrowth) r.write_client_configs_xGrowth = p.xGrowth;
  if (p.plan) {
    const { result } = p.plan;
    r.write_x_strategy_plans = {
      version: 1,
      authoredPerDay: result.authoredPerDay, tier: result.tier, engineTargets: result.engineTargets, notes: result.notes,
      tracks: result.contentTracks.map((t) => ({ id: t.id, label: t.label, share: Number(t.share.toFixed(3)), engines: t.engines, benchmarks: t.benchmarks, promotions: t.promotions.map((x) => `${x.id} ${x.url || ''} x${x.weeklyTarget}/wk`) })),
    };
  }
  return r;
}

async function main() {
  const write = process.argv.includes('--write');
  const ids = parseClientIds(process.argv.slice(2));
  if (!ids.length) throw new Error('--channels or --client <id> is required (no default client).');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;
  const planStore = createFirestorePlanStore(db);

  const homePlanDoc = await planStore.get(HOME_CLIENT_ID);
  const homeXGrowth = (await db.collection('client_configs').doc(HOME_CLIENT_ID).get()).data()?.marketingBriefConfig?.xGrowth ?? null;

  const read = async (id) => {
    const [c, cfg, pl, bk] = await Promise.all([
      db.collection('clients').doc(id).get(),
      db.collection('client_configs').doc(id).get(),
      planStore.get(id),
      db.collection('content_buckets').doc(id).collection('buckets').get(),
    ]);
    return {
      clientId: id, homePlanDoc, homeXGrowth,
      client: c.exists ? c.data() : null, clientConfig: cfg.exists ? cfg.data() : null, planDoc: pl,
      storedBuckets: bk.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
    };
  };

  const plans = [];
  for (const id of ids) plans.push(planChannelSeed(await read(id)));
  console.log(JSON.stringify({ mode: write ? 'WRITE' : 'DRY RUN (nothing written)', clients: plans.map(describe) }, null, 2));

  if (plans.some((p) => p.errors.length)) { console.log('\nErrors above: fix before --write.'); process.exitCode = 1; return; }
  if (!plans.some((p) => p.fill.length)) { console.log('\nNothing to seed: everything is already set.'); return; }
  if (!write) { console.log('\nTo apply (owner go only): re-run with --write'); return; }

  for (const first of plans) {
    const id = first.clientId;
    // Re-plan against live docs inside a transaction so a concurrent save is never overwritten.
    const clientRef = db.collection('clients').doc(id);
    const cfgRef = db.collection('client_configs').doc(id);
    const wrote = await db.runTransaction(async (tx) => {
      const [c, cfg] = await Promise.all([tx.get(clientRef), tx.get(cfgRef)]);
      const p = planChannelSeed({ ...(await read(id)), client: c.exists ? c.data() : null, clientConfig: cfg.exists ? cfg.data() : null });
      const done = [];
      if (p.contentLoop) { tx.set(clientRef, { contentLoop: p.contentLoop }, { merge: true }); done.push('contentLoop'); }
      if (p.xGrowth) { tx.set(cfgRef, { marketingBriefConfig: { xGrowth: p.xGrowth } }, { merge: true }); done.push('xGrowth'); }
      return done;
    });
    console.log(`${id}: wrote ${wrote.length ? wrote.join(', ') : 'nothing (already set)'}`);
    if (first.plan) {
      await planStore.apply(id, { changes: first.plan.changes, by: BY, source: 'manual', reason: 'seed channel client', expectedVersion: 0 });
      console.log(`${id}: wrote x_strategy_plans (version 1)`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
