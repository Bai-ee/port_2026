// One daily-loop run: input freshness, input fingerprint, and the orchestration
// that selects, drafts (injected) and hands the run to the store.
// Decides the run document; never owns persistence, review, or network clients (all injected).
// The only module that composes select + copy + conversations + evidence.

import { LOOP_VERSION, CHANNEL, DEFAULT_TIMEZONE, MAX_SUGGESTIONS, assertOwnerClient } from './config.js';
import { stableHash, localDateOf } from './time-ids.js';
import { conversationPostsFrom } from './conversations.js';
import { deriveStrategy } from './evidence.js';
import { selectSuggestions } from './select.js';
import { buildContributionPrompt, fallbackCopy, checkSuggestionText } from './copy.js';

// --- orchestration -------------------------------------------------------------------

/** Freshness of every input, shown first in every run. */
export function describeInputs(inputs, now) {
  const age = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? `${Math.round((now - t) / 3_600_000)}h old` : 'undated'; };
  return [
    { input: 'watchlist scan', status: inputs.scan ? 'loaded' : 'missing', asOf: inputs.scan?.generatedAt || null, age: inputs.scan ? age(inputs.scan.generatedAt) : null, detail: inputs.scan ? `${(inputs.scan.candidates || []).length} candidates` : 'run scan-quote-targets' },
    { input: 'brand-topic search', status: inputs.search ? 'loaded' : 'missing', asOf: inputs.search?.generatedAt || null, age: inputs.search ? age(inputs.search.generatedAt) : null, detail: inputs.search ? `${(inputs.search.queries || []).length} queries, ${(inputs.search.posts || []).length} posts` : 'run daily-run --discover' },
    { input: 'content library', status: (inputs.packages || []).length ? 'loaded' : 'missing', asOf: null, age: null, detail: `${(inputs.packages || []).length} items${inputs.libraryNote ? ` — ${inputs.libraryNote}` : ''}` },
    { input: 'Client Brain', status: inputs.brain?.status === 'approved' ? 'approved' : (inputs.brain?.status || 'missing'), asOf: inputs.brain?.updatedAt || null, age: null, detail: inputs.brain?.status === 'approved' ? 'used for voice' : (inputs.brain?.note || 'not approved — not used') },
    { input: 'Strategy Builder plan', status: inputs.strategyPlan ? (inputs.strategyPlan.excluded ? 'excluded' : 'loaded') : 'missing', asOf: inputs.strategyPlan?.generatedAt || null, age: null, detail: inputs.strategyPlan?.excluded || '' },
    { input: 'own-account history', status: inputs.ownSummary ? 'loaded' : 'missing', asOf: inputs.ownSummary?.range?.to || null, age: null, detail: inputs.ownSummary ? `${inputs.ownSummary.posts} posts, ${inputs.ownSummary.range?.from?.slice(0, 10)} → ${inputs.ownSummary.range?.to?.slice(0, 10)} (${inputs.ownSummary.source})` : '' },
    { input: 'benchmark report', status: inputs.benchmark ? 'loaded' : 'missing', asOf: inputs.benchmark?.asOf || null, age: null, detail: inputs.benchmark?.source || '' },
  ];
}

export function inputFingerprint({ scan, search, packages, brain, strategyPlan, benchmark, max }) {
  const pkgSig = packages.map((p) => `${p.id}:${p.updatedAt || ''}:${String(p.story || '').length}:${p.rights}:${p.status}`).sort().join(',');
  return stableHash([
    scan?.generatedAt || 'no-scan',
    search?.generatedAt || 'no-search',
    stableHash(pkgSig),
    brain?.status === 'approved' ? (brain.version || 'approved') : 'no-brain',
    strategyPlan?.excluded ? 'excluded' : (strategyPlan?.generatedAt || 'no-plan'),
    benchmark?.asOf || (benchmark ? 'computed' : 'no-benchmark'),
    max,
    LOOP_VERSION,
  ].join('|'));
}

/**
 * Run the loop once.
 * deps: readInputs(), draft({system,prompt}) optional, store {claim, complete, fail}, now()
 * opts: { clientId, max, timezone, force, localDate, inputSource: 'fixture' for replay files }
 */
