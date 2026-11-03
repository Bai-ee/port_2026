// Discogs API client for release enrichment (free API; personal token DISCOGS_TOKEN, never logged).
// Same conventions as assetManager/lib/discogs/client.ts: ~1.1 s between calls (Discogs allows 60/min authenticated),
// back off on 429, JSON v2 media type. Node-only (used by scripts/discogs/refresh-releases.mjs).

const API = 'https://api.discogs.com';
const USER_AGENT = 'HitloopDiscogsEnrichment/0.1 +https://hitloop.agency';
const MIN_INTERVAL_MS = 1100;

export class DiscogsHttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createDiscogsApi({ token = process.env.DISCOGS_TOKEN, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  let last = 0;
  async function get(path, attempt = 0) {
    if (!token) throw new Error('DISCOGS_TOKEN is not set.');
    const wait = last + MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    last = now();
    const res = await fetchImpl(`${API}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Authorization: `Discogs token=${token}`, Accept: 'application/vnd.discogs.v2.discogs+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && attempt < 3) { await sleep(5_000 * (attempt + 1)); return get(path, attempt + 1); }
    const text = await res.text();
    if (!res.ok) throw new DiscogsHttpError(`Discogs GET ${path.split('?')[0]} failed: ${res.status}`, res.status);
    return text ? JSON.parse(text) : {};
  }
  return {
    identity: () => get('/oauth/identity'),
    release: (id) => get(`/releases/${Number(id)}?curr_abbr=USD`),
    marketStats: (id) => get(`/marketplace/stats/${Number(id)}?curr_abbr=USD`),
    // Needs the account's seller settings filled in; a 4xx here is normal and recorded, not fatal.
    priceSuggestions: (id) => get(`/marketplace/price_suggestions/${Number(id)}`),
    collectionInstances: (username, id) => get(`/users/${encodeURIComponent(username)}/collection/releases/${Number(id)}`),
  };
}

/**
 * Everything Discogs has for one release, best-effort per part (a failed part is recorded, never thrown):
 * { releaseId, fetchedAt, release, marketStats, priceSuggestions, collection, errors }
 */
export async function fetchReleaseBundle(api, releaseId, { username = null, now = () => new Date().toISOString() } = {}) {
  const errors = {};
  const part = async (key, fn) => { try { return await fn(); } catch (e) { errors[key] = { status: e?.status ?? null, message: String(e?.message || e).slice(0, 200) }; return null; } };
  const release = await part('release', () => api.release(releaseId));
  const marketStats = await part('marketStats', () => api.marketStats(releaseId));
  const priceSuggestions = await part('priceSuggestions', () => api.priceSuggestions(releaseId));
  const collection = username ? await part('collection', () => api.collectionInstances(username, releaseId)) : null;
  return { releaseId: String(releaseId), fetchedAt: now(), release, marketStats, priceSuggestions, collection, errors };
}
