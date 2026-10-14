// One daily-loop run: input freshness, input fingerprint, and the orchestration
// that selects, drafts (injected) and hands the run to the store.
// Decides the run document; never owns persistence, review, or network clients (all injected).
// The only module that composes select + copy + conversations + evidence.

import { LOOP_VERSION, CHANNEL, DEFAULT_TIMEZONE, MAX_SUGGESTIONS, assertOwnerClient } from './config.js';
import { stableHash, localDateOf } from './time-ids.js';
import { conversationPostsFrom } from './conversations.js';
import { deriveStrategy } from './evidence.js';
import { selectSuggestions, selectForSlots } from './select.js';
import { planSlots } from './slots.js';
import { tracksOf } from '../../x-strategy/content-tracks.js';
import { promotionsOf, promotionSelfReply } from '../../x-strategy/promotions.js';
import { strategyGuidance } from '../../x-strategy/strategy-doc.js';
import { buildContributionPrompt, fallbackCopy, checkSuggestionText, marketHookTopic } from './copy.js';
import { matchMarketTopic, textUsesTopic } from '../../content-context/market-signals.js';

const REVIEWED = new Set(['edited', 'saved', 'dismissed']);
// Fallback sources all start with "fallback"; anything else names the model.
const isModelDraft = (d) => !!d?.source && !String(d.source).startsWith('fallback');

// --- orchestration -------------------------------------------------------------------

function strategyRow(src) {
  if (!src) return { input: 'strategy slots', status: 'missing', asOf: null, age: null, detail: 'no slot plan for this run' };
  const letters = (src.slotLetters || []).join(', ');
  const plan = src.planSource === 'plan-doc' ? `Strategy plan v${src.planVersion ?? '?'}, ` : '';
  return { input: 'strategy slots', status: 'loaded', asOf: src.date || null, age: null, detail: `${plan}${src.mixSource || 'unknown mix'}, tier ${src.tier ?? '?'}, ${src.authoredPerDay ?? '?'} authored/day — slots ${letters || 'none'}` };
}

/**
 * Today's strategy slots, when the run input carries the strategy inputs
 * ({ buildDayPlan, planInput } or an already computed { plan }). null = old path.
 * The plan is built with the injected `now` so a run is deterministic.
 */
function spineOf(inputs, packages, { localDate, now, timezone }) {
  const s = inputs.strategyInputs;
  if (!s || (!s.buildDayPlan && !s.plan)) return null;
  // A Strategy plan doc (features/x-strategy/plan-inputs.js resolvePlanInputs) sets the cadence, engine targets,
  // floors and caps. Absent (or source 'default') => exactly the old call: nothing below changes.
  const pi = s.planInputs?.source === 'plan-doc' ? s.planInputs : null;
  const built = planSlots({
    buildDayPlan: s.buildDayPlan || (() => s.plan),
    input: {
      packages, ...(s.planInput || {}),
      ...(pi ? { posts: pi.posts, ...(pi.engineConfig ? { engineConfig: pi.engineConfig } : {}) } : {}),
      date: localDate, now,
    },
    timezone,
    ...(pi ? { typeFloors: pi.typeFloors, typeCaps: pi.typeCaps, planMeta: { planSource: pi.source, planVersion: pi.planVersion } } : {}),
  });
  return { ...built, ownPosts: s.ownPosts || s.planInput?.corpusRows || [], ownHandle: s.ownHandle || s.planInput?.handle || 'bai_ee' };
}

/** Freshness of every input, shown first in every run. */
export function describeInputs(inputs, now) {
  const age = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? `${Math.round((now - t) / 3_600_000)}h old` : 'undated'; };
  return [
    { input: 'watchlist scan', status: inputs.scan ? 'loaded' : 'missing', asOf: inputs.scan?.generatedAt || null, age: inputs.scan ? age(inputs.scan.generatedAt) : null, detail: inputs.scan ? `${(inputs.scan.candidates || []).length} candidates` : 'run scan-quote-targets' },
    { input: 'brand-topic search', status: inputs.search ? 'loaded' : 'missing', asOf: inputs.search?.generatedAt || null, age: inputs.search ? age(inputs.search.generatedAt) : null, detail: inputs.search ? `${(inputs.search.queries || []).length} queries, ${(inputs.search.posts || []).length} posts` : 'run daily-run --discover' },
    { input: 'content library', status: (inputs.packages || []).length ? 'loaded' : 'missing', asOf: null, age: null, detail: `${(inputs.packages || []).length} items${inputs.libraryNote ? ` — ${inputs.libraryNote}` : ''}` },
    { input: 'Client Brain', status: inputs.brain?.status === 'approved' ? 'approved' : (inputs.brain?.status || 'missing'), asOf: inputs.brain?.updatedAt || null, age: null, detail: 'Seb rules §7 + content guard — Brain not used' },
    { input: 'Strategy Builder plan', status: inputs.strategyPlan ? (inputs.strategyPlan.excluded ? 'excluded' : 'loaded') : 'missing', asOf: inputs.strategyPlan?.generatedAt || null, age: null, detail: `not used for X${inputs.strategyPlan?.excluded ? ` — ${inputs.strategyPlan.excluded}` : ''}` },
    strategyRow(inputs.strategySource),
    { input: 'own-account history', status: inputs.ownSummary ? 'loaded' : 'missing', asOf: inputs.ownSummary?.range?.to || null, age: null, detail: inputs.ownSummary ? `${inputs.ownSummary.posts} posts, ${inputs.ownSummary.range?.from?.slice(0, 10)} → ${inputs.ownSummary.range?.to?.slice(0, 10)} (${inputs.ownSummary.source})` : '' },
    { input: 'benchmark report', status: inputs.benchmark ? 'loaded' : 'missing', asOf: inputs.benchmark?.asOf || null, age: null, detail: inputs.benchmark?.source || '' },
  ];
}