export async function runDailyLoop(deps, opts = {}) {
  const clientId = opts.clientId;
  assertOwnerClient(clientId);
  const now = deps.now ? deps.now() : Date.now();
  const timezone = opts.timezone || DEFAULT_TIMEZONE;
  const localDate = opts.localDate || localDateOf(now, timezone);
  const max = Math.max(1, Math.min(MAX_SUGGESTIONS, Number(opts.max) || MAX_SUGGESTIONS));

  const inputs = await deps.readInputs();
  const packages = Array.isArray(inputs.packages) ? inputs.packages : [];
  const fingerprint = inputFingerprint({ ...inputs, packages, max });
  const key = { clientId, localDate, channel: CHANNEL, version: LOOP_VERSION };

  const claim = await deps.store.claim({ key, fingerprint, force: !!opts.force, now });
  if (!claim.claimed) return { skipped: true, reason: claim.reason, run: claim.run || null };

  const strategy = deriveStrategy({ benchmark: inputs.benchmark, strategyPlan: inputs.strategyPlan, localDate, max });
  const brain = inputs.brain || {};
  const selection = selectSuggestions({
    clientId, localDate, timezone, now, max, strategy, brain, packages,
    conversationPosts: conversationPostsFrom(inputs),
    ownSummary: inputs.ownSummary || null,
  });

  const gaps = [...selection.gaps];
  if (brain.status !== 'approved') {
    gaps.push({ code: 'brain-not-approved', message: `Client Brain is ${brain.status || 'missing'} — drafts use a plain voice, not the Brain.${brain.note ? ` ${brain.note}` : ''}` });
  }
  if (!inputs.ownSummary) gaps.push({ code: 'no-own-history', message: 'No own-account history loaded — history evidence is missing.' });
  gaps.push({ code: 'feedback-loop-manual', message: 'Performance feedback is not automated: history comes from saved corpora, not from today’s results.' });
  const voice = brain.status === 'approved' ? (brain.context || '') : '';

  const run = {
    clientId, localDate, timezone, channel: CHANNEL, version: LOOP_VERSION,
    status: 'running',
    inputSource: opts.inputSource === 'fixture' ? 'fixture' : 'live',
    copySource: 'fallback', // set after drafting
    // Legacy field kept one version for old readers; derived, not authoritative.
    mode: deps.draft ? 'execute' : 'replay',
    inputFingerprint: fingerprint,
    inputs: describeInputs(inputs, now),
    scanGeneratedAt: inputs.scan?.generatedAt || null,
    searchGeneratedAt: inputs.search?.generatedAt || null,
    brainVersion: brain.status === 'approved' ? (brain.version ?? null) : null,
    brainStatus: brain.status || 'missing',
    strategy: { decisions: strategy.decisions, notes: strategy.notes, plan: strategy.plan },
    brandProfile: selection.brandProfile,
    shortlist: selection.shortlist,
    stats: selection.stats,
    suggestions: [],
    gaps,
    usage: { modelCalls: 0, failures: 0 },
    generatedAt: new Date(now).toISOString(),
  };

  const modelFlags = [];
  try {
    for (const s of selection.suggestions) {
      const built = buildContributionPrompt({ suggestion: s, voice });
      let text = fallbackCopy(s);
      let source = 'fallback (item text, cut to fit)';
      let fromModel = false;
      if (deps.draft && built.ok) {
        try {
          const res = await deps.draft(built, { suggestionId: s.id });
          run.usage.modelCalls += 1;
          if (res?.post) { text = res.post; source = res.model || 'model'; fromModel = true; }
        } catch (err) {
          run.usage.failures += 1;
          source = `fallback — model call failed: ${String(err?.message || err).slice(0, 120)}`;
        }
      } else if (!built.ok) {
        source = `fallback — ${built.reason}`;
      }
      modelFlags.push(fromModel);
      run.suggestions.push({ ...s, draft: { text, selfReply: '', source }, checks: checkSuggestionText(text, s), edit: null, reviewState: 'pending', socialPostId: null });
    }
    run.copySource = modelFlags.length && modelFlags.every(Boolean) ? 'model' : modelFlags.some(Boolean) ? 'mixed' : 'fallback';
    run.status = 'complete';
    return { skipped: false, run: await deps.store.complete(run) };
  } catch (err) {
    run.status = 'partial';
    run.error = String(err?.message || err).slice(0, 300);
    await deps.store.fail(run, err);
    throw err;
  }
}
