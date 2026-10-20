// sources.js - per-client external data sources (config in data-sources.json, not code).
// A new client site = one row { clientId, label, kind: 'site-stats', url, keyEnv } + that env var in Vercel.
// The key is read from env at call time and only ever sent in the Authorization header; it never appears in a
// result, an error message or the audit.

import rows from './data-sources.json' with { type: 'json' };

export const SITE_STATS_RANGES = Object.freeze(['today', '7d', '30d']);
export const FETCH_TIMEOUT_MS = 10_000;

export const DATA_SOURCES = Object.freeze(rows.map((r) => Object.freeze({ ...r })));

export function siteStatsSourceFor(clientId, sources = DATA_SOURCES) {
  return sources.find((s) => s.clientId === clientId && s.kind === 'site-stats') || null;
}

export class SourceError extends Error {
  constructor(message) { super(message); this.name = 'SourceError'; this.expose = true; }
}

/** GET <url>?range=<range> with the client's key. Returns the site's JSON as-is plus fetchedAt. */
export async function fetchSiteStats({ source, range, env, fetchImpl, now }) {
  if (!source) throw new SourceError('No website stats source is set up for this client.');
  const key = String(env[source.keyEnv] || '').trim();
  if (!key) throw new SourceError(`${source.label} is not connected yet (its key is not set on HITLOOP).`);
  const url = new URL(source.url);
  url.searchParams.set('range', range);
  let res;
  try {
    res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new SourceError(`${source.label} did not answer (${e?.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
  }
  if (res.status === 401) throw new SourceError(`${source.label} rejected HITLOOP's key (401). The key needs updating.`);
  if (res.status === 429) throw new SourceError(`${source.label} is rate limiting (429). Try again in a few minutes.`);
  if (!res.ok) throw new SourceError(`${source.label} returned HTTP ${res.status}.`);
  let data;
  try { data = await res.json(); } catch { throw new SourceError(`${source.label} returned something that is not JSON.`); }
  return { source: source.label, range, fetchedAt: new Date(now).toISOString(), stats: data };
}
