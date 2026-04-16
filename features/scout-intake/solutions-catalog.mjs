// solutions-catalog.js — Plain-language solutions mapped to analyzer findings.
//
// Each entry pairs a diagnostic finding (from an analyzer skill) with a
// concrete, action-oriented solution. Two paths per entry:
//
//   diy          — steps the site owner can take themselves, with time
//                  estimate, skill level, and helpful links.
//   expertOffer  — one-sentence pitch + turnaround + CTA when they'd rather
//                  hand it off.
//
// Matching (resolveSolution): priority order
//   1. finding.solutionId === entry.id          (explicit — forward-compat)
//   2. finding.id === entry.id                  (direct id match)
//   3. triggers.citationIncludes substring hit  (stable payload paths)
//   4. triggers.labelIncludes substring hit     (last-resort fuzzy)
//
// Authored content, not LLM-generated. Edit here to change user-facing copy.
// When a new card's skill lands, add its entries to this file.

const CALENDLY_BASE = 'https://calendly.com/bballi/30min';

function calendlyUrl(solutionId) {
  const params = new URLSearchParams({
    utm_source:   'dashboard',
    utm_medium:   'solutions-tab',
    utm_campaign: solutionId,
  });
  return `${CALENDLY_BASE}?${params.toString()}`;
}

