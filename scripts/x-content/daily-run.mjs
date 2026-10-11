#!/usr/bin/env node
// Daily Content Loop — which X conversations to join, with what owned content.
// Plan: docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md
//
// IT CANNOT POST. Nothing here schedules or publishes. The only queue write is
// `--save`, which creates ONE unscheduled draft per suggestion (create-once id).
//
// COST:
//   --replay, --discover, --execute     free (local files, bird, Firestore reads/writes)
//   --execute --draft-with-model        ONE Anthropic call per suggestion (≤3), logged
//                                       through logAnthropicCall → Operating Cost card
//
// Usage:
//   node scripts/x-content/daily-run.mjs --replay features/x-content-inventory/__tests__/fixtures/daily-loop-replay.json
//   node scripts/x-content/daily-run.mjs --client <id> --discover [--write]      # bird search, local only
//   node scripts/x-content/daily-run.mjs --client <id> --execute [--library full|demo] [--set <ids.json>] [--force] [--draft-with-model]
//   node scripts/x-content/daily-run.mjs --client <id> --show
//   node scripts/x-content/daily-run.mjs --client <id> --edit <suggestionId> --text "working copy"   # empty text clears the edit
//   node scripts/x-content/daily-run.mjs --client <id> --save <suggestionId> [--text "edited copy"]
//   node scripts/x-content/daily-run.mjs --client <id> --dismiss <suggestionId>
//
// --library: `demo` (default, same as the dashboard route) reads only the verified
// demo set; `full` reads every inventory item. `--set <ids.json>` overrides both.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDailyLoop, assertOwnerClient, discoveryQueries, packageEligibility, localDateOf, LOOP_VERSION, MAX_SUGGESTIONS,
} from '../../features/x-content-inventory/daily-loop.js';
import { buildDayPlan } from '../../features/x-content-inventory/plan-day.js';
import { createFirestorePlanStore } from '../../features/x-strategy/plan-store.js';
import {
  createMemoryRunStore, createFirestoreRunStore, loadDailyLoopInputs, saveSuggestionDraft, editSuggestion, dismissSuggestion, createModelDrafter,
} from '../../features/x-content-inventory/daily-run-store.js';
import { slotLabel, strategySourceLine, slotStatuses, VOICE_LINE } from '../../features/x-content-inventory/daily-loop/present.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const OWN_CORPUS = 'docs/audits/bai-ee-x-corpus.json';
const BENCH_CORPUS = 'docs/audits/seb-design-x-corpus.json';

