// Client-safe wording for a `sync-rendered-videos` result (sync.js is server-only: node:crypto).

const n = (v) => (Number.isFinite(v) ? v : 0);

/**
 * "0 new · 820 up to date · last synced 3 min ago". A throttled result carries the LAST sync's counts,
 * so its line says so instead of presenting them as fresh changes.
 * @param {object|null} r  sync result ({created, updated, unchanged, restored, retired, total, throttled})
 * @param {string} [agoText]  e.g. "3 min ago" for r.lastSyncAt
 * @returns {string}
 */
export function syncResultLine(r, agoText = '') {
  if (!r || typeof r !== 'object') return 'Not synced yet';
  const bits = [`${n(r.created)} new`];
  if (n(r.updated)) bits.push(`${n(r.updated)} updated`);
  if (n(r.restored)) bits.push(`${n(r.restored)} restored`);
  if (n(r.retired)) bits.push(`${n(r.retired)} retired`);
  bits.push(`${n(r.unchanged)} up to date`);
  const when = agoText ? (r.throttled ? agoText : `synced ${agoText}`) : '';
  return [r.throttled ? `Last sync: ${bits.join(' · ')}` : bits.join(' · '), when].filter(Boolean).join(' · ');
}

/** True when the result wrote rows the card should reload (a throttled echo never did). */
export const syncChangedRows = (r) => !!r && !r.throttled && n(r.created) + n(r.updated) + n(r.restored) + n(r.retired) > 0;
