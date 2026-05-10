// Lead Gen — Quick Auditor
// Lightweight pre-audit: single fetch + cheerio parse, no LLM, no Browserless.
// Runs on every discovered prospect to feed the website-quality signal in the
// scoring engine. Cheap (~0 cost), fast (~1-3s), and good enough to filter
// out junk before we spend money on enrichment / full audit.
//
// Returns:
//   {
//     ok: boolean,
//     siteScore: 0-100,         // 100 = lots of deficiencies (= big opportunity)
//     loadTimeMs: number,
//     status: number|null,
//     platform: string|null,
//     deficiencies: string[],
//     hasBlog: boolean,
//     hasSocial: boolean,
//     hasContactForm: boolean,
//     hasEmail: boolean,
//     emailFound: string|null,
//     hasJsonLd: boolean,
//     hasOgTags: boolean,
//     hasMetaDescription: boolean,
//     isHttps: boolean,
//     isResponsive: boolean,    // viewport meta presence (proxy)
//     error: string|null,
//   }
//
// Source: docs/LEAD_GEN_PIPELINE_PLAN.md §2.2 Signal 1.

const FETCH_TIMEOUT_MS = 8000;

// Platform fingerprints — checked against HTML body / meta / generator tag.
const PLATFORM_FINGERPRINTS = [
  { name: 'wix',         markers: ['wix.com', '_wixCIDX', 'X-Wix-Request-Id'] },
  { name: 'squarespace', markers: ['squarespace.com', 'Static.SQUARESPACE_CONTEXT', 'sqs-block'] },
  { name: 'godaddy',     markers: ['godaddysites.com', 'gem-id', 'data-aid="GODADDY'] },
  { name: 'wordpress',   markers: ['wp-content', 'wp-includes', '/wp-json/'] },
  { name: 'webflow',     markers: ['webflow.com', 'data-wf-page', 'data-wf-site'] },
  { name: 'shopify',     markers: ['cdn.shopify.com', 'Shopify.theme', 'shopify-section'] },
  { name: 'ghost',       markers: ['ghost.io', 'ghost-portal'] },
  { name: 'duda',        markers: ['dudamobile.com', 'duda_website'] },
  { name: 'weebly',      markers: ['weebly.com', 'weeblycloud.com'] },
];

// Exported so the scorer / UI can mark these as "template" deficiencies.
export const TEMPLATE_PLATFORMS = new Set(['wix', 'squarespace', 'godaddy', 'duda', 'weebly']);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Hosts checked when iterating <a href> links. Match by hostname to avoid
// false positives from substrings inside other URLs (e.g. analytics).
const SOCIAL_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'threads.net', 'bsky.app',
  'snapchat.com', 't.me', 'wa.me', 'reddit.com',
];

// Path patterns that indicate a content / publishing section. Matched against
// each anchor's pathname so we get a real hit, not a substring inside an
// unrelated URL.
const BLOG_PATH_RE = /^\/(blog|news|articles?|insights?|case-stud(?:y|ies)|resources?|journal|posts?|learning|stories|guides?)(\/|$)/i;

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BballiLeadGenAuditor/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function detectPlatform(html, headers) {
  const generator = headers?.get?.('x-generator') || '';
  const haystack = `${generator}\n${html}`.toLowerCase();
  for (const { name, markers } of PLATFORM_FINGERPRINTS) {
    if (markers.some((m) => haystack.includes(m.toLowerCase()))) return name;
  }
  return null;
}

