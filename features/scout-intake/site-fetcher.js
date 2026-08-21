'use strict';

const { readResponseText, readResponseBuffer, safeFetch, validateUrl: _ssrfValidate } = require('../../api/_lib/safe-fetch.cjs');
const { fetchBrowserlessContent } = require('../../api/_lib/browserless.cjs');
const sharp = require('sharp');

// site-fetcher.js — Lightweight website evidence extractor
//
// Strategy:
//   1. Fetch the homepage
//   2. Discover up to MAX_ADDITIONAL_PAGES linked pages (about, pricing, services, contact)
//   3. Fetch those pages in parallel
//   4. Extract structured evidence from each page using regex (no external HTML parser)
//   5. Rendered fallback (Phase 1, see docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md):
//      any page whose static read is thin, or that looks like an un-hydrated SPA
//      shell, gets one Browserless `/content` render attempt (hard-capped per run).
//      A successful, content-improving render REPLACES that page's primary fields;
//      the static read is preserved under `staticView` (Phase 2 needs both).
//
// Returns a compact SiteEvidence object ready for LLM synthesis.
//
// All fetches are timeout-guarded (FETCH_TIMEOUT_MS).
// Failures are non-fatal — pages that fail are logged in warnings[].
// thin=true is set when extracted content is very sparse (JS SPA or parked domain),
// recomputed AFTER any rendered fallback so a successful render clears it.

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ADDITIONAL_PAGES = 3;
const MAX_H2 = 10;
const MAX_CTA = 6;
const MAX_BODY_PARAGRAPHS = 8;
const MIN_PARAGRAPH_LENGTH = 40;
const MAX_PARAGRAPH_LENGTH = 600;
const THIN_CONTENT_THRESHOLD = 200; // total chars of headings+paragraphs below which we flag as thin

