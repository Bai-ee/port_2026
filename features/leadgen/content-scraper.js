// Lead Gen — Content Scraper
// Primary fetch: site-fetcher (multi-page crawl, homepage + about/services/contact/pricing).
// JS-rendered fallback: Browserless /content endpoint when thin:true is detected.
// Cheerio runs on raw HTML for structured asset + service + testimonial extraction.
// Output shape unchanged — design-md-generator.js needs no edits.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { fetchSiteEvidence } = require('../scout-intake/site-fetcher');
const { fetchBrowserlessContent } = require('../../api/_lib/browserless.cjs');

// ─── BROWSERLESS FALLBACK ─────────────────────────────────────────────────────

// Routes through api/_lib/browserless.cjs so every call is recorded in
// `browserless_requests` and surfaces on the OpsOverview dashboard.
async function fetchRenderedHtml(url, { placeId = null } = {}) {
  const result = await fetchBrowserlessContent({
    url,
    runId: placeId,
    variant: { id: 'leadgen-content', label: 'Leadgen content scrape' },
  });
  return result.ok ? result.html : null;
}

// ─── CHEERIO EXTRACTIONS (run on raw HTML) ────────────────────────────────────

function resolveUrl(href, baseUrl) {
  if (!href || href.startsWith('data:')) return null;
  try { return new URL(href, baseUrl.toString()).toString(); } catch { return null; }
}

function extractAssetsFromDom($, baseUrl, businessName) {
  let logo = { url: null, alt: null, detectedBy: null };

  $('header img, nav img').each(function () {
    if (logo.url) return false;
    const w = parseInt($(this).attr('width') || '', 10);
    const cls = ($(this).attr('class') || '').toLowerCase();
    const id  = ($(this).attr('id')    || '').toLowerCase();
    if (isNaN(w) || w < 300 || /logo/.test(cls + id)) {
      const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
      if (src) logo = { url: src, alt: $(this).attr('alt')?.trim() || null, detectedBy: 'header-img' };
    }
  });

  if (!logo.url) {
    $('img[class*="logo"], img[id*="logo"]').first().each(function () {
      const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
      if (src) logo = { url: src, alt: $(this).attr('alt')?.trim() || null, detectedBy: 'class-logo' };
    });
  }

  if (!logo.url && businessName) {
    const nameLower = businessName.toLowerCase();
    $('img').each(function () {
      if (logo.url) return false;
      const alt = ($(this).attr('alt') || '').toLowerCase();
      if (/logo/.test(alt) || alt.includes(nameLower.split(' ')[0])) {
        const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
        if (src) logo = { url: src, alt: $(this).attr('alt')?.trim() || null, detectedBy: 'alt-logo' };
      }
    });
  }

  if (!logo.url) {
    const faviconHref = $('link[rel="icon"], link[rel="shortcut icon"]').first().attr('href');
    const faviconUrl  = resolveUrl(faviconHref, baseUrl);
    if (faviconUrl) logo = { url: faviconUrl, alt: 'favicon', detectedBy: 'favicon-upscale' };
  }

  const heroImages = [];
  $('section:first-of-type img, [class*="hero"] img, [class*="banner"] img, [id*="hero"] img').each(function () {
    if (heroImages.length >= 3) return false;
    const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
    if (src && src !== logo.url) {
      heroImages.push({ url: src, alt: $(this).attr('alt')?.trim() || null });
    }
  });

  const sectionImages = [];
  $('section img, article img, main img').each(function () {
    if (sectionImages.length >= 12) return false;
    const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
    if (!src || src === logo.url || heroImages.some(h => h.url === src)) return;
    const section = $(this).closest('section, article').attr('class') || null;
    sectionImages.push({ url: src, alt: $(this).attr('alt')?.trim() || null, section });
  });

  const teamPhotos = [];
  $('[class*="team"] img, [class*="staff"] img, [id*="team"] img').each(function () {
    if (teamPhotos.length >= 8) return false;
    const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
    if (src) teamPhotos.push({ url: src, alt: $(this).attr('alt')?.trim() || null });
  });

  const galleryImages = [];
  $('[class*="gallery"] img, [class*="portfolio"] img, [id*="gallery"] img').each(function () {
    if (galleryImages.length >= 16) return false;
    const src = resolveUrl($(this).attr('src') || $(this).attr('data-src'), baseUrl);
    if (src) galleryImages.push({ url: src, alt: $(this).attr('alt')?.trim() || null });
  });

  const favicon = resolveUrl(
    $('link[rel="icon"]').first().attr('href') ||
    $('link[rel="shortcut icon"]').first().attr('href'),
    baseUrl,
  );
  const ogImage = resolveUrl($('meta[property="og:image"]').attr('content'), baseUrl);

  return { logo, heroImages, sectionImages, teamPhotos, galleryImages, favicon, ogImage };
}

