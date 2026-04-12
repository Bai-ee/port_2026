'use strict';

// site-fetcher.js — Lightweight website evidence extractor
//
// Strategy:
//   1. Fetch the homepage
//   2. Discover up to MAX_ADDITIONAL_PAGES linked pages (about, pricing, services, contact)
//   3. Fetch those pages in parallel
//   4. Extract structured evidence from each page using regex (no external HTML parser)
//
// Returns a compact SiteEvidence object ready for LLM synthesis.
//
// All fetches are timeout-guarded (FETCH_TIMEOUT_MS).
// Failures are non-fatal — pages that fail are logged in warnings[].
// thin=true is set when extracted content is very sparse (JS SPA or parked domain).

const FETCH_TIMEOUT_MS = 8000;
const MAX_ADDITIONAL_PAGES = 3;
const MAX_H2 = 10;
const MAX_CTA = 6;
const MAX_BODY_PARAGRAPHS = 8;
const MIN_PARAGRAPH_LENGTH = 40;
const MAX_PARAGRAPH_LENGTH = 600;
const THIN_CONTENT_THRESHOLD = 200; // total chars of headings+paragraphs below which we flag as thin

// Pages we want to fetch beyond the homepage, in priority order
const ADDITIONAL_PAGE_PATTERNS = [
  { pattern: /\/(about|about-us|our-story|who-we-are)\b/i, type: 'about' },
  { pattern: /\/(pricing|plans|packages|rates)\b/i, type: 'pricing' },
  { pattern: /\/(services|what-we-do|solutions|offerings|work)\b/i, type: 'services' },
  { pattern: /\/(contact|contact-us|get-in-touch|reach-us)\b/i, type: 'contact' },
];

// ── HTML helpers ──────────────────────────────────────────────────────────────

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

// ── Extraction functions ──────────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 200) : '';
}

function extractMetaDescription(html) {
  // Both attribute orderings
  const m =
    html.match(/<meta[^>]*name\s*=\s*['"]description['"][^>]*content\s*=\s*['"]([^'"]{0,600})['"]/i) ||
    html.match(/<meta[^>]*content\s*=\s*['"]([^'"]{0,600})['"][^>]*name\s*=\s*['"]description['"]/i);
  return m ? decodeEntities(m[1].trim()) : '';
}

function extractHeadings(html, level) {
  const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (text.length > 2 && text.length < 200) results.push(text.slice(0, 150));
  }
  return results;
}

function extractNavLabels(html) {
  // Try <nav> first, fall back to common nav class patterns
  const navMatch =
    html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i) ||
    html.match(/class=['"][^'"]*(?:nav|menu|header-nav|main-nav)[^'"]*['"][^>]*>([\s\S]*?)<\/(?:ul|div|header)>/i);

  if (!navMatch) return [];

  const re = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  const results = [];
  let m;
  while ((m = re.exec(navMatch[1])) !== null) {
    const text = stripTags(m[1]);
    if (text.length > 1 && text.length < 50) results.push(text);
  }
  return [...new Set(results)].slice(0, 14);
}

function extractCtaTexts(html) {
  const CTA_TRIGGER = /\b(get|start|try|sign\s*up|join|book|schedule|learn\s*more|contact|free|demo|buy|shop|order|request|apply|register|subscribe|download|explore|see\s*how)\b/i;
  const re = /<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi;
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (text.length > 2 && text.length < 80 && CTA_TRIGGER.test(text)) {
      results.push(text.slice(0, 80));
    }
  }
  return [...new Set(results)].slice(0, MAX_CTA);
}

function extractBodyParagraphs(html) {
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (text.length >= MIN_PARAGRAPH_LENGTH && text.length <= MAX_PARAGRAPH_LENGTH) {
      results.push(text.slice(0, 300));
    }
  }
  return results.slice(0, MAX_BODY_PARAGRAPHS);
}

function extractSocialLinks(html) {
  const re = /href\s*=\s*['"]([^'"]*(?:twitter\.com|x\.com|instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com|pinterest\.com)[^'"]*)['"]/gi;
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1]);
      // Skip generic domain roots (e.g. just twitter.com with no path)
      if (url.pathname && url.pathname !== '/') results.push(url.toString().replace(/\/$/, ''));
    } catch {
      // skip malformed URLs
    }
  }
  return [...new Set(results)].slice(0, 8);
}

