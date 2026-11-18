// Curated bucket for rendered videos (Video Remix P2a). The owner approves/rejects rv-<jobId> packages;
// the verdict lives on the package doc as `curation: { state, at, by }` (missing = pending).
//
// Writes go straight to the doc as a merge of {curation, updatedAt}: upsertPackage rewrites the whole doc
// and would race the render sync. Sync never touches `curation` (see sync.js NEVER list).
// All I/O is injected so tests use fakes; the route wires Firestore.

export const CURATION_STATES = ['approved', 'rejected', 'pending'];
export const CURATION_LIST_CAP = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * deps: { getDoc(id): Promise<object|null>, mergeDoc(id, patch): Promise<void>, deleteField(): sentinel }
 * `state: 'pending'` removes the verdict (undo).
 */
export async function setCuration(deps, { clientId, id, state, by, now }) {
  const docId = String(id || '').trim();
  if (!docId.startsWith('rv-')) throw fail(400, 'curation-bad-id', 'Only rendered-video (rv-) packages can be curated.');
  if (!CURATION_STATES.includes(state)) throw fail(400, 'curation-bad-state', `state must be one of ${CURATION_STATES.join(', ')}.`);
  const doc = await deps.getDoc(docId);
  if (!doc) throw fail(404, 'curation-not-found', `Package ${docId} not found.`);
  if (!clientId || doc.clientId !== clientId) throw fail(403, 'curation-client-mismatch', `Package ${docId} belongs to another client.`);
  if (doc.source?.kind !== 'rendered-video') throw fail(400, 'curation-bad-source', `Package ${docId} is not a rendered video.`);
  const at = new Date(now ?? Date.now()).toISOString();
  const curation = state === 'pending' ? deps.deleteField() : { state, at, by: by || null };
  await deps.mergeDoc(docId, { curation, updatedAt: now ?? Date.now() });
  return { ok: true, id: docId, curation: state === 'pending' ? null : { state, at, by: by || null } };
}

const stateOf = (r) => r?.curation?.state === 'approved' || r?.curation?.state === 'rejected' ? r.curation.state : 'pending';
const renderedMs = (r) => { const t = typeof r?.renderedAt === 'number' ? r.renderedAt : Date.parse(r?.renderedAt); return Number.isFinite(t) ? t : null; };

/** rows = all stored rv- packages. Window by renderedAt, newest first, slim rows + counts. */
export function listCurationCandidates(rows, { days = 10, now = Date.now() } = {}) {
  const live = (rows || []).filter((r) => r && r.status !== 'retired');
  const since = now - days * DAY_MS;
  const inWindow = live
    .map((r) => ({ r, t: renderedMs(r) }))
    .filter((x) => x.t != null && x.t >= since)
    .sort((a, b) => b.t - a.t);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const { r } of inWindow) counts[stateOf(r)] += 1;
  const items = inWindow.slice(0, CURATION_LIST_CAP).map(({ r }) => ({
    id: r.id,
    title: r.title ?? null,
    renderedAt: r.renderedAt ?? null,
    durationSec: r.durationSec ?? null,
    curation: r.curation ?? null,
    rights: r.rights ?? null,
  }));
  const approvedTotal = live.filter((r) => stateOf(r) === 'approved').length;
  return { items, counts, approvedTotal, days, truncated: inWindow.length > items.length };
}