function extractServicesFromDom($) {
  const serviceNames        = [];
  const serviceDescriptions = [];

  $('section, div').each(function () {
    const id  = ($(this).attr('id')    || '').toLowerCase();
    const cls = ($(this).attr('class') || '').toLowerCase();
    if (!/service|solution|offering|what-we-do|practice/i.test(id + cls)) return;
    $(this).find('h2, h3, h4').each(function () {
      const name = $(this).text().trim();
      if (name && name.length < 120 && !serviceNames.includes(name)) {
        serviceNames.push(name);
        const desc = $(this).nextAll('p').first().text().trim();
        serviceDescriptions.push({ name, description: desc.slice(0, 300) || '' });
      }
    });
  });

  return { serviceNames, serviceDescriptions };
}

function extractTestimonialsFromDom($) {
  const testimonials = [];
  $('[class*="testimonial"], [class*="review"], [class*="quote"], blockquote').each(function () {
    if (testimonials.length >= 6) return false;
    const quote  = $(this).find('p, blockquote').first().text().trim() || $(this).text().trim();
    const author = $(this).find('[class*="author"], [class*="name"], cite, strong').first().text().trim();
    if (quote && quote.length > 20) {
      testimonials.push({ quote: quote.slice(0, 400), author: author.slice(0, 80) || null, role: null });
    }
  });
  return testimonials;
}

function extractStructureFromDom($) {
  const sectionOrder = [];
  $('section[id], section[class], div[id*="section"]').each(function () {
    if (sectionOrder.length >= 12) return false;
    const id  = $(this).attr('id')    || '';
    const cls = $(this).attr('class') || '';
    const label = (id + ' ' + cls).toLowerCase().replace(/[-_]/g, ' ').trim();
    if (label) sectionOrder.push(label.slice(0, 60));
  });

  return {
    sectionOrder,
    hasContactForm:  $('form input[type="email"], form input[name*="email"]').length > 0,
    hasBlog:         $('a[href*="/blog"], a[href*="/news"]').length > 0,
    hasTestimonials: $('[class*="testimonial"], [class*="review"]').length > 0,
    hasTeamSection:  $('[class*="team"], [class*="staff"]').length > 0,
    hasGallery:      $('[class*="gallery"], [class*="portfolio"]').length > 0,
    hasPricing:      $('[class*="pricing"], [class*="plans"]').length > 0,
    footerColumns:   $('footer > div, footer > section, footer > ul').length || 1,
  };
}

function extractColorsFromHtml(rawHtml) {
  const hexRe  = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const freq   = {};
  const styleBlocks  = [...(rawHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])];
  const inlineStyles = [...(rawHtml.match(/style\s*=\s*["'][^"']*["']/gi)     || [])];
  const sources = [...styleBlocks, ...inlineStyles].join('\n');

  let m;
  while ((m = hexRe.exec(sources)) !== null) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (r > 220 && g > 220 && b > 220) continue;
    if (r < 30  && g < 30  && b < 30 ) continue;
    const key = '#' + hex.toLowerCase();
    freq[key] = (freq[key] || 0) + 1;
  }

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { primary: sorted[0] || null, secondary: sorted[1] || null, accent: sorted[2] || null, candidates: sorted.slice(0, 8) };
}

// ─── EVIDENCE → COPY MAP ──────────────────────────────────────────────────────

function parseContactClues(clues = []) {
  let phone = null, email = null;
  for (const c of clues) {
    if (!phone && c.startsWith('phone:')) phone = c.slice(6);
    if (!email && c.startsWith('email:')) email = c.slice(6);
  }
  return { phone, email };
}

