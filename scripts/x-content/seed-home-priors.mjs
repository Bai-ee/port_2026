#!/usr/bin/env node
// One-time seed of the home client's X growth priors into its OWN stored config (multi-client Phase 4.4).
//
// The code no longer defaults any client to @bai_ee / @seb__design / the curated quote-target watchlist.
// The home client keeps today's behaviour by storing those values itself, at
// client_configs/{clientId}.marketingBriefConfig.xGrowth:
//   ownHandle 'bai_ee', benchmarkHandles ['seb__design'], timezone 'America/Chicago', watchlist HOME_SEED_WATCHLIST
//
// Phase 4.7 (no inherited priors) moved the rest of the home priors out of code too. This script also fills, ONLY
// when absent:
//   x_strategy_docs/{clientId}            the former code seed strategy text (HOME_STRATEGY_SECTIONS), as a draft
//   x_strategy_plans/{clientId}.plan      contentTracks = the former DEFAULT_TRACKS (design + music) when the plan
//                                         has no contentTracks; benchmarkPrimary 'seb__design' when it is empty
//
// Rules: DRY RUN by default (prints what it would write); --client <id> is required (no default client);
// fills ONLY fields that are currently empty, never overwrites; --write applies with a merge write inside a
// transaction (re-planned against the live doc). The Client Brain still owns the handle fields afterwards.
//
// Usage:
//   node scripts/x-content/seed-home-priors.mjs --client <id>            # dry run
//   node scripts/x-content/seed-home-priors.mjs --client <id> --write    # apply (owner go only)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HOME_SEED_WATCHLIST } from '../../features/x-quote-targets/watchlist.js';
import { createFirestorePlanStore } from '../../features/x-strategy/plan-store.js';
import { createFirestoreStrategyDocStore } from '../../features/x-strategy/strategy-doc-store.js';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const HOME_PRIORS = Object.freeze({
  ownHandle: 'bai_ee',
  benchmarkHandles: Object.freeze(['seb__design']),
  timezone: 'America/Chicago',
  watchlist: HOME_SEED_WATCHLIST,
});

// The home client's Strategy document text, formerly features/x-strategy/strategy-doc-seed.js (moved verbatim).
// Distilled from docs/plans/X-STRATEGY-SEB-MODEL.md and docs/source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md §4.
export const HOME_STRATEGY_SECTIONS = Object.freeze({
  thesis: [
    'Show the work, not the casino.',
    'The account grows on proof of what I build and make (client design work, tools, music), not on market talk.',
    'Reach comes first: at double-digit median views followers cannot move, so the first job is consistent reach.',
  ].join('\n'),
  audience: [
    'People who hire or collaborate with a designer/builder: founders, web3 teams, creative technologists.',
    'People who follow underground electronic music and the scene around it.',
    'They come for the thing itself (the build, the mix, the flyer), not for commentary about it.',
  ].join('\n'),
  tracks: [
    '- Design: client and personal design/build work. Benchmark: @seb__design.',
    '- Music: mixes, sets, archive material from the scene. Benchmark: none yet (gap).',
    'Each track is measured only against its own benchmarks.',
  ].join('\n'),
  formats: [
    '- Quote-react = reach engine: a striking object from someone else + a very short reaction. No explaining, no own link.',
    '- Original showcase = conversion engine: short screen-captured video of something built, no intro; credits and links in the first self-reply.',
    '- Self-quote winners: re-surface posts that already worked.',
    '- Replies daily, as a floor.',
    '- Originals can be longer and structured (claim, line break, substance). Quote captions stay short.',
  ].join('\n'),
  rules: [
    '- No hashtags.',
    '- No link in the main post; link and credits go in the first self-reply.',
    '- Video over image; a static image reaches less than plain text.',
    '- Quote-react, never retweet (a retweet earns no impression).',
    '- No speculation, price, politics or rug chatter.',
    '- No audience questions, platform meta or generic hot takes.',
  ].join('\n'),
  algorithm: [
    'Active ranking profile: x-2026-10-03 (weights public in xai-org/x-algorithm).',
    '- Earned actions outrank likes: copy-link share 20, reply 5, quote 5, DM share 5, follow 4 vs like 0.5.',
    '- Negatives are brutal: one report = -234 (468 likes), mute -58.8, not-interested -47.5. Never bait.',
    '- Mutual follows get +15 on the reply weight for originals: replying daily builds the base that boosts originals.',
    '- Out-of-network reach is weighted 0.75x; author diversity decays same-author posts within one ranked session (0.5 decay, 0.25 floor), so density is not a lever; volume is.',
    '- No hard-coded link penalty, but links are a learned negative: keep them in the self-reply.',
    '- Video needs 10s+ to count as video.',
    '- The post scorer models originals only; it undervalues quote-reacts (borrowed reach).',
  ].join('\n'),
  decisions: [
    '- "The work" vs "the casino" is about subject matter, not industry: web3 client design work is the best lane (514 avg views); speculation is dead (49).',
    '- Cadence tiers: 5/day sustainable -> 8/day competitive -> 12/day full. Start at tier 1 and hold it before moving up.',
    '- The five fixes, in order: stop retweeting, fix quote targets, reply daily, cut politics/rug content, post video.',
    '- Act only on benchmark gaps marked increase/decrease; copying the benchmark\'s raw type mix scored 0.84x.',
  ].join('\n'),
  open: [
    '- Music track has no benchmark: which account represents the music lane?',
    '- What converts (follows, inquiries) vs what only reaches? The data measures reach, not conversion.',
  ].join('\n'),
});

