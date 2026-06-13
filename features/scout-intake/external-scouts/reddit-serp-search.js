'use strict';

// reddit-serp-search.js — Credential-free Reddit signals via search-engine
// indexing (DuckDuckGo HTML). Google/DDG still index Reddit heavily, so a
// `site:reddit.com <term>` query returns real threads — the practical path now
// that Reddit's API is paywalled (HTTP 402) and Claude web_search / Exa cannot
// reach Reddit. No API key, no credits.
//
// Tradeoff: DuckDuckGo IP-rate-limits rapid requests (HTTP 202). We throttle
// between queries and back off + retry on a block, and we report a block as a
// distinct "rate-limited" error so the caller never mislabels it as "no results".

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DDG_URL = 'https://html.duckduckgo.com/html/?q=';
const DELAY_MS = 2500;   // between queries — DDG throttles aggressively
const RETRY_MS = 3000;   // backoff before a single retry on a 202 block
const MAX_MENTION_QUERIES = 2;
const MAX_OPP_QUERIES = 3;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — blunts rate-limiting on repeat clicks

const SOURCE_LABEL = 'DuckDuckGo (site:reddit.com)';

// In-process result cache. Survives across requests in the same node process
// (persists through Next dev HMR for CJS modules). Keyed by client + query set.
const cache = new Map(); // key -> { report, ts }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function parseDDG(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    const u = href.match(/uddg=([^&]+)/);
    if (u) { try { href = decodeURIComponent(u[1]); } catch { /* keep raw */ } }
    if (!/reddit\.com/i.test(href)) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    const sn = (m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const snippet = decodeEntities(sn.replace(/<[^>]+>/g, '')).trim();
    if (title) out.push({ title, url: href, snippet });
  }
  return out;
}

const subredditOf = (url) => (url.match(/reddit\.com\/(r\/[A-Za-z0-9_]+)/) || [])[1] || 'reddit';
const isThread = (url) => /\/comments\//.test(url);

// Returns { blocked: boolean, results: [...] }
async function ddgSearch(term) {
  const url = DDG_URL + encodeURIComponent(`site:reddit.com ${term}`);
  const attempt = async () => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      if (res.status === 200) return { blocked: false, results: parseDDG(await res.text()) };
      // 202 (and other non-200) from DDG html = soft block / rate limit
      return { blocked: true, results: [] };
    } catch {
      return { blocked: true, results: [] };
    }
  };
  let r = await attempt();
  if (r.blocked) { await sleep(RETRY_MS); r = await attempt(); } // one backoff retry
  return r;
}

/**
 * Pull Reddit signals via search indexing. Same report shape as the other
 * reddit fetchers so callers can consume it interchangeably.
 *
 * @returns {Promise<{ ok, report, cost, error }>}
 */
async function runRedditSerpSearch({ clientId, redditConfig = {} }) {
  const mention = (Array.isArray(redditConfig.mentionQueries) ? redditConfig.mentionQueries : []).filter(Boolean);
  const brand   = (Array.isArray(redditConfig.brandTerms) ? redditConfig.brandTerms : []).filter(Boolean);
  const opp     = (Array.isArray(redditConfig.opportunityQueries) ? redditConfig.opportunityQueries : []).filter(Boolean);

  const mentionTerms = (mention.length ? mention : brand).slice(0, MAX_MENTION_QUERIES);
  const oppTerms = opp.slice(0, MAX_OPP_QUERIES);
  if (!mentionTerms.length && !oppTerms.length) {
    return { ok: false, report: null, cost: 0, error: 'no reddit queries configured', meta: { source: SOURCE_LABEL } };
  }

  const allTerms = [...mentionTerms, ...oppTerms];
  const cacheKey = JSON.stringify({ c: clientId, m: mentionTerms, o: oppTerms });
  const now = Date.now();

  // Fresh cache hit — skip the network entirely (avoids re-triggering blocks).
  const hit = cache.get(cacheKey);
  if (hit && (now - hit.ts) < CACHE_TTL_MS) {
    return { ok: true, report: hit.report, cost: 0, meta: { source: SOURCE_LABEL, terms: allTerms, queriesRun: 0, cached: true, cacheAgeMs: now - hit.ts } };
  }

  const seen = new Set();
  let anyBlocked = false;
  let queriesRun = 0;

  const collect = async (terms) => {
    const acc = [];
    for (const t of terms) {
      if (queriesRun > 0) await sleep(DELAY_MS); // throttle between queries
      const { blocked, results } = await ddgSearch(t);
      queriesRun += 1;
      if (blocked) { anyBlocked = true; continue; }
      for (const r of results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        acc.push(r);
      }
    }
    return acc;
  };

  const mentionsRaw = await collect(mentionTerms);
  const oppsRaw = await collect(oppTerms);

  const mentions = mentionsRaw.slice(0, 8).map((r) => ({
    title: r.title, url: r.url, subreddit: subredditOf(r.url), summary: r.snippet, insight: '',
  }));
  const participationOpportunities = oppsRaw.slice(0, 10).map((r) => ({
    title: r.title, url: r.url, subreddit: subredditOf(r.url), summary: r.snippet,
    opportunityType: isThread(r.url) ? 'participation_opportunity' : 'recommendation_thread', whyRelevant: '',
  }));

  const found = mentions.length + participationOpportunities.length;
  const baseMeta = { source: SOURCE_LABEL, terms: allTerms, queriesRun, blocked: anyBlocked, cached: false };

  // Nothing fresh found and at least one query was blocked. If we have a stale
  // cached result, serve it (labelled) rather than failing; otherwise surface
  // the rate-limit clearly so it isn't mistaken for a genuine "no results".
  if (found === 0 && anyBlocked) {
    if (hit) {
      return { ok: true, report: hit.report, cost: 0, meta: { ...baseMeta, cached: true, stale: true, cacheAgeMs: now - hit.ts, note: 'Live search rate-limited — showing last cached results.' } };
    }
    return { ok: false, report: null, cost: 0, error: 'Search engine rate-limited the request — retry in a moment.', meta: baseMeta };
  }

  const report = {
    clientId,
    provider:                         'serp',
    status:                           'connected',
    fetchedAt:                        new Date().toISOString(),
    mentionCount:                     mentions.length,
    newMentionCount:                  mentions.length,
    participationOpportunityCount:    participationOpportunities.length,
    newParticipationOpportunityCount: participationOpportunities.length,
    mentions,
    participationOpportunities,
    subreddits:                       redditConfig.subreddits || [],
  };
  cache.set(cacheKey, { report, ts: now });
  const note = found === 0 ? 'No Reddit results indexed for these terms.' : undefined;
  return { ok: true, report, cost: 0, meta: { ...baseMeta, note } };
}

module.exports = { runRedditSerpSearch };
