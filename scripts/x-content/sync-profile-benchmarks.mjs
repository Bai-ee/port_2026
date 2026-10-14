#!/usr/bin/env node
// One-off repair: copy a client's content-track benchmarks into its X growth profile
// (client_configs/{clientId}.marketingBriefConfig.xGrowth.benchmarkHandles), the same list a track save now
// mirrors (features/x-strategy/track-profile.js profileBenchmarksFromPlan: pace benchmark, then track benchmarks).
// Only needed for drift that predates the mirror.
//
// Usage: node scripts/x-content/sync-profile-benchmarks.mjs [--client <id>]            # dry run (default)
//        node scripts/x-content/sync-profile-benchmarks.mjs [--client <id>] --write    # writes (idempotent)
// WRITES client_configs only with --write (owner approval required). No X / LLM / paid calls.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { profileBenchmarksFromPlan } from '../../features/x-strategy/track-profile.js';
import { createXGrowthProfileSaver } from '../../features/x-strategy/route-handlers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));

const argAt = process.argv.indexOf('--client');
const clientId = argAt > -1 ? String(process.argv[argAt + 1] || '').trim() : '';
if (!clientId) { console.error('--client <id> is required (no owner default).'); process.exit(1); }
const write = process.argv.includes('--write');

const planSnap = await fb.adminDb.collection('x_strategy_plans').doc(clientId).get();
const next = profileBenchmarksFromPlan(planSnap.exists ? planSnap.data() : null);
const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
const current = cfgSnap.exists ? cfgSnap.data()?.marketingBriefConfig?.xGrowth?.benchmarkHandles ?? null : null;

const report = { clientId, mode: write ? 'write' : 'dry-run', planVersion: planSnap.data()?.version ?? null, current, next };
if (!next) report.result = 'skip: plan has no explicit contentTracks';
else if (JSON.stringify(current) === JSON.stringify(next)) report.result = 'in sync';
else if (!write) report.result = 'would update (re-run with --write)';
else report.result = { saved: (await createXGrowthProfileSaver(fb.adminDb)(clientId, { benchmarkHandles: next })).benchmarkHandles };
console.log(JSON.stringify(report, null, 1));
process.exit(0);