export async function quickSiteAudit(websiteUrl) {
  const out = {
    ok: false,
    siteScore: 0,
    loadTimeMs: 0,
    status: null,
    platform: null,
    deficiencies: [],
    hasBlog: false,
    blogLinksCount: 0,
    hasSocial: false,
    socialLinksCount: 0,
    socialPlatforms: [],
    hasContactForm: false,
    hasEmail: false,
    emailFound: null,
    hasJsonLd: false,
    hasOgTags: false,
    hasMetaDescription: false,
    isHttps: false,
    isResponsive: false,
    error: null,
  };

  if (!websiteUrl) {
    out.error = 'No URL provided';
    out.siteScore = 100; // no site at all = max opportunity
    out.deficiencies.push('No website on record');
    return out;
  }

  let url;
  try { url = new URL(websiteUrl); } catch {
    out.error = 'Invalid URL';
    out.siteScore = 100;
    out.deficiencies.push('Invalid website URL');
    return out;
  }
  out.isHttps = url.protocol === 'https:';

  let html = '';
  let res = null;
  const t0 = Date.now();
  try {
    res = await fetchWithTimeout(url.toString(), FETCH_TIMEOUT_MS);
    out.status = res.status;
    if (!res.ok) {
      out.error = `HTTP ${res.status}`;
      // Broken or 4xx/5xx homepages are a huge opportunity signal.
      out.siteScore = 100;
      out.deficiencies.push(`Homepage returns ${res.status}`);
      out.loadTimeMs = Date.now() - t0;
      return out;
    }
    html = await res.text();
  } catch (err) {
    out.error = err?.name === 'AbortError' ? 'Timeout' : (err?.message || 'Fetch failed');
    out.siteScore = 100;
    out.deficiencies.push(out.error === 'Timeout' ? 'Homepage took >8s to respond' : 'Homepage failed to load');
    out.loadTimeMs = Date.now() - t0;
    return out;
  }
  out.loadTimeMs = Date.now() - t0;

  // Lazy-load cheerio so this module stays usable in browser contexts that
  // never call quickSiteAudit (the function is server-only).
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);

  out.platform = detectPlatform(html, res.headers);

  out.hasMetaDescription = Boolean($('meta[name="description"]').attr('content')?.trim());
  out.hasOgTags          = $('meta[property^="og:"]').length > 0;
  out.hasJsonLd          = $('script[type="application/ld+json"]').length > 0;
  out.isResponsive       = Boolean($('meta[name="viewport"]').attr('content')?.includes('width'));
  out.hasContactForm     = $('form').filter((_, el) => {
    const text = $(el).text().toLowerCase();
    return text.includes('contact') || text.includes('message') || text.includes('inquir');
  }).length > 0;

  const bodyText = $('body').text() || '';
  const emailMatch = bodyText.match(EMAIL_RE) || html.match(EMAIL_RE);
  if (emailMatch) {
    out.hasEmail = true;
    out.emailFound = emailMatch[0];
  }

  // Iterate every anchor on the homepage and bucket by hostname / path.
  // More reliable than scanning raw HTML — catches links in any DOM position
  // (header, footer, body) and ignores substrings inside unrelated URLs.
  const socialHits = new Map(); // host -> count
  let blogLinksCount = 0;
  $('a[href]').each((_, el) => {
    const raw = ($(el).attr('href') || '').trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('#')) return;
    let parsed;
    try { parsed = new URL(raw, url); } catch { return; }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname || '/';

    // Social: hostname-suffix match against allow-list.
    const socialHost = SOCIAL_HOSTS.find((h) => host === h || host.endsWith(`.${h}`) || host === h.replace(/\..*/, '') + '.com');
    if (socialHost) {
      socialHits.set(socialHost, (socialHits.get(socialHost) || 0) + 1);
      return;
    }

    // Blog: only count when the link goes to the same site (or no host) — an
    // outbound link to someone else's /blog isn't a content section we own.
    const sameSite = !parsed.host || parsed.host === url.host;
    if (sameSite && BLOG_PATH_RE.test(path)) {
      blogLinksCount += 1;
    }
  });

  out.socialPlatforms  = Array.from(socialHits.keys());
  out.socialLinksCount = Array.from(socialHits.values()).reduce((a, b) => a + b, 0);
  out.hasSocial        = out.socialLinksCount > 0;
  out.blogLinksCount   = blogLinksCount;
  out.hasBlog          = blogLinksCount > 0;

  // ── Score deficiencies (0–100) ──────────────────────────────────────────
  let score = 0;
  if (!out.isResponsive)        { score += 20; out.deficiencies.push('No responsive viewport meta'); }
  if (!out.isHttps)             { score += 10; out.deficiencies.push('No HTTPS'); }
  if (out.loadTimeMs > 5000)    { score += 15; out.deficiencies.push(`Page load ${(out.loadTimeMs / 1000).toFixed(1)}s`); }
  if (TEMPLATE_PLATFORMS.has(out.platform)) {
    score += 10;
    out.deficiencies.push(`Template platform: ${out.platform}`);
  }
  if (!out.hasMetaDescription)  { score += 5;  out.deficiencies.push('Missing meta description'); }
  if (!out.hasOgTags)           { score += 5;  out.deficiencies.push('Missing OpenGraph tags'); }
  if (!out.hasJsonLd)           { score += 5;  out.deficiencies.push('No JSON-LD structured data'); }
  // Stale-content heuristic — if there's no detectable updated/published date in
  // the homepage HTML, treat as a soft signal of staleness.
  const hasFreshnessSignal = /datePublished|dateModified|"datetime"|<time[^>]*datetime/i.test(html);
  if (!hasFreshnessSignal)      { score += 15; out.deficiencies.push('No content freshness signals'); }
  // Broken homepage was already short-circuited above; if we got here and the
  // homepage was very thin (< 1KB after stripping), call that out.
  const textLen = bodyText.replace(/\s+/g, ' ').trim().length;
  if (textLen < 400)            { score += 15; out.deficiencies.push('Homepage has very little content'); }

  out.ok = true;
  out.siteScore = Math.min(100, score);
  return out;
}