export const SOLUTIONS_CATALOG = [
  // ────────────────────────────────────────────────────────────────────────
  // Meta description missing
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'missing-meta-description',
    category: 'seo',
    severity: 'critical',
    triggers: {
      ids: ['missing-meta-description', 'meta-description'],
      citationIncludes: ["seoRedFlags", "meta-description", "metaDescription"],
      labelIncludes: ['meta description'],
    },
    problem: 'Your pages are missing meta descriptions.',
    whyItMatters:
      "The meta description is the 1-2 sentence preview Google shows under your page title in search results. When it's missing, Google auto-generates one — usually pulling from the first bit of page text, which often reads as filler. A written description typically lifts click-through rate by 5-20%. This is one of the cheapest, highest-return SEO fixes you can make.",
    diy: {
      summary: 'Add a short description to each page\'s HTML head.',
      steps: [
        'Pick your top 5-10 pages (homepage, About, Services, top landing pages).',
        'For each page, write a 150-160 character summary that names what the page offers and one concrete benefit.',
        'Use the visitor\'s language, not yours. If a customer would search "voice AI for small business," use those words — not "conversational AI platform."',
        'Add it to the <head> of the page: <meta name="description" content="Your 155-char summary here." />',
        'Verify with Google\'s Rich Results Test or View Source on the live page.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google: Create good meta descriptions', url: 'https://developers.google.com/search/docs/appearance/snippet' },
      ],
    },
    expertOffer: {
      title: "I'll write all your meta descriptions in 24 hours.",
      summary:
        'I review your top pages, write SEO-tuned meta descriptions based on real keyword data, deploy them, and validate they appear in search snippets.',
      turnaround: '24 hours',
      deliverable: 'Deployed and validated meta descriptions for up to 10 key pages.',
      cta: { label: 'Book a 30-min fix call', href: calendlyUrl('missing-meta-description') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LCP critical (> 4s)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'lcp-critical',
    category: 'performance',
    severity: 'critical',
    triggers: {
      ids: ['lcp-critical', 'lcp-slow'],
      citationIncludes: ['labCoreWebVitals.lcp', 'coreWebVitals.lcp'],
      labelIncludes: ['largest contentful paint', 'lcp', 'paint exceeds', 'paint critically'],
    },
    problem: 'Your largest page element takes too long to load.',
    whyItMatters:
      "Largest Contentful Paint (LCP) measures when the biggest thing on screen — usually your hero image or headline — is visible to a visitor. Google uses it as a ranking signal and users bail when it's slow. When LCP is above 4 seconds, you're losing both ranking and real people. Above 10 seconds, many visitors close the tab before your page even finishes loading.",
    diy: {
      summary: 'Identify what your "largest contentful paint element" is and make it render faster.',
      steps: [
        'Open PageSpeed Insights (pagespeed.web.dev) and enter your URL.',
        'In the report, find the "Largest Contentful Paint element" — a screenshot and HTML snippet will be shown. Usually this is a hero image or an H1 above the fold.',
        'If it\'s an image: compress it to WebP or AVIF format, set explicit width/height, and add fetchpriority="high".',
        'If it\'s a font-rendered heading: add font-display: swap in your CSS and preload the font file.',
        'Remove render-blocking scripts above your LCP element (defer or async them).',
        'Re-run PageSpeed Insights and confirm LCP dropped below 2.5s.',
      ],
      estimatedTime: '2-6 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Google: Optimize LCP', url: 'https://web.dev/articles/optimize-lcp' },
        { label: 'Squoosh (image compressor)', url: 'https://squoosh.app' },
      ],
    },
    expertOffer: {
      title: "I'll get your LCP under 2.5 seconds.",
      summary:
        'I audit your critical rendering path, optimize images, preload fonts, defer third-party scripts, and ship the changes to production. We\'ll measure before/after on the same device.',
      turnaround: '3-5 days',
      deliverable: 'LCP reduced to pass threshold on mobile, verified on PageSpeed Insights.',
      cta: { label: 'Book a performance audit', href: calendlyUrl('lcp-critical') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LCP warning (2.5-4s)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'lcp-warning',
    category: 'performance',
    severity: 'warning',
    triggers: {
      ids: ['lcp-warning', 'lcp-average'],
      citationIncludes: [],
      labelIncludes: ['lcp in average', 'lcp metric in average', 'largest contentful paint in average'],
    },
    problem: 'Your page takes a beat too long to render the main content.',
    whyItMatters:
      "Your LCP is in the 'needs improvement' range — between 2.5 and 4 seconds. It's not catastrophic, but Google docks mobile rankings for sites that haven't hit the 2.5s threshold. On slower networks or older phones, that extra second or two feels much longer. You're leaking a measurable amount of traffic to faster competitors.",
    diy: {
      summary: 'Shave the hot half-second by fixing the largest rendering bottleneck.',
      steps: [
        'Run PageSpeed Insights on your homepage.',
        'Look at the "Opportunities" section — it lists the biggest wins in milliseconds.',
        'Tackle the single biggest opportunity first. Common wins: compressing the hero image, deferring analytics scripts, removing unused CSS.',
        'Measure again. One 400-600ms fix is usually enough to cross into the passing band.',
      ],
      estimatedTime: '1-3 hours',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'PageSpeed Insights', url: 'https://pagespeed.web.dev' },
      ],
    },
    expertOffer: {
      title: "Fast LCP fix — one session.",
      summary:
        'I screen-share with you, find the biggest rendering bottleneck on your site, and walk you through the fix live. You leave the call with a passing LCP.',
      turnaround: '60 minutes',
      deliverable: 'LCP under 2.5s, measured live during the call.',
      cta: { label: 'Book a 60-min session', href: calendlyUrl('lcp-warning') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Performance score warning (50-89)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'performance-warning',
    category: 'performance',
    severity: 'warning',
    triggers: {
      ids: ['performance-warning', 'moderate-performance', 'moderate-mobile-performance'],
      citationIncludes: ['scores.performance'],
      labelIncludes: ['moderate mobile performance', 'performance score', 'moderate performance'],
    },
    problem: 'Your mobile performance score has real headroom.',
    whyItMatters:
      "Your Lighthouse mobile score is in the 50-89 range — the 'needs improvement' zone. Google's ranking signals favor pages that pass all Core Web Vitals, which you're close to but not past. Every point you gain is measurably a better experience for mobile visitors, and since 60%+ of web traffic is mobile, this is where the leverage is.",
    diy: {
      summary: 'Knock out the top 3 opportunities Lighthouse is surfacing.',
      steps: [
        'Open pagespeed.web.dev and enter your URL.',
        'Scroll to the "Opportunities" and "Diagnostics" sections — these are sorted by estimated impact.',
        'Pick the top 3. Common wins: remove unused JavaScript, properly size images, eliminate render-blocking resources.',
        'Fix them one at a time and re-measure between each. Track the score as it climbs.',
        'Target is 90+. If you plateau below that, there\'s usually one specific script or asset that\'s the culprit — email support if you need help finding it.',
      ],
      estimatedTime: '3-8 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'PageSpeed Insights', url: 'https://pagespeed.web.dev' },
        { label: 'Chrome DevTools Performance tab', url: 'https://developer.chrome.com/docs/devtools/performance' },
      ],
    },
    expertOffer: {
      title: "I'll lift your mobile score into the 90s.",
      summary:
        'Performance audit + implementation. I target the highest-leverage fixes first, ship them to your production site, and measure the before/after on the same device class.',
      turnaround: '3-5 days',
      deliverable: 'Mobile Lighthouse score 90+, Core Web Vitals passing.',
      cta: { label: 'Book a performance audit', href: calendlyUrl('performance-warning') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Performance score critical (< 50)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'performance-critical',
    category: 'performance',
    severity: 'critical',
    triggers: {
      ids: ['performance-critical', 'poor-performance', 'poor-mobile-performance'],
      citationIncludes: [],
      labelIncludes: ['poor mobile performance', 'performance score — 45', '45/100', 'below 50'],
    },
    problem: 'Your mobile site is failing Google\'s performance benchmarks.',
    whyItMatters:
      "A Lighthouse score below 50 puts you in the bottom tier of the web. It signals to Google that mobile users are getting a poor experience, and it's a documented ranking factor. More tangibly: real people are closing the tab before your page finishes loading. Every visit that doesn't render becomes a visit that doesn't convert.",
    diy: {
      summary: 'This is usually structural — a bloated theme, unoptimized images, or too many third-party scripts stacked on top of each other.',
      steps: [
        'Run pagespeed.web.dev. Read the full report, not just the score.',
        'Check the "Diagnostics" → "Main-thread work" breakdown. If JavaScript execution time is above 3 seconds, that\'s your primary villain.',
        'Audit every third-party script (chat widgets, analytics, tracking pixels, A/B tools). Remove ones that aren\'t critical.',
        'Replace your hero image with a WebP version half the size.',
        'If you\'re on WordPress with a bloated theme, consider switching to a lightweight one like GeneratePress or Astra — this alone can lift scores 30+ points.',
        'Re-measure. If still below 50, honestly, this is when handing it off makes sense.',
      ],
      estimatedTime: '1-3 days',
      skillLevel: 'advanced',
      helpfulLinks: [
        { label: 'web.dev: Fast load times', url: 'https://web.dev/articles/fast' },
      ],
    },
    expertOffer: {
      title: "I'll rebuild your mobile performance from the ground up.",
      summary:
        'Full performance overhaul. I identify whether the issue is your theme, your scripts, your images, or your hosting — and fix each one until you pass every Core Web Vital.',
      turnaround: '1-2 weeks',
      deliverable: 'Mobile Lighthouse score 85+, all Core Web Vitals passing.',
      cta: { label: 'Book a diagnostic call', href: calendlyUrl('performance-critical') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // No schema markup
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-schema-markup',
    category: 'seo',
    severity: 'warning',
    triggers: {
      ids: ['no-schema-markup', 'no-structured-data'],
      citationIncludes: ['application/ld+json', 'schemaTypes', 'jsonLd', 'no application/ld+json'],
      labelIncludes: ['structured data', 'json-ld', 'schema markup', 'no structured data'],
    },
    problem: 'Your site has no structured data (JSON-LD schema markup).',
    whyItMatters:
      "Schema markup is how you tell Google what your content actually IS — not just what it says. With the right schema, Google can show rich results (star ratings, FAQs, prices, event dates) directly in search. Without it, you get the plain blue-link treatment. Schema is also the #1 signal AI search engines (ChatGPT, Perplexity, Google AI Overviews) use to decide whether to cite your site. Leaving it off means you're invisible to the fastest-growing discovery channel.",
    diy: {
      summary: 'Add JSON-LD schema markup to your homepage and content pages.',
      steps: [
        'Identify what type of business/content you have. Common options: LocalBusiness, Organization, Product, Article, FAQPage, Service.',
        'Use a schema generator like schema.dev or technicalseo.com/tools/schema-markup-generator to build your JSON-LD block.',
        'Fill in real values: business name, address, phone, website, hours, services/products offered.',
        'Paste the <script type="application/ld+json"> block into the <head> of every relevant page.',
        'Test each page with Google\'s Rich Results Test (search.google.com/test/rich-results) to confirm the schema is valid.',
        'Monitor Search Console over 2-4 weeks — you should start seeing rich result impressions appear.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'schema.org', url: 'https://schema.org' },
        { label: 'Google Rich Results Test', url: 'https://search.google.com/test/rich-results' },
      ],
    },
    expertOffer: {
      title: "I'll deploy complete schema markup for your site.",
      summary:
        'I identify every eligible schema type for your business (LocalBusiness, Service, FAQ, Review, etc.), write validated JSON-LD for each page, and verify rich result eligibility in Search Console.',
      turnaround: '3-5 days',
      deliverable: 'Fully deployed schema markup + rich result eligibility confirmed on 5-15 pages.',
      cta: { label: 'Book a schema deployment', href: calendlyUrl('no-schema-markup') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Missing OG tags
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'missing-og-tags',
    category: 'seo',
    severity: 'warning',
    triggers: {
      ids: ['missing-og-tags', 'no-og-image', 'missing-og-image'],
      citationIncludes: ['ogImage', 'og:image', 'og:title', 'og:description'],
      labelIncludes: ['og tag', 'og image', 'og title', 'og description', 'social sharing preview', 'open graph'],
    },
    problem: 'Your site has no social sharing preview tags.',
    whyItMatters:
      "When someone shares your URL on LinkedIn, X, Slack, WhatsApp, or iMessage, Open Graph tags control what appears — the headline, the description, the preview image. Without them, you get a blank box with just the URL. Studies show posts with rich previews get 2-3x more clicks than plain links. Every share of your site right now is underselling you.",
    diy: {
      summary: 'Add Open Graph meta tags to your HTML head.',
      steps: [
        'Design a 1200x630px preview image with your logo, a short headline, and your brand colors.',
        'Upload it to your server and note the URL.',
        'In the <head> of each page, add:\n<meta property="og:title" content="Your page title" />\n<meta property="og:description" content="Your 1-sentence summary" />\n<meta property="og:image" content="https://yoursite.com/preview.png" />\n<meta property="og:type" content="website" />\n<meta property="og:url" content="https://yoursite.com/this-page" />',
        'For Twitter/X support, add <meta name="twitter:card" content="summary_large_image" />',
        'Validate with opengraph.xyz and the LinkedIn Post Inspector.',
      ],
      estimatedTime: '45-90 minutes (plus image design)',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Open Graph Protocol docs', url: 'https://ogp.me' },
        { label: 'opengraph.xyz (validator)', url: 'https://www.opengraph.xyz' },
      ],
    },
    expertOffer: {
      title: "I'll design + deploy your social preview system.",
      summary:
        'Custom 1200x630 preview image designed in your brand style, OG + Twitter Card tags deployed across every page, validated on LinkedIn, X, Slack, and iMessage.',
      turnaround: '2-3 days',
      deliverable: 'Live OG preview on every page, rich previews everywhere.',
      cta: { label: 'Book a social preview setup', href: calendlyUrl('missing-og-tags') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Redirect chain
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'redirect-chain',
    category: 'performance',
    severity: 'info',
    triggers: {
      ids: ['redirect-chain', 'multiple-redirects'],
      citationIncludes: ["opportunities", "'redirects'"],
      labelIncludes: ['redirect chain', 'multiple page redirects', 'redirect'],
    },
    problem: 'Your site has a redirect chain adding latency to every visit.',
    whyItMatters:
      "When someone types your domain, their browser may be bounced through 2 or 3 URLs before it lands on the real page (typically http → https → www or similar). Each bounce is a round-trip to your server — that\'s hundreds of milliseconds that add up. Mobile users on spotty connections feel this most. It\'s also a minor crawl-budget waste for Googlebot.",
    diy: {
      summary: 'Configure your server to send users directly to the final URL.',
      steps: [
        'Test your canonical URL: type yoursite.com (no http, no www) into a browser and watch the URL bar as it loads.',
        'If it changes twice (e.g. http://yoursite.com → https://yoursite.com → https://www.yoursite.com), you have a chain.',
        'Update your server config (nginx, Apache, Cloudflare Page Rules, Netlify _redirects, Vercel rewrites) to redirect directly to the final URL in one hop.',
        'Example for Cloudflare: Page Rule that matches http://*yoursite.com/* and redirects 301 to https://www.yoursite.com/$1.',
        'Test again — the URL should change exactly once during load.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Redirect testing tool (httpstatus.io)', url: 'https://httpstatus.io' },
      ],
    },
    expertOffer: {
      title: "I'll fix your redirect chain in a single session.",
      summary:
        'Quick 30-min session. I identify your hosting setup, update the redirect configuration, and verify the chain is gone before we hang up.',
      turnaround: '30 minutes',
      deliverable: 'Single-hop redirects, verified live.',
      cta: { label: 'Book a 30-min fix', href: calendlyUrl('redirect-chain') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Unused JavaScript
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'unused-javascript',
    category: 'performance',
    severity: 'info',
    triggers: {
      ids: ['unused-javascript', 'reduce-unused-js'],
      citationIncludes: ["'unused-javascript'"],
      labelIncludes: ['unused javascript', 'reduce unused js', 'reduce javascript'],
    },
    problem: 'Your site ships JavaScript the browser never uses.',
    whyItMatters:
      "Every kilobyte of JavaScript your page loads has to be downloaded, parsed, compiled, and (often) executed before the page is fully interactive. When a chunk of that JS is for a feature on a different page — or a library you\'re using 2% of — you\'re charging visitors the full cost for work they get nothing from. This specifically hurts Time to Interactive and Total Blocking Time.",
    diy: {
      summary: 'Audit your JavaScript bundles and remove or defer the dead weight.',
      steps: [
        'Open Chrome DevTools → Coverage tab (Cmd+Shift+P → "Show Coverage"). Reload the page.',
        'Look at the percentage of unused JS per file. Anything above 50% is a candidate.',
        'Common culprits: jQuery loaded but barely used, Bootstrap/Material Design frameworks when you only use 2 components, analytics or tag managers loading all at once.',
        'For third-party scripts that aren\'t immediately needed (chat, analytics, pixels), add the defer attribute to the script tag.',
        'For first-party code, switch to code-splitting: only load the JavaScript each page actually needs.',
        'Re-run PageSpeed Insights — you should see the opportunity shrink or disappear.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'advanced',
      helpfulLinks: [
        { label: 'web.dev: Remove unused JavaScript', url: 'https://web.dev/articles/remove-unused-code' },
      ],
    },
    expertOffer: {
      title: "I'll prune your JavaScript bundles.",
      summary:
        'Bundle audit + cleanup. I map what\'s actually being used, remove the dead libraries, defer the non-critical ones, and ship code-splitting where it helps. Typical result: 1-3 seconds faster Time to Interactive.',
      turnaround: '2-4 days',
      deliverable: 'Reduced JS bundle, measured improvement on PageSpeed Insights.',
      cta: { label: 'Book a JS cleanup', href: calendlyUrl('unused-javascript') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // No contact / E-E-A-T signals
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-contact-signals',
    category: 'seo',
    severity: 'critical',
    triggers: {
      ids: ['no-contact-signals', 'no-trust-signals'],
      citationIncludes: ['contactClues'],
      labelIncludes: ['contact signal', 'trust signal', 'no contact', 'no trust', 'about or contact'],
    },
    problem: 'Your site has no visible contact information or trust signals.',
    whyItMatters:
      "Google\'s E-E-A-T guidelines (Expertise, Experience, Authoritativeness, Trustworthiness) weight contact info, About pages, and team presence heavily — especially for service businesses and any page that touches money, health, or decisions. Beyond rankings: visitors won\'t convert if they can\'t verify you\'re a real business. No email, no phone, no address, no team page all sends the same signal: \"we\'re hiding something.\" Fixing this is usually the single highest-ROI change on a sparse website.",
    diy: {
      summary: 'Add real, verifiable contact information and a person behind the business.',
      steps: [
        'Create (or link prominently from your homepage) a Contact page with: email address (not just a form), phone number, physical address if applicable, and business hours.',
        'Create (or link) an About page that includes a photo of you or your team, a short story about who you are and why you do this work, and any credentials.',
        'Put contact info in your footer on every page — email, phone, physical address (or city + state).',
        'Add LocalBusiness or Organization schema markup (see the "structured data" solution for details).',
        'If you have real reviews or testimonials, feature 2-3 on your homepage with the reviewer\'s full name and a photo if possible.',
      ],
      estimatedTime: '3-6 hours (plus photo time if needed)',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google E-E-A-T guidelines', url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content' },
      ],
    },
    expertOffer: {
      title: "I'll build your trust layer: About + Contact + proof.",
      summary:
        'I write your About and Contact pages, design a trust-signal footer, deploy Organization/LocalBusiness schema, and help you stage authentic photos if needed. This is the single change that tends to most lift conversion and E-E-A-T signals.',
      turnaround: '5-7 days',
      deliverable: 'Live About page, Contact page, schema, and trust-signal footer across every page.',
      cta: { label: 'Book a trust layer build', href: calendlyUrl('no-contact-signals') },
    },
  },
];

// ── Index for fast lookup by id ──────────────────────────────────────────────

export const SOLUTIONS_BY_ID = SOLUTIONS_CATALOG.reduce((acc, entry) => {
  acc[entry.id] = entry;
  return acc;
}, {});

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve a finding or gap to a catalog entry.
 *
 * Priority (first match wins):
 *   1. Explicit finding.solutionId (forward-compat — skill-emitted)
 *   2. finding.id direct match
 *   3. citationIncludes substring
 *   4. labelIncludes substring (case-insensitive)
 *
 * Returns the catalog entry or null when no match.
 *
 * @param {{ id?: string, solutionId?: string, label?: string, citation?: string, ruleId?: string, evidence?: string }} finding
 * @returns {object|null}
 */
export function resolveSolution(finding) {
  if (!finding || typeof finding !== 'object') return null;

  // 1. explicit solutionId
  if (finding.solutionId && SOLUTIONS_BY_ID[finding.solutionId]) {
    return SOLUTIONS_BY_ID[finding.solutionId];
  }

  // 2. direct id match (works for gaps too — gap.ruleId)
  const directId = finding.id || finding.ruleId || null;
  if (directId && SOLUTIONS_BY_ID[directId]) {
    return SOLUTIONS_BY_ID[directId];
  }

  // 3 + 4. triggers match
  const citation = String(finding.citation || finding.evidence || '').toLowerCase();
  const label    = String(finding.label || finding.ruleId || '').toLowerCase();

  for (const entry of SOLUTIONS_CATALOG) {
    const triggers = entry.triggers || {};

    // id alias match
    if (Array.isArray(triggers.ids)) {
      for (const alias of triggers.ids) {
        if (directId && directId === alias) return entry;
      }
    }

    // citation substring match
    if (citation && Array.isArray(triggers.citationIncludes)) {
      for (const needle of triggers.citationIncludes) {
        if (needle && citation.includes(String(needle).toLowerCase())) return entry;
      }
    }

    // label substring match
    if (label && Array.isArray(triggers.labelIncludes)) {
      for (const needle of triggers.labelIncludes) {
        if (needle && label.includes(String(needle).toLowerCase())) return entry;
      }
    }
  }

  return null;
}

/**
 * Build a generic fallback solution from a finding/gap when no catalog entry
 * matches. Uses the item's own data as the problem + whyItMatters, pairs it
 * with a diagnostic-call expert offer. No DIY steps — we don't know the
 * specifics, so the recommendation is to diagnose together.
 *
 * @param {object} item - finding or gap
 * @param {'finding'|'gap'} source
 * @returns {object} a catalog-shaped solution object
 */
function buildGenericSolution(item, source) {
  const rawId    = item.id || item.ruleId || 'unknown';
  const label    = item.label || item.ruleId || 'Issue detected';
  const rawWhy   = item.impact || item.detail || item.evidence || '';
  const severity = item.severity || 'warning';

  // Action-oriented copy for critical/warning/triggered-gap items. Review-oriented
  // copy for info items (optimization opportunities, neutral observations, or
  // positive signals worth maintaining).
  const isAction = severity === 'critical' || severity === 'warning' || source === 'gap';

  const expertOffer = isAction
    ? {
        title: "I'll diagnose and fix this for you.",
        summary:
          "On a 30-minute call I'll walk through this issue on your site live, identify the root cause, and give you a clear action plan — or fix it directly if it's quick.",
        turnaround: '30-minute call',
        deliverable: 'A clear action plan or a direct fix, depending on complexity.',
        cta: { label: 'Book a diagnostic call', href: calendlyUrl(`generic-${rawId}`) },
      }
    : {
        title: "Let's review this together.",
        summary:
          "Book a 30-minute call and I'll walk through this specifically for your site — whether it's an optimization worth making, a signal to maintain, or something to monitor as you grow.",
        turnaround: '30-minute call',
        deliverable: 'A clear take on whether this matters for your site and what (if anything) to do about it.',
        cta: { label: 'Book a review call', href: calendlyUrl(`generic-${rawId}`) },
      };

  return {
    id: `generic-${source}-${rawId}`,
    category: 'generic',
    severity,
    problem: label,
    whyItMatters:
      rawWhy ||
      (isAction
        ? "This was flagged as an issue on your site. The specifics need a closer look — what's impacting it, how much it's costing you, and what the cleanest fix looks like."
        : "This was flagged as an observation about your site. Whether it's worth acting on depends on your goals and priorities."),
    diy: null,  // no step-by-step for generic — we don't know enough
    expertOffer,
  };
}

/**
 * Build the ordered list of { source, finding, solution } tuples for a card's
 * analyzer aggregate. Every finding (critical/warning/info) AND every
 * triggered gap gets a solution — either a catalog match or a generic
 * fallback built from the item's own data. Parity with the PROBLEMS tab.
 *
 * @param {{ findings?: any[], gaps?: any[] } | null} aggregate
 * @returns {Array<{ source: 'finding'|'gap', key: string, severity: string, finding: object, solution: object, isGeneric: boolean }>}
 */
export function buildSolutionsList(aggregate) {
  if (!aggregate || typeof aggregate !== 'object') return [];

  const out = [];
  // Dedup is scoped per source — a finding and a gap that resolve to the same
  // catalog entry both produce their own card. This matches the PROBLEMS tab,
  // which lists findings and gaps separately.
  const seenFindingSolutionIds = new Set();
  const seenGapSolutionIds     = new Set();

  const findings = Array.isArray(aggregate.findings) ? aggregate.findings : [];
  for (const f of findings) {
    if (!f) continue;
    const matched  = resolveSolution(f);
    const solution = matched || buildGenericSolution(f, 'finding');
    if (seenFindingSolutionIds.has(solution.id)) continue;
    seenFindingSolutionIds.add(solution.id);
    out.push({
      source:    'finding',
      key:       f.id || `finding-${out.length}`,
      severity:  f.severity || 'info',
      finding:   f,
      solution,
      isGeneric: !matched,
    });
  }

  const gaps = Array.isArray(aggregate.gaps) ? aggregate.gaps : [];
  for (const g of gaps) {
    if (!g || !g.triggered) continue;
    const matched  = resolveSolution(g);
    const solution = matched || buildGenericSolution(g, 'gap');
    if (seenGapSolutionIds.has(solution.id)) continue;
    seenGapSolutionIds.add(solution.id);
    out.push({
      source:    'gap',
      key:       g.ruleId || `gap-${out.length}`,
      severity:  matched ? (solution.severity || 'warning') : 'warning',
      finding:   g,
      solution,
      isGeneric: !matched,
    });
  }

  return out;
}

