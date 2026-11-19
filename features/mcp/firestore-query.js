// firestore-query.js - safe, bounded Firestore reads for the data tools. The db is injected.

import { assertReadablePath, isDeniedCollectionName, isDeniedSubcollection, redactValue, PathError, REDACT_KEY_RE, REDACT_KEY_EXEMPT } from './redact.js';
import { ToolError } from './jsonrpc.js';

export const QUERY_DEFAULT_LIMIT = 50;
export const QUERY_MAX_LIMIT = 200;
export const MAX_WHERE = 3;
const FIELD_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/;

// Filtering or ordering on a secret-looking field would let a caller binary-search the value that redaction hides.
const assertFieldAllowed = (field) => {
  if (REDACT_KEY_RE.test(field)) throw new ToolError(`Field "${field.slice(0, 60)}" looks like a credential and cannot be used to filter or order.`);
  return field;
};

const asToolError = (e) => (e instanceof PathError ? new ToolError(e.message) : e);

/** Validate + normalise query_collection arguments. Throws ToolError. */
export function normalizeQueryArgs(args) {
  let parsed;
  try { parsed = assertReadablePath(args?.collection); } catch (e) { throw asToolError(e); }
  if (parsed.isDocument) throw new ToolError('collection must be a collection path (odd number of segments), e.g. "social_posts" or "clients/abc/client_brain". Use get_document for a document.');

  const where = Array.isArray(args?.where) ? args.where : [];
  if (where.length > MAX_WHERE) throw new ToolError(`At most ${MAX_WHERE} equality filters.`);
  const clauses = where.map((w) => {
    if (!w || typeof w.field !== 'string' || !FIELD_RE.test(w.field)) throw new ToolError('Each where needs a valid field name.');
    assertFieldAllowed(w.field);
    const v = w.value;
    if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) throw new ToolError('where.value must be a string, number, boolean or null.');
    return { field: w.field, value: v };
  });

  let orderBy = null;
  if (args?.orderBy !== undefined && args?.orderBy !== null && args.orderBy !== '') {
    if (typeof args.orderBy !== 'string' || !FIELD_RE.test(args.orderBy)) throw new ToolError('orderBy must be a valid field name.');
    orderBy = assertFieldAllowed(args.orderBy);
  }
  const direction = args?.direction === 'desc' ? 'desc' : 'asc';
  const rawLimit = args?.limit === undefined ? QUERY_DEFAULT_LIMIT : Number(args.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new ToolError('limit must be a positive integer.');
  const limit = Math.min(rawLimit, QUERY_MAX_LIMIT);
  const startAfter = args?.startAfter === undefined || args.startAfter === '' ? null : String(args.startAfter);
  if (startAfter && (startAfter.includes('/') || startAfter.length > 200)) throw new ToolError('startAfter must be a document id.');
  return { path: parsed.path, where: clauses, orderBy, direction, limit, startAfter };
}

export async function runQuery(db, args) {
  const n = normalizeQueryArgs(args);
  let q = db.collection(n.path);
  for (const w of n.where) q = q.where(w.field, '==', w.value);
  if (n.orderBy) q = q.orderBy(n.orderBy, n.direction);
  if (n.startAfter) {
    const snap = await db.collection(n.path).doc(n.startAfter).get();
    if (!snap.exists) throw new ToolError('startAfter document not found.');
    q = q.startAfter(snap);
  }
  const res = await q.limit(n.limit + 1).get();
  const docs = res.docs.slice(0, n.limit);
  const hasMore = res.docs.length > n.limit;
  return {
    collection: n.path,
    count: docs.length,
    hasMore,
    ...(hasMore && docs.length ? { nextStartAfter: docs[docs.length - 1].id } : {}),
    documents: docs.map((d) => ({ id: d.id, data: redactValue(d.data()) })),
  };
}