function mapEvidenceToCopy(pages, domServices) {
  const homepage  = pages.find(p => p.type === 'homepage') || pages[0] || {};
  const aboutPage = pages.find(p => p.type === 'about');
  const servPage  = pages.find(p => p.type === 'services');
  const contPage  = pages.find(p => p.type === 'contact');

  const heroHeadline    = homepage.h1?.[0] || null;
  const heroSubheadline = homepage.h2?.[0] || homepage.metaDescription?.slice(0, 300) || null;

  // About text: prefer dedicated about page paragraphs, fall back to homepage
  const aboutSource = aboutPage || homepage;
  const aboutText = aboutSource.bodyParagraphs?.filter(p => p.length > 40).join(' ').slice(0, 800) || null;

  // Services: prefer DOM extraction (has name+desc pairs), fall back to h2s from services/about page
  let serviceNames        = domServices.serviceNames;
  let serviceDescriptions = domServices.serviceDescriptions;
  if (serviceNames.length === 0) {
    const srcPage = servPage || homepage;
    serviceNames = (srcPage.h2 || []).slice(0, 8);
    serviceDescriptions = serviceNames.map(name => ({ name, description: '' }));
  }

  // Testimonials come from DOM extraction only (need CSS class context)
  const testimonials = [];

  const ctaTexts = homepage.ctaTexts || [];

  // Contact: prefer contact page, fall back to homepage
  const contSource = contPage || homepage;
  const { phone, email } = parseContactClues([
    ...(contSource.contactClues || []),
    ...(homepage.contactClues  || []),
  ]);

  const tagline = homepage.siteMeta?.description || homepage.metaDescription || null;

  return {
    heroHeadline,
    heroSubheadline,
    aboutText,
    missionStatement: null,
    serviceNames:        serviceNames.slice(0, 10),
    serviceDescriptions: serviceDescriptions.slice(0, 10),
    testimonials,
    ctaTexts,
    contactInfo: { phone, email, address: null, hours: null },
    footerText:  null,
    legalText:   null,
    tagline,
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export async function scrapeClientContent(websiteUrl, { businessName = '', placeId = null } = {}) {
  const meta = {
    title:         '',
    description:   '',
    scrapedAt:     new Date().toISOString(),
    pagesScraped:  0,
    warnings:      [],
    usedBrowserless: false,
  };

  if (!websiteUrl) {
    meta.warnings.push('No website URL provided');
    return buildEmpty(meta);
  }

  let baseUrl;
  try { baseUrl = new URL(websiteUrl); }
  catch {
    meta.warnings.push('Invalid website URL');
    return buildEmpty(meta);
  }

  // ── Step 1: Multi-page raw fetch via site-fetcher ─────────────────────────
  let evidence;
  try {
    evidence = await fetchSiteEvidence(websiteUrl);
  } catch (err) {
    meta.warnings.push(`site-fetcher failed: ${err.message}`);
    return buildEmpty(meta);
  }

  if (evidence.warnings?.length) meta.warnings.push(...evidence.warnings);
  meta.pagesScraped = evidence.pages?.length || 0;

  // ── Step 2: Browserless fallback for JS-rendered sites ───────────────────
  let homepageHtml = evidence.pages?.find(p => p.type === 'homepage')?._rawHtml || '';

  if (evidence.thin) {
    meta.warnings.push('Thin content detected — attempting JS-rendered fetch via Browserless…');
    const renderedHtml = await fetchRenderedHtml(websiteUrl, { placeId });
    if (renderedHtml && renderedHtml.length > homepageHtml.length) {
      homepageHtml = renderedHtml;
      meta.usedBrowserless = true;
      meta.warnings.push('Browserless JS render succeeded — using rendered HTML.');
    } else if (!renderedHtml) {
      meta.warnings.push('Browserless not configured or failed — proceeding with static HTML.');
    }
  }

  // ── Step 3: Cheerio parse on best available homepage HTML ─────────────────
  let assets    = buildEmptyAssets();
  let structure = buildEmptyStructure();
  let colors    = { primary: null, secondary: null, accent: null, candidates: [] };
  let domServices = { serviceNames: [], serviceDescriptions: [] };
  let domTestimonials = [];

  if (homepageHtml) {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(homepageHtml);

    meta.title       = $('title').first().text().trim().slice(0, 200);
    meta.description = $('meta[name="description"]').attr('content')?.trim().slice(0, 600) || '';

    // Remove noise before DOM extraction
    $('script, style, noscript, iframe, svg').remove();

    assets          = extractAssetsFromDom($, baseUrl, businessName);
    domServices     = extractServicesFromDom($);
    domTestimonials = extractTestimonialsFromDom($);
    structure       = { ...extractStructureFromDom($), navItems: evidence.pages?.[0]?.navLabels || [] };
    colors          = extractColorsFromHtml(homepageHtml);
  }

  // ── Step 4: Map multi-page evidence to copy ───────────────────────────────
  const copy = mapEvidenceToCopy(evidence.pages || [], domServices);
  copy.testimonials = domTestimonials;

  // OG image as hero fallback
  if (assets.heroImages.length === 0 && assets.ogImage) {
    assets.heroImages.push({ url: assets.ogImage, alt: meta.title || businessName || null });
  }

  return { copy, assets, structure, colors, meta };
}

// ─── EMPTY BUILDERS ───────────────────────────────────────────────────────────

function buildEmptyAssets() {
  return {
    logo:          { url: null, alt: null, detectedBy: null },
    heroImages:    [],
    sectionImages: [],
    teamPhotos:    [],
    galleryImages: [],
    favicon:       null,
    ogImage:       null,
  };
}

function buildEmptyStructure() {
  return {
    navItems: [], sectionOrder: [],
    hasContactForm: false, hasBlog: false, hasTestimonials: false,
    hasTeamSection: false, hasGallery: false, hasPricing: false, footerColumns: 1,
  };
}

function buildEmpty(meta) {
  return {
    copy: {
      heroHeadline: null, heroSubheadline: null, aboutText: null, missionStatement: null,
      serviceNames: [], serviceDescriptions: [], testimonials: [], ctaTexts: [],
      contactInfo: { phone: null, email: null, address: null, hours: null },
      footerText: null, legalText: null, tagline: null,
    },
    assets:    buildEmptyAssets(),
    structure: buildEmptyStructure(),
    colors:    { primary: null, secondary: null, accent: null, candidates: [] },
    meta,
  };
}