function extractContactClues(html) {
  const clues = [];

  // Email addresses (skip placeholder patterns)
  const emailRe = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
  const PLACEHOLDER_EMAIL = /example\.|yourdomain|placeholder|test@/i;
  let m;
  while ((m = emailRe.exec(html)) !== null) {
    if (!PLACEHOLDER_EMAIL.test(m[1])) clues.push(`email:${m[1]}`);
  }

  // US/CA phone numbers (rough)
  const phoneRe = /\b(\+?1?\s*[-.]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
  while ((m = phoneRe.exec(html)) !== null) {
    const cleaned = m[1].replace(/\s+/g, '');
    clues.push(`phone:${cleaned}`);
  }

  return [...new Set(clues)].slice(0, 4);
}

// ── Page discovery ────────────────────────────────────────────────────────────

/**
 * Find same-origin links matching the additional page patterns.
 * Returns [ { type, url } ] in pattern priority order, deduplicated by type.
 */
function discoverAdditionalPages(html, baseUrl) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const hrefRe = /href\s*=\s*['"]([^'"#][^'"]*)['"]/gi;
  const found = new Map(); // type → url (first match wins per type)
  let m;

  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1].trim();
    for (const { pattern, type } of ADDITIONAL_PAGE_PATTERNS) {
      if (found.has(type)) continue;
      if (!pattern.test(href)) continue;
      try {
        const resolved = new URL(href, base);
        if (resolved.hostname === base.hostname) {
          found.set(type, resolved.toString());
        }
      } catch {
        // skip
      }
    }
  }

  // Return in the original pattern priority order
  return ADDITIONAL_PAGE_PATTERNS
    .filter(({ type }) => found.has(type))
    .map(({ type }) => ({ type, url: found.get(type) }));
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchPage(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrandintelBot/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, status: res.status, html: null, reason: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { ok: false, status: res.status, html: null, reason: 'non-html response' };
    }

    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? 'timeout' : (err.message || 'fetch error');
    return { ok: false, status: 0, html: null, reason };
  }
}

// ── Page evidence builder ─────────────────────────────────────────────────────

function buildPageEvidence(url, type, html) {
  return {
    url,
    type,
    title: extractTitle(html),
    metaDescription: extractMetaDescription(html),
    h1: extractHeadings(html, 1),
    h2: extractHeadings(html, 2).slice(0, MAX_H2),
    navLabels: extractNavLabels(html),
    ctaTexts: extractCtaTexts(html),
    bodyParagraphs: extractBodyParagraphs(html),
    socialLinks: extractSocialLinks(html),
    contactClues: extractContactClues(html),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a site and extract structured evidence for LLM synthesis.
 *
 * @param {string} websiteUrl - The site to fetch (must include protocol)
 * @param {object} [options]
 * @param {function} [options.onPageFetched] - Called after each page is fetched.
 *   Signature: (type: string, url: string, pageEvidence: object) => void
 *   Fire-and-forget — the fetcher does not await this.
 * @returns {Promise<SiteEvidence>}
 */
async function fetchSiteEvidence(websiteUrl, { onPageFetched } = {}) {
  const fetchedAt = new Date().toISOString();
  const pages = [];
  const warnings = [];

  // Step 1 — Homepage
  const homepageFetch = await fetchPage(websiteUrl);

  if (!homepageFetch.ok || !homepageFetch.html) {
    return {
      url: websiteUrl,
      fetchedAt,
      pages: [],
      warnings: [`Homepage fetch failed: ${homepageFetch.reason || 'unknown error'}`],
      thin: true,
    };
  }

  const homepageEvidence = buildPageEvidence(websiteUrl, 'homepage', homepageFetch.html);
  pages.push(homepageEvidence);
  // Emit homepage progress — fire-and-forget, never throws to fetcher
  if (onPageFetched) { try { onPageFetched('homepage', websiteUrl, homepageEvidence); } catch { /* ignore */ } }

  // Step 2 — Discover and fetch additional pages in parallel
  const additionalLinks = discoverAdditionalPages(homepageFetch.html, websiteUrl)
    .slice(0, MAX_ADDITIONAL_PAGES);

  if (additionalLinks.length > 0) {
    const additionalResults = await Promise.allSettled(
      additionalLinks.map(({ type, url }) =>
        fetchPage(url).then((result) => {
          if (!result.ok || !result.html) {
            warnings.push(`${type} page (${url}) failed: ${result.reason}`);
            return { type, url, result, pageEvidence: null };
          }
          const pageEvidence = buildPageEvidence(url, type, result.html);
          // Emit per-page progress — fire-and-forget
          if (onPageFetched) { try { onPageFetched(type, url, pageEvidence); } catch { /* ignore */ } }
          return { type, url, result, pageEvidence };
        })
      )
    );

    for (const settled of additionalResults) {
      if (settled.status !== 'fulfilled') continue;
      const { pageEvidence } = settled.value;
      if (pageEvidence) pages.push(pageEvidence);
    }
  }

  // Step 3 — Flag thin content
  const totalContentChars = pages
    .flatMap((p) => [...p.h1, ...p.h2, ...p.bodyParagraphs])
    .join(' ')
    .length;

  const thin = totalContentChars < THIN_CONTENT_THRESHOLD;
  if (thin) {
    warnings.push(
      'Very little static content detected — site may be JS-rendered or have minimal copy.'
    );
  }

  return {
    url: websiteUrl,
    fetchedAt,
    pages,
    warnings,
    thin,
  };
}

module.exports = { fetchSiteEvidence };
