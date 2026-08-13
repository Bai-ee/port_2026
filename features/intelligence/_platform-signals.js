'use strict';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function str(value) {
  return String(value || '').trim();
}

// ─── Relevance guard ────────────────────────────────────────────────────────
// Platform search (Reddit/Instagram) runs broad category queries alongside the
// brand ones, so a raw result set mixes genuine brand signal with generic
// category chatter that has nothing to do with the client. Everything
// downstream — the analyzers, the email sections, the brief — treats stored
// signals as already-relevant, so the filter belongs at the WRITE, before
// reportSnapshot.platformTests is persisted. Filtering here means all eight
// collect*Signals readers inherit clean data with no signature churn.

/** Normalize for comparison: lowercase, strip everything but a-z0-9. Makes
 *  "Critters Quest" / "CrittersQuest" / "critters.quest" all compare equal. */
function foldTerm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A folded term this long is distinctive enough that a bare substring match is
// safe ("crittersquest" cannot appear by accident). Anything shorter is matched
// on word boundaries instead — folding "$QUEST" to "quest" and substring-matching
// it tagged "Cat Quests lover seeking recs" and "the quests board in Clash of
// Critters" as brand signal, which is exactly the bleed this guard exists to stop.
const STRONG_TERM_MIN = 8;

/** Lowercased text with punctuation collapsed to spaces, but $ and # kept so
 *  cashtags/hashtags stay matchable as themselves. */
function looseText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9$#]+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 2 = matches a brand term, 1 = matches only a category term, 0 = neither. */
function relevanceScore(item = {}, brandTerms = [], categoryTerms = []) {
  const raw = [item.title, item.summary, item.subreddit, item.tag, item.author, item.url].join(' ');
  const folded = foldTerm(raw);
  const loose = looseText(raw);
  if (!folded) return 0;
  const hits = (terms) => arr(terms).some((term) => {
    const f = foldTerm(term);
    if (f.length < 3) return false;
    if (f.length >= STRONG_TERM_MIN) return folded.includes(f);
    // Short term ("$QUEST", "Valdara") — must appear as its own word, with any
    // leading $/# preserved so a ticker only matches the actual ticker.
    const cleaned = looseText(term);
    if (!cleaned) return false;
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(cleaned)}([^a-z0-9]|$)`).test(loose);
  });
  if (hits(brandTerms)) return 2;
  if (hits(categoryTerms)) return 1;
  return 0;
}

/** Drop off-topic items and rank brand matches ahead of category-only ones, so a
 *  capped item budget spends itself on the client's own signal first.
 *
 *  One safety valve only: with no brand terms configured the input is returned
 *  untouched, so an unconfigured client behaves exactly as before.
 *
 *  Note what is deliberately NOT a valve — "if everything was dropped, keep it
 *  all". A broad query genuinely can return zero on-brand results (searching
 *  "Critters Quest" on Reddit surfaces Smiling Critters, Clash of Critters and
 *  Cat Quest threads), and in that case an empty set is the honest answer: the
 *  section renders its empty state instead of presenting unrelated chatter as
 *  market intel. Callers log kept/dropped so a mis-tuned term list is visible
 *  rather than silent. */
function filterRelevantSignals(items = [], { brandTerms = [], categoryTerms = [] } = {}) {
  const list = arr(items);
  const usableBrand = arr(brandTerms).map(foldTerm).filter((t) => t.length >= 3);
  if (!list.length || !usableBrand.length) return list;
  const scored = list
    .map((item, index) => ({ item, index, score: relevanceScore(item, brandTerms, categoryTerms) }))
    .filter((entry) => entry.score > 0);
  // Stable: equal scores keep the platform's own ordering.
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((entry) => entry.item);
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

// `relevance` ({brandTerms, categoryTerms}) filters the MERGED set. The write-time
// guard in refreshPlatformSignals only covers platformTests; Scout's own
// agentData.redditSignals/brandMentions reach the analyzers untouched, and those
// are broad web-search results (WoW's "Think of the Critters" quest threads came
// through this path). Pass relevance from any caller holding the client config so
// the analyzer input is filtered too. Omitted = unfiltered, exactly as before.
function collectRedditSignals(marketingBrief = {}, { includeBrandMentionFallback = true, limit = 12, relevance = null } = {}) {
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

  const deduped = dedupeSignals(signals, limit);
  return relevance ? filterRelevantSignals(deduped, relevance) : deduped;
}

// Instagram mirror of collectRedditSignals. Merges scout agentData.instagramSignals
// (if present) + the persisted Instagram source-test items + Instagram brandMentions.
// Reuses the generic normalize/dedupe helpers; `subreddit` holds the @account label
// so the same render/analyzer schema works across platforms.
function collectInstagramSignals(marketingBrief = {}, { includeBrandMentionFallback = true, limit = 12, relevance = null } = {}) {
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

  const deduped = dedupeSignals(signals, limit);
  return relevance ? filterRelevantSignals(deduped, relevance) : deduped;
}

/** X "market talk" — the brand-search pull (handle + brand keywords), NOT the
 *  watchlist handle timelines. Kept in its own platformTests slot (`xMarketTalk`)
 *  so it can never collide with `platformTests.x`, which the Market Insights
 *  per-source Test writes from `fetchHandleTimelines`. Same normalize/dedupe
 *  helpers as the other platforms; `subreddit` carries the @author label so the
 *  shared analyzer/render schema works unchanged. */
function collectXMarketTalkSignals(marketingBrief = {}, { limit = 12 } = {}) {
  const reportSnapshot = marketingBrief?.reportSnapshot || {};
  const test = reportSnapshot?.platformTests?.xMarketTalk || {};
  const signals = arr(test.items).map((item) => normalizeRedditSignal({
    ...item,
    subreddit: item.handle || item.tag || 'x',
  }, 'x-market-talk'));
  return dedupeSignals(signals, limit);
}

module.exports = {
  collectRedditSignals,
  collectInstagramSignals,
  collectXMarketTalkSignals,
  normalizeRedditSignal,
  filterRelevantSignals,
  relevanceScore,
};