export async function runGetDocument(db, rawPath) {
  let parsed;
  try { parsed = assertReadablePath(rawPath); } catch (e) { throw asToolError(e); }
  if (!parsed.isDocument) throw new ToolError('path must be a document path (even number of segments), e.g. "clients/abc".');
  const ref = db.doc(parsed.path);
  const snap = await ref.get();
  let subcollections = [];
  try { subcollections = (await ref.listCollections()).map((c) => c.id).filter((id) => !isDeniedCollectionName(id) && !isDeniedSubcollection(id, parsed.segments.at(-2))); } catch { /* optional */ }
  if (!snap.exists) return { path: parsed.path, exists: false, subcollections };
  return { path: parsed.path, exists: true, data: redactValue(snap.data()), subcollections };
}

export async function runListCollections(db) {
  const cols = (await db.listCollections()).map((c) => c.id).filter((id) => !isDeniedCollectionName(id)).sort();
  const rows = await Promise.all(cols.map(async (name) => {
    try {
      const agg = await db.collection(name).count().get();
      return { name, count: agg.data().count };
    } catch {
      return { name, count: null };
    }
  }));
  return { collections: rows, note: 'Credential and private-account collections are hidden. Counts are exact document counts.' };
}

// ---- get_document_field: page through ONE field of a large document ------------------------------------------

// Budget for the whole printed result (indent 1, as the dispatcher prints it), leaving room under RESULT_MAX_CHARS.
export const FIELD_PAGE_BUDGET = 30000;
const FIELD_MAX_ITEMS = 500;
const sizeOf = (v) => { try { return JSON.stringify(v ?? null, null, 1).length; } catch { return 0; } };

/**
 * One field of a document, paged so nothing is silently cut. `field` is a dot path (numeric parts index arrays);
 * omitted = the whole document. Strings are sliced by character offset/limit, arrays by element offset/limit
 * (default: as many whole elements as fit), objects that do not fit come back as a map of their keys and sizes.
 * Secrets: the full document is redacted (key rule on) BEFORE navigation, and a field segment that looks like a
 * credential is refused outright. Stored data only.
 */
