// extract.mjs — B1: walk the mirrored pages and pull structured, seedable
// content out of them. Deterministic (no LLM): headings/paragraphs/images in
// document order per page, site settings from title/tel:/mailto:/social hrefs,
// brand colors from theme-color + CSS, fonts from @font-face families.
//
// Generic model (not the runbook's restaurant-specific one): every page
// becomes an ordered list of items — heading / text / image — which the CMS
// scaffold turns into hero + content + image blocks. See
// docs/plans/SITE-RECREATE-CMS-LAYER-PLAN.md.

import { load } from 'cheerio';
import path from 'path';
import { readdir, readFile, stat } from 'fs/promises';

const SOCIAL_HOSTS = [
  ['instagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['tiktok.com', 'tiktok'],
  ['youtube.com', 'youtube'],
  ['linkedin.com', 'linkedin'],
  ['yelp.com', 'yelp'],
];

// Content images only — logos/icons and formats browsers or sharp can't
// decode reliably are skipped (.heic = runbook gotcha #3).
const SKIP_IMAGE_EXT = new Set(['.svg', '.heic', '.ico', '.gif']);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function pageSlug(file) {
  const base = path.basename(file, '.html');
  if (base === 'index') return 'home';
  return base.replace(/^pages-/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}

/** Strip the mirror's `?v=` collision hash (`name.<8hex>.ext`) to a stable
 *  dedupe key, so srcset size variants of one photo collapse to one image. */
function imageKey(localSrc) {
  return localSrc.replace(/\.[0-9a-f]{8}(\.[a-z0-9]+)$/i, '$1');
}

function extractSocial($) {
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    for (const [host, name] of SOCIAL_HOSTS) {
      if (href.includes(host) && !seen.has(name)) seen.set(name, href.split('?')[0]);
    }
  });
  return [...seen.entries()].map(([platform, url]) => ({ platform, url }));
}

function extractNav($, htmlFiles) {
  const localSet = new Set(htmlFiles.map((f) => path.basename(f)));
  const nav = [];
  const seen = new Set();
  $('nav a[href], header a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const base = path.basename(href.split('#')[0].split('?')[0]);
    const label = clean($(el).text());
    if (!label || label.length > 40) return;
    const file = base === '' || href === '/' ? 'index.html' : base;
    if (!localSet.has(file)) return;
    const slug = pageSlug(file);
    if (seen.has(slug)) return;
    seen.add(slug);
    nav.push({ label, slug });
  });
  return nav;
}

/** Most-used non-grayscale hex colors across the mirrored CSS — the brand
 *  accent candidates. Grayscale/near-white noise is filtered out. */
function topCssColors(cssText, limit = 3) {
  const counts = new Map();
  const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
  let m;
  while ((m = re.exec(cssText))) {
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    if (spread < 24 || lum > 235 || lum < 18) continue; // grayscale-ish noise
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([hex]) => `#${hex}`);
}

function fontFamilies(cssText, limit = 2) {
  const fams = [];
  const re = /@font-face\s*{[^}]*font-family:\s*['"]?([^'";}]+)['"]?/gi;
  let m;
  while ((m = re.exec(cssText))) {
    const fam = clean(m[1]);
    if (fam && !fams.includes(fam)) fams.push(fam);
  }
  return fams.slice(0, limit);
}

async function readAllCss(siteDir) {
  const chunks = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.name.endsWith('.css')) chunks.push(await readFile(abs, 'utf8').catch(() => ''));
    }
  }
  await walk(path.join(siteDir, 'assets'));
  return chunks.join('\n');
}

/** Ordered content items for one page: heading / text / image. */
function extractPageItems($, siteDir) {
  const scope = $('main').length ? $('main').first() : $('body');
  // Drop chrome + machinery; what's left in document order is the content.
  scope.find('script, style, noscript, nav, header, footer, form, iframe, svg').remove();
  const items = [];
  const seenText = new Set();
  scope.find('h1, h2, h3, h4, p, li, img').each((_, el) => {
    const tag = el.tagName?.toLowerCase?.() || el.name;
    if (tag === 'img') {
      const src = String($(el).attr('src') || '');
      if (!src.startsWith('assets/')) return;
      if (SKIP_IMAGE_EXT.has(path.extname(src.split('?')[0]).toLowerCase())) return;
      items.push({ kind: 'image', src, alt: clean($(el).attr('alt')) });
      return;
    }
    // Skip text that lives inside a child element we'll visit separately
    // (li inside li, p containing only an img, etc.).
    const text = clean($(el).text());
    if (!text || text.length < 2) return;
    if (tag === 'li' && $(el).find('p, h1, h2, h3, h4').length) return;
    const key = `${tag}:${text}`;
    if (seenText.has(key)) return;
    seenText.add(key);
    if (/^h[1-4]$/.test(tag)) {
      items.push({ kind: 'heading', level: Number(tag[1]), text });
    } else {
      items.push({ kind: 'text', text });
    }
  });
  return items;
}

/**
 * Extract everything build-cms needs from a completed mirror.
 *
 * @param {object} args
 * @param {string} args.siteDir  path to the mirrored `site/` directory
 * @param {string} args.targetUrl original site URL (for provenance)
 * @param {(line: string) => void} [args.log]
 * @returns {Promise<{settings, brand, pages, images}>}
 */
