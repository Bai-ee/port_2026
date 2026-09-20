#!/usr/bin/env node
// Draft the copy for today's plan.
//
// The model assembles; it does not invent. The author's `story` carries the
// facts, the Client Brain carries the voice, and the measured shape for the
// series carries the structure — see features/x-content-inventory/draft.js.
// A package with no story is REFUSED rather than drafted, because a model
// handed no material writes something that sounds like a post and says
// nothing, which is the whole reason automated content reads as slop.
//
// COST: dry run is free and makes no network call of any kind. `--execute`
// makes ONE Anthropic call per draftable slot (~$0.001 each) and logs every
// one through logAnthropicCall, so the spend lands on the Operating Cost card.
//
// IT CANNOT POST. Output is text on your terminal. Nothing is written to
// social_posts, nothing is scheduled, nothing reaches X.
//
// Usage:
//   node scripts/x-content/draft-day.mjs                 # dry run: prompts + fallbacks
//   node scripts/x-content/draft-day.mjs --posts 8
//   node scripts/x-content/draft-day.mjs --execute       # real drafts, costs money
//   node scripts/x-content/draft-day.mjs --execute --max 3
//   node scripts/x-content/draft-day.mjs --show-prompt   # print the full prompt

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayPlan } from '../../features/x-content-inventory/plan-day.js';
import { buildDraftPrompt, validateDraft, fallbackDraft } from '../../features/x-content-inventory/draft.js';
import { guardXPost } from '../../features/x-content-guard/index.js';
import { scoreXPost } from '../../features/x-growth/index.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const INVENTORY = path.join(REPO, 'features/x-content-inventory/content-packages.json');
const CORPUS = path.join(REPO, 'docs/audits/bai-ee-x-corpus.json');
const BENCHMARK = path.join(REPO, 'docs/audits/seb-design-x-corpus.json');

const MODEL = 'claude-sonnet-4-6';

