// aggregator.js — Data aggregation layer for the Newsletter module
//
// Pulls the latest Scout brief + agentData from the existing store and
// normalizes it into a newsletterBriefData shape that the Newsletter Scribe
// consumes. No new data collection — purely a consumer of Scout output.
//
// This is the bridge between the existing Scout pipeline and the Newsletter.
// If Scout hasn't run yet for a client, the aggregator returns null so the
// caller can surface a clear "run Scout first" message on the dashboard.

const { getLatestBrief, getLatestContent } = require('../not-the-rug-brief/store');
const { normalizeIntelligence, getIntelligenceConfig } = require('../not-the-rug-brief/intelligence');

/**
 * Coalesce a value to a non-empty string, or return the fallback.
 */
function coalesce(value, fallback = '') {
  return value && typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Derive the alert level from escalation array — same logic as scribe.js extractBriefData.
 */
function deriveAlertLevel(escalations = []) {
  if (escalations.some((e) => e.level === 'CRITICAL')) return 'CRITICAL';
  if (escalations.some((e) => e.level === 'IMPORTANT')) return 'IMPORTANT';
  return 'QUIET';
}

/**
 * Extract the PRIORITY ACTION line from the Scout humanBrief.
 */
function extractPriorityAction(humanBrief, escalations = []) {
  const match = humanBrief?.match(/PRIORITY ACTION:\s*(.+)/i);
  return match
    ? match[1].trim()
    : escalations[0]?.summary || 'No priority action identified.';
}

/**
 * Build a compact metrics block from normalized intelligence.
 * Returns an array of { label, value } pairs for the Scribe to work with.
 */
function buildMetricsBlock(normalized) {
  const metrics = [];

  // Weather
  if (normalized.weatherImpact) {
    metrics.push({
      label: 'Weather',
      value: `${normalized.weatherImpact.summary}${normalized.weatherImpact.operationalTakeaway ? ` — ${normalized.weatherImpact.operationalTakeaway}` : ''}`,
    });
  }

  // Brand mention count
  const mentionCount = asArray(normalized.brandMentions).length;
  if (mentionCount > 0) {
    const topSentiment = normalized.brandMentions[0]?.sentiment || 'neutral';
    metrics.push({
      label: 'Brand Mentions',
      value: `${mentionCount} mention${mentionCount === 1 ? '' : 's'} (top sentiment: ${topSentiment})`,
    });
  }

  // Review insights
  if (normalized.reviewInsights.length > 0) {
    const topReview = normalized.reviewInsights[0];
    metrics.push({
      label: 'Reviews',
      value: `${topReview.source}: ${topReview.insight} (${topReview.sentiment})`,
    });
  }

  // Competitor intel count
  const compIntelCount = asArray(normalized.competitorIntel).length;
  if (compIntelCount > 0) {
    metrics.push({
      label: 'Competitor Signals',
      value: `${compIntelCount} signal${compIntelCount === 1 ? '' : 's'} detected`,
    });
  }

  return metrics;
}

/**
 * Aggregate Scout data into the shape the Newsletter Scribe expects.
 *
 * @param {string} clientId
 * @param {object} config     - Full client config from clients.js or Firestore
 * @param {object|null} brief - Scout brief passed directly (preferred), or null to load from store
 * @returns {Promise<object|null>} newsletterBriefData, or null if no Scout brief exists
 */
async function aggregateForNewsletter(clientId, config, brief = null) {
  // Accept brief passed in-memory (from pipeline) or load from filesystem
  const resolvedBrief = brief || await getLatestBrief(clientId);

  if (!resolvedBrief) {
    console.warn(`[NEWSLETTER-AGGREGATOR] No Scout brief found for ${clientId}`);
    return null;
  }

  if (resolvedBrief.status !== 'success') {
    console.warn(`[NEWSLETTER-AGGREGATOR] Scout brief has status '${resolvedBrief.status}' — skipping`);
    return null;
  }

  const agentData = resolvedBrief.agentData || {};
  const normalized = normalizeIntelligence(agentData, config);
  const intelligence = getIntelligenceConfig(config);
  const escalations = asArray(normalized.escalations);

  // Also pull existing Scribe content if available — the Newsletter Scribe
  // can reference the social content angle for coherence
  const existingContent = await getLatestContent(clientId);

  const alertLevel = deriveAlertLevel(escalations);
  const priorityAction = extractPriorityAction(resolvedBrief.humanBrief, escalations);

  // Build upcoming events from config
  const upcomingEvents = (config?.upcomingEvents || []).filter((e) => {
    const daysOut = typeof e.daysOut === 'number' ? e.daysOut : null;
    return daysOut !== null && daysOut >= 0 && daysOut <= 30;
  });

  return {
    // ── Core brief metadata ─────────────────────────────────────────
    clientId,
    runDate: new Date(resolvedBrief.timestamp || Date.now()),
    scoutBriefTimestamp: resolvedBrief.timestamp,
    alertLevel,
    priorityAction,

    // ── Top-line signals (pre-extracted for prompt injection) ────────
    topEscalation: escalations[0]?.summary || 'No escalations this cycle.',
    topSignal: normalized.primarySignals[0]?.title
      || intelligence.primarySignalsFallback
      || 'No primary signals available.',
    topWeatherImpact: normalized.weatherImpact
      ? `${normalized.weatherImpact.summary}${normalized.weatherImpact.operationalTakeaway ? ` — ${normalized.weatherImpact.operationalTakeaway}` : ''}`
      : null,
    topLocalEvent: normalized.localEvents[0]
      ? `${normalized.localEvents[0].event}${normalized.localEvents[0].date ? ` (${normalized.localEvents[0].date})` : ''}${normalized.localEvents[0].opportunity ? ` — ${normalized.localEvents[0].opportunity}` : ''}`
      : null,
    topReviewInsight: normalized.reviewInsights[0]?.insight || null,

    // ── Full arrays for deeper section rendering ────────────────────
    brandMentions: normalized.brandMentions,
    competitorIntel: normalized.competitorIntel,
    categoryTrends: normalized.primarySignals,
    contentOpportunities: normalized.contentOpportunities,
    localEvents: normalized.localEvents,
    redditSignals: normalized.redditSignals,
    reviewInsights: normalized.reviewInsights,
    relationshipSignals: normalized.relationshipSignals,
    escalations,

    // ── Computed blocks ─────────────────────────────────────────────
    metrics: buildMetricsBlock(normalized),
    upcomingEvents,
    hasUpcomingEvent: upcomingEvents.length > 0,
    upcomingEvent: upcomingEvents[0] || null,

    // ── Reference to existing Scribe output (optional coherence) ────
    existingContentAngle: existingContent?.content?.content_angle || null,
    existingPriorityAction: existingContent?.scoutPriorityAction || null,
  };
}

module.exports = { aggregateForNewsletter };
