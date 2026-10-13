// firestore-query.js - safe, bounded Firestore reads for the data tools. The db is injected.

import { assertReadablePath, isDeniedCollectionName, isDeniedSubcollection, redactValue, PathError, REDACT_KEY_RE } from './redact.js';
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
