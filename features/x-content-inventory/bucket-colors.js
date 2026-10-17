// bucket-colors.js — one color per Content Center bucket, from the theme's own hue tokens (styles/theme), so the
// calendar, its legend and the Content Center bucket dots always agree and follow light/dark. A bucket's color is set
// by its place in the bucket order (inactive buckets keep their slot, so hiding one never repaints the others).
// The stored `bucket.color` hex is not used for display. `--t-support-1` / danger reds are left out: red means failed.
//
// Pure, client-safe (no node builtins).

import { resolveEngine, isEngine } from './engines.js';

export const BUCKET_COLOR_TOKENS = Object.freeze([
  '--t-deco-1', '--t-comet-2', '--t-comet-6', '--t-deco-3', '--t-support-2', '--t-comet-3',
  '--t-deco-2', '--t-deco-4', '--t-comet-5', '--t-accent', '--t-comet-7', '--t-comet-1',
]);
export const NEUTRAL_BUCKET_COLOR = 'var(--t-text-muted)';
const BUCKET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const ordered = (buckets) => (Array.isArray(buckets) ? buckets : [])
  .filter((b) => b && BUCKET_ID_RE.test(String(b.id ?? '')))
  .slice()
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.id).localeCompare(String(b.id)));

/** bucketId -> CSS color (`var(--t-…)`), for every bucket in `buckets` (listBuckets rows). */
export function bucketColorMap(buckets) {
  const map = {};
  ordered(buckets).forEach((b, i) => { map[b.id] = `var(${BUCKET_COLOR_TOKENS[i % BUCKET_COLOR_TOKENS.length]})`; });
  return map;
}

/** One bucket's color, or the neutral color when it is unknown. */
export function bucketColorFor(bucketId, buckets) {
  return bucketColorMap(buckets)[bucketId] || NEUTRAL_BUCKET_COLOR;
}

/**
 * The bucket a social post belongs to: its own `bucketId`, else its package's (`bucketId`, else the package engine,
 * since built-in bucket ids equal engine ids), else its own engine. null when none apply.
 */
export function bucketOfPost(post, pkg = null) {
  if (BUCKET_ID_RE.test(String(post?.bucketId ?? ''))) return post.bucketId;
  if (pkg) return BUCKET_ID_RE.test(String(pkg.bucketId ?? '')) ? pkg.bucketId : resolveEngine(pkg);
  return isEngine(post?.engine) ? post.engine : null;
}
