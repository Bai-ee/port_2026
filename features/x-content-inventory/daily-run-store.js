// Daily Content Loop — run persistence, rerun protection and review actions.
//
// Suggestions live HERE, in `x_content_daily_runs`, not in `social_posts`.
// Only an explicit Save Draft copies one into the queue, as an unscheduled
// draft, through the create-once helper (`createDraftPostOnce`) so a
// double-click or a concurrent request still yields exactly one row.
//
// Run key: (clientId, localDate, channel, version) → one doc per local day.
// Rerun rules: a claim is a short lease (no duplicate model work from two
// Generate clicks); an unchanged input fingerprint skips regeneration; a
// regeneration keeps every reviewed (saved/dismissed) suggestion.
//
// I/O is injected: `createFirestoreRunStore(db)` for real runs,
// `createMemoryRunStore()` for replay and tests.

import { packageEligibility, checkSuggestionText, socialPostIdFor, guardTypeFor, localDateOf } from './daily-loop.js';
import { summarizeCorpus, compareToBenchmark } from '../x-benchmark/index.js';
import { tagTopics } from '../x-benchmark/taxonomy.js';

export const RUNS_COLLECTION = 'x_content_daily_runs';
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
const REVIEWED = new Set(['saved', 'dismissed']);
const LATEST_LOOKBACK_DAYS = 7;

const bad = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function runDocId({ clientId, localDate, channel = 'x', version = 1 }) {
  return `${clientId}__${localDate}__${channel}__v${version}`;
}

// --- pure rules (shared by both stores) -------------------------------------

/** Should this caller run the generation? */
export function claimDecision(prev, { fingerprint, force = false, now, leaseMs = CLAIM_LEASE_MS }) {
  if (prev?.status === 'running' && Number(prev.claimedAt) + leaseMs > now) return { claimed: false, reason: 'in-progress' };
  if (prev?.status === 'complete' && prev.inputFingerprint === fingerprint && !force) return { claimed: false, reason: 'unchanged', run: prev };
  return { claimed: true };
}

/** Reviewed work survives a regeneration; fresh pending suggestions replace old pending ones. */
export function mergePreserved(prev, next) {
  const kept = (prev?.suggestions || []).filter((s) => REVIEWED.has(s.reviewState) || s.socialPostId);
  const keptIds = new Set(kept.map((s) => s.id));
  return { ...next, suggestions: [...kept, ...(next.suggestions || []).filter((s) => !keptIds.has(s.id))] };
}

// --- stores ----------------------------------------------------------------

export function createMemoryRunStore({ leaseMs = CLAIM_LEASE_MS } = {}) {
  const docs = new Map();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  return {
    docs,
    async claim({ key, fingerprint, force, now }) {
      const id = runDocId(key);
      const decision = claimDecision(docs.get(id), { fingerprint, force, now, leaseMs });
      if (decision.claimed) docs.set(id, { ...(docs.get(id) || {}), ...key, status: 'running', claimedAt: now });
      return clone(decision);
    },
    async complete(run) {
      const id = runDocId(run);
      const merged = mergePreserved(docs.get(id), { ...run, status: 'complete' });
      docs.set(id, clone(merged));
      return clone(merged);
    },
    async fail(run) {
      const id = runDocId(run);
      docs.set(id, clone(mergePreserved(docs.get(id), { ...run, status: 'partial' })));
    },
    async read(key) { return clone(docs.get(runDocId(key)) || null); },
    async updateSuggestion(key, suggestionId, mutate) {
      const id = runDocId(key);
      const run = docs.get(id);
      const idx = run?.suggestions?.findIndex((s) => s.id === suggestionId) ?? -1;
      if (idx < 0) throw bad('Suggestion not found.', 404);
      const patch = await mutate(clone(run.suggestions[idx]), clone(run));
      run.suggestions[idx] = { ...run.suggestions[idx], ...patch };
      return clone(run.suggestions[idx]);
    },
  };
}

