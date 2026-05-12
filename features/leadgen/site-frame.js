import { existsSync, readFileSync } from 'fs';
import path from 'path';

const FRAME_PATH = path.join(process.cwd(), 'clients/_shared/frame.html');

const DEFAULT_FRAME = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{{DESCRIPTION}}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{{CANONICAL_URL}}">
  <title>{{TITLE}}</title>
  <meta property="og:title" content="{{OG_TITLE}}">
  <meta property="og:description" content="{{OG_DESCRIPTION}}">
  <meta property="og:image" content="{{OG_IMAGE}}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{{CANONICAL_URL}}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{OG_TITLE}}">
  <meta name="twitter:description" content="{{OG_DESCRIPTION}}">
  <meta name="twitter:image" content="{{OG_IMAGE}}">
  {{FONT_LINKS}}
  <script type="application/ld+json">{{JSON_LD}}</script>
  <script>{{LLMS_SCRIPT}}</script>
  <script>{{TAILWIND_CONFIG}}</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" defer></script>
  <script src="gsap-kit.js?v=20260511" defer></script>
  {{HEAD_EXTRA}}
  {{STYLE}}
</head>
<body class="font-body antialiased text-slate-950 bg-white">
  <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-slate-950 focus:shadow-lg">Skip to content</a>
  {{BODY}}
</body>
</html>`;

function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== '—' ? text : fallback;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeScriptJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function firstDefined(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === 'string' && cleanText(value)) return value;
    if (value && typeof value === 'object' && Object.keys(value).length) return value;
    if (typeof value === 'number') return value;
  }
  return null;
}

function parseContentJson(contentJson) {
  if (!contentJson) return {};
  if (typeof contentJson === 'string') {
    try { return JSON.parse(contentJson); } catch { return {}; }
  }
  return contentJson;
}

function getBusinessName({ contentJson, prospect }) {
  const copy = contentJson.copy || {};
  return cleanText(firstDefined(
    copy.businessName,
    contentJson.businessName,
    contentJson.name,
    prospect?.name,
  ), 'Local Business');
}

function getServices(contentJson) {
  const copy = contentJson.copy || {};
  const services = firstDefined(copy.serviceNames, copy.services, contentJson.services, []);
  if (!Array.isArray(services)) return [];
  return services
    .map((service) => typeof service === 'string' ? service : service?.name || service?.title)
    .map((service) => cleanText(service))
    .filter(Boolean);
}

function getContact({ contentJson, prospect }) {
  const copy = contentJson.copy || {};
  const ci = copy.contactInfo || contentJson.contactInfo || {};
  return {
    phone:   cleanText(firstDefined(ci.phone, contentJson.phone, prospect?.phone)),
    email:   cleanText(firstDefined(ci.email, contentJson.email, prospect?.email)),
    address: cleanText(firstDefined(ci.address, contentJson.address, prospect?.address)),
    hours:   cleanText(firstDefined(ci.hours, contentJson.hours, prospect?.hours)),
  };
}

function getCanonical({ contentJson, prospect }) {
  return cleanText(firstDefined(
    contentJson.canonicalUrl,
    contentJson.url,
    contentJson.website,
    prospect?.website,
  ), 'https://example.com/');
}

function getDescription({ contentJson, prospect, businessName, services }) {
  const copy = contentJson.copy || {};
  const description = cleanText(firstDefined(
    contentJson.metaDescription,
    contentJson.description,
    copy.metaDescription,
    copy.heroSubheadline,
    copy.tagline,
    prospect?.description,
  ));
  if (description) return description.slice(0, 240);
  return `${businessName} provides ${services.slice(0, 3).join(', ') || 'local services'} with a modern, customer-focused experience.`;
}

function getOgImage({ contentJson, prospect }) {
  const assetManifest = prospect?.generation?.assetManifest || contentJson.assetManifest || {};
  const heroImages = assetManifest.heroImages || [];
  const sectionImages = assetManifest.sectionImages || [];
  return cleanText(firstDefined(
    contentJson.ogImage,
    contentJson.og?.image,
    contentJson.openGraph?.image,
    assetManifest.ogImage,
    assetManifest.logo,
    heroImages[0],
    sectionImages[0],
    prospect?.thumbnail,
    prospect?.image,
  ));
}

function findColor(source, names) {
  if (!source || typeof source !== 'object') return null;
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
      return value.trim();
    }
  }
  for (const value of Object.values(source)) {
    if (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
      return value.trim();
    }
    if (value && typeof value === 'object') {
      const nested = findColor(value, names);
      if (nested) return nested;
    }
  }
  return null;
}

function getTheme(contentJson, prospect) {
  const sources = [
    contentJson.theme,
    contentJson.designTokens,
    contentJson.brand,
    contentJson.brandSystem,
    prospect?.brandGuide,
    prospect?.userUploads?.brandSystem?.brandGuideV2,
  ].filter(Boolean);

  const palette = sources.reduce((acc, source) => Object.assign(acc, source.palette || source.colors || source.colorSystem || {}), {});
  const typography = sources.reduce((acc, source) => Object.assign(acc, source.typography || source.fonts || source.typography_system || {}), {});

  return {
    primary:   findColor(palette, ['primary', 'brand', 'main']) || '#0f172a',
    secondary: findColor(palette, ['secondary', 'support', 'muted']) || '#475569',
    accent:    findColor(palette, ['accent', 'highlight', 'cta']) || '#14b8a6',
    heading:   cleanText(firstDefined(typography.heading, typography.headline, typography.display, typography.headingFont), 'Inter'),
    body:      cleanText(firstDefined(typography.body, typography.bodyFont, typography.sans), 'Inter'),
  };
}

function fontFamilyName(value) {
  if (!value) return null;
  const first = String(value).split(',')[0].replace(/['"]/g, '').trim();
  return first || null;
}

function buildFontLinks(theme) {
  const fonts = [...new Set([fontFamilyName(theme.heading), fontFamilyName(theme.body)].filter(Boolean))];
  const googleFonts = fonts.filter((font) => !/^(system-ui|sans-serif|serif|monospace|arial|helvetica|georgia)$/i.test(font));
  if (!googleFonts.length) return '';
  const families = googleFonts
    .map((font) => `family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700;800`)
    .join('&');
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`,
  ].join('\n  ');
}