export function inputFingerprint({ scan, search, packages, brain, strategyPlan, strategySource, benchmark, max, contentTracks, strategyDoc }) {
  const pkgSig = packages.map((p) => `${p.id}:${p.updatedAt || ''}:${String(p.story || '').length}:${p.rights}:${p.status}`).sort().join(',');
  return stableHash([
    scan?.generatedAt || 'no-scan',
    search?.generatedAt || 'no-search',
    stableHash(pkgSig),
    brain?.status === 'approved' ? (brain.version || 'approved') : 'no-brain',
    strategyPlan?.excluded ? 'excluded' : (strategyPlan?.generatedAt || 'no-plan'),
    benchmark?.asOf || (benchmark ? 'computed' : 'no-benchmark'),
    // A changed slot plan must regenerate.
    // planSource/planVersion join the hash only when a Strategy plan doc was used, so a run with no plan doc keeps its old fingerprint.
    strategySource ? stableHash(JSON.stringify([strategySource.date, strategySource.tier, strategySource.authoredPerDay, strategySource.mixSource, strategySource.slotLetters,
      ...(strategySource.planSource ? [strategySource.planSource, strategySource.planVersion] : [])])) : 'no-slots',
    max,
    // Track shares/promotion links join the hash only when tracks were supplied, so old inputs keep their fingerprint.
    ...(contentTracks ? [stableHash(JSON.stringify(contentTracks.map((t) => [t.id, t.engines, t.share, t.promotions.map((p) => [p.id, p.url])])))] : []),
    // A CONFIRMED strategy document changes drafting, so its version joins the hash; a draft or no doc adds nothing.
    ...(strategyDoc?.confirmed ? [`strategy-doc-v${strategyDoc.version}`] : []),
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
  const spine = spineOf(inputs, packages, { localDate, now, timezone });
  const strategySource = spine ? spine.strategySource : inputs.strategySource || null;
  const contentTracks = Array.isArray(inputs.contentTracks) && inputs.contentTracks.length ? inputs.contentTracks : tracksOf(null);
  const promotions = promotionsOf({ contentTracks });
  const fingerprint = inputFingerprint({ ...inputs, packages, strategySource, max, contentTracks: inputs.contentTracks });
  const key = { clientId, localDate, channel: CHANNEL, version: LOOP_VERSION };

  // Prior doc: lets a no-model regenerate keep model drafts and lets reviewed cards skip the model.
  const prior = deps.store.read ? await deps.store.read(key) : null;
  const priorById = new Map((prior?.suggestions || []).map((p) => [p.id, p]));

  const claim = await deps.store.claim({ key, fingerprint, force: !!opts.force, now });
  if (!claim.claimed) return { skipped: true, reason: claim.reason, run: claim.run || null };

  const strategy = deriveStrategy({ benchmark: inputs.benchmark, strategyPlan: inputs.strategyPlan, localDate, max });
  const brain = inputs.brain || {};
  const conversationPosts = conversationPostsFrom(inputs);
  const selection = spine
    ? selectForSlots({
      clientId, localDate, timezone, now, max, strategy, brain, packages, conversationPosts, contentTracks, promotions,
      slots: spine.slots,
      matchedSlots: spine.plan.slots,
      // Quote slots draw on the watchlist scan only, carrying the scan's own score.
      candidates: conversationPosts.filter((p) => p.source === 'watchlist')
        .map((p) => ({ ...p, score: (inputs.scan?.candidates || []).find((c) => String(c.id) === p.id)?.score })),
      ownSummary: inputs.ownSummary || null,
      ownPosts: spine.ownPosts,
      ownHandle: spine.ownHandle,
    })
    : selectSuggestions({
      clientId, localDate, timezone, now, max, strategy, brain, packages, conversationPosts, contentTracks, promotions,
      ownSummary: inputs.ownSummary || null,
    });

  const gaps = [...selection.gaps, ...(spine?.gaps || [])];
  if (brain.status !== 'approved') {
    gaps.push({ code: 'brain-not-approved', message: `Client Brain is ${brain.status || 'missing'} — drafts use a plain voice, not the Brain.${brain.note ? ` ${brain.note}` : ''}` });
  }
  if (!inputs.ownSummary) gaps.push({ code: 'no-own-history', message: 'No own-account history loaded — history evidence is missing.' });
  gaps.push({ code: 'feedback-loop-manual', message: 'Performance feedback is not automated: history comes from saved corpora, not from today’s results.' });
  // Drafting voice = the approved Brain, plus the Rules + Formats of a CONFIRMED strategy document (none for a draft).
  const brainVoice = brain.status === 'approved' ? (brain.context || '') : '';
  const guidance = strategyGuidance(inputs.strategyDoc);
  const voice = guidance
    ? `${brainVoice || '(no approved brand voice — write plainly and specifically, first person, lowercase start is fine)'}\n\n${guidance}`
    : brainVoice;

  const run = {
    clientId, localDate, timezone, channel: CHANNEL, version: LOOP_VERSION,
    status: 'running',
    inputSource: opts.inputSource === 'fixture' ? 'fixture' : 'live',
    copySource: 'fallback', // set after drafting
    // Legacy field kept one version for old readers; derived, not authoritative.
    mode: deps.draft ? 'execute' : 'replay',
    strategySource,
    inputFingerprint: fingerprint,
    inputs: describeInputs({ ...inputs, strategySource }, now),
    scanGeneratedAt: inputs.scan?.generatedAt || null,
    searchGeneratedAt: inputs.search?.generatedAt || null,
    brainVersion: brain.status === 'approved' ? (brain.version ?? null) : null,
    brainStatus: brain.status || 'missing',
    // Present only when a confirmed strategy document shaped drafting (absent keeps old run docs byte-identical).
    ...(inputs.strategyDoc?.confirmed ? { strategyDocVersion: inputs.strategyDoc.version ?? null } : {}),
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
  const usedLines = new Set(); // fallback reactions already used, so a run never repeats one
  try {
    for (const s of selection.suggestions) {
      const before = priorById.get(s.id);
      const reviewed = before && (REVIEWED.has(before.reviewState) || before.socialPostId);
      const keepModel = before && isModelDraft(before.draft) && (reviewed || !deps.draft);
      if (reviewed || keepModel) {
        // The store keeps reviewed cards as they are; a model draft is reused rather than paid for again.
        modelFlags.push(isModelDraft(before.draft));
        run.suggestions.push(reviewed ? { ...s, slot: s.slot ?? null, package: s.package ?? null, draft: before.draft, checks: before.checks, edit: before.edit ?? null, reviewState: before.reviewState, socialPostId: before.socialPostId ?? null }
          : { ...s, slot: s.slot ?? null, package: s.package ?? null, draft: { ...before.draft, selfReply: before.draft.selfReply || promotionSelfReply(s.promotion) }, checks: checkSuggestionText(before.draft.text, s), edit: null, reviewState: 'pending', socialPostId: null });
        continue;
      }
      const built = buildContributionPrompt({ suggestion: s, voice });
      // Market Signals: the topic (if any) that fits this slot's track topics. Context only; never auto-posted content.
      const marketSignals = inputs.marketSignals || null;
      const trackId = typeof s.track === 'string' ? s.track : s.track?.id;
      const trackTopics = contentTracks.find((t) => t.id === trackId)?.topics || [];
      const marketTopic = marketSignals ? matchMarketTopic(marketSignals, trackTopics) : null;
      const quoteSlot = s.type === 'quote' || s.slot?.type === 'quote-react' || s.slot?.type === 'quote-commentary';
      let text = fallbackCopy(s, { usedLines, marketSignals, trackTopics });
      let marketUsed = !!marketHookTopic(s, { marketSignals, trackTopics }) && !!text;
      usedLines.add(text);
      let source = 'fallback (item text, cut to fit)';
      let fromModel = false;
      if (deps.draft && built.ok) {
        try {
          const res = await deps.draft(built, { suggestionId: s.id, ...(marketSignals && !quoteSlot ? { marketSignals } : {}) });
          run.usage.modelCalls += 1;
          if (res?.post) { text = res.post; source = res.model || 'model'; fromModel = true; marketUsed = !!marketTopic && !quoteSlot && textUsesTopic(text, marketTopic); }
        } catch (err) {
          run.usage.failures += 1;
          source = `fallback — model call failed: ${String(err?.message || err).slice(0, 120)}`;
        }
      } else if (!built.ok) {
        source = `fallback — ${built.reason}`;
      }
      modelFlags.push(fromModel);
      run.suggestions.push({ ...s, ...(marketUsed && marketTopic ? { trigger: { kind: 'market', reason: marketTopic } } : {}), slot: s.slot ?? null, package: s.package ?? null, draft: { text, selfReply: promotionSelfReply(s.promotion), source }, checks: checkSuggestionText(text, s), edit: null, reviewState: 'pending', socialPostId: null });
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