export function createFirestoreRunStore(db, { leaseMs = CLAIM_LEASE_MS } = {}) {
  const col = () => db.collection(RUNS_COLLECTION);
  return {
    async claim({ key, fingerprint, force, now }) {
      const ref = col().doc(runDocId(key));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const decision = claimDecision(snap.exists ? snap.data() : null, { fingerprint, force, now, leaseMs });
        if (decision.claimed) tx.set(ref, { ...key, status: 'running', claimedAt: now }, { merge: true });
        return decision;
      });
    },
    async complete(run) {
      const ref = col().doc(runDocId(run));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const merged = mergePreserved(snap.exists ? snap.data() : null, { ...run, status: 'complete', claimedAt: null });
        tx.set(ref, merged);
        return merged;
      });
    },
    async fail(run) {
      const ref = col().doc(runDocId(run));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.set(ref, mergePreserved(snap.exists ? snap.data() : null, { ...run, status: 'partial', claimedAt: null }));
      });
    },
    async read(key) {
      const snap = await col().doc(runDocId(key)).get();
      return snap.exists ? snap.data() : null;
    },
    /** Most recent run on or before `localDate`, without a composite index. */
    async latest({ clientId, localDate, channel = 'x', version }) {
      const [y, m, d] = localDate.split('-').map(Number);
      const refs = Array.from({ length: LATEST_LOOKBACK_DAYS }, (_, i) => {
        const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
        return col().doc(runDocId({ clientId, localDate: day, channel, version }));
      });
      const snaps = await db.getAll(...refs);
      const hit = snaps.find((s) => s.exists);
      return hit ? hit.data() : null;
    },
    async updateSuggestion(key, suggestionId, mutate) {
      const ref = col().doc(runDocId(key));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const run = snap.exists ? snap.data() : null;
        const idx = run?.suggestions?.findIndex((s) => s.id === suggestionId) ?? -1;
        if (idx < 0) throw bad('Suggestion not found.', 404);
        const patch = await mutate(run.suggestions[idx], run);
        const suggestions = run.suggestions.slice();
        suggestions[idx] = { ...suggestions[idx], ...patch };
        tx.update(ref, { suggestions });
        return suggestions[idx];
      });
    },
  };
}

// --- inputs ----------------------------------------------------------------

const PACKAGE_FIELDS = ['series', 'pillar', 'title', 'story', 'mediaState', 'effort', 'rights', 'status', 'platforms', 'approval',
  'expiresAt', 'priority', 'source', 'facets', 'tags', 'entities', 'assetRefs', 'thumbRef', 'engine', 'updatedAt', 'lastPostedAt'];

function corpusRange(rows) {
  const ts = rows.map((r) => r.utc).filter(Boolean).sort();
  return { from: ts[0] || null, to: ts[ts.length - 1] || null };
}

/**
 * Load every input the loop reads, from the stores that already hold them.
 * Read-only. `corpora` are the committed own/benchmark corpus rows (the CLI
 * reads them from docs/audits, the route bundles them).
 *
 * deps: { db, loadBrainContext(clientId) -> string }
 * opts: { clientId, packageIds?: string[], corpora: { own, benchmark, ownSource, benchmarkSource }, now }
 */