// Rendered fallback — hard cap independent of MAX_ADDITIONAL_PAGES so a future
// bump to page discovery can never silently uncap Browserless spend.
const MAX_RENDERED_FETCHES_PER_RUN = 4;
// A sub-10KB document whose hydration root is empty is the master prompt's
// SPA-shell signature (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3
// Phase 1) — thin-content alone can also be a genuinely sparse but real static
// page, so this catches the case where static extraction found *something* but
// the document itself is a client-hydration shell.
const SPA_SHELL_MAX_BYTES = 10 * 1024;
const SPA_SHELL_ROOT_RE = /<div[^>]*\bid\s*=\s*["'](?:root|app|__next|___gatsby)["'][^>]*>\s*<\/div>/i;
const RENDER_VARIANT = { id: 'scout-intake-site-fetch', label: 'Scout intake rendered fallback' };

// Phase 2 (docs/plans/BRIEF-RENDERED-SCRAPE-SONNET-HANDOFF.md §3): the master
// prompt's L3 "inspect the artifact" rule applied to og:image — resolving is
// not a pass, fetch it and record what it is.
const MAX_OG_IMAGE_BYTES = 5 * 1024 * 1024;

// robotsSitemapProbe/screenshots never run inside site-fetcher.js itself —
// they are separate modules (agent-readiness / the parallel screenshot task
// in runner.js). Honest default: 'skipped' unless a caller that DOES have
// that data this run passes it in via coverageOverrides.
const ROBOTS_SITEMAP_SKIP_REASON = 'robots/sitemap probe runs as a separate agent-readiness module, not part of this fetch stage';
const SCREENSHOTS_SKIP_REASON = 'screenshot capture runs as a separate parallel task (api/_lib/browserless.cjs), not part of this fetch stage';

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

// CTA detection signals. A candidate needs at least one of these — the word
// list alone used to be the only gate, which missed every product-specific CTA
// ("Mine", "Play Game", "Connect Wallet", "Stake") and left newsletter
// "Subscribe" as the only captured CTA on real sites.
const CTA_TRIGGER = /\b(get|get\s*started|start|try|sign\s*up|sign\s*in|log\s*in|join|book|schedule|learn\s*more|read\s*more|see\s*how|contact|call|quote|free|demo|buy|shop|order|checkout|request|apply|register|subscribe|download|explore|discover|view|watch|play|enter|open|launch|connect|claim|stake|mine|mint|swap|trade|earn|invest|donate|upgrade|install|create|build)\b/i;
// role="button" / class="…btn…|…cta…" — the markup shape of a styled CTA that
// is an <a>, not a <button>.
const CTA_ELEMENT_HINT = /(?:role\s*=\s*['"]button['"]|class\s*=\s*['"][^'"]*(?:\bbtn\b|button|\bcta\b|call-to-action)[^'"]*['"])/i;
// Conversion-shaped destinations.
const CTA_HREF_HINT = /href\s*=\s*['"][^'"]*\/(?:signup|sign-up|register|get-started|start|demo|book|booking|contact|pricing|buy|checkout|cart|shop|order|apply|subscribe|download|join|trial|app|play|game|mint|stake|mine|pre-mine|launch|dashboard)\b/i;

/**
 * Pull CTA-ish labels out of raw HTML.
 *
 * A candidate is any <a> or <button>. It is kept when the element LOOKS like a
 * CTA (a <button>, role="button", a btn/cta class, or a conversion-shaped href)
 * OR its label reads like one (CTA_TRIGGER). Label text comes from the visible
 * inner text; when that is empty (icon-only) or too long to be a label (an
 * anchor wrapping a whole hero block), the element's aria-label is used
 * instead. Results are ranked so word+shape matches land before shape-only
 * matches — the cap is small and nav/footer buttons should not crowd out the
 * real primary CTAs.
 */
function extractCtaTexts(html) {
  const re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const candidates = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2] || '';
    const innerText = stripTags(m[3]);
    const ariaMatch = attrs.match(/aria-label\s*=\s*['"]([^'"]{2,80})['"]/i);
    const aria = ariaMatch ? decodeEntities(ariaMatch[1]).trim() : '';
    const usable = (t) => t.length > 2 && t.length <= 80;
    const text = usable(innerText) ? innerText : (usable(aria) ? aria : '');
    if (!text) continue;
    if (/^https?:\/\//i.test(text)) continue; // bare URL, not a label

    const byWord = CTA_TRIGGER.test(text);
    const byShape = m[1].toLowerCase() === 'button'
      || CTA_ELEMENT_HINT.test(attrs)
      || CTA_HREF_HINT.test(attrs);
    if (!byWord && !byShape) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // 0 = word + CTA markup, 1 = CTA wording only, 2 = CTA markup only
    candidates.push({ text: text.slice(0, 80), rank: byWord && byShape ? 0 : (byWord ? 1 : 2) });
  }
  return candidates
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i) // stable: document order within a rank
    .slice(0, MAX_CTA)
    .map((c) => c.text);
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

// JSON-LD @type extraction — regex script-block extraction (no HTML parser
// needed: script contents are JSON, not markup), JSON.parse per block. A
// malformed block is skipped, never thrown — one bad script tag must not lose
// types found in other, valid script tags on the same page.
function collectJsonLdTypes(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, out);
    return;
  }
  if (Array.isArray(node['@graph'])) {
    for (const item of node['@graph']) collectJsonLdTypes(item, out);
  }
  const t = node['@type'];
  if (typeof t === 'string' && t.trim()) {
    out.add(t.trim());
  } else if (Array.isArray(t)) {
    for (const v of t) if (typeof v === 'string' && v.trim()) out.add(v.trim());
  }
}

/** Distinct schema.org @type values declared anywhere in the page's JSON-LD. */
function extractJsonLdTypes(html) {
  if (!html) return [];
  const re = /<script[^>]*type\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  const types = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed JSON-LD — skip this block, keep scanning
    }
    collectJsonLdTypes(parsed, types);
  }
  return [...types].slice(0, 20);
}

