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

// ---------------------------------------------------------------------------
// Chunking + rowsMeta helpers (pure, client-safe). Contract: master plan §5.
// ---------------------------------------------------------------------------

export const CHUNK_SIZE = 250;
export const STALE_AFTER_DAYS = 7;

/** Split rows into arrays of at most `size` (default 250). Empty input -> []. Order kept. */
export function chunkRows(rows, size = CHUNK_SIZE) {
  const list = Array.isArray(rows) ? rows : [];
  const n = Number.isInteger(size) && size > 0 ? size : CHUNK_SIZE;
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Inverse of chunkRows. Accepts chunk arrays or `{rows}` docs; ignores malformed chunks. */
export function unchunkRows(chunks) {
  const out = [];
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const rows = Array.isArray(c) ? c : c && Array.isArray(c.rows) ? c.rows : [];
    for (const r of rows) out.push(r);
  }
  return out;
}

/**
 * Build x_corpora/{handle}.rowsMeta.
 * viewsCoverage = share of rows whose `views` is non-null (0 for no rows). range = min/max `utc` (null/null if none).
 * `pulledAt` defaults to now; pass null explicitly when the pull time is unknown (committed seeds).
 */
export function buildRowsMeta(rows, { pulledAt, source } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let withViews = 0;
  let from = null;
  let to = null;
  for (const r of list) {
    if (r && present(r.views)) withViews += 1;
    const u = r && typeof r.utc === 'string' && r.utc ? r.utc : null;
    if (u) {
      if (from === null || u < from) from = u;
      if (to === null || u > to) to = u;
    }
  }
  return {
    rowCount: list.length,
    range: { from, to },
    pulledAt: pulledAt === undefined ? new Date().toISOString() : pulledAt,
    viewsCoverage: list.length ? withViews / list.length : 0,
    chunks: Math.ceil(list.length / CHUNK_SIZE),
    source: source ?? 'bird',
  };
}

/** Age of a rowsMeta. Stale when older than 7 days (exactly 7d is not stale) or when pulledAt is unknown. */
export function freshness(meta, now = Date.now()) {
  const pulled = meta && meta.pulledAt ? new Date(meta.pulledAt).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(pulled) || !Number.isFinite(nowMs)) return { ageDays: null, stale: true };
  const ageDays = (nowMs - pulled) / 86400000;
  return { ageDays, stale: ageDays > STALE_AFTER_DAYS };
}
