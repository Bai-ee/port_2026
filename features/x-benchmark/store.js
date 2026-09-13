// store.js — Firestore persistence for ingested corpora and gap reports.
//
// Layout:
//
//   x_corpora/{handle}                          stat block + watchlist seed + ingest meta
//   dashboard_state/{clientId}.marketingBrief.xGrowth.gapReport   the comparison
//   dashboard_state/{clientId}.marketingBrief.xGrowth.calendar    the generated plan
//
// ⚠️ Keyed by LOWERCASED HANDLE, in its own collection, deliberately NOT in
// `x_monitor`. That collection is keyed by the immutable X user id, and a
// benchmark account ingested from a timeline is identified by handle — mixing
// the two key types in one collection is the kind of trap that surfaces as a
// silent miss months later. A handle can be reassigned; for a benchmark that is
// acceptable (re-ingest and the data corrects itself), which is not true for
// the monitored account's own follower history.
//
// A corpus is stored as its STAT BLOCK, not its rows. The rows are ~650KB per
// account and nothing downstream needs them: compare.js consumes stat blocks,
// and the one derived artifact that needs raw rows (the quote-target watchlist)
// is derived at ingest time and stored alongside, compact.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

const ROOT = 'x_corpora';

export function corpusKey(handle) {
  return String(handle ?? '').trim().replace(/^@+/, '').toLowerCase();
}

function corpusRef(handle) {
  const key = corpusKey(handle);
  if (!key) throw Object.assign(new Error('handle is required.'), { status: 400 });
  return fb.adminDb.collection(ROOT).doc(key);
}

/**
 * Save an ingested corpus.
 *
 * @param {string} handle
 * @param {object} input
 * @param {object} input.stats - summarizeCorpus() block
 * @param {object[]} [input.watchlistSeed] - deriveWatchlist() output
 * @param {object} [input.meta] - { source, posts, firstDate, lastDate, tzOffsetHours }
 */
export async function saveCorpus(handle, input = {}) {
  const at = Date.now();
  const payload = {
    handle: corpusKey(handle),
    stats: input.stats ?? null,
    watchlistSeed: Array.isArray(input.watchlistSeed) ? input.watchlistSeed : [],
    meta: { ...(input.meta ?? {}), ingestedAt: at },
    updatedAt: at,
  };
  await corpusRef(handle).set(payload, { merge: true });
  return payload;
}

export async function readCorpus(handle) {
  const snap = await corpusRef(handle).get();
  return snap.exists ? snap.data() : null;
}

/** Read several corpora at once, skipping any that have never been ingested. */
export async function readCorpora(handles = []) {
  const keys = [...new Set((Array.isArray(handles) ? handles : []).map(corpusKey).filter(Boolean))];
  const docs = await Promise.all(keys.map((k) => corpusRef(k).get()));
  return docs.filter((d) => d.exists).map((d) => d.data());
}

/**
 * Store a client's gap report and the calendar generated from it.
 *
 * Written under the client's dashboard_state, not the corpus doc: a corpus is
 * shared (several clients can benchmark against the same account and it is
 * ingested once), while a comparison belongs to exactly one client.
 */
export async function saveGapReport(clientId, { report, calendar } = {}) {
  if (!clientId) throw Object.assign(new Error('clientId is required.'), { status: 400 });
  const patch = { computedAt: Date.now() };
  if (report !== undefined) patch.gapReport = report;
  if (calendar !== undefined) patch.calendar = calendar;
  await fb.adminDb.collection('dashboard_state').doc(String(clientId)).set(
    { marketingBrief: { xGrowth: patch }, updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true },
  );
  return patch;
}

export async function readXGrowthState(clientId) {
  if (!clientId) return null;
  const snap = await fb.adminDb.collection('dashboard_state').doc(String(clientId)).get();
  return snap.exists ? (snap.data()?.marketingBrief?.xGrowth ?? null) : null;
}
