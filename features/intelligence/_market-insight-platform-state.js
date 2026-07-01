'use strict';

const fb = require('../../api/_lib/firebase-admin.cjs');

const DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'instagram'];

function normalizeMarketInsightSourcePlatforms(value) {
  return Array.isArray(value) && value.length
    ? value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS];
}

function platformAvailabilityFromSourcePlatforms(sourcePlatforms) {
  const set = new Set(normalizeMarketInsightSourcePlatforms(sourcePlatforms));
  return {
    x: set.has('x'),
    reddit: set.has('reddit'),
    instagram: set.has('instagram'),
  };
}

async function getMarketInsightPlatformState(clientId) {
  if (!clientId) {
    const sourcePlatforms = [...DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS];
    return { sourcePlatforms, platformAvailability: platformAvailabilityFromSourcePlatforms(sourcePlatforms) };
  }
  try {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const sourcePlatforms = normalizeMarketInsightSourcePlatforms(snap.data()?.marketingBriefConfig?.sourcePlatforms);
    return { sourcePlatforms, platformAvailability: platformAvailabilityFromSourcePlatforms(sourcePlatforms) };
  } catch {
    const sourcePlatforms = [...DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS];
    return { sourcePlatforms, platformAvailability: platformAvailabilityFromSourcePlatforms(sourcePlatforms) };
  }
}

module.exports = {
  DEFAULT_MARKET_INSIGHT_SOURCE_PLATFORMS,
  normalizeMarketInsightSourcePlatforms,
  platformAvailabilityFromSourcePlatforms,
  getMarketInsightPlatformState,
};