export async function extractSiteContent({ siteDir, targetUrl, log = () => {} }) {
  const entries = await readdir(siteDir);
  const htmlFiles = entries.filter((f) => f.endsWith('.html')).sort((a, b) =>
    a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b));
  if (!htmlFiles.length) throw new Error(`No .html pages found in ${siteDir}`);

  const docs = new Map();
  for (const file of htmlFiles) {
    docs.set(file, load(await readFile(path.join(siteDir, file), 'utf8')));
  }
  const $home = docs.get('index.html') || docs.values().next().value;

  // ── Site settings ─────────────────────────────────────────────────────
  const rawTitle = clean($home('title').text());
  const siteName = clean($home('meta[property="og:site_name"]').attr('content'))
    || rawTitle.split(/[|–—-]/)[0].trim()
    || new URL(targetUrl).hostname.replace(/^www\./, '');
  const phoneHref = $home('a[href^="tel:"]').first().attr('href') || '';
  const emailHref = $home('a[href^="mailto:"]').first().attr('href') || '';
  const settings = {
    siteName,
    tagline: clean($home('meta[name="description"]').attr('content')),
    phone: clean(decodeURIComponent(phoneHref.replace(/^tel:/, ''))),
    email: clean(emailHref.replace(/^mailto:/, '').split('?')[0]),
    address: clean($home('address').first().text()),
    social: extractSocial($home),
    footerText: clean($home('footer').find('small, .copyright, [class*="copyright"]').first().text())
      || clean(($home('footer').text().match(/©[^.\n]{0,80}/) || [''])[0]),
    nav: extractNav($home, htmlFiles),
    sourceUrl: targetUrl,
  };

  // ── Brand tokens ──────────────────────────────────────────────────────
  // Primary source: CSS custom props in the pages' inline <style> blocks —
  // Shopify (and most theme platforms) emit brand tokens there, not in the
  // external stylesheets (`--color-base-*` RGB triplets, `--font-*-family`).
  // Fallback: theme-color meta + frequency scan of the mirrored CSS.
  const inlineCss = $home('style').map((_, el) => $home(el).html() || '').get().join('\n');
  const cssVar = (re) => { const m = inlineCss.match(re); return m ? clean(m[1]) : ''; };
  const rgbTripletToHex = (s) => {
    const m = String(s).match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
    if (!m) return '';
    return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  };
  const varPrimary = rgbTripletToHex(cssVar(/--color-base-background-1:\s*([^;]+);/));
  const varAccent = rgbTripletToHex(cssVar(/--color-base-accent-1:\s*([^;]+);/));
  const varText = rgbTripletToHex(cssVar(/--color-base-text:\s*([^;]+);/));
  const varHeadingFont = cssVar(/--font-heading-family:\s*([^;]+);?/);
  const varBodyFont = cssVar(/--font-body-family:\s*([^;]+);?/);

  const css = await readAllCss(siteDir);
  const cssColors = topCssColors(css + '\n' + inlineCss);
  const themeColor = clean($home('meta[name="theme-color"]').attr('content'));
  const fonts = fontFamilies(css);
  const primary = varPrimary || themeColor || cssColors[0] || '#2a2420';
  const brand = {
    primary,
    accent: varAccent || cssColors.find((c) => c !== primary) || '#e4571e',
    background: varText && varText !== primary ? varText : '#faf7f2',
    headingFont: varHeadingFont || fonts[0] || 'Georgia, serif',
    bodyFont: varBodyFont || fonts[1] || fonts[0] || 'Helvetica, Arial, sans-serif',
  };

  // ── Pages + images ────────────────────────────────────────────────────
  const pages = [];
  const imagesByKey = new Map(); // key → {localPath, alt, bytes}
  for (const file of htmlFiles) {
    const $ = docs.get(file);
    const slug = pageSlug(file);
    const title = clean($('h1').first().text()) || clean($('title').text()).split(/[|–—-]/)[0].trim() || slug;
    const items = extractPageItems($, siteDir);

    // Dedupe srcset variants: keep the largest file per image key, and point
    // the page item at the winning variant.
    const pageImages = [];
    for (const item of items) {
      if (item.kind !== 'image') continue;
      const key = imageKey(item.src);
      const abs = path.join(siteDir, item.src);
      const st = await stat(abs).catch(() => null);
      if (!st) { item.kind = 'dropped'; continue; }
      const prev = imagesByKey.get(key);
      if (!prev || st.size > prev.bytes) {
        imagesByKey.set(key, { key, localPath: item.src, alt: item.alt, bytes: st.size });
      }
      item.key = key;
      if (!pageImages.includes(key)) pageImages.push(key);
    }

    pages.push({
      slug,
      title,
      file,
      items: items.filter((i) => i.kind !== 'dropped'),
      imageKeys: pageImages,
    });
  }

  // Re-point every page item at its key's winning variant.
  for (const pg of pages) {
    for (const item of pg.items) {
      if (item.kind === 'image' && item.key && imagesByKey.has(item.key)) {
        item.src = imagesByKey.get(item.key).localPath;
      }
    }
  }

  const images = [...imagesByKey.values()];
  log(`extract: ${pages.length} pages, ${images.length} unique images, brand ${brand.primary}/${brand.accent}, fonts ${brand.headingFont}/${brand.bodyFont}`);
  return { settings, brand, pages, images };
}
