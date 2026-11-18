import { createHash } from 'node:crypto';
import { HOWTO_REQUESTS, HOWTO_CAMPAIGN_UNTIL } from './clients.js';

export { classifyBrief } from './brief.js';

const sortKeysDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]));
  return v;
};

/** sha256 hex (first 16) of the spec's canonical JSON with `mode` forced to "final". Must match the render service. */
export const howtoSpecHash = (spec) =>
  createHash('sha256').update(JSON.stringify(sortKeysDeep({ ...spec, mode: 'final' }))).digest('hex').slice(0, 16);

/**
 * Is this howto brief renderable? Reads howto_requests/{id} (read-only). Returns
 *   { ready: true, specHash } | { ready: false, state: 'waiting_howto' | 'invalid_brief', reason }.
 * `cache` (a Map) dedupes reads within one tick.
 */
export async function howtoReadiness(db, { howtoId, clientId, reviewOn }, cache = new Map()) {
  if (!cache.has(howtoId)) {
    cache.set(howtoId, db.collection(HOWTO_REQUESTS).doc(howtoId).get().then((s) => (s.exists ? s.data() : null)));
  }
  const req = await cache.get(howtoId);
  if (!req) return { ready: false, state: 'waiting_howto', reason: 'request-missing' };
  if (req.status !== 'approved') return { ready: false, state: 'waiting_howto', reason: `request-${String(req.status || 'unknown')}` };
  if (String(reviewOn || '') > HOWTO_CAMPAIGN_UNTIL) return { ready: false, state: 'invalid_brief', reason: 'after-campaign' };
  if (req.clientId !== clientId) return { ready: false, state: 'invalid_brief', reason: 'client-mismatch' };
  if (!req.specHash) return { ready: false, state: 'waiting_howto', reason: 'request-no-spechash' };
  return { ready: true, specHash: String(req.specHash) };
}
