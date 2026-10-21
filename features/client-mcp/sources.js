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

export const PEOPLE_KINDS = Object.freeze(['leads', 'captures', 'applicants']);
export const PEOPLE_RANGES = Object.freeze(['today', '7d', '30d', 'all']);
export const PEOPLE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** peopleUrl of the row, else <stats url>/people. */
export const peopleUrlOf = (source) => source.peopleUrl || `${String(source.url).replace(/\/$/, '')}/people`;

// Shared GET: builds the URL, sends the key ONLY in the Authorization header, maps failures to SourceError
// (messages never contain the key). notFound: message for a 404, else it is a generic HTTP error.
async function getJson({ source, url, params, env, fetchImpl, notFound }) {
  const key = String(env[source.keyEnv] || '').trim();
  if (!key) throw new SourceError(`${source.label} is not connected yet (its key is not set on HITLOOP).`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
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
  if (res.status === 404 && notFound) throw new SourceError(notFound);
  if (res.status === 429) throw new SourceError(`${source.label} is rate limiting (429). Try again in a few minutes.`);
  if (res.status === 400) throw new SourceError(`${source.label} did not accept that request (400).`);
  if (!res.ok) throw new SourceError(`${source.label} returned HTTP ${res.status}.`);
  try { return await res.json(); } catch { throw new SourceError(`${source.label} returned something that is not JSON.`); }
}

/** GET <url>?range=<range> with the client's key. Returns the site's JSON as-is plus fetchedAt. */
export async function fetchSiteStats({ source, range, env, fetchImpl, now }) {
  if (!source) throw new SourceError('No website stats source is set up for this client.');
  const stats = await getJson({ source, url: new URL(source.url), params: { range }, env, fetchImpl });
  return { source: source.label, range, fetchedAt: new Date(now).toISOString(), stats };
}

/** GET <peopleUrl>?kind=..&range=..[&id|&stage&limit]: person-level leads / email captures / applicants. */
export async function fetchSitePeople({ source, kind, range, id, stage, limit, env, fetchImpl, now }) {
  if (!source) throw new SourceError('No website source is set up for this client.');
  if (!PEOPLE_KINDS.includes(kind)) throw new SourceError('Unknown record kind.');
  const data = await getJson({
    source, url: new URL(peopleUrlOf(source)), env, fetchImpl,
    params: id ? { kind, id } : { kind, range, stage, limit },
    notFound: `No ${kind.replace(/s$/, '')} record with that id.`,
  });
  return { source: source.label, fetchedAt: new Date(now).toISOString(), ...data };
}