function parseArgs(argv) {
  const out = { posts: 5, date: new Date().toISOString().slice(0, 10), execute: false, max: 0, showPrompt: false, client: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--posts') out.posts = Number(argv[++i]) || 5;
    else if (a === '--date') out.date = argv[++i] || out.date;
    else if (a === '--max') out.max = Number(argv[++i]) || 0;
    else if (a === '--client') out.client = argv[++i] || '';
    else if (a === '--execute') out.execute = true;
    else if (a === '--show-prompt') out.showPrompt = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const packages = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const plan = buildDayPlan({
  corpusRows: JSON.parse(readFileSync(CORPUS, 'utf8')),
  benchmarkRows: existsSync(BENCHMARK) ? JSON.parse(readFileSync(BENCHMARK, 'utf8')) : null,
  packages,
  date: args.date,
  posts: args.posts,
});

const byId = new Map(packages.map((p) => [p.id, p]));

/** Approved brand voice, if there is one. Absent or unapproved returns '' and
 * every consumer behaves as before — the same contract the rest of the repo
 * uses for Client Brain. */
async function loadVoice(clientId) {
  if (!clientId) return '';
  try {
    const { loadClientBrainContext } = require('../../features/client-brain/store.cjs');
    return await loadClientBrainContext(clientId, { useFor: 'socialPosts', requireApproved: true }) || '';
  } catch {
    return '';
  }
}

async function callModel({ system, prompt }) {
  const { createAnthropicClient } = require('../../features/not-the-rug-brief/anthropic-client.js');
  const anthropic = createAnthropicClient();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  // ⚠️ Every Anthropic call in this repo must be instrumented or it is
  // invisible to the Operating Cost card. (`enhancePost` in twitter-service.js
  // is NOT — worth fixing separately.)
  try {
    const { logAnthropicCall } = require('../../api/_lib/usage-logger.cjs');
    await logAnthropicCall({ module: 'x-content-inventory', action: 'draft-day', model: MODEL, response: res, clientId: args.client || null });
  } catch { /* logging must never break drafting */ }

  let text = String(res?.content?.[0]?.text || '').trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const parsed = JSON.parse(text);
  return { post: String(parsed.post || '').trim(), selfReply: String(parsed.selfReply || '').trim() };
}

const voice = await loadVoice(args.client);
const draftable = plan.slots.filter((s) => s.packageId);

const out = [];
out.push('');
out.push(`DRAFTS — ${plan.date}  ·  ${draftable.length} of ${plan.slots.length} slots have content`);
out.push(args.execute ? `  MODE: execute — one ${MODEL} call per slot, logged to usage_events` : '  MODE: dry run — no network calls, showing the deterministic fallback');
if (args.client) out.push(`  voice: ${voice ? 'Client Brain (approved)' : 'none available for ' + args.client}`);
out.push('');

let calls = 0;
for (const slot of draftable) {
  const pkg = byId.get(slot.packageId);
  const head = `  ${slot.timeCT}  ${slot.slot}  ${slot.type}  [${slot.series}]  ${slot.packageId}`;

  const built = buildDraftPrompt({
    pkg,
    slot,
    voice,
    trigger: slot.matchReason?.includes('anniversary') ? slot.matchReason : null,
  });

  if (!built.ok) {
    out.push(`${head}\n      ⚠️ NOT DRAFTABLE — ${built.reason}`);
    continue;
  }

  if (args.showPrompt) out.push(`${head}\n--- prompt ---\n${built.prompt}\n--- end ---`);

  let post = fallbackDraft({ pkg, slot });
  let selfReply = pkg?.cta ?? '';
  let source = 'fallback (author text, truncated)';

  if (args.execute && (!args.max || calls < args.max)) {
    try {
      const res = await callModel(built);
      if (res.post) { post = res.post; selfReply = res.selfReply || selfReply; source = MODEL; calls += 1; }
    } catch (err) {
      out.push(`${head}\n      ⚠️ model call failed: ${String(err?.message || err).slice(0, 120)}`);
    }
  }

  const check = validateDraft(post, { series: slot.series, slotType: slot.type });
  const guard = guardXPost({ text: post, type: slot.type, media: pkg?.mediaState === 'video' ? 'video' : 'none' });
  // scoreXPost models engagement per impression and has no concept of borrowed
  // reach, so it is meaningful on originals and misleading on quote-reacts.
  // scoreXPost returns a full report; the headline number is xGrowthScore.
  const scored = slot.type === 'quote-react' ? null : scoreXPost(post);
  const score = scored && typeof scored === 'object' ? scored.xGrowthScore : scored;

  out.push(head);
  out.push(`      ${post}`);
  if (selfReply) out.push(`      ↳ self-reply: ${selfReply}`);
  out.push(`      source: ${source}  ·  ${check.chars} chars  ·  ${check.ok ? 'rules ok' : 'VIOLATIONS: ' + check.violations.join('; ')}`);
  out.push(`      guard: ${guard.hardBlock ? 'HARD BLOCK' : 'pass'} (lane ${guard.lane})${score != null ? `  ·  score ${Number(score).toFixed(3)}` : '  ·  score n/a (borrowed reach — scoreXPost does not model it)'}`);
  // ⚠️ scoreXPost recommends "add a question" by default. Audience questions
  // measured 12.6 avg likes on the benchmark, below its own baseline — the
  // scorer's profile predates that finding. Surfaced, not obeyed.
  const recs = (scored?.recommendations ?? []).filter((r) => !/question/i.test(r.action));
  if (recs.length) out.push(`      scorer says: ${recs.map((r) => r.action).join('; ')}`);
  out.push('');
}

if (!args.execute) {
  out.push(`Dry run. ${draftable.length} slot${draftable.length === 1 ? '' : 's'} would cost ~$${(draftable.length * 0.001).toFixed(3)} with --execute.`);
}
out.push('Nothing was posted. Drafts live on this terminal only.');
out.push('');

process.stdout.write(`${out.join('\n')}\n`);