function buildJsonLd({ businessName, canonicalUrl, contact, services }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: businessName,
    url: canonicalUrl,
  };
  if (contact.phone) schema.telephone = contact.phone;
  if (contact.email) schema.email = contact.email;
  if (contact.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: contact.address,
    };
  }
  if (contact.hours) schema.openingHours = contact.hours;
  if (services.length) {
    schema.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: `${businessName} services`,
      itemListElement: services.map((name) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name },
      })),
    };
  }
  return schema;
}

function buildTailwindConfig(theme) {
  return `window.tailwind = window.tailwind || {};
window.tailwind.config = ${safeScriptJson({
    theme: {
      extend: {
        colors: {
          brand: {
            primary: theme.primary,
            secondary: theme.secondary,
            accent: theme.accent,
          },
        },
        fontFamily: {
          heading: [fontFamilyName(theme.heading) || 'Inter', 'sans-serif'],
          body: [fontFamilyName(theme.body) || 'Inter', 'sans-serif'],
        },
      },
    },
  })};`;
}

export function normalizeGeneratedBody(rawHtml) {
  let body = String(rawHtml || '').trim();
  const warnings = [];

  if (body.startsWith('```')) {
    body = body.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    warnings.push('Removed markdown fence from generated output');
  }

  const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    body = bodyMatch[1].trim();
    warnings.push('Extracted body from full HTML output');
  }

  body = body
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .trim();

  const styles = [];
  body = body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    styles.push(match);
    return '';
  }).trim();

  body = body
    .replace(/<script\b[^>]*src=["'][^"']*(cdn\.tailwindcss\.com|gsap\.min\.js|ScrollTrigger\.min\.js|gsap-kit\.js)[^"']*["'][^>]*><\/script>/gi, '')
    .trim();

  if (!/<main\b/i.test(body)) {
    body = `<main id="main">\n${body}\n</main>`;
    warnings.push('Wrapped generated body in <main id="main">');
  } else if (!/<main\b[^>]*\bid=["']main["']/i.test(body)) {
    body = body.replace(/<main\b([^>]*)>/i, '<main id="main"$1>');
    warnings.push('Added id="main" to generated <main>');
  }

  return { bodyHtml: body, styleHtml: styles.join('\n'), warnings };
}

export function buildSiteFrame({ rawHtml, bodyHtml, styleHtml = '', contentJson = {}, prospect = {}, headExtra = '' }) {
  const parsedContent = parseContentJson(contentJson);
  const businessName = getBusinessName({ contentJson: parsedContent, prospect });
  const services = getServices(parsedContent);
  const contact = getContact({ contentJson: parsedContent, prospect });
  const canonicalUrl = getCanonical({ contentJson: parsedContent, prospect });
  const description = getDescription({ contentJson: parsedContent, prospect, businessName, services });
  const ogImage = getOgImage({ contentJson: parsedContent, prospect });
  const theme = getTheme(parsedContent, prospect);
  const normalized = bodyHtml == null ? normalizeGeneratedBody(rawHtml) : { bodyHtml, styleHtml: '', warnings: [] };
  const frame = existsSync(FRAME_PATH) ? readFileSync(FRAME_PATH, 'utf8') : DEFAULT_FRAME;
  const jsonLd = buildJsonLd({ businessName, canonicalUrl, contact, services });
  const llms = {
    business: businessName,
    services,
    location: contact.address,
  };

  const replacements = {
    TITLE: `${businessName} | Modern Local Business Website`,
    DESCRIPTION: description,
    CANONICAL_URL: canonicalUrl,
    OG_TITLE: `${businessName} | Modern Local Business Website`,
    OG_DESCRIPTION: description,
    OG_IMAGE: ogImage,
    BUSINESS_NAME: businessName,
    FONT_LINKS: buildFontLinks(theme),
    JSON_LD: safeScriptJson(jsonLd),
    LLMS_SCRIPT: `window.__llms = ${safeScriptJson(llms)};`,
    TAILWIND_CONFIG: buildTailwindConfig(theme),
    HEAD_EXTRA: headExtra,
    STYLE: [styleHtml, normalized.styleHtml].filter(Boolean).join('\n'),
    BODY: normalized.bodyHtml,
  };

  let html = frame;
  for (const [key, value] of Object.entries(replacements)) {
    const escaped = ['FONT_LINKS', 'JSON_LD', 'LLMS_SCRIPT', 'TAILWIND_CONFIG', 'HEAD_EXTRA', 'STYLE', 'BODY'].includes(key)
      ? String(value || '')
      : escapeHtml(value || '');
    html = html.replaceAll(`{{${key}}}`, escaped);
  }
  return { html, warnings: normalized.warnings };
}

export function validateGeneratedBody(bodyHtml) {
  const issues = [];
  if (/<\/?(html|head|body)\b/i.test(bodyHtml)) issues.push('Generated body contains html/head/body tags');
  if (/<script\b[^>]*src=["'][^"']*(cdn\.tailwindcss\.com|gsap\.min\.js|ScrollTrigger\.min\.js|gsap-kit\.js)/i.test(bodyHtml)) {
    issues.push('Generated body contains managed CDN scripts');
  }
  if (!/<main\b/i.test(bodyHtml)) issues.push('Missing <main>');
  if (!/data-gsap/i.test(bodyHtml)) issues.push('No data-gsap animation attributes');
  return issues;
}

export function validateFramedHtml(html) {
  const issues = [];
  if (!html.includes('<!DOCTYPE html') && !html.includes('<!doctype html')) issues.push('Missing DOCTYPE');
  if (!html.includes('<head>') && !html.includes('<head ')) issues.push('Missing <head>');
  if (!html.includes('</body>')) issues.push('Missing </body>');
  if (!html.includes('application/ld+json')) issues.push('Missing JSON-LD');
  if (!html.includes('og:title')) issues.push('Missing og:title');
  if (!html.includes('twitter:card')) issues.push('Missing Twitter card');
  if (!html.includes('cdn.tailwindcss.com')) issues.push('Missing Tailwind CDN');
  if (!html.includes('gsap.min.js')) issues.push('Missing GSAP CDN');
  if (!html.includes('ScrollTrigger.min.js')) issues.push('Missing ScrollTrigger CDN');
  if (!html.includes('gsap-kit.js')) issues.push('Missing gsap-kit.js');
  if (!html.includes('data-gsap')) issues.push('No data-gsap animation attributes');
  if (html.indexOf('tailwind.config') > html.indexOf('cdn.tailwindcss.com')) issues.push('Tailwind config loads after Tailwind CDN');
  return issues;
}
