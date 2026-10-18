// Compact Discogs summary stored ON the record package (x_content_packages.discogsSummary) for search, sorting and
// batching. The FULL object lives in discogs_releases/{releaseId} and the chat reads it with get_item. Pure.
//
// valueUsd = Discogs' suggested price for VG+ (the usual collector reference), else the best other suggested
// condition, else the lowest current listing. basis says which one. null when Discogs has no price at all.

const SUGGEST_ORDER = ['Very Good Plus (VG+)', 'Near Mint (NM or M-)', 'Very Good (VG)', 'Mint (M)', 'Good Plus (G+)', 'Good (G)'];
const usd = (o) => (o && o.value != null && Number.isFinite(Number(o.value)) && (!o.currency || o.currency === 'USD') ? Math.round(Number(o.value) * 100) / 100 : null);
const names = (list, key = 'name') => (Array.isArray(list) ? list.map((x) => String(x?.[key] ?? '').trim()).filter(Boolean) : []);

export function summarizeDiscogsBundle(bundle) {
  const r = bundle?.release || {};
  const s = bundle?.marketStats || {};
  const sugg = bundle?.priceSuggestions && typeof bundle.priceSuggestions === 'object' ? bundle.priceSuggestions : {};
  const suggested = {};
  for (const [cond, v] of Object.entries(sugg)) { const n = usd(v); if (n != null) suggested[cond] = n; }
  const bestCond = SUGGEST_ORDER.find((c) => suggested[c] != null) || Object.keys(suggested)[0] || null;
  const lowestUsd = usd(s.lowest_price) ?? (r.lowest_price != null && Number.isFinite(Number(r.lowest_price)) ? Number(r.lowest_price) : null);
  const valueUsd = bestCond ? suggested[bestCond] : lowestUsd;
  const instances = Array.isArray(bundle?.collection?.releases) ? bundle.collection.releases : [];
  return {
    releaseId: String(bundle?.releaseId ?? r.id ?? ''),
    title: r.title ?? null,
    artists: names(r.artists),
    year: Number.isFinite(Number(r.year)) && Number(r.year) > 0 ? Number(r.year) : null,
    country: r.country ?? null,
    labels: names(r.labels),
    catalogNumbers: names(r.labels, 'catno'),
    formats: Array.isArray(r.formats) ? r.formats.map((f) => [f?.name, ...(f?.descriptions || [])].filter(Boolean).join(' ')).filter(Boolean) : [],
    genres: Array.isArray(r.genres) ? r.genres : [],
    styles: Array.isArray(r.styles) ? r.styles : [],
    tracks: Array.isArray(r.tracklist) ? r.tracklist.length : 0,
    have: r.community?.have ?? null,
    want: r.community?.want ?? null,
    rating: r.community?.rating?.average ?? null,
    ratingCount: r.community?.rating?.count ?? null,
    forSale: s.num_for_sale ?? r.num_for_sale ?? null,
    lowestUsd,
    suggestedUsd: suggested,
    valueUsd: valueUsd ?? null,
    valueBasis: bestCond ? `suggested ${bestCond}` : lowestUsd != null ? 'lowest listing' : null,
    discogsVideos: Array.isArray(r.videos) ? r.videos.length : 0,
    inCollection: instances.length || null,
    url: r.uri ?? null,
    fetchedAt: bundle?.fetchedAt ?? null,
    partsMissing: Object.keys(bundle?.errors || {}),
  };
}
