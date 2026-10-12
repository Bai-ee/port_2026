// Promotion goals for the X plan: which existing content promotes what, and where it links.
// Owner decisions 2026-10-11 (docs/plans/CONTENT-PROMOTION-CONTRACTS.md): Underground Existence mixes,
// the Discogs store and client work; links start empty and are filled in the plan.
// Pure: no I/O. A link always rides in the self-reply, never the main post (X down-ranks link posts).

import { resolveEngine } from '../x-content-inventory/engines.js';

export const DEFAULT_PROMOTIONS = Object.freeze([
  Object.freeze({ id: 'ue', label: 'Underground Existence', engine: 'ue', url: null, weeklyTarget: 3 }),
  Object.freeze({ id: 'discogs', label: 'Discogs store', engine: 'record', url: null, weeklyTarget: 3 }),
  Object.freeze({ id: 'client', label: 'Client work', engine: 'client', url: null, weeklyTarget: 2 }),
]);

const ENGINE_IDS = new Set(['ue', 'record', 'client', 'identity']);
const MAX_PROMOTIONS = 8;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeUrl(value) {
  if (value == null || String(value).trim() === '') return null;
  let u;
  try { u = new URL(String(value).trim()); } catch { throw bad(`Promotion link is not a valid URL: ${value}`); }
  if (u.protocol !== 'https:') throw bad('Promotion links must start with https://');
  return u.toString();
}

/** Validate a promotions list. Throws 400 on bad input; returns a clean copy. */
export function normalizePromotions(input) {
  if (!Array.isArray(input)) throw bad('promotions must be an array.');
  if (input.length > MAX_PROMOTIONS) throw bad(`At most ${MAX_PROMOTIONS} promotions.`);
  const seen = new Set();
  return input.map((raw) => {
    const id = String(raw?.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw bad(`Bad promotion id: ${raw?.id}`);
    if (seen.has(id)) throw bad(`Duplicate promotion id: ${id}`);
    seen.add(id);
    const engine = String(raw?.engine || '').trim();
    if (!ENGINE_IDS.has(engine)) throw bad(`Promotion ${id} has an unknown engine: ${engine}`);
    const label = String(raw?.label || '').trim().slice(0, 60);
    if (!label) throw bad(`Promotion ${id} needs a label.`);
    const weeklyTarget = Number(raw?.weeklyTarget ?? 0);
    if (!Number.isInteger(weeklyTarget) || weeklyTarget < 0 || weeklyTarget > 14) throw bad(`Promotion ${id} weeklyTarget must be 0–14.`);
    return { id, label, engine, url: normalizeUrl(raw?.url), weeklyTarget };
  });
}

/** Promotions from a plan doc or plan; absent or invalid ⇒ the defaults. */
export function promotionsOf(planOrDoc) {
  const plan = planOrDoc?.plan && typeof planOrDoc.plan === 'object' ? planOrDoc.plan : planOrDoc;
  if (!Array.isArray(plan?.promotions)) return DEFAULT_PROMOTIONS.map((p) => ({ ...p }));
  try {
    return normalizePromotions(plan.promotions);
  } catch {
    return DEFAULT_PROMOTIONS.map((p) => ({ ...p }));
  }
}

/** Which promotion a package serves, or null. UE = rendered mixes only; record = Discogs releases only. */
export function promotionFor(pkg, promotions = DEFAULT_PROMOTIONS) {
  if (!pkg) return null;
  const engine = resolveEngine(pkg);
  const kind = pkg.source?.kind || null;
  if (engine === 'ue' && kind !== 'rendered-video') return null;
  if (engine === 'record' && kind !== 'discogs') return null;
  return (promotions || []).find((p) => p.engine === engine) || null;
}

/** Self-reply carrying the promotion link; '' when no link is set. */
export function promotionSelfReply(promotion) {
  if (!promotion?.url) return '';
  return `${promotion.label}: ${promotion.url}`;
}
