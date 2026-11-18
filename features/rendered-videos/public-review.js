import { CURATION_STATES } from './curation.js';

// Pure input handling for the PUBLIC Remix review route (app/api/public/remix-review). Everything a signed-out
// visitor can send is validated here; the route only wires Firestore. Owner scoping lives in curationMediaPackages.

export const REVIEW_ID_RE = /^rv-[A-Za-z0-9_-]{1,120}$/;
export const REVIEW_MEDIA_MAX_IDS = 60;
export const REVIEW_MEDIA_KINDS = ['thumb', 'video'];
export const REVIEW_PUBLIC_BY = 'public';

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** @returns {{action:'list', days:number} | {action:'set', id:string, state:string} | {action:'media', ids:string[], kinds:string[]}} */
export function parseReviewRequest(body) {
  const action = body?.action;
  if (action === 'list') {
    const n = Number(body?.days);
    return { action, days: Math.min(90, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 10)) };
  }
  if (action === 'set') {
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!REVIEW_ID_RE.test(id)) throw bad('id must be a rendered-video (rv-) id.');
    if (!CURATION_STATES.includes(body?.state)) throw bad(`state must be one of ${CURATION_STATES.join(', ')}.`);
    return { action, id, state: body.state };
  }
  if (action === 'media') {
    if (!Array.isArray(body?.ids)) throw bad('ids[] is required.');
    const ids = [...new Set(body.ids.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))];
    if (!ids.length) throw bad('ids[] is required.');
    if (ids.length > REVIEW_MEDIA_MAX_IDS) throw bad(`At most ${REVIEW_MEDIA_MAX_IDS} ids per call.`);
    if (!ids.every((id) => REVIEW_ID_RE.test(id))) throw bad('Only rendered-video (rv-) ids are allowed.');
    const kinds = Array.isArray(body?.kinds) && body.kinds.length ? body.kinds : ['thumb'];
    if (!kinds.every((k) => REVIEW_MEDIA_KINDS.includes(k))) throw bad(`kinds must be among ${REVIEW_MEDIA_KINDS.join(', ')}.`);
    return { action, ids, kinds };
  }
  throw bad('Unknown action.');
}

/** Stored packages (Map or array) the page may mint media URLs for: owned by the media owner client only. */
export function ownedReviewPackages(stored, ownerClientId) {
  if (!ownerClientId) return [];
  const rows = stored instanceof Map ? [...stored.values()] : Array.isArray(stored) ? stored : [];
  return rows.filter((p) => p && REVIEW_ID_RE.test(String(p.id)) && p.clientId === ownerClientId);
}

/** Public view of a verdict: never expose `by` (it can be a voter's email). */
export function publicCuration(curation) {
  return curation ? { state: curation.state, at: curation.at } : null;
}

/** Strip `by` from a curation-list result (items) or a set result (curation). */
export function publicizeReviewResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  if (Array.isArray(out.items)) out.items = out.items.map((i) => ({ ...i, curation: publicCuration(i.curation) }));
  if ('curation' in out) out.curation = publicCuration(out.curation);
  return out;
}
