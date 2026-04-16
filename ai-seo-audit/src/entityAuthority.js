// entityAuthority.js — Entity authority signals: Wikidata QID lookup + NAP consistency.
//
// Wikidata etiquette:
//   - Descriptive User-Agent on every request
//   - In-memory QID cache for the duration of one audit run (no re-queries)
//
// Public API:
//   analyzeEntityAuthority({ orgData, html, signal })
//     → { score, wikidataFound, qid, wikidataUrl, wikipediaUrl, napConsistent, napIssues }

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const UA = 'BballiAiSeoAudit/1.0 (mailto:bryanballi@gmail.com)';

// Per-run in-memory cache. Keys:
//   "search:<query>"  → QID string | null
//   "entity:<qid>"    → { qid, wikidataUrl, wikipediaUrl } | null
const _cache = new Map();

// ── Wikidata helpers ──────────────────────────────────────────────────────────

async function wikidataFetch(url, signal) {
  try {
    const res = await fetch(url, { signal, headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function searchWikidata(query, signal) {
  const key = `search:${query}`;
  if (_cache.has(key)) return _cache.get(key);

  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=1`;
  const data = await wikidataFetch(url, signal);
  const qid  = data?.search?.[0]?.id || null;
  _cache.set(key, qid);
  return qid;
}

// Resolve a QID from a sameAs URL (wikidata.org/wiki/Q… or wikipedia.org/wiki/…)
async function resolveQidFromSameAs(url, signal) {
  // Direct Wikidata URL: https://www.wikidata.org/wiki/Q12345
  const wd = url.match(/wikidata\.org\/(?:wiki|entity)\/([Qq]\d+)/);
  if (wd) return wd[1].toUpperCase();

  // Wikipedia URL → search by page title
  const wp = url.match(/wikipedia\.org\/wiki\/(.+)/);
  if (wp) {
    const title = decodeURIComponent(wp[1]).replace(/_/g, ' ');
    return searchWikidata(title, signal);
  }

  return null;
}

async function lookupQidDetails(qid, signal) {
  const key = `entity:${qid}`;
  if (_cache.has(key)) return _cache.get(key);

  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=enwiki&format=json`;
  const data = await wikidataFetch(url, signal);

  const enwikiTitle = data?.entities?.[qid]?.sitelinks?.enwiki?.title || null;
  const result = {
    qid,
    wikidataUrl:  `https://www.wikidata.org/wiki/${qid}`,
    wikipediaUrl: enwikiTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwikiTitle)}`
      : null,
  };
  _cache.set(key, result);
  return result;
}

// ── NAP consistency ───────────────────────────────────────────────────────────

function checkNap(orgData, html) {
  if (!orgData) return { napConsistent: true, napIssues: [] };

  const $ = cheerio.load(html);
  const bodyText = $('body').text().toLowerCase();
  const issues   = [];

  // Name
  const name = orgData.name;
  if (name && typeof name === 'string' && name.trim().length > 2) {
    if (!bodyText.includes(name.toLowerCase().trim())) {
      issues.push(`Organization name "${name}" not found in page body`);
    }
  }

  // Telephone
  const phone = orgData.telephone;
  if (phone && typeof phone === 'string') {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 7) {
      const last10 = digits.slice(-10);
      const bodyDigits = bodyText.replace(/\D/g, '');
      if (!bodyDigits.includes(last10)) {
        issues.push(`Phone "${phone}" from schema not found in page body`);
      }
    }
  }

  // Address street
  const addr = orgData.address;
  if (addr) {
    const street =
      typeof addr === 'string' ? addr : (addr.streetAddress || '');
    if (street.length > 5) {
      const snippet = street.toLowerCase().slice(0, 20).trim();
      if (snippet && !bodyText.includes(snippet)) {
        issues.push(`Address "${street}" from schema not found in page body`);
      }
    }
  }

  return { napConsistent: issues.length === 0, napIssues: issues };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeEntityAuthority({ orgData, html, signal }) {
  let wikidataFound = false;
  let qid           = null;
  let wikidataUrl   = null;
  let wikipediaUrl  = null;

  // Try sameAs links first
  const sameAs = orgData?.sameAs;
  const sameAsArr = sameAs
    ? (Array.isArray(sameAs) ? sameAs : [sameAs]).filter(Boolean)
    : [];

  for (const url of sameAsArr) {
    const resolved = await resolveQidFromSameAs(String(url), signal).catch(() => null);
    if (resolved) { qid = resolved; break; }
  }

  // Fallback: name search
  if (!qid && orgData?.name && typeof orgData.name === 'string') {
    qid = await searchWikidata(orgData.name.trim(), signal).catch(() => null);
  }

  if (qid) {
    const details = await lookupQidDetails(qid, signal).catch(() => null);
    if (details) {
      wikidataFound = true;
      wikidataUrl   = details.wikidataUrl;
      wikipediaUrl  = details.wikipediaUrl;
    }
  }

  const { napConsistent, napIssues } = checkNap(orgData, html);

  // Score: Wikidata 50pts + Wikipedia 20pts + NAP 30pts
  let score = 0;
  if (wikidataFound) score += 50;
  if (wikipediaUrl)  score += 20;
  if (napConsistent) score += 30;

  return { score, wikidataFound, qid, wikidataUrl, wikipediaUrl, napConsistent, napIssues };
}
