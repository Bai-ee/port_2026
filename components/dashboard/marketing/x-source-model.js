// Pure helpers for the Refresh panel's X data-source toggles + X API spend line. No React, no network.
// Contract: x-data-sources-get|save (quote-targets route), GET /api/admin/x-usage, POST {action:'set-pricing'}.

export const X_SOURCE_GROUPS = [
  { groupId: 'strategy-accounts', key: 'strategyAccounts', label: 'Strategy accounts' },
  { groupId: 'quote-targets', key: 'quoteTargets', label: 'Quote targets' },
];

export const X_SOURCE_GROUP_IDS = X_SOURCE_GROUPS.map((g) => g.groupId);

export const DEFAULT_DATA_SOURCES = {
  strategyAccounts: 'mac',
  quoteTargets: 'mac',
  autoDaily: { strategyAccounts: false, quoteTargets: false },
};

const keyFor = (groupId) => X_SOURCE_GROUPS.find((g) => g.groupId === groupId)?.key || null;

// Accepts the raw server value (or the { dataSources } envelope); anything unknown falls back to the free Mac source.
export function normalizeDataSources(raw) {
  const src = raw && typeof raw === 'object' ? (raw.dataSources && typeof raw.dataSources === 'object' ? raw.dataSources : raw) : {};
  const auto = src.autoDaily && typeof src.autoDaily === 'object' ? src.autoDaily : {};
  const pick = (v) => (v === 'x-api' ? 'x-api' : 'mac');
  return {
    strategyAccounts: pick(src.strategyAccounts),
    quoteTargets: pick(src.quoteTargets),
    autoDaily: { strategyAccounts: auto.strategyAccounts === true, quoteTargets: auto.quoteTargets === true },
  };
}

export function sourceFor(sources, groupId) {
  const k = keyFor(groupId);
  return k ? normalizeDataSources(sources)[k] : 'mac';
}

export function autoDailyFor(sources, groupId) {
  const k = keyFor(groupId);
  return k ? normalizeDataSources(sources).autoDaily[k] : false;
}

// Immutable update. Switching back to Mac clears that group's auto-daily (it only applies to X API).
export function withSource(sources, groupId, source) {
  const k = keyFor(groupId);
  const cur = normalizeDataSources(sources);
  if (!k) return cur;
  const next = source === 'x-api' ? 'x-api' : 'mac';
  return { ...cur, [k]: next, autoDaily: { ...cur.autoDaily, [k]: next === 'x-api' ? cur.autoDaily[k] : false } };
}

export function withAutoDaily(sources, groupId, on) {
  const k = keyFor(groupId);
  const cur = normalizeDataSources(sources);
  if (!k || cur[k] !== 'x-api') return cur;
  return { ...cur, autoDaily: { ...cur.autoDaily, [k]: !!on } };
}

// Only groups that exist in the catalog get a toggle (quote-targets lights up once SOURCES lands).
export function sourceGroupsPresent(refreshGroups) {
  const ids = new Set((refreshGroups || []).map((g) => g.id));
  return X_SOURCE_GROUP_IDS.filter((id) => ids.has(id));
}

// Extra confirm-row entries for selected groups whose source is X API but which paidGroupsFor did not already list
// (strategy-accounts is a free group on the Mac path). `estimates` = optional { [groupId]: { calls, maxPosts, text } }.
export function xApiPaidRows(selection, sources, alreadyPaid = [], estimates = {}, refreshGroups = []) {
  const ids = Array.isArray(selection?.ids) ? selection.ids : [];
  const have = new Set((alreadyPaid || []).map((p) => p.id));
  return X_SOURCE_GROUP_IDS
    .filter((id) => ids.includes(id) && !have.has(id) && sourceFor(sources, id) === 'x-api')
    .map((id) => {
      const e = estimates?.[id] || {};
      const g = (refreshGroups || []).find((x) => x.id === id);
      const parts = [];
      if (Number.isFinite(e.calls)) parts.push(`${e.calls} calls`);
      if (Number.isFinite(e.maxPosts)) parts.push(`up to ${e.maxPosts} posts`);
      const text = e.text || (parts.length ? `X API — ${parts.join(', ')}` : 'X API — paid reads (no estimate available)');
      return { id, label: g?.label || id, cost: 'Paid X API', estimate: { text, usd: null, ...(Number.isFinite(e.calls) ? { calls: e.calls } : {}) } };
    });
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// x-data-sources-get `estimates:{strategyAccounts,quoteTargets}` ({calls,maxPosts,...}) -> { [groupId]: {calls,maxPosts} } for xApiPaidRows.
export function estimatesByGroup(resp) {
  const e = resp && typeof resp === 'object' && resp.estimates && typeof resp.estimates === 'object' ? resp.estimates : {};
  const out = {};
  for (const g of X_SOURCE_GROUPS) {
    const v = e[g.key];
    if (v && typeof v === 'object') out[g.groupId] = { calls: Number.isFinite(v.calls) ? v.calls : undefined, maxPosts: Number.isFinite(v.maxPosts) ? v.maxPosts : undefined };
  }
  return out;
}

// True when the selection includes a group whose source is X API (the confirm row then lists its estimate and confirming sets xApiConfirmed).
export function selectionUsesXApi(selection, sources) {
  const ids = Array.isArray(selection?.ids) ? selection.ids : [];
  return X_SOURCE_GROUP_IDS.some((id) => ids.includes(id) && sourceFor(sources, id) === 'x-api');
}

// Header line from the readXUsage payload. Dollars only when the server returned a number; cap only when set.
export function formatXSpendLine(usage) {
  if (!usage || typeof usage !== 'object') return 'X API today: unavailable';
  const t = usage.today && typeof usage.today === 'object' ? usage.today : {};
  const calls = n(t.calls);
  const posts = n(t.readPosts ?? t.posts); // readXUsage: today.readPosts (older shape: posts)
  let line = `X API today: ${calls} ${calls === 1 ? 'call' : 'calls'} · ${posts} ${posts === 1 ? 'post' : 'posts'}`;
  const usd = t.estUsd ?? usage.estUsd;
  if (typeof usd === 'number' && Number.isFinite(usd)) line += ` · ~$${usd.toFixed(2)}`;
  else line += ' · no rate set';
  const cap = usage.cap && typeof usage.cap === 'object' ? usage.cap.dailyReadCap ?? usage.cap.daily : usage.cap;
  if (Number.isFinite(Number(cap)) && Number(cap) > 0) line += ` (cap ${Number(cap)})`;
  return line;
}

// Rate-form values (strings) -> set-pricing body. Blank = omit; negative/NaN = error.
export function buildPricingBody(form) {
  const body = { action: 'set-pricing' };
  const fields = [['perPostReadUsd', 'Per-post rate'], ['perUserLookupUsd', 'Per-lookup rate'], ['dailyReadCap', 'Daily cap']];
  for (const [key, label] of fields) {
    const raw = String(form?.[key] ?? '').trim();
    if (!raw) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return { error: `${label} must be a number of 0 or more.` };
    body[key] = key === 'dailyReadCap' ? Math.floor(v) : v;
  }
  if (Object.keys(body).length === 1) return { error: 'Enter at least one value.' };
  return { body };
}
