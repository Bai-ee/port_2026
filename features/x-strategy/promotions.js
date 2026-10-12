// Promotion goals for the X plan — which existing content promotes what, and where it links.
// Promotions live inside content tracks (content-tracks.js is the contract). Links start empty (owner fills them in the UI).
// Pure: no I/O. A link always rides in the self-reply, never the main post (X down-ranks link posts).

import { resolveEngine } from '../x-content-inventory/engines.js';
import { tracksOf, allPromotions, normalizePromotions } from './content-tracks.js';

export { normalizePromotions };

/** Flattened promotions (each tagged `trackId`) from a plan doc or plan; absent/invalid ⇒ track defaults. */
export function promotionsOf(planOrDoc) {
  return allPromotions(tracksOf(planOrDoc));
}

/** Which promotion a package serves, or null. UE = rendered mixes only; record = Discogs releases only. */
export function promotionFor(pkg, promotions) {
  if (!pkg) return null;
  const list = promotions || promotionsOf(null);
  const engine = resolveEngine(pkg);
  const kind = pkg.source?.kind || null;
  if (engine === 'ue' && kind !== 'rendered-video') return null;
  if (engine === 'record' && kind !== 'discogs') return null;
  return list.find((p) => p.engine === engine) || null;
}

/** Self-reply carrying the promotion link; '' when no link is set. */
export function promotionSelfReply(promotion) {
  if (!promotion?.url) return '';
  return `${promotion.label}: ${promotion.url}`;
}
