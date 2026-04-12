// services/reviews.js — search-based review status monitoring for Yelp and Google

require('../load-env');
const { getProvider } = require('../providers');
const { MODELS } = require('../optimizer');

function getAnthropicClient() {
  return getProvider();
}

function getReviewConfig(config = {}) {
  return config.reviews || null;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSource(source = {}) {
  const reviewCount = toNumber(source.reviewCount);
  const ratingValue = toNumber(source.ratingValue);

  return {
    key: source.key || 'source',
    label: source.label || source.key || 'Source',
    reviewCount,
    ratingValue: ratingValue != null && ratingValue > 0 && ratingValue <= 5 ? ratingValue : null,
    verificationStatus: source.verificationStatus || (reviewCount != null ? 'verified' : 'unverified'),
    sourceUrl: source.sourceUrl || source.url || '',
    notes: source.notes || '',
  };
}

function buildSourceDiff(currentSource, previousSource) {
  if (!currentSource) {
    return {
      status: 'unavailable',
      countDelta: null,
      ratingDelta: null,
    };
  }

  if (!previousSource || previousSource.reviewCount == null || currentSource.reviewCount == null) {
    return {
      status: currentSource.reviewCount == null ? 'unable_to_verify' : 'baseline_only',
      countDelta: null,
      ratingDelta: previousSource?.ratingValue != null && currentSource.ratingValue != null
        ? Number((currentSource.ratingValue - previousSource.ratingValue).toFixed(2))
        : null,
    };
  }

  const countDelta = currentSource.reviewCount - previousSource.reviewCount;
  const ratingDelta = previousSource.ratingValue != null && currentSource.ratingValue != null
    ? Number((currentSource.ratingValue - previousSource.ratingValue).toFixed(2))
    : null;

  let status = 'no_change';
  if (countDelta > 0) status = 'new_review_detected';
  else if (countDelta < 0) status = 'count_decreased';

  return { status, countDelta, ratingDelta };
}

function buildOverallStatus(sourceDiffs = []) {
  if (sourceDiffs.some((diff) => diff.status === 'new_review_detected')) {
    return 'new_review_detected';
  }
  if (sourceDiffs.every((diff) => diff.status === 'no_change')) {
    return 'no_new_reviews';
  }
  if (sourceDiffs.every((diff) => diff.status === 'unable_to_verify' || diff.status === 'unavailable')) {
    return 'unable_to_verify';
  }
  return 'mixed';
}

function getFounderStatus(reviewReport) {
  const yelpDiff = reviewReport?.diff?.yelp || null;
  if (!yelpDiff) return 'unable_to_verify';
  if (yelpDiff.status === 'new_review_detected') return 'new_yelp_review_detected';
  if (yelpDiff.status === 'no_change') return 'no_new_yelp_reviews';
  if (yelpDiff.status === 'baseline_only') return 'yelp_baseline_captured';
  return 'unable_to_verify';
}

function buildReviewContextBlock(reviewReport) {
  if (!reviewReport) return '';

  const yelp = (reviewReport.sources || []).find((source) => source.key === 'yelp');
  const founderStatus = getFounderStatus(reviewReport);
  const statusLine = founderStatus === 'new_yelp_review_detected'
    ? 'NEW YELP REVIEW DETECTED.'
    : founderStatus === 'no_new_yelp_reviews'
      ? 'NO NEW YELP REVIEWS DETECTED.'
      : founderStatus === 'yelp_baseline_captured'
        ? 'YELP BASELINE CAPTURED. NEXT CHECK CAN DETECT CHANGES.'
        : 'UNABLE TO VERIFY YELP REVIEW STATUS THIS CYCLE.';

  const details = yelp
    ? `Yelp snapshot: ${yelp.reviewCount != null ? `${yelp.reviewCount} reviews` : 'count unavailable'}${yelp.ratingValue != null ? `, ${yelp.ratingValue} stars` : ''}.`
    : 'Yelp snapshot unavailable.';

  return `REVIEW STATUS CHECK:
${statusLine}
${details}
Use this only to answer whether Yelp has a new review or not. Do not quote or summarize review text.`;
}

function buildReviewSearchPrompt(config = {}) {
  const reviewConfig = getReviewConfig(config) || {};
  const sources = reviewConfig.sources || [];
  const searchLines = sources.map((source, index) => `SEARCH ${index + 1} — ${source.label}: ${source.query}`).join('\n');

  return `You are checking review status for ${config.clientName}. Execute exactly ${sources.length} web searches in sequence.

Goal:
- estimate the current public review count and star rating for each source
- prefer source-native snippets or obvious review/search results
- do NOT summarize any review text
- if the result is ambiguous, mark it unverified instead of guessing

${searchLines}

Return ONLY valid JSON:
{
  "sources": [
    {
      "key": "google",
      "label": "Google Business Profile",
      "reviewCount": 0,
      "ratingValue": 0,
      "verificationStatus": "verified|unverified",
      "sourceUrl": "https://...",
      "notes": "short note if needed"
    }
  ]
}`;
}

function parseSearchJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function fetchReviewStatusViaWebSearch(config = {}, previousReport = null) {
  const reviewConfig = getReviewConfig(config);
  if (!reviewConfig || reviewConfig.provider !== 'web-search') return null;

  const sources = reviewConfig.sources || [];
  const response = await getAnthropicClient().messages.create({
    model: MODELS.briefWrite,
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: buildReviewSearchPrompt(config),
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: sources.length }],
  });

  const fullText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const parsed = parseSearchJson(fullText) || { sources: [] };
  const normalizedSources = sources.map((expectedSource) => {
    const matched = (parsed.sources || []).find((source) => source.key === expectedSource.key) || {};
    return normalizeSource({
      key: expectedSource.key,
      label: expectedSource.label,
      ...matched,
    });
  });

  const previousSources = Object.fromEntries((previousReport?.sources || []).map((source) => [source.key, source]));
  const diff = Object.fromEntries(
    normalizedSources.map((source) => [source.key, buildSourceDiff(source, previousSources[source.key])])
  );

  return {
    clientId: config.clientId,
    provider: 'web-search',
    fetchedAt: new Date().toISOString(),
    overallStatus: buildOverallStatus(Object.values(diff)),
    founderStatus: getFounderStatus({ diff }),
    sources: normalizedSources,
    diff,
  };
}

module.exports = {
  buildReviewContextBlock,
  fetchReviewStatusViaWebSearch,
};
