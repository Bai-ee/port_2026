// discover.mjs — A(0): find which pages to mirror. Tries sitemap.xml first
// (works regardless of renderMode — sitemaps are always static XML), falls
// back to parsing nav links off the homepage. Always includes '/' first,
// capped at maxPages (default 15 — see plan Risk #5).

import { load } from 'cheerio';
import { fetchPageHtml } from './http.mjs';
import { loadProfiles, detectPlatform } from './profile.mjs';

const DEFAULT_MAX_PAGES = 15;

async function fetchSitemapDoc(url) {
  try {
    const { html, status } = await fetchPageHtml(url);
    if (status !== 200) return null;
    return load(html, { xmlMode: true });
  } catch {
    return null;
  }
}

/**
 * Resolve the real content-page list from /sitemap.xml. Many storefront
 * platforms (Shopify included) publish a sitemap INDEX — separate
 * sub-sitemaps for products/collections/blogs/pages — rather than a flat
 * list. Recreating a static marketing site should mirror the informational
 * "pages" sub-sitemap only; product/collection catalogs are a different,
 * much bigger problem and would blow past the page cap with irrelevant
 * content. Sub-sitemap URLs often carry required pagination query params
 * (e.g. `?from=...&to=...`) — fetch the <loc> verbatim, never strip the query.
 */
async function discoverViaSitemap(origin) {
  const $ = await fetchSitemapDoc(`${origin}/sitemap.xml`);
  if (!$) return [];

  const subSitemaps = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
  if (subSitemaps.length) {
    const pagesSitemap = subSitemaps.find((u) => /pages/i.test(u));
    if (!pagesSitemap) return [];
    const $$ = await fetchSitemapDoc(pagesSitemap);
    if (!$$) return [];
    return $$('url > loc').map((_, el) => $$(el).text().trim()).get();
  }

  return $('url > loc').map((_, el) => $(el).text().trim()).get();
}

function parseNavLinks($, origin) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) return;
      links.add(abs.pathname || '/');
    } catch { /* unparsable href — skip */ }
  });
  return [...links];
}

/**
 * @param {object} args
 * @param {string} args.targetUrl
 * @param {number} [args.maxPages]
 * @returns {Promise<{ profile: object, pages: string[], homepageHtml: string, homepageStatus: number, origin: string }>}
 */
export async function discoverPages({ targetUrl, maxPages = DEFAULT_MAX_PAGES }) {
  const parsed = new URL(targetUrl);
  const origin = parsed.origin;

  const { html: homepageHtml, status: homepageStatus } = await fetchPageHtml(`${origin}/`);

  const profiles = await loadProfiles();
  const profile = detectPlatform(homepageHtml, profiles);

  let paths = [];
  const sitemapLocs = await discoverViaSitemap(origin);
  for (const loc of sitemapLocs) {
    try {
      const u = new URL(loc);
      if (u.origin === origin) paths.push(u.pathname || '/');
    } catch { /* malformed loc — skip */ }
  }

  if (!paths.length) {
    const $ = load(homepageHtml);
    paths = parseNavLinks($, origin);
  }

  const deduped = ['/', ...paths.filter((p) => p && p !== '/')];
  const pages = [...new Set(deduped)].slice(0, maxPages);

  return { profile, pages, homepageHtml, homepageStatus, origin };
}