function parseArgs(argv) {
  const out = { max: MAX_SUGGESTIONS };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--client') out.client = next();
    else if (a === '--replay') out.replay = next();
    else if (a === '--out') out.out = next();
    else if (a === '--set') out.set = next();
    else if (a === '--library') out.library = next();
    else if (a === '--edit') out.edit = next();
    else if (a === '--max') out.max = Number(next()) || MAX_SUGGESTIONS;
    else if (a === '--save') out.save = next();
    else if (a === '--dismiss') out.dismiss = next();
    else if (a === '--text') out.text = next();
    else if (a === '--queries') out.queries = Number(next()) || 6;
    else if (a === '--execute') out.execute = true;
    else if (a === '--discover') out.discover = true;
    else if (a === '--write') out.write = true;
    else if (a === '--show') out.show = true;
    else if (a === '--force') out.force = true;
    else if (a === '--draft-with-model') out.model = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const readJson = (p) => JSON.parse(readFileSync(path.resolve(REPO, p), 'utf8'));
const DEMO_SET = 'features/x-content-inventory/daily-loop-demo-set.json';

// Which library items the loop reads: --set file, else the whole library for
// `--library full`, else the verified demo set (the route's default).
function packageIdsForRun() {
  if (args.set) return readJson(args.set).ids;
  return args.library === 'full' ? null : readJson(DEMO_SET).ids;
}

function firebase() {
  require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
  return require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
}

// --- report ------------------------------------------------------------------

function report(run, label) {
  const L = [];
  L.push('', `DAILY CONTENT LOOP — ${run.clientId} — ${run.localDate} (${run.timezone})  [${label}]`);
  L.push(`  inputs: ${run.inputSource || 'unknown'} · copy: ${run.copySource || 'unknown'}`, '');
  L.push('INPUTS');
  for (const i of run.inputs || []) L.push(`  ${i.input.padEnd(22)} ${String(i.status).padEnd(9)} ${i.age ? i.age.padEnd(9) : ''.padEnd(9)} ${i.detail || ''}`);
  L.push('', `BRAND PROFILE  top phrases: ${(run.brandProfile?.topPhrases || []).join(', ')}`);
  L.push(`  sources: ${Object.entries(run.brandProfile?.sources || {}).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  L.push('', `CONVERSATIONS  ${run.stats.conversationPosts} posts → ${run.stats.narratives} narratives → ${run.stats.onBrandWithContent} on-brand with owned content (${run.stats.offBrand} off-brand, ${run.stats.withoutContent} without content)`);
  for (const s of run.shortlist || []) L.push(`  ${s.rank.toFixed(3)}  [${s.label.join(' ')}]  fit ${s.brandFit}  → ${s.skipped ? `skipped: ${s.reason}` : s.content}  ${s.anchor}`);
  L.push('', `LIBRARY  ${run.stats.eligible}/${run.stats.packages} eligible (story ${run.stats.eligibleByBasis.story}, facts ${run.stats.eligibleByBasis.facts})`);
  L.push('', `SUGGESTIONS (${run.suggestions.length})`);
  run.suggestions.forEach((s, n) => {
    L.push('', `  ${n + 1}. ${s.type.toUpperCase()}  ${s.id}  [${s.reviewState}${s.socialPostId ? ` → ${s.socialPostId}` : ''}]`);
    if (s.conversation) for (const p of s.conversation.posts.slice(0, 2)) L.push(`     conversation: @${p.author} (${p.ageHours}h, ${p.likes}♥) ${p.url}\n        "${p.text.slice(0, 110)}"`);
    L.push(`     why now:      ${s.why.now}`);
    L.push(`     why brand:    ${s.why.brand}`);
    L.push(`     brain:        ${s.why.brain}`);
    L.push(`     strategy:     ${s.why.strategy}`);
    L.push(`     content:      ${s.why.content}`);
    const h = s.why.history;
    if (h?.available) {
      const t = h.type ? `${h.type.key} n=${h.type.n} lift=${h.type.lift ?? '—'}${h.type.weak ? ' (weak)' : ''}` : '';
      const tp = (h.topics || []).map((x) => `${x.topic} n=${x.n} lift=${x.lift ?? '—'}${x.weak ? ' (weak)' : ''}`).join('; ') || 'no topic match';
      L.push(`     history:      ${t}; ${tp}${h.note ? ` — ${h.note}` : ''} [${h.range?.from?.slice(0, 10)} → ${h.range?.to?.slice(0, 10)}]`);
    } else L.push(`     history:      ${h?.note || 'missing'}`);
    L.push(`     draft (${s.draft.source}):`, `        ${s.draft.text || '(empty: write this one yourself)'}`);
    L.push(`     checks:       ${s.checks.blocked ? `BLOCKED — ${s.checks.violations.join('; ')}` : 'pass'} · guard lane ${s.checks.guard.lane}${s.checks.guard.hardBlock ? ' HARD BLOCK' : ''} · ${s.checks.chars} chars${s.checks.score ? ` · score ${Number(s.checks.score.value).toFixed(3)} (advisory, ${s.checks.score.profile})` : ' · score n/a (quote: borrowed reach not modelled)'}`);
    if (s.slot) L.push(`     slot:         ${slotLabel(s.slot)}`);
    L.push(`     proposed slot: ${s.proposedSlot && s.proposedSlot.localTime !== 'anytime' ? `${s.proposedSlot.localTime} ${s.proposedSlot.timezone} — ${s.proposedSlot.note}` : 'anytime today — suggestion only, not scheduled'}`);
  });
  L.push('', 'GAPS');
  for (const g of run.gaps) L.push(`  - [${g.code}] ${g.message}`);
  L.push('', `usage: ${run.usage.modelCalls} model call(s), ${run.usage.failures} failure(s). Nothing was scheduled or posted.`, '');
  return L.join('\n');
}

// --- modes ---------------------------------------------------------------------

async function replay() {
  const fx = readJson(args.replay);
  const store = createMemoryRunStore();
  // The fixture runs on the strategy spine too: same plan builder, the committed corpora, the fixture's own library.
  const own = readJson(OWN_CORPUS);
  const strategyInputs = { buildDayPlan, planInput: { corpusRows: own, benchmarkRows: readJson(BENCH_CORPUS), packages: fx.packages }, ownPosts: own, ownHandle: 'bai_ee' };
  const res = await runDailyLoop({ now: () => Date.parse(fx.now), store, readInputs: async () => ({ ...fx, strategyInputs }) }, { clientId: fx.clientId, max: args.max, inputSource: 'fixture' });
  const out = args.out || path.join(os.tmpdir(), `daily-run-replay-${res.run.localDate}.json`);
  writeFileSync(out, JSON.stringify(res.run, null, 2));
  process.stdout.write(report(res.run, 'FIXTURE REPLAY — not real data'));
  process.stdout.write(`replay output: ${out}\n`);
}

function resolveBird() {
  const p = process.env.BIRD || path.join(os.homedir(), '.local/birdtool/node_modules/.bin/bird');
  return existsSync(p) ? p : '';
}

async function discover() {
  assertOwnerClient(args.client);
  const BIRD = resolveBird();
  if (!BIRD) throw new Error('bird not found — see scripts/x-content/scan-quote-targets.mjs for install.');
  const fb = firebase();
  const inputs = await loadDailyLoopInputs({ db: fb.adminDb }, { clientId: args.client, packageIds: packageIdsForRun() });
  const eligible = inputs.packages.filter((p) => packageEligibility(p).ok);
  const sinceDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const queries = discoveryQueries(eligible, { limit: args.queries || 6, sinceDate });
  console.error(`discovery: ${queries.length} queries from ${eligible.length} eligible items: ${queries.map((q) => `${q.term} (${q.items})`).join(', ')}`);
  const posts = [];
  const failures = [];
  for (const [i, q] of queries.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 3000));
    try {
      const raw = execFileSync(BIRD, ['search', q.query, '-n', '15', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const start = raw.indexOf('[') === -1 ? raw.indexOf('{') : raw.indexOf('[');
      const parsed = JSON.parse(raw.slice(start));
      const rows = Array.isArray(parsed) ? parsed : parsed.tweets || [];
      for (const r of rows) posts.push({ ...r, query: q.query });
      console.error(`  ${q.query}: ${rows.length}`);
    } catch (err) {
      failures.push({ query: q.query, error: String(err?.message || err).slice(0, 120) });
      console.error(`  ${q.query}: FAILED`);
    }
  }
  const payload = { generatedAt: new Date().toISOString(), method: 'bird search (local, free)', queries: queries.map((q) => q.query), posts, failures };
  if (!args.write) {
    console.log(`\nDRY RUN — ${posts.length} posts from ${queries.length} queries. Add --write to save to dashboard_state/${args.client}.marketingBrief.conversationSearch.`);
    return;
  }
  if (!posts.length) throw new Error('every query failed or returned nothing — refusing to overwrite the saved search.');
  await fb.adminDb.collection('dashboard_state').doc(args.client).set({ marketingBrief: { conversationSearch: payload } }, { merge: true });
  console.log(`\nwrote ${posts.length} posts to dashboard_state/${args.client}.marketingBrief.conversationSearch`);
}

function modelDrafter(clientId) {
  const { createAnthropicClient } = require(path.join(REPO, 'features/not-the-rug-brief/anthropic-client.js'));
  const { logAnthropicCall } = require(path.join(REPO, 'api/_lib/usage-logger.cjs'));
  return createModelDrafter({ anthropic: createAnthropicClient(), logAnthropicCall, clientId });
}

function loadBrainContextFn() {
  const { loadClientBrainContext } = require(path.join(REPO, 'features/client-brain/store.cjs'));
  return (clientId) => loadClientBrainContext(clientId, { useFor: 'socialPosts', requireApproved: true }).catch(() => '');
}

async function execute() {
  assertOwnerClient(args.client);
  const fb = firebase();
  const store = createFirestoreRunStore(fb.adminDb);
  const res = await runDailyLoop({
    now: () => Date.now(),
    store,
    draft: args.model ? modelDrafter(args.client) : undefined,
    // readPlanDoc: the Strategy plan doc (x_strategy_plans) sets cadence/targets/floors/caps; no doc => unchanged behaviour.
    readInputs: () => loadDailyLoopInputs({ db: fb.adminDb, loadBrainContext: loadBrainContextFn(), buildDayPlan, readPlanDoc: (id) => createFirestorePlanStore(fb.adminDb).get(id) }, {
      clientId: args.client,
      packageIds: packageIdsForRun(),
      corpora: { own: readJson(OWN_CORPUS), benchmark: readJson(BENCH_CORPUS), ownSource: OWN_CORPUS, benchmarkSource: BENCH_CORPUS },
    }),
  }, { clientId: args.client, max: args.max, force: args.force });
  if (res.skipped) {
    console.log(`skipped: ${res.reason}${res.reason === 'unchanged' ? ' (inputs unchanged since the last run — use --force to regenerate; reviewed work is kept)' : ''}`);
    if (res.run) process.stdout.write(report(res.run, 'REAL DATA — saved run'));
    return;
  }
  process.stdout.write(report(res.run, args.model ? 'REAL DATA — model drafts' : 'REAL DATA — deterministic drafts (no model call)'));
}

function runKey() {
  return { clientId: args.client, localDate: localDateOf(Date.now()), channel: 'x', version: LOOP_VERSION };
}

async function show() {
  assertOwnerClient(args.client);
  const fb = firebase();
  const run = await createFirestoreRunStore(fb.adminDb).latest(runKey());
  if (!run) { console.log('No run in the last 7 days.'); return; }
  if (args.json) { process.stdout.write(JSON.stringify(run, null, 2)); return; }
  process.stdout.write(report(run, 'REAL DATA — saved run') + showStrategy(run));
}

// Strategy source, slots (filled or gap) and gap reasons; old v2 runs have none of it.
function showStrategy(run) {
  const L = ['STRATEGY'];
  const line = strategySourceLine(run.strategySource);
  L.push(`  source: ${line || 'none (run predates the strategy spine)'}`, `  ${VOICE_LINE}`);
  for (const x of slotStatuses(run)) L.push(`  ${x.letter}  ${(x.timeCT || 'anytime').padEnd(8)} ${x.type.padEnd(18)} ${(x.pillar || '-').padEnd(3)} ${x.filled ? 'filled' : `GAP — ${x.reason}`}`);
  const slotGaps = (run.gaps || []).filter((g) => g.slot);
  if (slotGaps.length) { L.push('  slot gaps:'); for (const g of slotGaps) L.push(`    - [${g.code}] ${g.slot.fillReason || g.message}`); }
  return L.join('\n') + '\n';
}

async function review() {
  assertOwnerClient(args.client);
  const fb = firebase();
  const store = createFirestoreRunStore(fb.adminDb);
  const latest = await store.latest(runKey());
  if (!latest) throw new Error('No run to review.');
  const key = { clientId: latest.clientId, localDate: latest.localDate, channel: latest.channel, version: latest.version };
  if (args.edit) {
    if (args.text === undefined) throw new Error('--edit needs --text "..." (use --text "" to clear the edit).');
    const edited = await editSuggestion({ store }, { key, suggestionId: args.edit, text: args.text });
    console.log(`${edited.reviewState}: ${args.edit}${edited.edit?.checks?.blocked ? ` — BLOCKED, cannot be saved: ${edited.edit.checks.violations.join('; ')}` : ''}`);
    return;
  }
  if (args.dismiss) {
    await dismissSuggestion({ store }, { key, suggestionId: args.dismiss });
    console.log(`dismissed ${args.dismiss}`);
    return;
  }
  const { getPackage } = await import('../../features/x-content-inventory/store.js');
  const { createDraftPostOnce } = await import('../../features/social-posting/twitter-service.js');
  try {
    const res = await saveSuggestionDraft({ store, getPackage, createDraftPostOnce }, { key, suggestionId: args.save, text: args.text });
    console.log(`${res.existing ? 'already saved' : 'saved'}: social_posts/${res.postId} (status draft, scheduledAt null)`);
  } catch (err) {
    console.error(`NOT SAVED: ${err.message}`);
    if (err.checks) console.error(JSON.stringify(err.checks, null, 2));
    process.exitCode = 1;
  }
}

try {
  if (args.replay) await replay();
  else if (args.discover) await discover();
  else if (args.execute) await execute();
  else if (args.show) await show();
  else if (args.save || args.dismiss || args.edit) await review();
  else {
    console.error('Pick a mode: --replay <fixture> | --discover | --execute | --show | --edit <id> | --save <id> | --dismiss <id>. See the header.');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
