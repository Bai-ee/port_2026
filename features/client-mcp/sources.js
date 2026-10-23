// sources.js - per-client external data sources (config in data-sources.json, not code).
// A new client site = one row { clientId, label, kind: 'site-stats', url, keyEnv } + that env var in Vercel.
// A static site HITLOOP tracks itself (beacon -> /api/public/site-events) = { ..., provider: 'hitloop', site, url }:
// no key, no HTTP; stats and visit paths are built from HITLOOP's own Firestore by the injected readers
// (readLocal / readLocalSessions -> features/site-analytics/report.js).
// The key is read from env at call time and only ever sent in the Authorization header; it never appears in a
// result, an error message or the audit.

import rows from './data-sources.json' with { type: 'json' };

export const SITE_STATS_RANGES = Object.freeze(['today', '7d', '30d']);
// The site's /api/stats also takes a rolling 24h and from/to dates (YYYY-MM-DD, site timezone, inclusive, <= 90 days).
export const SITE_REPORT_RANGES = Object.freeze(['24h', ...SITE_STATS_RANGES]);
export const SITE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

/** Only key-backed client sites expose person-level records; a HITLOOP-tracked static site has none. */
export const hasPeople = (source) => Boolean(source && source.provider !== 'hitloop');

// A HITLOOP-tracked site: call the injected reader; a bad date window keeps its message, anything else is generic.
async function readHitloop(source, reader, args) {
  if (!reader) throw new SourceError(`${source.label} stats are not available right now.`);
  try { return await reader({ site: source.site, ...args }); }
  catch (e) { throw new SourceError(e?.expose ? e.message : `${source.label} stats could not be read right now.`); }
}

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

/** GET <url>?range=<range> (or ?from=&to=) with the client's key. Returns the site's JSON as-is plus fetchedAt. */
export async function fetchSiteStats({ source, range, from, to, env, fetchImpl, now, readLocal }) {
  if (!source) throw new SourceError('No website stats source is set up for this client.');
  const custom = Boolean(from && to);
  if (source.provider === 'hitloop') {
    const stats = await readHitloop(source, readLocal, custom ? { from, to, now } : { range, now });
    return { source: source.label, range: custom ? 'custom' : range, ...(custom ? { from, to } : {}), fetchedAt: new Date(now).toISOString(), stats };
  }
  const params = custom ? { from, to } : { range };
  const stats = await getJson({ source, url: new URL(source.url), params, env, fetchImpl });
  return { source: source.label, range: custom ? 'custom' : range, ...(custom ? { from, to } : {}), fetchedAt: new Date(now).toISOString(), stats };
}

/** sessionsUrl of the row, else <stats url>/sessions. */
export const sessionsUrlOf = (source) => source.sessionsUrl || `${String(source.url).replace(/\/$/, '')}/sessions`;

/** GET <sessionsUrl>?range=..|from=&to=&limit=..: per-visit paths (source, pages, CTAs, booking steps, outcome). */
export async function fetchSiteSessions({ source, range, from, to, limit, env, fetchImpl, now, readLocalSessions }) {
  if (!source) throw new SourceError('No website source is set up for this client.');
  if (source.provider === 'hitloop') {
    const data = await readHitloop(source, readLocalSessions, from && to ? { from, to, limit, now } : { range, limit, now });
    return { source: source.label, fetchedAt: new Date(now).toISOString(), ...data };
  }
  const params = from && to ? { from, to, limit } : { range, limit };
  const data = await getJson({ source, url: new URL(sessionsUrlOf(source)), params, env, fetchImpl });
  return { source: source.label, fetchedAt: new Date(now).toISOString(), ...data };
}

/** GET <peopleUrl>?kind=..&range=..[&id|&stage&limit]: person-level leads / email captures / applicants. */
export async function fetchSitePeople({ source, kind, range, id, stage, limit, env, fetchImpl, now }) {
  if (!source) throw new SourceError('No website source is set up for this client.');
  if (!hasPeople(source)) throw new SourceError(`${source.label} has no forms, so there are no leads, email captures or applicants.`);
  if (!PEOPLE_KINDS.includes(kind)) throw new SourceError('Unknown record kind.');
  const data = await getJson({
    source, url: new URL(peopleUrlOf(source)), env, fetchImpl,
    params: id ? { kind, id } : { kind, range, stage, limit },
    notFound: `No ${kind.replace(/s$/, '')} record with that id.`,
  });
  return { source: source.label, fetchedAt: new Date(now).toISOString(), ...data };
}