export async function runGetDocumentField(db, args, { budget = FIELD_PAGE_BUDGET } = {}) {
  let parsed;
  try { parsed = assertReadablePath(args?.path); } catch (e) { throw asToolError(e); }
  if (!parsed.isDocument) throw new ToolError('path must be a document path (even number of segments), e.g. "dashboard_state/<clientId>".');
  const field = args?.field === undefined || args?.field === null ? '' : String(args.field).trim();
  if (field && !FIELD_RE.test(field)) throw new ToolError('field must be a dot path like "audienceSummary" or "audienceSummary.warmFollowers.0".');
  const parts = field ? field.split('.') : [];
  if (parts.some((p) => !p)) throw new ToolError('field has an empty segment.');
  for (const p of parts) {
    if (!REDACT_KEY_EXEMPT.includes(p) && REDACT_KEY_RE.test(p)) throw new ToolError(`Field segment "${p.slice(0, 60)}" looks like a credential and is not readable.`);
  }
  const num = (v, name) => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new ToolError(`${name} must be a non-negative integer.`);
    return n;
  };
  const offset = num(args?.offset, 'offset') ?? 0;
  const limit = num(args?.limit, 'limit');
  if (limit === 0) throw new ToolError('limit must be at least 1.');

  const snap = await db.doc(parsed.path).get();
  if (!snap.exists) return { path: parsed.path, exists: false };
  let v = redactValue(snap.data());
  for (let i = 0; i < parts.length; i += 1) {
    const k = parts[i];
    const ok = v !== null && typeof v === 'object' && (Array.isArray(v) ? /^\d+$/.test(k) && String(Number(k)) === k && Number(k) < v.length : Object.prototype.hasOwnProperty.call(v, k));
    if (!ok) {
      const at = parts.slice(0, i).join('.') || '(root)';
      const keys = Array.isArray(v) ? `array of ${v.length}` : v && typeof v === 'object' ? Object.keys(v).slice(0, 200) : typeof v;
      throw new ToolError(`No "${parts.slice(0, i + 1).join('.')}" in ${parsed.path}. ${at} has: ${JSON.stringify(keys)}`);
    }
    v = v[k];
  }
  const base = { path: parsed.path, field: field || '(root)' };
  // Every size check measures the WHOLE result as the dispatcher prints it (nested values gain indent), never a bare value.
  const fits = (r) => sizeOf(r) <= budget;

  if (typeof v === 'string') {
    const total = v.length;
    // Note: the dispatcher re-runs value-pattern redaction on each page; a pattern can rarely match at a page edge that
    // is not a word boundary in the stored text (shows "[redacted]" there). Never a leak: the doc was redacted first.
    const page = (n) => {
      const value = v.slice(offset, offset + n);
      const end = offset + value.length;
      return { ...base, type: 'string', total, offset, returned: value.length, ...(end < total ? { nextOffset: end } : {}), value };
    };
    let n = Math.min(limit ?? budget, budget);
    let r = page(n);
    while (n > 1 && !fits(r)) { n = Math.max(1, Math.floor((n * budget) / sizeOf(r)) - 16); r = page(n); }
    return r;
  }
  if (Array.isArray(v)) {
    const total = v.length;
    const max = Math.min(limit ?? FIELD_MAX_ITEMS, FIELD_MAX_ITEMS);
    const page = (items) => {
      const end = offset + items.length;
      return { ...base, type: 'array', total, offset, returned: items.length, ...(end < total ? { nextOffset: end } : {}), items };
    };
    let items = v.slice(offset, offset + max);
    let r = page(items);
    while (items.length && !fits(r)) {
      // Shrink proportionally, then by one, until the printed page fits.
      const next = Math.min(items.length - 1, Math.floor((items.length * budget) / sizeOf(r)));
      items = items.slice(0, Math.max(0, next)); r = page(items);
    }
    if (!items.length && offset < total) {
      return { ...base, type: 'array', total, offset, tooBigForOneRead: true, elementChars: sizeOf(v[offset]), howToRead: `pass field "${field ? `${field}.` : ''}${offset}" to page through that element` };
    }
    return r;
  }
  if (v !== null && typeof v === 'object') {
    if (fits({ ...base, type: 'object', value: v })) return { ...base, type: 'object', value: v };
    // Too big: list its keys with sizes, paged by offset/limit over the key list (a map keyed by account id can be huge).
    const all = Object.keys(v);
    const total = all.length;
    const describe = (k) => {
      const x = v[k];
      const reachable = FIELD_RE.test(k) && !k.includes('.') && (REDACT_KEY_EXEMPT.includes(k) || !REDACT_KEY_RE.test(k));
      return { key: k, type: Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x, ...(Array.isArray(x) || typeof x === 'string' ? { length: x.length } : {}), chars: sizeOf(x), ...(reachable ? {} : { reachable: false }) };
    };
    const page = (keys) => {
      const end = offset + keys.length;
      return {
        ...base, type: 'object', tooBigForOneRead: true, totalChars: sizeOf(v), totalKeys: total, offset, ...(end < total ? { nextOffset: end } : {}), keys,
        howToRead: `call again with field "${field ? `${field}.` : ''}<key>" for each key (strings and arrays page with offset/limit)${end < total ? '; pass offset=nextOffset (no field change) for more keys' : ''}`,
      };
    };
    let keys = all.slice(offset, offset + Math.min(limit ?? FIELD_MAX_ITEMS, FIELD_MAX_ITEMS)).map(describe);
    let r = page(keys);
    while (keys.length > 1 && !fits(r)) { keys = keys.slice(0, Math.max(1, Math.min(keys.length - 1, Math.floor((keys.length * budget) / sizeOf(r))))); r = page(keys); }
    return r;
  }
  return { ...base, type: v === null ? 'null' : typeof v, value: v };
}