export async function loadDailyLoopInputs(deps, { clientId, packageIds = null, corpora = {}, now = Date.now() }) {
  const { db } = deps;
  const stateSnap = await db.collection('dashboard_state').doc(clientId).get();
  const state = stateSnap.exists ? stateSnap.data() : {};

  let packages;
  if (packageIds?.length) {
    const snaps = await db.getAll(...packageIds.map((id) => db.collection('x_content_packages').doc(id)));
    packages = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  } else {
    const snap = await db.collection('x_content_packages').select(...PACKAGE_FIELDS).get();
    packages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // Brain: only an APPROVED Brain is used. Anything else is reported with why.
  const brainSnap = await db.collection('clients').doc(clientId).collection('client_brain').doc('current').get();
  const brainDoc = brainSnap.exists ? brainSnap.data() : null;
  let brain = { status: 'missing', note: 'No Client Brain.' };
  if (brainDoc) {
    const compiledFor = brainDoc.markdownMeta?.clientName || brainDoc.identity?.name || null;
    const recordName = (brainDoc.sourceRefs || []).find((s) => s.id === 'client-record')?.extractedFields?.name || null;
    const mismatch = compiledFor && recordName && !String(compiledFor).toLowerCase().includes(String(recordName).toLowerCase());
    brain = {
      status: brainDoc.status || 'unknown',
      version: brainDoc.version ?? null,
      updatedAt: brainDoc.updatedAtIso || brainDoc.generatedAt || null,
      note: mismatch ? `Brain was compiled for "${compiledFor}", not "${recordName}" — needs a corrected draft before approval.` : null,
      context: brainDoc.status === 'approved' && deps.loadBrainContext ? await deps.loadBrainContext(clientId) : '',
    };
  }

  // Strategy Builder: a plan that does not cover today is excluded, with its sources named.
  let strategyPlan = state.strategyBuilder?.lastPlan || null;
  if (strategyPlan) {
    const localDate = localDateOf(now);
    const dates = [strategyPlan.today?.date, ...(strategyPlan.items || []).map((i) => String(i.scheduledAt || '').slice(0, 10))].filter(Boolean).sort();
    if (!dates.includes(localDate)) {
      const kb = [...new Set((strategyPlan.knowledgeBaseSources || []).map((s) => s.title).filter(Boolean))].slice(0, 4);
      strategyPlan = {
        ...strategyPlan,
        excluded: `stale (covers ${dates[0] || '?'} → ${dates[dates.length - 1] || '?'})${kb.length ? `; built from ${kb.join(', ')}` : ''}`,
      };
    }
  }

  const own = Array.isArray(corpora.own) ? corpora.own : null;
  const bench = Array.isArray(corpora.benchmark) ? corpora.benchmark : null;
  let ownSummary = null;
  let benchmark = null;
  if (own) {
    // Re-tag with the shared taxonomy so topic evidence uses the same labels
    // the loop puts on conversations (the committed rows carry a per-account tagger's labels).
    const retagged = own.map((r) => ({ ...r, topics: tagTopics(r.text, { quotedText: r.quotedText }) }));
    const s = summarizeCorpus(retagged, { handle: 'bai_ee' });
    ownSummary = { posts: own.length, range: corpusRange(own), source: `${corpora.ownSource || 'own corpus'} (re-tagged with the shared taxonomy)`, byType: s.byType, byTopic: s.byTopic };
  }
  if (own && bench) {
    const report = compareToBenchmark({ own: summarizeCorpus(own, { handle: 'bai_ee' }), benchmark: summarizeCorpus(bench, { handle: 'seb__design' }) });
    benchmark = {
      ...report,
      asOf: [corpusRange(own).to, corpusRange(bench).to].sort()[0]?.slice(0, 10) || null,
      source: `computed from ${corpora.ownSource || 'own corpus'} vs ${corpora.benchmarkSource || 'benchmark corpus'} (no saved report exists)`,
    };
  }

  return {
    scan: state.marketingBrief?.quoteTargets || null,
    search: state.marketingBrief?.conversationSearch || null,
    packages,
    libraryNote: packageIds?.length ? `verified demo set (${packages.length} of ${packageIds.length} found)` : 'full library',
    brain,
    strategyPlan,
    ownSummary,
    benchmark,
  };
}

// --- review actions --------------------------------------------------------

function findSuggestion(run, suggestionId) {
  const s = run?.suggestions?.find((x) => x.id === suggestionId);
  if (!s) throw bad('Suggestion not found.', 404);
  return s;
}

/** Compose what goes into the queue. A quote carries the quoted URL last,
 * which is how X composes a quote post. */
export function composeQueueContent(suggestion, text) {
  const body = String(text ?? '').trim();
  if (suggestion.type !== 'quote') return body;
  const url = suggestion.opportunity?.url;
  if (!url) throw bad('Quote suggestion has no source URL.', 422);
  return `${body}\n\n${url}`;
}

/**
 * Save one suggestion to `social_posts` as an unscheduled draft.
 * Re-checks the (possibly edited) text and the package's eligibility first;
 * a blocked suggestion never reaches the queue.
 *
 * deps: { store, getPackage(id), createDraftPostOnce(clientId, postId, payload), now() }
 */
export async function saveSuggestionDraft(deps, { key, suggestionId, text }) {
  const run = await deps.store.read(key);
  const s = findSuggestion(run, suggestionId);
  if (s.socialPostId) return { ok: true, postId: s.socialPostId, existing: true };
  if (s.reviewState === 'dismissed') throw bad('Suggestion was dismissed.', 409);

  const finalText = typeof text === 'string' ? text : s.draft?.text || '';
  const checks = checkSuggestionText(finalText, s);
  if (checks.blocked) throw bad(`Blocked by checks: ${checks.violations.join('; ') || 'content guard hard block'} — edit the text and try again.`, 422, { checks });

  const pkg = await deps.getPackage(s.package?.id);
  const eligibility = pkg ? packageEligibility(pkg, { now: deps.now ? deps.now() : Date.now() }) : { ok: false, reason: 'missing' };
  if (!eligibility.ok) throw bad(`Content item is no longer eligible (${eligibility.reason}).`, 409);

  const postId = socialPostIdFor(s.id);
  const { post, existing } = await deps.createDraftPostOnce(key.clientId, postId, {
    content: composeQueueContent(s, finalText),
    platform: 'x',
    source: 'daily-loop',
    packageId: s.package.id,
    engine: pkg.engine || null,
    selfReply: s.draft?.selfReply ? { text: s.draft.selfReply } : null,
    // A reply carries its target the same way Reply Targets drafts do; the
    // operator posts it into the thread.
    replyTo: s.type === 'reply' && s.opportunity ? { author: s.opportunity.author, url: s.opportunity.url, text: s.opportunity.text, source: 'daily-loop' } : null,
    sourceRef: {
      kind: 'daily-loop',
      runKey: runDocId(key),
      suggestionId: s.id,
      suggestionType: s.type,
      conversationId: s.conversation?.id || null,
      opportunityId: s.opportunity?.id || null,
      opportunityUrl: s.opportunity?.url || null,
      matchTerms: s.match?.terms || [],
    },
    xStrategy: { postType: guardTypeFor(s), source: 'daily-loop' },
    algorithmProfileVersion: checks.score?.profile || null,
  });

  await deps.store.updateSuggestion(key, s.id, () => ({
    reviewState: 'saved',
    socialPostId: post?.id || postId,
    savedText: finalText,
    savedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    checks,
  }));
  return { ok: true, postId: post?.id || postId, existing };
}

export async function dismissSuggestion(deps, { key, suggestionId }) {
  return deps.store.updateSuggestion(key, suggestionId, (s) => {
    if (s.socialPostId) throw bad('Already saved as a draft — delete it from the queue instead.', 409);
    return { reviewState: 'dismissed', dismissedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
  });
}

// --- model drafting ------------------------------------------------------------

export const DRAFT_MODEL = 'claude-sonnet-4-6';

/**
 * One Anthropic call per suggestion, logged through logAnthropicCall so the
 * spend reaches the Operating Cost card. Only built when a human asks for it.
 * deps: { anthropic (client), logAnthropicCall, clientId }
 */
export function createModelDrafter({ anthropic, logAnthropicCall, clientId }) {
  return async ({ system, prompt }) => {
    const res = await anthropic.messages.create({ model: DRAFT_MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: prompt }] });
    try { await logAnthropicCall({ module: 'x-content-inventory', action: 'daily-loop', model: DRAFT_MODEL, response: res, clientId }); } catch { /* logging never blocks drafting */ }
    let text = String(res?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return { post: String(JSON.parse(text).post || '').trim(), model: DRAFT_MODEL };
  };
}