// og:*/twitter:* tag PRESENCE (names only, never values) — feeds the crawler-
// parity "social meta set" comparison. Distinct from extractSiteMeta, which
// resolves specific field VALUES for the homepage only; this scans any page's
// raw HTML for which tags exist at all.
function extractSocialMetaKeys(html) {
  if (!html) return [];
  const re = /<meta[^>]*(?:property|name)\s*=\s*['"](og:[a-z0-9:_-]+|twitter:[a-z0-9:_-]+)['"]/gi;
  const keys = new Set();
  let m;
  while ((m = re.exec(html)) !== null) keys.add(m[1].toLowerCase());
  return [...keys].sort();
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

// ── Site meta (OG / social / brand graphics) — homepage only ─────────────────

/**
 * Extract OG, Twitter Card, and brand identity metadata from raw HTML.
 * All URLs are resolved against baseUrl. Fields not found are null.
 * Only called for the homepage page evidence — other pages skip this.
 *
 * @param {string} html    - Raw HTML of the homepage
 * @param {string} baseUrl - Absolute URL used to resolve relative hrefs
 * @returns {object} siteMeta
 */
function extractSiteMeta(html, baseUrl) {
  // Try each pattern in order; return the first non-empty content value.
  function metaContent(patterns) {
    for (const re of patterns) {
      const m = html.match(re);
      const val = m?.[1]?.trim();
      if (val) return decodeEntities(val);
    }
    return null;
  }

  function resolveUrl(href) {
    if (!href) return null;
    try { return new URL(href, baseUrl).toString(); } catch { return null; }
  }

  // ── title ─────────────────────────────────────────────────────────────────
  const title =
    metaContent([
      /<meta[^>]*property\s*=\s*['"]og:title['"][^>]*content\s*=\s*['"]([^'"]{1,300})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,300})['"][^>]*property\s*=\s*['"]og:title['"]/i,
      /<meta[^>]*name\s*=\s*['"]twitter:title['"][^>]*content\s*=\s*['"]([^'"]{1,300})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,300})['"][^>]*name\s*=\s*['"]twitter:title['"]/i,
    ]) || extractTitle(html) || null;

  // ── description ───────────────────────────────────────────────────────────
  const description =
    metaContent([
      /<meta[^>]*property\s*=\s*['"]og:description['"][^>]*content\s*=\s*['"]([^'"]{1,600})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,600})['"][^>]*property\s*=\s*['"]og:description['"]/i,
      /<meta[^>]*name\s*=\s*['"]twitter:description['"][^>]*content\s*=\s*['"]([^'"]{1,600})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,600})['"][^>]*name\s*=\s*['"]twitter:description['"]/i,
    ]) || extractMetaDescription(html) || null;

  // ── siteName ──────────────────────────────────────────────────────────────
  const siteName =
    metaContent([
      /<meta[^>]*property\s*=\s*['"]og:site_name['"][^>]*content\s*=\s*['"]([^'"]{1,200})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,200})['"][^>]*property\s*=\s*['"]og:site_name['"]/i,
    ]) || (() => { try { return new URL(baseUrl).hostname; } catch { return null; } })();

  // ── ogImage ───────────────────────────────────────────────────────────────
  const ogImageRaw = metaContent([
    /<meta[^>]*property\s*=\s*['"]og:image['"][^>]*content\s*=\s*['"]([^'"]{4,1000})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{4,1000})['"][^>]*property\s*=\s*['"]og:image['"]/i,
    /<meta[^>]*property\s*=\s*['"]og:image:secure_url['"][^>]*content\s*=\s*['"]([^'"]{4,1000})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{4,1000})['"][^>]*property\s*=\s*['"]og:image:secure_url['"]/i,
    /<meta[^>]*name\s*=\s*['"]twitter:image['"][^>]*content\s*=\s*['"]([^'"]{4,1000})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{4,1000})['"][^>]*name\s*=\s*['"]twitter:image['"]/i,
  ]);
  const ogImage = resolveUrl(ogImageRaw);

  // ── ogImageAlt ────────────────────────────────────────────────────────────
  const ogImageAlt = metaContent([
    /<meta[^>]*property\s*=\s*['"]og:image:alt['"][^>]*content\s*=\s*['"]([^'"]{1,300})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{1,300})['"][^>]*property\s*=\s*['"]og:image:alt['"]/i,
    /<meta[^>]*name\s*=\s*['"]twitter:image:alt['"][^>]*content\s*=\s*['"]([^'"]{1,300})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{1,300})['"][^>]*name\s*=\s*['"]twitter:image:alt['"]/i,
  ]);

  // ── favicon — only from link[rel=icon] tags; never guess /favicon.ico ────
  let favicon = null;
  // Try rel-first ordering, then href-first ordering
  const faviconPatterns = [
    /<link[^>]*rel\s*=\s*['"][^'"]*(?:shortcut\s+)?icon[^'"]*['"][^>]*href\s*=\s*['"]([^'"]+)['"]/gi,
    /<link[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*rel\s*=\s*['"][^'"]*(?:shortcut\s+)?icon[^'"]*['"]/gi,
  ];
  for (const re of faviconPatterns) {
    if (favicon) break;
    let fm;
    while ((fm = re.exec(html)) !== null) {
      const resolved = resolveUrl(fm[1].trim());
      if (resolved) { favicon = resolved; break; }
    }
  }

  // ── appleTouchIcon — prefer largest declared size ─────────────────────────
  let appleTouchIcon = null;
  let bestSize = -1;
  const aticRe = /<link[^>]*rel\s*=\s*['"]apple-touch-icon(?:-precomposed)?['"][^>]*>/gi;
  let aim;
  while ((aim = aticRe.exec(html)) !== null) {
    const tag = aim[0];
    const hrefM = tag.match(/href\s*=\s*['"]([^'"]+)['"]/i);
    if (!hrefM) continue;
    const sizesM = tag.match(/sizes\s*=\s*['"](\d+)x\d+['"]/i);
    const size = sizesM ? parseInt(sizesM[1], 10) : 0;
    if (size >= bestSize) {
      bestSize = size;
      appleTouchIcon = resolveUrl(hrefM[1].trim());
    }
  }

  // ── themeColor ────────────────────────────────────────────────────────────
  const themeColor = metaContent([
    /<meta[^>]*name\s*=\s*['"]theme-color['"][^>]*content\s*=\s*['"]([^'"]{1,50})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{1,50})['"][^>]*name\s*=\s*['"]theme-color['"]/i,
  ]);

  // ── canonical ─────────────────────────────────────────────────────────────
  const canonicalRaw = (() => {
    const m =
      html.match(/<link[^>]*rel\s*=\s*['"]canonical['"][^>]*href\s*=\s*['"]([^'"]+)['"]/i) ||
      html.match(/<link[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*rel\s*=\s*['"]canonical['"]/i);
    return m?.[1] || null;
  })();
  const canonical = resolveUrl(canonicalRaw);

  // ── locale ────────────────────────────────────────────────────────────────
  const locale =
    metaContent([
      /<meta[^>]*property\s*=\s*['"]og:locale['"][^>]*content\s*=\s*['"]([^'"]{1,20})['"]/i,
      /<meta[^>]*content\s*=\s*['"]([^'"]{1,20})['"][^>]*property\s*=\s*['"]og:locale['"]/i,
    ]) || (() => { const m = html.match(/<html[^>]*lang\s*=\s*['"]([^'"]{1,20})['"]/i); return m?.[1] || null; })();

  // ── og:type ───────────────────────────────────────────────────────────────
  const ogType = metaContent([
    /<meta[^>]*property\s*=\s*['"]og:type['"][^>]*content\s*=\s*['"]([^'"]{1,50})['"]/i,
    /<meta[^>]*content\s*=\s*['"]([^'"]{1,50})['"][^>]*property\s*=\s*['"]og:type['"]/i,
  ]);

  return {
    title,
    description,
    siteName,
    ogImage,
    ogImageAlt,
    favicon,
    appleTouchIcon,
    themeColor,
    canonical,
    locale,
    type: ogType,
  };
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
  try {
    const res = await safeFetch(url, {
      timeoutMs,
      maxBytes: MAX_HTML_BYTES,
      fetchOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BrandintelBot/1.0)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, html: null, reason: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { ok: false, status: res.status, html: null, reason: 'non-html response' };
    }

    const html = await readResponseText(res, MAX_HTML_BYTES);
    return { ok: true, status: res.status, html };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : (err.message || 'fetch error');
    return { ok: false, status: 0, html: null, reason };
  }
}

// ── Page evidence builder ─────────────────────────────────────────────────────

function buildPageEvidence(url, type, html) {
  const jsonLdTypes = extractJsonLdTypes(html);
  const evidence = {
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
    // Phase 2: schema.org @type values declared in this page's JSON-LD.
    jsonLdTypes,
    // Raw HTML preserved for downstream CSS extraction (design-system-extractor.js).
    // Stripped before Firestore write by normalize.js — never persisted.
    _rawHtml: html,
  };

  // siteMeta is homepage-only: OG image, favicon, theme-color, etc.
  // Stored as a top-level field so it survives after _rawHtml is stripped.
  if (type === 'homepage') {
    evidence.siteMeta = { ...extractSiteMeta(html, url), jsonLdTypes };
  }

  return evidence;
}

// ── Rendered fallback (Phase 1) ─────────────────────────────────────────────────

/** Chars of extracted heading/body content for ONE page's static evidence. */
function pageContentChars(pageEvidence) {
  return [...pageEvidence.h1, ...pageEvidence.h2, ...pageEvidence.bodyParagraphs].join(' ').length;
}

/** A page's own static read is sparse — same measure as the run-level `thin` flag. */
function isPageThin(pageEvidence) {
  return pageContentChars(pageEvidence) < THIN_CONTENT_THRESHOLD;
}

/**
 * SPA-shell signature: a small HTML document with an empty client-hydration
 * root (React/Vue/Next/Gatsby). Static extraction on a page like this can
 * still clear THIN_CONTENT_THRESHOLD by accident (e.g. a stray footer string),
 * so this check fires independently of page thinness.
 */
function looksLikeSpaShell(html) {
  if (!html) return false;
  if (Buffer.byteLength(html, 'utf8') >= SPA_SHELL_MAX_BYTES) return false;
  return SPA_SHELL_ROOT_RE.test(html);
}

/** Trimmed static-read snapshot preserved on a page once a render replaces it. */
function buildStaticView(pageEvidence) {
  const view = {
    title: pageEvidence.title,
    metaDescription: pageEvidence.metaDescription,
    h1: pageEvidence.h1,
    h2: pageEvidence.h2,
    navLabels: pageEvidence.navLabels,
    ctaTexts: pageEvidence.ctaTexts,
    bodyParagraphs: pageEvidence.bodyParagraphs,
    socialLinks: pageEvidence.socialLinks,
    contactClues: pageEvidence.contactClues,
    jsonLdTypes: pageEvidence.jsonLdTypes || [],
  };
  if (pageEvidence.siteMeta) view.siteMeta = pageEvidence.siteMeta;
  return view;
}

// ── Crawler-parity diff (Phase 2) ───────────────────────────────────────────
//
// The master prompt's highest-value comparison: what a non-rendering crawler
// (static HTML) receives vs. what a human sees (rendered DOM). Both raw HTMLs
// exist only here, at capture time — this computes the derived, persistable
// diff and nothing raw ever leaves this function.

function wordCount(paragraphs) {
  return (Array.isArray(paragraphs) ? paragraphs : [])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function sameStringSet(a, b) {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Diff a page's static read against its rendered read. Only meaningful (and
 * only ever called) when BOTH views were actually captured this run — a page
 * that was never rendered has nothing to diff against, so callers must not
 * invoke this outside a successful rendered-fallback.
 */
function computeCrawlerParity(staticEvidence, staticHtml, renderedEvidence, renderedHtml) {
  const staticTitle = staticEvidence.title || '';
  const renderedTitle = renderedEvidence.title || '';
  const staticDesc = staticEvidence.metaDescription || '';
  const renderedDesc = renderedEvidence.metaDescription || '';
  const staticTags = extractSocialMetaKeys(staticHtml);
  const renderedTags = extractSocialMetaKeys(renderedHtml);
  const staticH1 = staticEvidence.h1 || [];
  const renderedH1 = renderedEvidence.h1 || [];
  const staticCta = staticEvidence.ctaTexts || [];
  const renderedCta = renderedEvidence.ctaTexts || [];
  const staticWords = wordCount(staticEvidence.bodyParagraphs);
  const renderedWords = wordCount(renderedEvidence.bodyParagraphs);

  return {
    title: { static: staticTitle, rendered: renderedTitle, match: staticTitle === renderedTitle },
    metaDescription: { static: staticDesc, rendered: renderedDesc, match: staticDesc === renderedDesc },
    socialMetaTags: { static: staticTags, rendered: renderedTags, match: sameStringSet(staticTags, renderedTags) },
    h1: { static: staticH1, rendered: renderedH1, match: sameStringSet(staticH1, renderedH1) },
    ctaTexts: { static: staticCta, rendered: renderedCta, match: sameStringSet(staticCta, renderedCta) },
    bodyWordCount: { static: staticWords, rendered: renderedWords, match: staticWords === renderedWords },
  };
}

// ── og:image artifact inspection (Phase 2, L3) ──────────────────────────────
//
// "Present" is not a finding — fetch the resolved og:image and record what it
// actually is. Never throws; an undecodable image records what it could
// confirm (bytes/contentType/host) and leaves dimensions null.

async function defaultFetchImage(imageUrl) {
  try {
    const res = await safeFetch(imageUrl, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_OG_IMAGE_BYTES });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const contentType = res.headers.get('content-type') || null;
    const buffer = await readResponseBuffer(res, MAX_OG_IMAGE_BYTES);
    return { ok: true, buffer, contentType };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch_error');
    return { ok: false, reason };
  }
}

/**
 * @param {string|null} imageUrl - resolved og:image URL (or null — nothing to inspect)
 * @param {object} [opts]
 * @param {function} [opts.fetchImage] - DI seam for tests. Defaults to a real,
 *   SSRF-validated, size-capped fetch.
 * @returns {Promise<{ artifact: object|null, status: 'ran'|'skipped'|'failed', reason: string|null }>}
 */
async function inspectOgImageArtifact(imageUrl, { fetchImage = defaultFetchImage } = {}) {
  if (!imageUrl) return { artifact: null, status: 'skipped', reason: 'no_og_image' };

  try {
    await _ssrfValidate(imageUrl);
  } catch {
    return { artifact: null, status: 'failed', reason: 'ssrf_blocked' };
  }

  let result;
  try {
    result = await fetchImage(imageUrl);
  } catch (err) {
    result = { ok: false, reason: err?.message || 'fetch_error' };
  }

  if (!result?.ok || !result.buffer) {
    return { artifact: null, status: 'failed', reason: result?.reason || 'fetch_failed' };
  }

  const host = (() => { try { return new URL(imageUrl).hostname; } catch { return null; } })();
  let width = null;
  let height = null;
  try {
    const metadata = await sharp(result.buffer).metadata();
    width = typeof metadata.width === 'number' ? metadata.width : null;
    height = typeof metadata.height === 'number' ? metadata.height : null;
  } catch {
    // Undecodable image (corrupt bytes, unsupported format) — bytes/contentType/
    // host below are still real, confirmed facts; dimensions stay unknown.
  }

  return {
    artifact: { bytes: result.buffer.length, contentType: result.contentType || null, width, height, host },
    status: 'ran',
    reason: null,
  };
}

// ── Coverage manifest (Phase 2) ─────────────────────────────────────────────
//
// L4/L5 made durable: every planned check, recorded as ran/skipped/failed
// (+reason), so nothing this run could not see is silently absent from the
// output. One object for the whole run (not per-page) — Phase 3's coverage
// manifest section reads this directly.

function resolveExternalCoverage(entry, defaultReason) {
  if (entry && typeof entry === 'object' && typeof entry.status === 'string') {
    return { status: entry.status, reason: entry.reason ?? null };
  }
  return { status: 'skipped', reason: defaultReason };
}

/** Coverage for the early-exit paths (SSRF blocked / homepage fetch failed) — nothing after page crawl ever ran. */
function buildEmptyCoverage({ pageCrawlReason, coverageOverrides = {} }) {
  const skip = (reason) => ({ status: 'skipped', reason });
  return {
    pageCrawl: { status: 'failed', reason: pageCrawlReason },
    renderedFallback: skip('homepage fetch failed — no page to evaluate for a rendered fallback'),
    metaExtraction: skip('homepage fetch failed — no HTML to extract meta from'),
    jsonLd: skip('homepage fetch failed — no HTML to scan for JSON-LD'),
    ogImageInspection: skip('homepage fetch failed — no siteMeta to resolve an og:image from'),
    robotsSitemapProbe: resolveExternalCoverage(coverageOverrides.robotsSitemapProbe, ROBOTS_SITEMAP_SKIP_REASON),
    screenshots: resolveExternalCoverage(coverageOverrides.screenshots, SCREENSHOTS_SKIP_REASON),
  };
}

/** Coverage for a run that got at least the homepage. */
function buildCoverage({ pages, ogImageStatus, coverageOverrides = {} }) {
  // A page's renderFailed is only a real render ATTEMPT when it isn't the cap
  // being reached before this page's turn — the cap case never called fetchRendered.
  const attempted = pages.filter((p) => p.renderMode === 'rendered-fallback' || (p.renderFailed && p.renderFailed !== 'render_cap_reached'));
  const succeeded = pages.filter((p) => p.renderMode === 'rendered-fallback');

  let renderedFallback;
  if (attempted.length === 0) {
    renderedFallback = { status: 'skipped', reason: 'no page required a rendered fallback — static reads were sufficient' };
  } else if (succeeded.length > 0) {
    renderedFallback = { status: 'ran', reason: null };
  } else {
    const reasons = [...new Set(attempted.map((p) => p.renderFailed).filter(Boolean))];
    renderedFallback = { status: 'failed', reason: reasons.join('; ') || 'rendered fetch attempted but did not succeed' };
  }

  return {
    pageCrawl: { status: 'ran', reason: null },
    renderedFallback,
    metaExtraction: { status: 'ran', reason: null },
    jsonLd: { status: 'ran', reason: null },
    ogImageInspection: ogImageStatus,
    robotsSitemapProbe: resolveExternalCoverage(coverageOverrides.robotsSitemapProbe, ROBOTS_SITEMAP_SKIP_REASON),
    screenshots: resolveExternalCoverage(coverageOverrides.screenshots, SCREENSHOTS_SKIP_REASON),
  };
}

/**
 * Decide whether a page needs a rendered (Browserless) fallback and apply it.
 * Exported for direct unit testing of the per-run render cap — the public
 * `fetchSiteEvidence` flow never has more than MAX_RENDERED_FETCHES_PER_RUN
 * candidate pages today (homepage + MAX_ADDITIONAL_PAGES), so the cap itself
 * needs a test that drives this function directly against a shared budget.
 *
 * Never throws — a `fetchRendered` rejection degrades to `renderFailed`.
 *
 * @param {object} params
 * @param {object} params.pageEvidence - static evidence already built for this page
 * @param {string} params.rawHtml - the static HTML that produced it
 * @param {string} params.url
 * @param {string} params.type - 'homepage' | 'about' | 'pricing' | ...
 * @param {{ remaining: number }} params.renderBudget - shared, mutated in place
 * @param {function} params.fetchRendered - fetchBrowserlessContent-shaped fn
 * @param {string[]} params.warnings - pushed to in place
 * @returns {Promise<object>} the page evidence to use (static, or rebuilt from the render)
 */
async function attemptRenderedFallback({ pageEvidence, rawHtml, url, type, renderBudget, fetchRendered, warnings }) {
  const needsRender = isPageThin(pageEvidence) || looksLikeSpaShell(rawHtml);
  if (!needsRender) {
    return { ...pageEvidence, renderMode: 'static', crawlerParity: null };
  }

  if (!renderBudget || renderBudget.remaining <= 0) {
    warnings.push(`${type} page (${url}) looked thin/JS-rendered but the per-run rendered-fetch cap (${MAX_RENDERED_FETCHES_PER_RUN}) was already reached.`);
    return { ...pageEvidence, renderMode: 'static', renderFailed: 'render_cap_reached', crawlerParity: null };
  }
  renderBudget.remaining -= 1;

  let rendered;
  try {
    rendered = await fetchRendered({ url, variant: RENDER_VARIANT });
  } catch (err) {
    rendered = { ok: false, reason: err?.message || 'fetch_error' };
  }

  if (!rendered?.ok || !rendered.html) {
    warnings.push(`${type} page (${url}) looked thin/JS-rendered but the Browserless render did not succeed (${rendered?.reason || 'unavailable'}) — reading static HTML only.`);
    return { ...pageEvidence, renderMode: 'static', renderFailed: rendered?.reason || 'browserless_unavailable', crawlerParity: null };
  }

  if (rendered.html.length <= rawHtml.length) {
    warnings.push(`${type} page (${url}) rendered via Browserless but returned no more content than the static HTML — keeping the static read.`);
    return { ...pageEvidence, renderMode: 'static', renderFailed: 'no_improvement', crawlerParity: null };
  }

  const rebuilt = buildPageEvidence(url, type, rendered.html);
  rebuilt.renderMode = 'rendered-fallback';
  rebuilt.renderedVia = 'browserless';
  rebuilt.staticView = buildStaticView(pageEvidence);
  // Both raw HTMLs are only ever in hand here — persist the derived diff, never the markup.
  rebuilt.crawlerParity = computeCrawlerParity(pageEvidence, rawHtml, rebuilt, rendered.html);
  warnings.push(`${type} page (${url}) was JS-rendered — static HTML was too thin; Browserless rendered fallback succeeded.`);
  return rebuilt;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a site and extract structured evidence for LLM synthesis.
 *
 * @param {string} websiteUrl - The site to fetch (must include protocol)
 * @param {object} [options]
 * @param {function} [options.onPageFetched] - Called after each page is fetched
 *   (after any rendered-fallback attempt, so callers see the final evidence).
 *   Signature: (type: string, url: string, pageEvidence: object) => void
 *   Fire-and-forget — the fetcher does not await this.
 * @param {function} [options.fetchRendered] - fetchBrowserlessContent-shaped
 *   override for tests. Defaults to the real Browserless `/content` client
 *   (`api/_lib/browserless.cjs`), which logs every attempt to
 *   `browserless_requests` and degrades to `{ ok:false }` when unconfigured.
 * @param {function} [options.fetchImage] - DI seam for the og:image artifact
 *   inspection (Phase 2, L3). Defaults to a real, SSRF-validated, size-capped
 *   ({@link MAX_OG_IMAGE_BYTES}) fetch. Tests must always override this.
 * @param {object} [options.coverageOverrides] - `{ robotsSitemapProbe, screenshots }`,
 *   each `{ status, reason }`. Neither check ever runs inside site-fetcher.js
 *   itself (they are separate modules/tasks) — pass real status here only when
 *   the caller already ran them this same run; omitted, both read 'skipped'.
 * @returns {Promise<SiteEvidence>}
 */
async function fetchSiteEvidence(websiteUrl, { onPageFetched, fetchRendered = fetchBrowserlessContent, fetchImage = defaultFetchImage, coverageOverrides = {} } = {}) {
  const fetchedAt = new Date().toISOString();
  const pages = [];
  const warnings = [];
  const renderBudget = { remaining: MAX_RENDERED_FETCHES_PER_RUN };

  // SSRF guard: reject private/internal URLs before fetching
  try {
    await _ssrfValidate(websiteUrl);
  } catch {
    return {
      url: websiteUrl,
      fetchedAt,
      pages: [],
      warnings: ['URL not allowed.'],
      thin: true,
      coverage: buildEmptyCoverage({ pageCrawlReason: 'URL not allowed (SSRF guard)', coverageOverrides }),
    };
  }

  // Step 1 — Homepage
  const homepageFetch = await fetchPage(websiteUrl);

  if (!homepageFetch.ok || !homepageFetch.html) {
    return {
      url: websiteUrl,
      fetchedAt,
      pages: [],
      warnings: [`Homepage fetch failed: ${homepageFetch.reason || 'unknown error'}`],
      thin: true,
      coverage: buildEmptyCoverage({ pageCrawlReason: homepageFetch.reason || 'unknown error', coverageOverrides }),
    };
  }

  let homepageEvidence = buildPageEvidence(websiteUrl, 'homepage', homepageFetch.html);
  homepageEvidence = await attemptRenderedFallback({
    pageEvidence: homepageEvidence,
    rawHtml: homepageFetch.html,
    url: websiteUrl,
    type: 'homepage',
    renderBudget,
    fetchRendered,
    warnings,
  });

  // og:image artifact inspection (Phase 2, L3) — inspect whichever siteMeta
  // won (rendered or static), once per run. Never blocks/throws the pipeline.
  let ogImageStatus = { status: 'skipped', reason: 'no_og_image' };
  const ogImageUrl = homepageEvidence.siteMeta?.ogImage || null;
  if (ogImageUrl) {
    const inspected = await inspectOgImageArtifact(ogImageUrl, { fetchImage });
    ogImageStatus = { status: inspected.status, reason: inspected.reason };
    if (inspected.artifact) {
      homepageEvidence = { ...homepageEvidence, siteMeta: { ...homepageEvidence.siteMeta, ogImageArtifact: inspected.artifact } };
    }
  }

  pages.push(homepageEvidence);
  // Emit homepage progress — fire-and-forget, never throws to fetcher
  if (onPageFetched) { try { onPageFetched('homepage', websiteUrl, homepageEvidence); } catch { /* ignore */ } }

  // Step 2 — Discover and fetch additional pages in parallel. Discovery reads
  // the STATIC homepage HTML (unchanged) — a true client-only SPA shell has no
  // static hrefs to discover either, so only the homepage gets a rendered
  // fallback in that case; a site with static nav but thin individual pages
  // gets each thin page rendered too.
  const additionalLinks = discoverAdditionalPages(homepageFetch.html, websiteUrl)
    .slice(0, MAX_ADDITIONAL_PAGES);

  if (additionalLinks.length > 0) {
    const additionalResults = await Promise.allSettled(
      additionalLinks.map(({ type, url }) =>
        fetchPage(url).then(async (result) => {
          if (!result.ok || !result.html) {
            warnings.push(`${type} page (${url}) failed: ${result.reason}`);
            return { type, url, result, pageEvidence: null };
          }
          let pageEvidence = buildPageEvidence(url, type, result.html);
          pageEvidence = await attemptRenderedFallback({
            pageEvidence,
            rawHtml: result.html,
            url,
            type,
            renderBudget,
            fetchRendered,
            warnings,
          });
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

  // Step 3 — Flag thin content. Computed from the FINAL pages array, so a page
  // whose primary fields were replaced by a successful rendered fallback
  // contributes its rendered content here, not its static content.
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
    coverage: buildCoverage({ pages, ogImageStatus, coverageOverrides }),
  };
}

module.exports = {
  fetchSiteEvidence,
  extractSiteMeta,
  extractCtaTexts,
  // Exported for direct unit testing (Phase 1 rendered-fallback matrix) —
  // see features/scout-intake/__tests__/site-fetcher-rendered-fallback.test.js
  looksLikeSpaShell,
  isPageThin,
  attemptRenderedFallback,
  MAX_RENDERED_FETCHES_PER_RUN,
  // Exported for direct unit testing (Phase 2 — see
  // features/scout-intake/__tests__/{crawler-parity,json-ld-extraction,
  // og-image-artifact,coverage-manifest}.test.js)
  extractJsonLdTypes,
  extractSocialMetaKeys,
  computeCrawlerParity,
  inspectOgImageArtifact,
  buildCoverage,
  buildEmptyCoverage,
  MAX_OG_IMAGE_BYTES,
};
