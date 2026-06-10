'use strict';

// news-monitor.js — Phase 1 brand monitoring (Tier A).
//
// Adds real news coverage to the brief's brandMentions using GDELT's free Doc
// 2.0 API (no key, no per-call cost). This complements Claude's sampled
// web_search: GDELT indexes a very broad set of news sources, so it catches
// coverage the top-N web search may miss. Best-effort — any failure is
// swallowed so the brief proceeds unchanged.
//
// Output items match the agentData.brandMentions shape so they merge straight in:
//   { source, author, content, sentiment, reach, url }

const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Build a GDELT query from the brand name + exact identifiers. */
function buildQuery({ brandName, brandKeywords }) {
  const terms = [];
  const add = (t) => {
    const s = String(t || '').replace(/^["']|["']$/g, '').trim();
    if (s && s.length >= 2 && !terms.some((x) => x.toLowerCase() === s.toLowerCase())) terms.push(s);
  };
  add(brandName);
  (Array.isArray(brandKeywords) ? brandKeywords : []).forEach(add);
  const quoted = terms.slice(0, 6).map((t) => `"${t}"`);
  if (!quoted.length) return '';
  return quoted.length === 1 ? quoted[0] : `(${quoted.join(' OR ')})`;
}

/**
 * Fetch recent news mentions for a brand.
 *
 * @param {object} options
 * @param {string}   options.brandName
 * @param {string[]} [options.brandKeywords]  - exact identifiers (may be quoted)
 * @param {number}   [options.lookbackDays=1]  - 1..7
 * @param {number}   [options.maxRecords=20]
 * @returns {Promise<Array>} brandMentions-shaped items (possibly empty)
 */
async function fetchBrandNews({ brandName, brandKeywords = [], lookbackDays = 1, maxRecords = 20 } = {}) {
  const query = buildQuery({ brandName, brandKeywords });
  if (!query) return [];
  const days = Math.min(7, Math.max(1, Number(lookbackDays) || 1));
  const url = `${GDELT_DOC}?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=${maxRecords}&sort=DateDesc&timespan=${days}d`;

  let data;
  try {
    // GDELT throttles to ~1 req / 5s per IP; a 429 just means we skip news this
    // run (res.ok false → []). UA set for good citizenship.
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HitLoopBrief/1.0 (+https://hitloop.agency)' },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return []; // network/timeout/parse — non-fatal
  }

  const articles = Array.isArray(data?.articles) ? data.articles : [];
  const seen = new Set();
  const items = [];
  for (const a of articles) {
    const url = String(a?.url || '').trim();
    const title = String(a?.title || '').trim();
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    items.push({
      source: a.domain || 'news',
      author: a.domain || '',
      content: title,
      sentiment: 'neutral', // GDELT ArtList has no per-article tone; Phase 2 can add it
      reach: 'medium',
      url,
      _origin: 'gdelt-news',
    });
  }
  return items;
}

module.exports = { fetchBrandNews, buildQuery };