// The home client's content tracks, formerly features/x-strategy/content-tracks.js DEFAULT_TRACKS (moved verbatim).
export const HOME_CONTENT_TRACKS = Object.freeze([
  Object.freeze({
    id: 'design', label: 'Design & client work', engines: Object.freeze(['client', 'identity']),
    benchmarks: Object.freeze(['seb__design']), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([Object.freeze({ id: 'client', label: 'Client work', engine: 'client', url: null, weeklyTarget: 2 })]),
  }),
  Object.freeze({
    id: 'music', label: 'Music (UE mixes, Discogs)', engines: Object.freeze(['ue', 'record']),
    benchmarks: Object.freeze([]), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([
      Object.freeze({ id: 'ue', label: 'Underground Existence', engine: 'ue', url: null, weeklyTarget: 3 }),
      Object.freeze({ id: 'discogs', label: 'Discogs store', engine: 'record', url: null, weeklyTarget: 3 }),
    ]),
  }),
]);
export const HOME_BENCHMARK_PRIMARY = 'seb__design';

const plain = (v) => JSON.parse(JSON.stringify(v));

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || String(v).trim() === '');

/**
 * Pure planner: which prior fields to write into an existing xGrowth block. Only empty fields are filled.
 * @param {object|null} xGrowth  current client_configs/{id}.marketingBriefConfig.xGrowth (or null)
 * @param {object} [priors]
 * @returns {{patch:object, fill:string[], keep:string[]}}
 */
export function planHomePriors(xGrowth, priors = HOME_PRIORS) {
  const current = xGrowth && typeof xGrowth === 'object' ? xGrowth : {};
  const patch = {};
  const fill = [];
  const keep = [];
  for (const field of ['ownHandle', 'benchmarkHandles', 'timezone', 'watchlist']) {
    if (isEmpty(current[field])) {
      const v = priors[field];
      patch[field] = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? { ...x } : x)) : v;
      fill.push(field);
    } else {
      keep.push(field);
    }
  }
  return { patch, fill, keep };
}

/**
 * Pure planner for x_strategy_plans/{id}: contentTracks only when the plan has none (an explicit list, even [], is
 * kept); benchmarkPrimary only when empty.
 * @param {object|null} planDoc  current x_strategy_plans/{id} doc (or null)
 * @returns {{changes:object, fill:string[], keep:string[], expectedVersion:number}}
 */
export function planHomeStrategyPlan(planDoc) {
  const plan = planDoc?.plan && typeof planDoc.plan === 'object' ? planDoc.plan : {};
  const changes = {};
  const fill = [];
  const keep = [];
  if (Array.isArray(plan.contentTracks)) keep.push('contentTracks');
  else { changes.contentTracks = plain(HOME_CONTENT_TRACKS); fill.push('contentTracks'); }
  if (isEmpty(plan.benchmarkPrimary)) { changes.benchmarkPrimary = HOME_BENCHMARK_PRIMARY; fill.push('benchmarkPrimary'); }
  else keep.push('benchmarkPrimary');
  return { changes, fill, keep, expectedVersion: Number.isInteger(planDoc?.version) ? planDoc.version : 0 };
}

/**
 * Pure planner for x_strategy_docs/{id}: the home text is written only when the doc does not exist at all.
 * @param {object|null} strategyDoc  current x_strategy_docs/{id} doc (or null)
 * @returns {{fill:boolean, sections:object|null}}
 */
