// Loads every input the loop reads from the stores that already hold them.
// Decides which Brain/strategy/corpus data is usable (and why not); read-only, writes nothing.
// Stands alone: takes an injected db and returns plain data.

import { summarizeCorpus, compareToBenchmark } from '../../x-benchmark/index.js';
import { tagTopics } from '../../x-benchmark/taxonomy.js';
import { localDateOf } from './time-ids.js';

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
