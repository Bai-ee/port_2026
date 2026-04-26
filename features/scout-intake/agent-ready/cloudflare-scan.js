'use strict';

// cloudflare-scan.js — Supplemental Cloudflare cross-check.
//
// Two signal sources, both optional / graceful-fail:
//   1. Header analysis — reads CF headers already captured in the site-fetch
//      evidence (cf-ray, server: cloudflare, cf-cache-status, etc.).
//   2. Cloudflare Radar API — queries domain intelligence when
//      CLOUDFLARE_RADAR_API_TOKEN is set in the environment.
//
// Returns a findings[] array appended to the agentReady result — never throws.

const RADAR_BASE = 'https://api.cloudflare.com/client/v4/radar';
const RADAR_TIMEOUT_MS = 8000;

function getCfToken() {
  return process.env.CLOUDFLARE_RADAR_API_TOKEN || null;
}

/**
 * Analyse response headers captured during site-fetch for Cloudflare signals.
 * @param {object|null} evidence  — site-fetch evidence object
 * @returns {{ onCloudflare: boolean, cacheStatus: string|null, botManagement: boolean, http2: boolean|null }}
 */
function analyseHeaders(evidence) {
  const headers = evidence?.pages?.[0]?._responseHeaders || evidence?.headers || {};
  const norm = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  const onCloudflare  = Boolean(norm['cf-ray'] || norm['server']?.toLowerCase().includes('cloudflare'));
  const cacheStatus   = norm['cf-cache-status'] || null;
  const botManagement = Boolean(norm['cf-mitigated'] || norm['cf-ipcountry']);
  const http2         = norm[':status'] != null || norm['x-protocol']?.includes('HTTP/2') || null;

  return { onCloudflare, cacheStatus, botManagement, http2 };
}

/**
 * Query Cloudflare Radar for domain ranking + traffic intelligence.
 * Endpoint: GET /radar/ranking/domain/{hostname}
 * Gracefully returns null if no token or request fails.
 * @param {string} hostname
 * @returns {Promise<{ rank: object|null, errors: string[] }>}
 */
async function fetchRadarDomain(hostname) {
  const token = getCfToken();
  if (!token) return { rank: null, errors: [] };

  // Ranking endpoint — returns rank, categories, and top locations for any domain
  const rankUrl = `${RADAR_BASE}/ranking/domain/${encodeURIComponent(hostname)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RADAR_TIMEOUT_MS);
    const res = await fetch(rankUrl, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    clearTimeout(timer);

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = body?.errors?.[0]?.message || `HTTP ${res.status}`;
      return { rank: null, errors: [errMsg] };
    }

    return { rank: body?.result ?? null, errors: [] };
  } catch (err) {
    return { rank: null, errors: [err?.message || 'request failed'] };
  }
}

/**
 * Run the Cloudflare supplemental cross-check.
 *
 * @param {{ websiteUrl: string, evidence: object|null }} opts
 * @returns {Promise<{ findings: object[], cfSignals: object }>}
 */
async function runCloudflareScan({ websiteUrl, evidence = null }) {
  let hostname = '';
  try { hostname = new URL(websiteUrl).hostname; } catch { return { findings: [], cfSignals: {} }; }

  const headerSignals             = analyseHeaders(evidence);
  const { rank: radarRank, errors: radarErrors } = await fetchRadarDomain(hostname);

  const findings = [];

  // ── Header-derived findings ──────────────────────────────────────────────

  if (headerSignals.onCloudflare) {
    findings.push({
      severity: 'info',
      source:   'cloudflare-headers',
      text:     'Site is served via Cloudflare CDN',
      detail:   headerSignals.cacheStatus ? `Cache status: ${headerSignals.cacheStatus}` : 'cf-ray header confirmed',
    });
    if (headerSignals.botManagement) {
      findings.push({
        severity: 'info',
        source:   'cloudflare-headers',
        text:     'Cloudflare Bot Management active',
        detail:   'cf-mitigated or cf-ipcountry header detected',
      });
    }
  } else {
    findings.push({
      severity: 'low',
      source:   'cloudflare-headers',
      text:     'No Cloudflare CDN detected',
      detail:   'No cf-ray or Cloudflare server headers found. Consider Cloudflare for DDoS protection and bot management.',
    });
  }

  // ── Radar-derived findings ───────────────────────────────────────────────
  // radarRank shape: { rank: number, categories: [...], topLocations: [...] }

  const hasRank = radarRank != null && radarRank.rank != null;

  if (hasRank) {
    findings.push({
      severity: 'info',
      source:   'cloudflare-radar',
      text:     `Cloudflare Radar global rank: #${radarRank.rank.toLocaleString()}`,
      detail:   radarRank.rankChange != null
        ? (radarRank.rankChange > 0 ? `↑ improved ${radarRank.rankChange}` : radarRank.rankChange < 0 ? `↓ dropped ${Math.abs(radarRank.rankChange)}` : 'rank unchanged')
        : undefined,
    });
    if (Array.isArray(radarRank.categories) && radarRank.categories.length > 0) {
      findings.push({
        severity: 'info',
        source:   'cloudflare-radar',
        text:     `Domain categories: ${radarRank.categories.map((c) => c.name || c).join(', ')}`,
      });
    }
    if (Array.isArray(radarRank.topLocations) && radarRank.topLocations.length > 0) {
      const top3 = radarRank.topLocations.slice(0, 3).map((l) => l.locationName || l.countryAlpha2 || l).join(', ');
      findings.push({
        severity: 'info',
        source:   'cloudflare-radar',
        text:     `Top traffic locations: ${top3}`,
      });
    }
  } else if (getCfToken()) {
    // Token is set — API reached — domain simply not in Radar index yet
    const reason = radarErrors.length > 0 ? radarErrors[0] : 'domain not yet indexed';
    findings.push({
      severity: 'info',
      source:   'cloudflare-radar',
      text:     'Cloudflare Radar: domain not indexed',
      detail:   `${reason} — Radar tracks domains with significant global traffic; smaller or newer domains may not appear`,
    });
  }

  const cfSignals = {
    onCloudflare:   headerSignals.onCloudflare,
    cacheStatus:    headerSignals.cacheStatus,
    botManagement:  headerSignals.botManagement,
    radarAvailable: Boolean(getCfToken()),
    radarRank:      radarRank || null,
    radarErrors,
  };

  return { findings, cfSignals };
}

module.exports = { runCloudflareScan };