export function planHomeStrategyDoc(strategyDoc) {
  if (strategyDoc) return { fill: false, sections: null };
  return { fill: true, sections: { ...HOME_STRATEGY_SECTIONS } };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? String(process.argv[i + 1] || '').trim() : '';
}

function describe(plan) {
  return {
    fill: plan.fill.map((f) => (f === 'watchlist' ? `watchlist (${plan.patch.watchlist.length} accounts)` : `${f} = ${JSON.stringify(plan.patch[f])}`)),
    keepExisting: plan.keep,
  };
}

async function main() {
  const write = process.argv.includes('--write');
  const clientId = arg('--client');
  if (!CLIENT_ID_RE.test(clientId)) throw new Error('--client <id> is required (no default client).');

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  const db = require(path.join(REPO, 'api/_lib/firebase-admin.cjs')).adminDb;

  if (!(await db.collection('clients').doc(clientId).get()).exists) throw new Error(`clients/${clientId} does not exist.`);
  const ref = db.collection('client_configs').doc(clientId);
  const snap = await ref.get();
  const plan = planHomePriors(snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null);
  const planStore = createFirestorePlanStore(db);
  const docStore = createFirestoreStrategyDocStore(db);
  const planDoc = await planStore.get(clientId);
  const stratPlan = planHomeStrategyPlan(planDoc);
  const stratDoc = planHomeStrategyDoc(await docStore.get(clientId));

  console.log(JSON.stringify({
    mode: write ? 'WRITE' : 'DRY RUN (nothing written)',
    targets: [
      {
        target: `client_configs/${clientId}.marketingBriefConfig.xGrowth`,
        ...describe(plan),
      },
      {
        target: `x_strategy_plans/${clientId}.plan`,
        fill: stratPlan.fill.map((f) => (f === 'contentTracks'
          ? `contentTracks (${HOME_CONTENT_TRACKS.length} tracks: ${HOME_CONTENT_TRACKS.map((t) => t.id).join(', ')})`
          : `${f} = ${JSON.stringify(stratPlan.changes[f])}`)),
        keepExisting: stratPlan.keep,
      },
      {
        target: `x_strategy_docs/${clientId}`,
        fill: stratDoc.fill ? [`sections (${Object.keys(HOME_STRATEGY_SECTIONS).length}, as an unconfirmed draft)`] : [],
        keepExisting: stratDoc.fill ? [] : ['sections (doc exists)'],
      },
    ],
  }, null, 2));

  if (!plan.fill.length && !stratPlan.fill.length && !stratDoc.fill) {
    console.log('\nNothing to seed: every prior field is already set.');
    return;
  }
  if (!write) {
    console.log(`\nTo apply (owner go only): node scripts/x-content/seed-home-priors.mjs --client ${clientId} --write`);
    return;
  }

  // Re-plan against the live doc inside a transaction so a concurrent save is never overwritten.
  const written = await db.runTransaction(async (tx) => {
    const live = await tx.get(ref);
    const p = planHomePriors(live.exists ? live.data()?.marketingBriefConfig?.xGrowth ?? null : null);
    if (p.fill.length) tx.set(ref, { marketingBriefConfig: { xGrowth: p.patch } }, { merge: true });
    return p.fill;
  });
  console.log(`\nwrote ${written.length ? written.join(', ') : 'nothing (already set)'} to client_configs/${clientId}.marketingBriefConfig.xGrowth`);

  // Both stores are version-checked transactions: a plan/doc changed since the read above fails with version-conflict
  // instead of being overwritten (re-run the script to re-plan).
  if (stratPlan.fill.length) {
    await planStore.apply(clientId, {
      changes: stratPlan.changes, by: 'seed-home-priors', source: 'manual',
      reason: 'seed home priors (multi-client 4.7)', expectedVersion: stratPlan.expectedVersion,
    });
    console.log(`wrote ${stratPlan.fill.join(', ')} to x_strategy_plans/${clientId}.plan`);
  }
  if (stratDoc.fill) {
    // expectedVersion 0 = only when the doc is still absent. source 'seed' keeps it an unconfirmed draft.
    await docStore.apply(clientId, {
      sections: stratDoc.sections, by: 'seed-home-priors', source: 'seed',
      reason: 'seed home strategy text (multi-client 4.7)', expectedVersion: 0,
    });
    console.log(`wrote the strategy draft to x_strategy_docs/${clientId}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
