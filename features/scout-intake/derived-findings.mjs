// derived-findings.mjs
//
// Deterministic, zero-cost findings derived from raw dashboard data.
// Each rule inspects a data condition and emits a finding that matches
// the solutions catalog by ID. No LLM call — pure data inspection.
//
// Usage:
//   import { deriveFindings } from './derived-findings.mjs';
//   const findings = deriveFindings('social-preview', data);
//
// To add rules for a new card:
//   1. Add entries to DERIVED_RULES with the card ID in `cardIds`
//   2. The `id` MUST match a solutions-catalog entry (or a triggers.ids alias)
//   3. The `check` function receives the full data bag and returns truthy to emit

// ── Rule definitions ─────────────────────────────────────────────────────────
//
// Each rule:
//   id        — must match a solutions-catalog entry ID or trigger alias
//   cardIds   — which card(s) this rule applies to
//   severity  — 'critical' | 'warning' | 'info'
//   label     — short human label shown in PROBLEMS tab
//   detail    — one-sentence explanation
//   check(d)  — returns truthy when the problem is present

const DERIVED_RULES = [

  // ── SITE META / SOCIAL PREVIEW ───────────────────────────────────────────

  {
    id: 'missing-meta-description',
    cardIds: ['social-preview', 'brand-tone', 'seo-performance', 'site-performance'],
    severity: 'warning',
    label: 'No meta description',
    detail: 'Your homepage is missing a meta description. Search engines will auto-generate one, often poorly.',
    check: (d) => d.siteMeta && !d.siteMeta.description,
  },
  {
    id: 'missing-og-image',
    cardIds: ['social-preview'],
    severity: 'warning',
    label: 'No Open Graph image',
    detail: 'Social shares will show a blank or auto-generated preview instead of a branded image.',
    check: (d) => d.siteMeta && !d.siteMeta.ogImage,
  },
  {
    id: 'missing-og-tags',
    cardIds: ['social-preview'],
    severity: 'warning',
    label: 'Missing OG tags',
    detail: 'Core Open Graph tags (title or description) are missing — social shares will look incomplete.',
    check: (d) => d.siteMeta && (!d.siteMeta.title || !d.siteMeta.description),
  },
  {
    id: 'missing-favicon',
    cardIds: ['social-preview', 'style-guide'],
    severity: 'info',
    label: 'No favicon',
    detail: 'Browser tabs and bookmarks show a generic icon instead of your brand mark.',
    check: (d) => d.siteMeta && !d.siteMeta.favicon,
  },
  {
    id: 'missing-apple-touch-icon',
    cardIds: ['social-preview'],
    severity: 'info',
    label: 'No Apple touch icon',
    detail: 'iOS home screen shortcuts use a blank icon instead of your brand.',
    check: (d) => d.siteMeta && !d.siteMeta.appleTouchIcon,
  },
  {
    id: 'missing-theme-color',
    cardIds: ['social-preview', 'style-guide'],
    severity: 'info',
    label: 'No theme color',
    detail: 'Mobile browsers default to grey instead of your brand color in the address bar.',
    check: (d) => d.siteMeta && !d.siteMeta.themeColor,
  },
  {
    id: 'missing-canonical',
    cardIds: ['social-preview', 'seo-performance'],
    severity: 'warning',
    label: 'No canonical URL',
    detail: 'Without a canonical tag, search engines may index duplicate versions of your pages.',
    check: (d) => d.siteMeta && !d.siteMeta.canonical,
  },
  {
    id: 'missing-og-site-name',
    cardIds: ['social-preview'],
    severity: 'info',
    label: 'No og:site_name',
    detail: 'Social platforms can\'t attribute shared links to your brand name.',
    check: (d) => d.siteMeta && !d.siteMeta.siteName,
  },

  // ── STYLE GUIDE / BRAND SNAPSHOT ─────────────────────────────────────────

  {
    id: 'no-brand-typography',
    cardIds: ['style-guide'],
    severity: 'warning',
    label: 'No brand typography detected',
    detail: 'No distinct heading or body font was identified — your site may be using browser defaults.',
    check: (d) => d.sgDisplayData && !d.sgDisplayData.typography?.headingSystem?.fontFamily && !d.sgDisplayData.typography?.bodySystem?.fontFamily,
  },
  {
    id: 'no-brand-color',
    cardIds: ['style-guide'],
    severity: 'warning',
    label: 'No primary brand color',
    detail: 'No primary color was extracted from your site — brand recognition depends on consistent color use.',
    check: (d) => d.sgDisplayData && !d.sgDisplayData.colors?.primary?.hex,
  },
  {
    id: 'thin-color-palette',
    cardIds: ['style-guide'],
    severity: 'info',
    label: 'Thin color palette',
    detail: 'Only one or two colors detected — a broader palette improves visual hierarchy and brand depth.',
    check: (d) => {
      if (!d.sgDisplayData?.colors) return false;
      const c = d.sgDisplayData.colors;
      const count = [c.primary?.hex, c.secondary?.hex, c.tertiary?.hex, c.neutral?.hex].filter(Boolean).length;
      return count > 0 && count < 3;
    },
  },

  // ── CONVERSION / LANDING PAGE ────────────────────────────────────────────

  {
    id: 'no-primary-cta',
    cardIds: ['website-landing', 'trust-credibility'],
    severity: 'warning',
    label: 'No CTA detected',
    detail: 'No call-to-action text was found on the homepage — visitors have no clear next step.',
    check: (d) => d.homePage && (!d.homePage.ctaTexts || d.homePage.ctaTexts.length === 0),
  },
  {
    id: 'no-hero-value-prop',
    cardIds: ['website-landing', 'brand-voice'],
    severity: 'warning',
    label: 'No hero headline / value prop',
    detail: 'No H1 heading or hero statement was found — visitors can\'t quickly understand what you offer.',
    check: (d) => d.homePage && (!d.homePage.h1 || d.homePage.h1.length === 0) && !d.brandOverview?.headline,
  },
  {
    id: 'no-contact-signals',
    cardIds: ['website-landing', 'trust-credibility'],
    severity: 'info',
    label: 'No contact information',
    detail: 'No email, phone, or contact form clues were found — visitors can\'t reach you easily.',
    check: (d) => d.homePage && (!d.homePage.contactClues || d.homePage.contactClues.length === 0),
  },

  // ── BRAND IDENTITY ───────────────────────────────────────────────────────

  {
    id: 'thin-brand-positioning',
    cardIds: ['brand-voice', 'business-model'],
    severity: 'warning',
    label: 'Thin brand positioning',
    detail: 'No clear positioning statement or differentiator was extracted from your site copy.',
    check: (d) => d.brandOverview && !d.brandOverview.positioning,
  },
  {
    id: 'generic-target-audience',
    cardIds: ['brand-voice', 'business-model'],
    severity: 'info',
    label: 'No target audience identified',
    detail: 'Your site copy doesn\'t clearly signal who the product or service is for.',
    check: (d) => d.brandOverview && !d.brandOverview.targetAudience,
  },

  // ── SEO / PERFORMANCE ────────────────────────────────────────────────────

  {
    id: 'performance-critical',
    cardIds: ['seo-performance', 'site-performance'],
    severity: 'critical',
    label: 'Performance score critical',
    detail: 'PageSpeed performance score is under 30 — your site is significantly slower than most.',
    check: (d) => d.seoAudit?.scores?.performance != null && d.seoAudit.scores.performance < 30,
  },
  {
    id: 'performance-warning',
    cardIds: ['seo-performance', 'site-performance'],
    severity: 'warning',
    label: 'Performance score needs work',
    detail: 'PageSpeed performance score is under 60 — load times are impacting user experience.',
    check: (d) => {
      const p = d.seoAudit?.scores?.performance;
      return p != null && p >= 30 && p < 60;
    },
  },
  {
    id: 'lcp-critical',
    cardIds: ['seo-performance', 'site-performance'],
    severity: 'critical',
    label: 'Largest Contentful Paint critical',
    detail: 'LCP exceeds 4 seconds — the main content takes too long to appear.',
    check: (d) => {
      const lcp = d.seoAudit?.coreWebVitals?.lcp || d.seoAudit?.labCoreWebVitals?.lcp;
      if (!lcp) return false;
      const ms = typeof lcp === 'string' ? parseFloat(lcp) * (lcp.includes('s') && !lcp.includes('ms') ? 1000 : 1) : lcp;
      return ms > 4000;
    },
  },
  {
    id: 'lcp-warning',
    cardIds: ['seo-performance', 'site-performance'],
    severity: 'warning',
    label: 'Largest Contentful Paint slow',
    detail: 'LCP is between 2.5–4 seconds — the main content is slower than recommended.',
    check: (d) => {
      const lcp = d.seoAudit?.coreWebVitals?.lcp || d.seoAudit?.labCoreWebVitals?.lcp;
      if (!lcp) return false;
      const ms = typeof lcp === 'string' ? parseFloat(lcp) * (lcp.includes('s') && !lcp.includes('ms') ? 1000 : 1) : lcp;
      return ms >= 2500 && ms <= 4000;
    },
  },
  {
    id: 'no-schema-markup',
    cardIds: ['seo-performance', 'visibility-snapshot'],
    severity: 'warning',
    label: 'No structured data / schema',
    detail: 'No schema markup detected — search engines and AI can\'t parse your content as structured data.',
    check: (d) => d.aiSeoAudit && (!d.aiSeoAudit.rawSignals?.schema?.types || d.aiSeoAudit.rawSignals.schema.types.length === 0),
  },

  // ── AI VISIBILITY ────────────────────────────────────────────────────────

  {
    id: 'missing-llms-txt',
    cardIds: ['visibility-snapshot'],
    severity: 'info',
    label: 'No llms.txt found',
    detail: 'Your site has no llms.txt — AI models can\'t read structured context about your business.',
    check: (d) => d.aiSeoAudit && d.aiSeoAudit.rawSignals?.llmsTxt?.found === false,
  },
  {
    id: 'ai-bots-blocked-generic',
    cardIds: ['visibility-snapshot'],
    severity: 'warning',
    label: 'AI bots blocked by robots.txt',
    detail: 'Your robots.txt blocks one or more AI crawlers — this limits your visibility in AI-powered search.',
    check: (d) => {
      const blocked = d.aiSeoAudit?.rawSignals?.robotsAi?.blockedBots;
      return Array.isArray(blocked) && blocked.length > 0;
    },
  },
  {
    id: 'no-wikidata-entity',
    cardIds: ['visibility-snapshot'],
    severity: 'info',
    label: 'No Wikidata entity',
    detail: 'No Wikidata entry found for your brand — AI models have less authoritative context to reference.',
    check: (d) => d.aiSeoAudit && !d.aiSeoAudit.rawSignals?.entity?.qid,
  },

  // ── SITE EVIDENCE / CONTENT ──────────────────────────────────────────────

  {
    id: 'run-single-page',
    cardIds: ['content-gaps', 'trust-credibility'],
    severity: 'info',
    label: 'Only homepage was crawled',
    detail: 'No About, Services, or Contact pages were found — analysis is based on a single page.',
    check: (d) => {
      const pages = d.pages;
      return Array.isArray(pages) && pages.length === 1;
    },
  },
  {
    id: 'run-evidence-thin',
    cardIds: ['brand-voice', 'content-gaps', 'business-model'],
    severity: 'warning',
    label: 'Thin site content',
    detail: 'Very little text was extracted from your site — not enough signal for confident analysis.',
    check: (d) => {
      const body = d.homePage?.bodyParagraphs;
      return d.homePage && (!body || body.length === 0);
    },
  },

  // ── PLATFORM / SOCIAL COVERAGE ───────────────────────────────────────────

  {
    id: 'brand-on-default-platform',
    cardIds: ['platform-coverage'],
    severity: 'info',
    label: 'No social links detected',
    detail: 'No social media links were found on your site — platform coverage can\'t be assessed.',
    check: (d) => d.homePage && (!d.homePage.socialLinks || d.homePage.socialLinks.length === 0),
  },

  // ── TRUST & CREDIBILITY ──────────────────────────────────────────────────

  {
    id: 'nap-inconsistency',
    cardIds: ['trust-credibility'],
    severity: 'info',
    label: 'No NAP signals found',
    detail: 'No name, address, or phone signals were detected — trust and local SEO both suffer.',
    check: (d) => d.homePage && (!d.homePage.contactClues || d.homePage.contactClues.length === 0) && !d.siteMeta,
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Derive deterministic findings for a card from raw dashboard data.
 * Returns only findings whose checks pass — ready to merge into
 * analyzer.findings for solutions catalog matching.
 *
 * @param {string} cardId
 * @param {object} data - bag of raw dashboard data:
 *   { siteMeta, brandOverview, sgDisplayData, seoAudit, aiSeoAudit,
 *     aiVisibility, homePage, pages, client, ... }
 * @returns {Array<{ id, severity, label, detail, citation, derived }>}
 */
export function deriveFindings(cardId, data) {
  if (!cardId || !data) return [];

  const seen = new Set();
  const out = [];

  for (const rule of DERIVED_RULES) {
    if (!rule.cardIds.includes(cardId)) continue;
    if (seen.has(rule.id)) continue; // one finding per ID per card
    try {
      if (rule.check(data)) {
        seen.add(rule.id);
        out.push({
          id: rule.id,
          severity: rule.severity,
          label: rule.label,
          detail: rule.detail,
          citation: `derived:${rule.id}`,
          derived: true,
        });
      }
    } catch {
      // guard against data shape surprises — skip silently
    }
  }

  return out;
}
