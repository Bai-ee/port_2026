// intelligence.js — Normalize client-specific Scout agentData into shared shapes

function getIntelligenceConfig(config = {}) {
  return config.intelligence || {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePrimarySignals(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const candidates = [
    agentData[intel.primarySignalsKey],
    agentData.categoryTrends,
    agentData.localDemandSignals,
  ].filter(Boolean);

  const raw = asArray(candidates[0]);
  return raw.map((item) => ({
    title: item.signal || item.trend || item.topic || item.headline || 'Signal',
    detail: item.detail || item.whyNow || item.finding || '',
    relevance: item.relevance || item.priority || item.impact || 'medium',
    raw: item,
  }));
}

function normalizeReviewInsights(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const raw = asArray(
    agentData[intel.reviewInsightsKey]
    || agentData.reviewInsights
  );

  return raw.map((item) => ({
    source: item.source || item.platform || 'Review source',
    insight: item.insight || item.finding || item.content || '',
    sentiment: item.sentiment || 'neutral',
    actionableTakeaway: item.actionableTakeaway || item.suggestion || '',
    url: item.url || '',
    raw: item,
  }));
}

function normalizeWeatherImpact(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const raw = agentData[intel.weatherKey] || agentData.weatherImpact || null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  return {
    summary: raw.summary || raw.condition || '',
    operationalTakeaway: raw.operationalTakeaway || raw.impact || raw.detail || '',
    source: raw.source || '',
    url: raw.url || '',
    raw,
  };
}

function normalizeLocalEvents(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const raw = asArray(
    agentData[intel.localEventsKey]
    || agentData.localEvents
  );

  return raw.map((item) => ({
    event: item.event || item.name || 'Event',
    date: item.date || '',
    impact: item.impact || item.detail || '',
    opportunity: item.opportunity || item.whyNow || '',
    url: item.url || '',
    raw: item,
  }));
}

function normalizeRedditSignals(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const explicit = asArray(
    agentData[intel.redditSignalsKey]
    || agentData.redditSignals
  );

  if (explicit.length > 0) {
    return explicit.map((item) => ({
      title: item.title || item.thread || item.subreddit || 'Reddit signal',
      subreddit: item.subreddit || item.community || '',
      signalType: item.signalType || item.type || 'signal',
      summary: item.summary || item.detail || item.finding || item.content || '',
      actionableTakeaway: item.actionableTakeaway || item.whyItMatters || item.suggestion || '',
      url: item.url || '',
      raw: item,
    }));
  }

  return asArray(agentData.brandMentions)
    .filter((item) => /reddit/i.test(`${item.source || ''} ${item.url || ''}`))
    .map((item) => ({
      title: item.author || item.source || 'Reddit mention',
      subreddit: item.source || 'Reddit',
      signalType: 'brand_mention',
      summary: item.content || item.finding || '',
      actionableTakeaway: '',
      url: item.url || '',
      raw: item,
    }));
}

function normalizeRelationshipSignals(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const raw = asArray(
    agentData[intel.relationshipSignalsKey]
    || agentData.partnershipOpportunities
    || agentData.kolActivity
  );

  return raw.map((item) => ({
    name: item.partner || item.name || item.account || 'Relationship opportunity',
    summary: item.finding || item.content || item.detail || '',
    priority: item.priority || item.relevance || item.impact || 'medium',
    type: item.type || item.platform || '',
    url: item.url || '',
    raw: item,
  }));
}

function normalizeContentOpportunities(agentData = {}, config = {}) {
  const intel = getIntelligenceConfig(config);
  const rawBlock = agentData[intel.contentOpportunitiesKey]
    || agentData.contentOpportunities
    || agentData.viralOpportunities
    || [];

  const opportunities = Array.isArray(rawBlock)
    ? rawBlock
    : asArray(rawBlock.opportunities);

  return opportunities.map((item) => ({
    title: item.topic || item.conversation || item.trigger || 'Opportunity',
    summary: item.whyNow || item.injectionAngle || item.suggestedAngle || '',
    priority: item.priority || item.authenticity || item.engagementLevel || 'medium',
    format: item.format || '',
    source: item.source || '',
    url: item.url || '',
    windowHours: item.windowHours || null,
    raw: item,
  }));
}

function normalizeIntelligence(agentData = {}, config = {}) {
  return {
    brandMentions: asArray(agentData.brandMentions),
    competitorIntel: asArray(agentData.competitorIntel),
    weatherImpact: normalizeWeatherImpact(agentData, config),
    localEvents: normalizeLocalEvents(agentData, config),
    redditSignals: normalizeRedditSignals(agentData, config),
    primarySignals: normalizePrimarySignals(agentData, config),
    reviewInsights: normalizeReviewInsights(agentData, config),
    relationshipSignals: normalizeRelationshipSignals(agentData, config),
    contentOpportunities: normalizeContentOpportunities(agentData, config),
    escalations: asArray(agentData.escalations),
  };
}

module.exports = {
  getIntelligenceConfig,
  normalizeIntelligence,
};
