// events.js - first-party analytics for sites HITLOOP tracks with its own beacon: the Underground Existence Arweave
// site (website/js/ue-analytics.js in arweave-video-generator) and hitloop.agency itself (components/SiteAnalytics.jsx).
// The site's beacon posts one small JSON event; parseBeacon validates it and builds the stored row. Pure: no I/O.
// Stored rows never hold an IP address or the raw user agent: location comes from Vercel's geo headers, device is
// reduced to mobile/tablet/desktop, and the visitor id is a random string the browser keeps in localStorage.

// hostRe = the site's own hosts: allowed as beacon Origins and treated as internal navigation in referrers.
export const SITES = Object.freeze({
  ue: Object.freeze({
    label: 'Underground Existence', url: 'https://undergroundexistence.info', timeZone: 'America/Chicago',
    hostRe: /^(www\.)?undergroundexistence\.info$|(^|\.)arweave\.net$|(^|\.)ar\.io$|(^|\.)ar-io\.dev$/,
  }),
  hitloop: Object.freeze({
    label: 'HITLOOP (hitloop.agency)', url: 'https://hitloop.agency', timeZone: 'America/Chicago',
    hostRe: /^(www\.)?hitloop\.agency$/,
  }),
});

export const EVENT_TYPES = Object.freeze(['pageview', 'engagement', 'click', 'play']);
export const EVENTS_COLLECTION = (site) => `site_analytics/${site}/events`;

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget|python|node-fetch|axios/i;
// Arweave gateways serve the site under /<43-char manifest txid>/...; strip it so every deploy reports the same paths.
const TXID_PREFIX_RE = /^\/[A-Za-z0-9_-]{43}(?=\/|$)/;
const RETENTION_MS = 395 * 86_400_000;

const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export function normalizePath(raw) {
  let p = clip(raw, 300) || '/';
  p = p.split(/[?#]/)[0].replace(TXID_PREFIX_RE, '') || '/';
  p = p.replace(/\/index\.html$/i, '/');
  return p.startsWith('/') ? p : `/${p}`;
}

// Common link-shim hosts fold into the network they belong to.
const HOST_ALIASES = Object.freeze({ 't.co': 'x.com', 'twitter.com': 'x.com', 'l.instagram.com': 'instagram.com', 'lm.facebook.com': 'facebook.com', 'l.facebook.com': 'facebook.com', 'm.facebook.com': 'facebook.com', 'out.reddit.com': 'reddit.com', 'old.reddit.com': 'reddit.com' });

export function referrerHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return HOST_ALIASES[h] || h;
  } catch { return null; }
}

/** Pages may only beacon from the site's own hosts (or localhost); a missing Origin (some beacons) is allowed. */
export function isAllowedOrigin(origin, site) {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return Boolean(SITES[site]?.hostRe.test(h)) || h === 'localhost' || h === '127.0.0.1';
  } catch { return false; }
}

// Same-site referrers (the site's own domain, or an Arweave gateway hop for UE) are navigation, not a traffic source.
const isInternalHost = (h, site) => !h || Boolean(SITES[site]?.hostRe.test(h));

/** Strip query + fragment from a referrer so no tokens or personal search terms are stored. */
function cleanReferrer(url) {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`.slice(0, 300); } catch { return null; }
}

function cleanHref(url) {
  const s = clip(url, 400);
  if (!s) return null;
  try { const u = new URL(s); return `${u.origin}${normalizePath(u.pathname)}${u.search}`.slice(0, 300); } catch { return s.slice(0, 300); }
}

export function deviceOf(ua) {
  if (/ipad|tablet|kindle|silk/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

const decode = (v) => { if (!v) return null; try { return decodeURIComponent(v).slice(0, 80); } catch { return String(v).slice(0, 80); } };

/**
 * @param body    parsed JSON from the beacon
 * @param headers { get(name) } (a Request's headers)
 * @param now     ms
 * @returns {{ ok: true, site: string, row: object } | { ok: false, reason: string }}
 */
export function parseBeacon(body, headers, now) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body' };
  const site = typeof body.site === 'string' ? body.site : '';
  if (!SITES[site]) return { ok: false, reason: 'site' };
  if (!EVENT_TYPES.includes(body.type)) return { ok: false, reason: 'type' };
  if (!ID_RE.test(String(body.vid || '')) || !ID_RE.test(String(body.sid || ''))) return { ok: false, reason: 'id' };
  const ua = String(headers?.get?.('user-agent') || '');
  if (!ua || BOT_RE.test(ua)) return { ok: false, reason: 'bot' };
  if (!isAllowedOrigin(headers?.get?.('origin'), site)) return { ok: false, reason: 'origin' };

  const row = {
    site,
    type: body.type,
    ts: now,
    day: new Date(now).toISOString().slice(0, 10),
    expireAt: new Date(now + RETENTION_MS),
    vid: body.vid,
    sid: body.sid,
    path: normalizePath(body.path),
    title: clip(body.title, 120),
    device: deviceOf(ua),
    country: clip(headers?.get?.('x-vercel-ip-country'), 2),
    region: decode(headers?.get?.('x-vercel-ip-country-region')),
    city: decode(headers?.get?.('x-vercel-ip-city')),
    // Test traffic (?ue_analytics_test=1 on the site) is kept out of real numbers; reports show it only in test mode.
    test: body.test === true || undefined,
  };

  if (body.type === 'pageview') {
    row.entry = body.entry === true;
    const host = referrerHost(body.ref);
    if (host && !isInternalHost(host, site)) { row.refHost = host; row.ref = cleanReferrer(body.ref); }
    const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
    row.utmSource = clip(utm.source, 60);
    row.utmMedium = clip(utm.medium, 60);
    row.utmCampaign = clip(utm.campaign, 80);
  } else if (body.type !== 'engagement') {
    row.label = clip(body.label, 120);
    row.href = cleanHref(body.href);
    row.kind = clip(body.kind, 20);
  }
  for (const k of Object.keys(row)) if (row[k] === null || row[k] === undefined) delete row[k];
  return { ok: true, site, row };
}
