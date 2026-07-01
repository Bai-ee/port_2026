'use strict';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return String(value || '').trim();
}

function normalizeRedditSignal(item = {}, source = '') {
  const title = str(item.title || item.conversation || item.topic || item.author || item.source || 'Reddit signal');
  const url = str(item.url || item.permalink || item.link || '');
  const subreddit = str(item.subreddit || item.tag || item.community || item.source || '');
  const summary = str(item.summary || item.insight || item.whyRelevant || item.content || item.finding || item.snippet || item.text || '');
  return {
    ...item,
    title,
    subreddit,
    signalType: str(item.signalType || item.opportunityType || item.type || ''),
    summary,
    actionableTakeaway: str(item.actionableTakeaway || item.whyRelevant || item.injectionAngle || item.angle || ''),
    url,
    source: source || item.source || '',
  };
}

function dedupeSignals(items, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const normalized = normalizeRedditSignal(item, item?.source || '');
    if (!normalized.title && !normalized.url && !normalized.summary) continue;
    const key = (normalized.url || `${normalized.title}|${normalized.summary}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function collectRedditSignals(marketingBrief = {}, { includeBrandMentionFallback = true, limit = 12 } = {}) {
  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  const reportSnapshot = marketingBrief?.reportSnapshot || {};
  const platformTests = reportSnapshot?.platformTests || {};
  const redditTest = platformTests?.reddit || {};

  const signals = [
    ...arr(agentData.redditSignals).map((item) => normalizeRedditSignal(item, 'scout')),
    ...arr(redditTest.items).map((item) => normalizeRedditSignal(item, 'platform-test')),
  ];

  if (includeBrandMentionFallback) {
    signals.push(...arr(agentData.brandMentions)
      .filter((item) => /reddit/i.test(`${item?.source || ''} ${item?.url || ''}`))
      .map((item) => normalizeRedditSignal({
        title: item.author || item.source || 'Reddit mention',
        subreddit: item.source || 'Reddit',
        signalType: 'brand_mention',
        summary: item.content || item.finding || '',
        actionableTakeaway: '',
        url: item.url || '',
      }, 'brand-mention-fallback')));
  }

  return dedupeSignals(signals, limit);
}

// Instagram mirror of collectRedditSignals. Merges scout agentData.instagramSignals
// (if present) + the persisted Instagram source-test items + Instagram brandMentions.
// Reuses the generic normalize/dedupe helpers; `subreddit` holds the @account label
// so the same render/analyzer schema works across platforms.
function collectInstagramSignals(marketingBrief = {}, { includeBrandMentionFallback = true, limit = 12 } = {}) {
  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  const reportSnapshot = marketingBrief?.reportSnapshot || {};
  const platformTests = reportSnapshot?.platformTests || {};
  const igTest = platformTests?.instagram || {};

  const signals = [
    ...arr(agentData.instagramSignals).map((item) => normalizeRedditSignal(item, 'scout')),
    ...arr(igTest.items).map((item) => normalizeRedditSignal(item, 'platform-test')),
  ];

  if (includeBrandMentionFallback) {
    signals.push(...arr(agentData.brandMentions)
      .filter((item) => /instagram/i.test(`${item?.source || ''} ${item?.url || ''}`))
      .map((item) => normalizeRedditSignal({
        title: item.author || item.source || 'Instagram mention',
        subreddit: item.source || 'Instagram',
        signalType: 'brand_mention',
        summary: item.content || item.finding || '',
        actionableTakeaway: '',
        url: item.url || '',
      }, 'brand-mention-fallback')));
  }

  return dedupeSignals(signals, limit);
}

module.exports = {
  collectRedditSignals,
  collectInstagramSignals,
  normalizeRedditSignal,
};
