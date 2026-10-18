// creative-picker-model.js — pure logic behind CreativePicker (no React, no I/O).
// Mirrors the server's pick rules (item-actions.js pickMediaRef: the first ev:/publish-staging ref wins) so a tile is
// disabled for the same reason the post-attach-item-media action would refuse it. The server stays the authority.

import { isXPublishableContentType } from '../../../features/x-content-inventory/attach-item-media.js';

// Local copy of item-actions.js pickMediaRef (that module pulls in node:crypto, which must not reach the client bundle).
// A parity test pins the two together.
const contentTypeFor = (p) => (/\.mov$/i.test(p) ? 'video/quicktime' : /\.webm$/i.test(p) ? 'video/webm' : /\.(mp4|m4v)$/i.test(p) ? 'video/mp4'
  : /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : /\.gif$/i.test(p) ? 'image/gif' : 'image/jpeg');
export function pickMediaRef(pkg) {
  for (const ref of pkg?.assetRefs || []) {
    const r = String(ref);
    const ev = /^ev:(.+)$/.exec(r)?.[1];
    const path = ev || (r.startsWith('publish-staging/') ? r : null);
    if (!path || path.startsWith('/') || path.split('/').includes('..')) continue;
    if (!/\.(mp4|mov|m4v|webm|jpe?g|png|webp|gif)$/i.test(path)) continue;
    const contentType = contentTypeFor(path);
    return { kind: contentType.startsWith('video/') ? 'video' : 'image', contentType };
  }
  return null;
}

export const PICKER_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'MP4 video' },
  { id: 'staged', label: 'Staged only' },
]);

export const REASONS = Object.freeze({
  neverPublic: 'Never public',
  noMedia: 'No media on this item',
  notStaged: 'Not staged — stage it first',
  badFormat: "X can't publish this format",
});

/** { kind:'video'|'image'|null, staged, usable, reason } for one inventory package. */
export function tileState(item) {
  if (item?.rights === 'never-public') return { kind: null, staged: false, usable: false, reason: REASONS.neverPublic };
  const m = pickMediaRef(item);
  if (m) {
    const ok = isXPublishableContentType(m.contentType);
    return { kind: m.kind, staged: true, usable: ok, reason: ok ? null : REASONS.badFormat };
  }
  const hasRefs = Array.isArray(item?.assetRefs) && item.assetRefs.length > 0;
  return { kind: null, staged: false, usable: false, reason: hasRefs ? REASONS.notStaged : REASONS.noMedia };
}

const haystack = (item) => [item?.title, item?.story, item?.id, ...(Array.isArray(item?.tags) ? item.tags : [])].filter(Boolean).join(' ').toLowerCase();

/** Filter + search the items; selectable tiles first (stable otherwise). Returns [{ item, state }]. */
export function pickerTiles(items, { query = '', filter = 'all' } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    const state = tileState(item);
    if (filter === 'staged' && !state.staged) continue;
    if (filter === 'image' && state.kind !== 'image') continue;
    if (filter === 'video' && state.kind !== 'video') continue;
    if (words.length) {
      const h = haystack(item);
      if (!words.every((w) => h.includes(w))) continue;
    }
    out.push({ item, state });
  }
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (Number(b.t.state.usable) - Number(a.t.state.usable)) || (a.i - b.i))
    .map((x) => x.t);
}
