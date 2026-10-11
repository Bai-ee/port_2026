// Pure merge of X corpus rows (docs/audits/*-x-corpus.json shape). No I/O.
// Corpus files are sorted newest-first by `utc`.

const validId = (r) => r && typeof r === 'object' && r.id !== null && r.id !== undefined && r.id !== '';
const utcOf = (r) => (typeof r.utc === 'string' ? r.utc : '');

/** The only fields a refresh may copy onto an existing row. Everything else is kept as-is. */
export const METRIC_FIELDS = Object.freeze(['likes', 'reposts', 'replies', 'views']);
/** Derived from METRIC_FIELDS, never copied from incoming (ingest emits a 0-1 ratio; the committed corpora use percent). */
export const DERIVED_FIELDS = Object.freeze(['engagement', 'engagementRate']);

const present = (v) => v !== null && v !== undefined;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function mergeMetrics(row, inc) {
  const merged = { ...row };
  let changed = false;
  for (const f of METRIC_FIELDS) {
    if (present(inc[f]) && inc[f] !== row[f]) { merged[f] = inc[f]; changed = true; }
  }
  // Same formula as the corpus builders: engagement = likes + reposts + replies, rate = engagement / views.
  if (changed && present(merged.views) && merged.views > 0) {
    merged.engagement = num(merged.likes) + num(merged.reposts) + num(merged.replies);
    merged.engagementRate = Number(((merged.engagement / merged.views) * 100).toFixed(2));
  }
  return merged;
}

/**
 * Merge incoming rows into existing rows by id.
 * - Existing rows: only METRIC_FIELDS update, and only from non-null incoming values; tags, type,
 *   text, urls etc. are kept. `engagement`/`engagementRate` (DERIVED_FIELDS) are recomputed when metrics changed
 *   and views are known. A null/undefined incoming value never erases an existing one.
 * - New rows (id not in existing) are added whole, newest-first by `utc`.
 * - Existing order is kept. Rows without an id are skipped. Inputs are never mutated.
 * @returns {Array<object>}
 */
export function mergeRowsById(existingRows, incomingRows) {
  const existing = (Array.isArray(existingRows) ? existingRows : []).filter(validId);
  const incoming = (Array.isArray(incomingRows) ? incomingRows : []).filter(validId);

  // Last duplicate in incoming wins.
  const incomingById = new Map();
  for (const r of incoming) incomingById.set(String(r.id), r);

  const seen = new Set();
  const out = [];
  for (const row of existing) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const inc = incomingById.get(id);
    if (!inc) { out.push({ ...row }); continue; }
    out.push(mergeMetrics(row, inc));
  }

  const fresh = [...incomingById.entries()]
    .filter(([id]) => !seen.has(id))
    .map(([, r]) => ({ ...r }))
    .sort((a, b) => (utcOf(a) < utcOf(b) ? 1 : utcOf(a) > utcOf(b) ? -1 : 0));

  for (const row of fresh) {
    let at = out.findIndex((r) => utcOf(r) < utcOf(row));
    if (at === -1) at = out.length;
    out.splice(at, 0, row);
  }
  return out;
}
