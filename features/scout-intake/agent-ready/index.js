'use strict';

const { fetchProbe } = require('./_fetch');
const { runDiscoverability } = require('./checks/discoverability');
const { runAccessibility } = require('./checks/accessibility');
const { runBotAccess } = require('./checks/bot-access');
const { runCapabilities } = require('./checks/capabilities');
const { scoreDimension, overallScore, verdictFor } = require('./scoring');
const { FIX_LIBRARY } = require('./fix-library');

// Map check severity: weight ≥ 3 → critical, 2 → warning, 1 → info
function toFindingSeverity(weight) {
  if (weight >= 3) return 'critical';
  if (weight >= 2) return 'warning';
  return 'info';
}

function buildHighlights(verdict, dimensions, failedChecks) {
  const highlights = [];
  highlights.push(`${verdict} — overall agent-readiness score across discoverability, accessibility, bot access, and capabilities.`);
  const worst = Object.entries(dimensions)
    .filter(([, v]) => v != null)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 1);
  if (worst.length) {
    const [dim, score] = worst[0];
    highlights.push(`Lowest dimension: ${dim} at ${score}%.`);
  }
  if (failedChecks.length) {
    highlights.push(`${failedChecks.length} gap${failedChecks.length !== 1 ? 's' : ''} found: ${failedChecks.slice(0, 3).map((c) => c.id).join(', ')}${failedChecks.length > 3 ? '…' : ''}.`);
  }
  return highlights;
}

/**
 * Build the probes map by fetching all signals in parallel.
 * Reuses evidence fields when available to avoid redundant fetches.
 *
 * @param {string} baseUrl
 * @param {object|null} evidence  — from runSiteFetch, may contain pages[0]._rawHtml
 * @returns {Promise<object>} probes map
 */
async function buildProbes(baseUrl, evidence) {
  const origin = new URL(baseUrl).origin;
  // Reuse homepage HTML from evidence if available
  const homepageHtml = evidence?.pages?.[0]?._rawHtml || null;

  const [
    robotsTxt,
    sitemapXml,
    homepageHeaders,
    apiCatalog,
    llmsTxt,
    markdownNegotiation,
    signatureAgentProbe,
    mcpJson,
    agentSkills,
    x402Probe,
    oauthDiscovery,
  ] = await Promise.all([
    fetchProbe(`${origin}/robots.txt`),
    fetchProbe(`${origin}/sitemap.xml`),
    fetchProbe(baseUrl, { method: 'HEAD' }),
    fetchProbe(`${origin}/.well-known/api-catalog`),
    fetchProbe(`${origin}/llms.txt`),
    fetchProbe(baseUrl, { headers: { Accept: 'text/markdown, text/html;q=0.5, */*;q=0.1' } }),
    fetchProbe(baseUrl, { headers: { 'Signature-Agent': 'agent-readiness-probe/1.0' } }),
    fetchProbe(`${origin}/.well-known/mcp.json`),
    fetchProbe(`${origin}/.well-known/agent-skills.json`),
    fetchProbe(`${origin}/.well-known/payment`, { method: 'GET' }),
    fetchProbe(`${origin}/.well-known/oauth-authorization-server`),
  ]);

  return {
    robotsTxt,
    sitemapXml,
    homepageHeaders,
    apiCatalog,
    llmsTxt,
    markdownNegotiation,
    homepageHtml: homepageHtml || markdownNegotiation.body || '',
    signatureAgentProbe,
    mcpJson,
    agentSkills,
    x402Probe,
    oauthDiscovery,
  };
}

/**
 * Run agent-readiness checks for a website.
 *
 * @param {{ websiteUrl: string, evidence?: object|null, _probes?: object }} opts
 *   _probes: optional pre-built probes map (used in tests to skip network calls)
 * @returns {Promise<object>}
 */
async function runAgentReady({ websiteUrl, evidence = null, _probes = null }) {
  try {
    const probes = _probes || (await buildProbes(websiteUrl, evidence));

    const allChecks = [
      ...runDiscoverability(probes),
      ...runAccessibility(probes),
      ...runBotAccess(probes),
      ...runCapabilities(probes),
    ];

    const byDimension = {
      discoverability: allChecks.filter((c) => c.dimension === 'discoverability'),
      accessibility:   allChecks.filter((c) => c.dimension === 'accessibility'),
      botAccess:       allChecks.filter((c) => c.dimension === 'botAccess'),
      capabilities:    allChecks.filter((c) => c.dimension === 'capabilities'),
    };

    const dimensions = {
      discoverability: scoreDimension(byDimension.discoverability),
      accessibility:   scoreDimension(byDimension.accessibility),
      botAccess:       scoreDimension(byDimension.botAccess),
      capabilities:    scoreDimension(byDimension.capabilities),
    };

    const score = overallScore(dimensions);
    const verdict = verdictFor(score);
    // Map verdict → aggregator readiness scale (healthy|partial|critical) so
    // the dashboard card pill reflects agent-readiness, not just the AI SEO skill.
    const readiness = score >= 80 ? 'healthy' : score >= 50 ? 'partial' : 'critical';

    // `na` (no signal) is treated as a fail in scoring — surface it as a gap too,
    // otherwise the dimension score drops but the user sees zero findings.
    const failedChecks = allChecks.filter((c) => c.status === 'fail' || c.status === 'warn' || c.status === 'na');

    const findings = failedChecks.map((c) => ({
      id:       c.id,
      severity: toFindingSeverity(c.weight),
      label:    FIX_LIBRARY[c.fixId]?.title || c.id,
      detail:   FIX_LIBRARY[c.fixId]?.why   || null,
    }));

    const highlights = buildHighlights(verdict, dimensions, failedChecks);

    return { ok: true, score, dimensions, verdict, readiness, checks: allChecks, findings, highlights };
  } catch (err) {
    return { ok: false, error: err.message, score: 0, dimensions: {}, verdict: 'Not agent-ready', checks: [], findings: [], highlights: [] };
  }
}

module.exports = { runAgentReady };
