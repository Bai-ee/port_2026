// Buckets — user-defined content SOURCES (Content Engine v2 master plan §4).
//
// WHY THIS EXISTS: the four hardcoded engines (engines.js) were the right
// allocation axis for one account, but every client's content comes from
// different places. A bucket is a source the owner can add, rename and size
// ("Discogs Records", "Rendered Videos", "NAS Archive", "Ideas"). Buckets are
// data per client; engines remain as the compatibility layer — a package's
// `engine` still resolves to a bucket, so nothing built on engines breaks.
//
// Pure data + pure helpers. No fs, no network, no clock.

import { resolveEngine } from './engines.js';

export const SOURCE_KINDS = ['discogs', 'rendered-video', 'nas-archive', 'ideas', 'manual'];

/** Seed buckets for a client with no bucket docs yet. Ids equal the legacy
 * engine ids so existing packages (engine: 'record' | 'ue' | 'client' |
 * 'identity') land in a bucket without a migration write. */
export const DEFAULT_BUCKETS = [
  { id: 'record',   name: 'Discogs Records', sourceKind: 'discogs',        color: '#c2410c', order: 0, active: true,
    share: { perDayMin: 0, perDayMax: 2, targetPerDay: 1, maxSharePct: 40 } },
  { id: 'ue',       name: 'Rendered Videos', sourceKind: 'rendered-video', color: '#7c3aed', order: 1, active: true,
    share: { perDayMax: 1, perWeekMin: 3, perWeekMax: 4 } },
  { id: 'client',   name: 'Ideas',           sourceKind: 'ideas',          color: '#0f766e', order: 2, active: true,
    share: { perDayMax: 1, perWeekMin: 3 } },
  { id: 'identity', name: 'Your Takes',      sourceKind: 'manual',         color: '#334155', order: 3, active: true,
    share: { perDayMin: 1, perDayMax: 2 } },
  { id: 'nas',      name: 'NAS Archive',     sourceKind: 'nas-archive',    color: '#a16207', order: 4, active: true,
    share: { perDayMax: 1 } },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Slug a display name into a stable bucket id. */
export function bucketIdFromName(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
}

/** Returns an array of error strings; empty means valid. */
export function validateBucket(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return ['bucket must be an object'];
  if (!ID_RE.test(String(b.id ?? ''))) errors.push('id must be lowercase kebab-case, ≤40 chars');
  if (!String(b.name ?? '').trim()) errors.push('name is required');
  if (String(b.name ?? '').length > 60) errors.push('name ≤ 60 chars');
  if (!SOURCE_KINDS.includes(b.sourceKind)) errors.push(`sourceKind must be one of ${SOURCE_KINDS.join(', ')}`);
  if (b.share != null) {
    if (typeof b.share !== 'object') errors.push('share must be an object');
    else for (const [k, v] of Object.entries(b.share)) {
      if (!['perDayMin', 'perDayMax', 'targetPerDay', 'perWeekMin', 'perWeekMax', 'maxSharePct'].includes(k)) errors.push(`unknown share field ${k}`);
      else if (!(Number.isFinite(v) && v >= 0)) errors.push(`share.${k} must be a non-negative number`);
    }
  }
  return errors;
}

/** The bucket a package belongs to: its own `bucketId` when that bucket
 * exists, else its engine (legacy), else 'identity'. */
export function resolveBucket(pkg, buckets = DEFAULT_BUCKETS) {
  const ids = new Set(buckets.map((b) => b.id));
  if (pkg?.bucketId && ids.has(pkg.bucketId)) return pkg.bucketId;
  const engine = resolveEngine(pkg);
  return ids.has(engine) ? engine : 'identity';
}

/** Merge stored bucket docs over the defaults (stored wins; unknown stored
 * buckets are kept — that is how the owner adds new ones). Sorted by order. */
export function mergeBuckets(stored = []) {
  const byId = new Map(DEFAULT_BUCKETS.map((b) => [b.id, { ...b }]));
  for (const s of stored) {
    if (!s?.id) continue;
    byId.set(s.id, { ...(byId.get(s.id) || {}), ...s, share: { ...(byId.get(s.id)?.share || {}), ...(s.share || {}) } });
  }
  return [...byId.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}
