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
      ids: ['missing-og-tags', 'missing-og-title', 'missing-og-description', 'missing-og-type'],
      citationIncludes: ['og:title', 'og:description', 'og:type'],
      labelIncludes: ['og tag', 'og title', 'og description', 'social sharing preview', 'open graph'],
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

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — llms.txt missing
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'missing-llms-txt',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['missing-llms-txt'],
      citationIncludes: ['llms.txt', 'llmsTxt'],
      labelIncludes: ['llms.txt'],
    },
    problem: 'Your site has no llms.txt file — AI assistants have no guide to your content.',
    whyItMatters:
      'llms.txt is a simple text file that tells AI tools (ChatGPT, Perplexity, Claude) which pages are most useful and how your content is structured. Sites without one get guessed at. Sites with one get accurately cited. It takes under an hour to add and has an outsized impact on how AI search results represent your business.',
    diy: {
      summary: 'Create a plain-text llms.txt at the root of your site.',
      steps: [
        'Visit llmstxt.org to see the spec and generator tools.',
        'Create /llms.txt with: a # H1 title line, a > one-sentence site summary, and ## sections listing your key pages as - [Page Title](url).',
        'Start with 5-10 pages: homepage, About, Services, top blog posts.',
        'Upload to your site root so it\'s accessible at yourdomain.com/llms.txt.',
        'Verify by visiting yourdomain.com/llms.txt in your browser.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'llmstxt.org — spec + generator', url: 'https://llmstxt.org' },
      ],
    },
    expertOffer: {
      title: "I'll write and deploy your llms.txt in 24 hours.",
      summary:
        'I audit your site structure, write a well-formed llms.txt covering your key pages, deploy it, and validate it passes spec. Includes a follow-up check after 7 days.',
      turnaround: '24 hours',
      deliverable: 'Live, validated llms.txt at your site root.',
      cta: { label: 'Book an AI visibility fix', href: calendlyUrl('missing-llms-txt') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — llms.txt broken links
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'llms-txt-broken-links',
    category: 'ai-visibility',
    severity: 'info',
    triggers: {
      ids: ['llms-txt-broken-links'],
      citationIncludes: ['llmsTxt', 'broken-links', 'brokenLinks'],
      labelIncludes: ['llms.txt broken', 'broken link'],
    },
    problem: 'Some links in your llms.txt return errors — AI tools are being sent to dead pages.',
    whyItMatters:
      'When an AI assistant follows a link from your llms.txt and gets a 404 or timeout, it may stop referencing your site entirely. Keeping your llms.txt links live is low-effort maintenance with a direct payoff in how reliably AI tools can access and cite your content.',
    diy: {
      summary: 'Audit and fix the broken URLs listed in your llms.txt.',
      steps: [
        'Open your llms.txt and copy each URL into a new browser tab, or use a free link checker like deadlinkchecker.com.',
        'For each 404: check if the page was moved and update the URL, or remove the entry if the page no longer exists.',
        'For each redirect: update the llms.txt URL to point directly to the final destination.',
        'Re-upload the updated llms.txt.',
      ],
      estimatedTime: '20-40 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Dead Link Checker', url: 'https://www.deadlinkchecker.com' },
      ],
    },
    expertOffer: {
      title: "I'll clean up your llms.txt links in one session.",
      summary:
        'I audit every URL in your llms.txt, fix broken links, redirect chains, and outdated entries, and return a validated file ready to deploy.',
      turnaround: '24 hours',
      deliverable: 'Updated llms.txt with all links verified live.',
      cta: { label: 'Book an AI visibility fix', href: calendlyUrl('llms-txt-broken-links') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — GPTBot blocked
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'ai-bots-blocked-gptbot',
    category: 'ai-visibility',
    severity: 'critical',
    triggers: {
      ids: ['ai-bots-blocked-gptbot'],
      citationIncludes: ['GPTBot', 'gptbot', 'robotsAi'],
      labelIncludes: ['gptbot blocked', 'chatgpt blocked'],
    },
    problem: "GPTBot is blocked in your robots.txt — ChatGPT can't read your site.",
    whyItMatters:
      "GPTBot is the crawler OpenAI uses to train and update ChatGPT's knowledge. When it's blocked, ChatGPT has no access to your current site content. Users asking ChatGPT about your industry, services, or brand get answers that don't include you. This is a direct AI visibility gap that one robots.txt change can fix.",
    diy: {
      summary: 'Remove the GPTBot Disallow rule from your robots.txt.',
      steps: [
        'Open your robots.txt (yourdomain.com/robots.txt).',
        'Find any block that includes "User-agent: GPTBot" followed by "Disallow: /".',
        'Delete that block entirely, or change "Disallow: /" to "Allow: /".',
        'Save and upload the updated robots.txt.',
        'Verify the change at yourdomain.com/robots.txt.',
      ],
      estimatedTime: '10-15 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'OpenAI: GPTBot documentation', url: 'https://platform.openai.com/docs/gptbot' },
        { label: 'Google robots.txt tester', url: 'https://search.google.com/search-console/robots-testing-tool' },
      ],
    },
    expertOffer: {
      title: "I'll fix your robots.txt and audit all AI bot access in one call.",
      summary:
        'I review your full robots.txt, unblock GPTBot and any other AI crawlers that are incorrectly restricted, and verify the changes in Search Console.',
      turnaround: '24 hours',
      deliverable: 'Updated robots.txt with AI bots correctly configured.',
      cta: { label: 'Book a robots.txt fix', href: calendlyUrl('ai-bots-blocked-gptbot') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — ClaudeBot blocked
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'ai-bots-blocked-claudebot',
    category: 'ai-visibility',
    severity: 'critical',
    triggers: {
      ids: ['ai-bots-blocked-claudebot'],
      citationIncludes: ['ClaudeBot', 'claudebot', 'robotsAi'],
      labelIncludes: ['claudebot blocked', 'claude blocked'],
    },
    problem: "ClaudeBot is blocked in your robots.txt — Anthropic's Claude can't read your site.",
    whyItMatters:
      "ClaudeBot is Anthropic's crawler for Claude AI. When blocked, Claude has no access to your site's current content. As AI assistants like Claude become a primary discovery surface for services, being invisible to them has the same effect as not ranking in Google. One robots.txt edit restores full access.",
    diy: {
      summary: 'Remove the ClaudeBot Disallow rule from your robots.txt.',
      steps: [
        'Open your robots.txt (yourdomain.com/robots.txt).',
        'Find any block that includes "User-agent: ClaudeBot" followed by "Disallow: /".',
        'Delete that block, or change "Disallow: /" to "Allow: /".',
        'Save and upload the updated robots.txt.',
        'Confirm the change is live by visiting yourdomain.com/robots.txt.',
      ],
      estimatedTime: '10-15 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Anthropic: ClaudeBot documentation', url: 'https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-the-web-and-how-can-site-owners-block-the-crawler' },
      ],
    },
    expertOffer: {
      title: "I'll fix your robots.txt and audit all AI bot access in one call.",
      summary:
        'I review your full robots.txt, unblock ClaudeBot and any other AI crawlers that are incorrectly restricted, and verify the changes with a live test.',
      turnaround: '24 hours',
      deliverable: 'Updated robots.txt with AI bots correctly configured.',
      cta: { label: 'Book a robots.txt fix', href: calendlyUrl('ai-bots-blocked-claudebot') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — PerplexityBot blocked
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'ai-bots-blocked-perplexitybot',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['ai-bots-blocked-perplexitybot'],
      citationIncludes: ['PerplexityBot', 'perplexitybot', 'robotsAi'],
      labelIncludes: ['perplexitybot blocked', 'perplexity blocked'],
    },
    problem: "PerplexityBot is blocked in your robots.txt — Perplexity AI can't read your site.",
    whyItMatters:
      "Perplexity AI is a fast-growing AI search engine that cites sources directly in its answers. PerplexityBot crawls the web to keep its index current. Blocking it means Perplexity users asking questions relevant to your business won't be shown your site as a source.",
    diy: {
      summary: 'Remove the PerplexityBot Disallow rule from your robots.txt.',
      steps: [
        'Open your robots.txt (yourdomain.com/robots.txt).',
        'Find any block that includes "User-agent: PerplexityBot" followed by "Disallow: /".',
        'Delete that block, or change "Disallow: /" to "Allow: /".',
        'Save and redeploy the updated file.',
      ],
      estimatedTime: '10-15 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Perplexity: PerplexityBot documentation', url: 'https://docs.perplexity.ai/docs/perplexitybot' },
      ],
    },
    expertOffer: {
      title: "I'll fix your robots.txt and audit all AI bot access in one call.",
      summary:
        'I review your full robots.txt, unblock PerplexityBot and any other AI crawlers that are incorrectly restricted, and return a validated file.',
      turnaround: '24 hours',
      deliverable: 'Updated robots.txt with AI bots correctly configured.',
      cta: { label: 'Book a robots.txt fix', href: calendlyUrl('ai-bots-blocked-perplexitybot') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — multiple AI bots blocked (generic)
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'ai-bots-blocked-generic',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['ai-bots-blocked-generic'],
      citationIncludes: ['robotsAi', 'ai-bots-blocked'],
      labelIncludes: ['ai bot blocked', 'ai bots blocked'],
    },
    problem: 'Multiple AI crawlers are blocked in your robots.txt — you\'re invisible to several AI search tools.',
    whyItMatters:
      'Your robots.txt is blocking two or more AI crawlers. Each blocked bot is one AI platform that cannot read your site, cite your content, or surface your business in AI-generated answers. A single review of your robots.txt can restore access across all of them.',
    diy: {
      summary: 'Review your robots.txt and remove blanket AI bot restrictions.',
      steps: [
        'Open yourdomain.com/robots.txt and look for any "User-agent: *" blocks with "Disallow: /".',
        'If you have a wildcard block followed by selective Allow rules for Googlebot, you may be inadvertently blocking all AI crawlers.',
        'Add explicit "User-agent: GPTBot / Allow: /" and similar entries for each AI bot you want to allow.',
        'Use the full list at llmstxt.org/robots or ahrefs.com/blog/ai-bot-crawler-list/ to check which bots to include.',
        'Test your updated robots.txt using Google Search Console.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'AI crawler list reference', url: 'https://github.com/nicehash/ai-crawler-list' },
        { label: 'Google robots.txt tester', url: 'https://search.google.com/search-console/robots-testing-tool' },
      ],
    },
    expertOffer: {
      title: "I'll audit and fix your robots.txt for all AI bots.",
      summary:
        'I map every AI crawler currently blocked, build the correct allow-list for your use case, update your robots.txt, and verify with live tests.',
      turnaround: '24 hours',
      deliverable: 'Updated robots.txt allowing the appropriate AI crawlers.',
      cta: { label: 'Book a robots.txt fix', href: calendlyUrl('ai-bots-blocked-generic') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — no FAQPage schema
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-faqpage-schema',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['no-faqpage-schema'],
      citationIncludes: ['FAQPage', 'faqpage', 'schema'],
      labelIncludes: ['faq schema', 'faqpage schema'],
    },
    problem: 'Your site has no FAQPage schema — AI assistants can\'t extract Q&A pairs from your pages.',
    whyItMatters:
      "FAQPage schema marks up question-and-answer content so search engines and AI tools can extract it directly. Sites with FAQPage schema are far more likely to appear in AI-generated answer boxes and conversational AI responses because the Q&A structure is machine-readable. If you have an FAQ section anywhere on your site, adding this schema is a 30-minute upgrade with outsized reach.",
    diy: {
      summary: 'Add FAQPage JSON-LD schema to your pages with FAQ content.',
      steps: [
        'Identify pages with FAQ or Q&A sections (homepage, Services, pricing pages are common).',
        'For each page, write the FAQPage schema:\n  <script type="application/ld+json">\n  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Your Q?","acceptedAnswer":{"@type":"Answer","text":"Your answer."}}]}\n  </script>',
        'Add as many Question entries as you have Q&As on that page.',
        'Insert the script in the <head> of the page.',
        'Validate at schema.org/SchemaValidator or Google\'s Rich Results Test.',
      ],
      estimatedTime: '30-60 minutes per page',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google: FAQ rich results guide', url: 'https://developers.google.com/search/docs/appearance/structured-data/faqpage' },
        { label: 'Rich Results Test', url: 'https://search.google.com/test/rich-results' },
      ],
    },
    expertOffer: {
      title: "I'll add FAQPage schema across your key pages.",
      summary:
        'I identify every page with FAQ content, write and deploy valid FAQPage JSON-LD, and validate all entries pass Rich Results Test.',
      turnaround: '2-3 days',
      deliverable: 'Deployed, validated FAQPage schema on all eligible pages.',
      cta: { label: 'Book a schema build', href: calendlyUrl('no-faqpage-schema') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — no Article/BlogPosting schema
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-article-schema',
    category: 'ai-visibility',
    severity: 'info',
    triggers: {
      ids: ['no-article-schema'],
      citationIncludes: ['Article', 'BlogPosting', 'schema'],
      labelIncludes: ['article schema', 'blogposting schema'],
    },
    problem: 'No Article or BlogPosting schema found — your content pages aren\'t marked up for AI citation.',
    whyItMatters:
      "Article and BlogPosting schema tell AI tools that a page is authoritative authored content — with a headline, author, date, and topic. Without it, your blog or resource pages are treated like any other web page rather than citable sources. Adding this schema is a strong signal for AI-generated answers that pull from expert content.",
    diy: {
      summary: 'Add Article or BlogPosting JSON-LD to your content pages.',
      steps: [
        'For each blog post or article page, add a JSON-LD block in the <head>:',
        '{"@context":"https://schema.org","@type":"BlogPosting","headline":"Post Title","author":{"@type":"Person","name":"Author Name"},"datePublished":"2025-01-01","description":"One-sentence summary."}',
        'Use @type "Article" for resource pages and "BlogPosting" for blog entries.',
        'Validate with Google\'s Rich Results Test.',
      ],
      estimatedTime: '20-30 minutes per page (or automate via CMS template)',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google: Article structured data', url: 'https://developers.google.com/search/docs/appearance/structured-data/article' },
      ],
    },
    expertOffer: {
      title: "I'll add Article schema to your content pages.",
      summary:
        'I audit your blog and resource pages, write Article/BlogPosting schema for each, deploy it, and validate the markup.',
      turnaround: '2-3 days',
      deliverable: 'Article schema deployed on all blog and resource pages.',
      cta: { label: 'Book a schema build', href: calendlyUrl('no-article-schema') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — no Organization schema
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-organization-schema',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['no-organization-schema'],
      citationIncludes: ['Organization', 'LocalBusiness', 'schema', 'organizationSchema'],
      labelIncludes: ['organization schema', 'localbusiness schema'],
    },
    problem: 'No Organization or LocalBusiness schema found — AI tools can\'t verify your business identity.',
    whyItMatters:
      "Organization schema is the foundation of how search engines and AI tools understand who you are. It provides your business name, logo, contact info, social profiles, and service area in a machine-readable format. Without it, AI assistants rely on guesswork to describe your business. With it, they have authoritative, structured data to pull from.",
    diy: {
      summary: 'Add Organization or LocalBusiness JSON-LD to your homepage.',
      steps: [
        'Decide the right type: use "LocalBusiness" if you serve a specific location, "Organization" for national/online businesses.',
        'Write the JSON-LD block with: name, url, logo, telephone, address (for LocalBusiness), sameAs (link to your Google Business, LinkedIn, social profiles).',
        'Add it to the <head> of your homepage.',
        'Validate at schema.org/SchemaValidator or Rich Results Test.',
      ],
      estimatedTime: '30-45 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google: Organization structured data', url: 'https://developers.google.com/search/docs/appearance/structured-data/organization' },
        { label: 'Schema.org Organization', url: 'https://schema.org/Organization' },
      ],
    },
    expertOffer: {
      title: "I'll build and deploy your Organization schema.",
      summary:
        'I research your business details, write a complete Organization or LocalBusiness JSON-LD block, deploy it to your homepage, and validate the output.',
      turnaround: '24-48 hours',
      deliverable: 'Deployed, validated Organization schema on your homepage.',
      cta: { label: 'Book a schema build', href: calendlyUrl('no-organization-schema') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — no Wikidata entity
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'no-wikidata-entity',
    category: 'ai-visibility',
    severity: 'info',
    triggers: {
      ids: ['no-wikidata-entity'],
      citationIncludes: ['wikidata', 'Wikidata', 'entityAuthority'],
      labelIncludes: ['wikidata entity', 'entity authority'],
    },
    problem: "Your business doesn't have a verified Wikidata entity — a missing trust signal for AI knowledge bases.",
    whyItMatters:
      "Wikidata is the structured knowledge base that powers Google's Knowledge Graph and many AI training sets. When your business has a Wikidata entry, it becomes a verified entity that AI tools can cross-reference. This isn't essential for most small businesses, but for service providers, consultants, and anyone building a public brand, a Wikidata entry is a durable trust signal that compounds over time.",
    diy: {
      summary: 'Create a Wikidata entry for your business or personal brand.',
      steps: [
        'Check if you already have an entry: search at wikidata.org/wiki/Special:Search using your business name.',
        'If not, create a Wikidata account at wikidata.org.',
        'Create a new item and add: label (your business name), description (1-line what you do), website URL as a P856 (official website) statement.',
        'Link to your Wikipedia article if one exists (P17 or P18), or to your LinkedIn, Crunchbase, or other notable profiles.',
        'Follow Wikidata\'s notability guidelines — your business should have some verifiable presence online.',
      ],
      estimatedTime: '1-2 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Wikidata: Your first item', url: 'https://www.wikidata.org/wiki/Wikidata:Your_first_item' },
      ],
    },
    expertOffer: {
      title: "I'll research and create your Wikidata entity.",
      summary:
        'I audit your online presence, create a properly-cited Wikidata item with verifiable statements, and link it to your schema markup for maximum entity authority.',
      turnaround: '3-5 days',
      deliverable: 'Verified Wikidata item linked to your Organization schema.',
      cta: { label: 'Book an entity authority build', href: calendlyUrl('no-wikidata-entity') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — NAP inconsistency
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'nap-inconsistency',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['nap-inconsistency'],
      citationIncludes: ['NAP', 'nap', 'napInconsistency', 'entityAuthority'],
      labelIncludes: ['nap inconsistency', 'name address phone'],
    },
    problem: 'Your business name, address, or phone in your schema doesn\'t match what appears on your page.',
    whyItMatters:
      "NAP (Name, Address, Phone) consistency is how search engines and AI tools verify that the business in your structured data is the same one mentioned in your page content. Mismatches — even minor ones like 'St' vs 'Street' — erode entity confidence scores and can cause your business to be under-cited or cited incorrectly in AI-generated answers.",
    diy: {
      summary: 'Align your schema NAP data with the visible text on your page.',
      steps: [
        'Open your homepage and note exactly how your business name, address, and phone appear in visible text.',
        'Open your JSON-LD Organization or LocalBusiness schema and compare each field.',
        'Correct any differences — use the exact same format in both places.',
        'Common issues: "Suite 100" vs "#100", "(555) 000-0000" vs "555-000-0000", "LLC" missing from schema.',
        'Validate the updated schema at Rich Results Test.',
      ],
      estimatedTime: '20-30 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Moz: NAP consistency guide', url: 'https://moz.com/learn/seo/nap-consistency' },
      ],
    },
    expertOffer: {
      title: "I'll audit and fix your NAP consistency across schema and page content.",
      summary:
        'I compare your schema data against every page mentioning your business details, correct the mismatches, and validate the updated markup.',
      turnaround: '24-48 hours',
      deliverable: 'Consistent NAP across schema markup and visible page text.',
      cta: { label: 'Book a schema audit', href: calendlyUrl('nap-inconsistency') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — heavy JS dependency
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'heavy-js-dependency',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['heavy-js-dependency'],
      citationIncludes: ['jsOff', 'dualFetch', 'contentExtractability'],
      labelIncludes: ['javascript dependency', 'js-rendered content'],
    },
    problem: 'Most of your page content only appears after JavaScript runs — many AI crawlers can\'t see it.',
    whyItMatters:
      "Many AI crawlers and some search bots fetch pages without executing JavaScript. If your site relies on JS to render its main content (common with React, Vue, or Angular SPAs), those bots see a near-empty page. Content that's invisible to crawlers can't be cited in AI answers. Server-side rendering or static generation solves this entirely.",
    diy: {
      summary: 'Ensure your critical page content is available in the raw HTML.',
      steps: [
        'Test your site with JS disabled: in Chrome DevTools → Settings → Debugger → Disable JavaScript, then reload.',
        'If you see a blank page or minimal content, your site is JS-dependent.',
        'Add server-side rendering (SSR) or static generation to your build: Next.js, Astro, or Gatsby all support this.',
        'At minimum, add a <noscript> fallback with your core content for each page.',
        'Retest with JS disabled after the change.',
      ],
      estimatedTime: '2-8 hours (depends on framework)',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Next.js: SSR guide', url: 'https://nextjs.org/docs/pages/building-your-application/rendering/server-side-rendering' },
        { label: 'Google: JavaScript and SEO', url: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics' },
      ],
    },
    expertOffer: {
      title: "I'll audit your JS rendering and fix AI crawlability.",
      summary:
        'I test your current rendering pipeline, identify which critical content is JS-only, and implement SSR or static fallbacks so your pages are fully readable by AI crawlers.',
      turnaround: '3-7 days',
      deliverable: 'Server-side rendered or static core content on your key pages.',
      cta: { label: 'Book a crawlability fix', href: calendlyUrl('heavy-js-dependency') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — poor answer-first structure
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'poor-answer-first-structure',
    category: 'ai-visibility',
    severity: 'warning',
    triggers: {
      ids: ['poor-answer-first-structure'],
      citationIncludes: ['answerFirst', 'contentExtractability'],
      labelIncludes: ['answer-first', 'answer first structure'],
    },
    problem: 'Your content sections don\'t lead with the answer — AI tools have trouble extracting useful snippets.',
    whyItMatters:
      "AI assistants extract and cite direct answers, not introductory paragraphs. When a section starts with context or preamble before getting to the point, AI tools often skip it or cite it poorly. 'Answer-first' writing means your first sentence after a heading directly answers the question that heading poses. This single structural change dramatically increases how often your content shows up in AI-generated responses.",
    diy: {
      summary: 'Rewrite your section openers to lead with the direct answer.',
      steps: [
        'Open each page and read the first sentence under each H2 or H3 heading.',
        'Ask: "If someone asked the heading as a question, does this sentence answer it directly?"',
        'If not, rewrite: move the answer to the first sentence, move context and caveats to sentences 2-3.',
        'Example: Instead of "When it comes to pricing, there are several factors…", write "Our pricing starts at $X per month for [core service]."',
        'Prioritize your top 5 pages and your FAQ sections first.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google: Featured snippets guide', url: 'https://developers.google.com/search/docs/appearance/featured-snippets' },
      ],
    },
    expertOffer: {
      title: "I'll rewrite your page sections for answer-first structure.",
      summary:
        'I audit your top 5 pages, identify sections that bury the answer, and rewrite the openers to lead with direct, citable answers — without changing your voice or message.',
      turnaround: '3-5 days',
      deliverable: 'Revised copy for top 5 pages with answer-first section openers.',
      cta: { label: 'Book a content structure audit', href: calendlyUrl('poor-answer-first-structure') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI Visibility — deep heading nesting
  // ────────────────────────────────────────────────────────────────────────
  {
    id: 'deep-heading-nesting',
    category: 'ai-visibility',
    severity: 'info',
    triggers: {
      ids: ['deep-heading-nesting'],
      citationIncludes: ['headingNesting', 'contentExtractability', 'headings'],
      labelIncludes: ['heading nesting', 'h4 heading', 'deep heading'],
    },
    problem: 'Your pages use H4+ headings without a clear H2/H3 hierarchy — AI tools may misread your content structure.',
    whyItMatters:
      "AI tools and screen readers navigate pages using heading hierarchy. When H4 or H5 headings appear without a clear H2/H3 parent structure, the outline becomes ambiguous — AI assistants can't tell what's a main topic and what's a sub-point. A clean H1 → H2 → H3 structure makes your content easier to extract, outline, and cite accurately.",
    diy: {
      summary: 'Flatten your heading hierarchy to H1 → H2 → H3 where possible.',
      steps: [
        'Open each page and use the browser\'s Accessibility tree (DevTools → Accessibility) or an outline tool like headingsMap to see your heading structure.',
        'Identify any H4 or H5 headings and evaluate whether they can be promoted to H3.',
        'If a section truly needs H4, ensure it\'s nested directly under an H3, not floating under an H2.',
        'Remove any H4s used for visual styling only — use CSS or a styled div instead.',
        'Re-check the outline reads cleanly from top to bottom.',
      ],
      estimatedTime: '1-2 hours',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'MDN: Heading elements', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements' },
        { label: 'HeadingsMap browser extension', url: 'https://rumoroso.bitbucket.io/headingsmap/' },
      ],
    },
    expertOffer: {
      title: "I'll audit and fix your page heading structure.",
      summary:
        'I map the full heading outline of your key pages, fix hierarchy gaps and over-nesting, and return a cleaner structure that AI tools and screen readers can parse correctly.',
      turnaround: '2-3 days',
      deliverable: 'Fixed heading hierarchy across your top pages.',
      cta: { label: 'Book a content audit', href: calendlyUrl('deep-heading-nesting') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Site Meta card — social + chrome + identity signals
  // ────────────────────────────────────────────────────────────────────────

  // Missing OG image — the big one
  {
    id: 'missing-og-image',
    category: 'site-meta',
    severity: 'critical',
    triggers: {
      ids: ['missing-og-image', 'no-og-image'],
      citationIncludes: ['ogImage', 'og:image'],
      labelIncludes: ['og image', 'og:image', 'social preview image', 'social sharing image'],
    },
    problem: 'Your site has no Open Graph preview image.',
    whyItMatters:
      "Every time someone shares your URL on LinkedIn, X, Slack, iMessage, WhatsApp, or Discord, the platform pulls an image to render the preview. Without og:image, shares render as a blank box next to the URL — usually ignored in feed or skipped mid-conversation. This is the single most visible social presentation failure and one of the cheapest to fix.",
    diy: {
      summary: 'Design a 1200x630 preview image and wire it into your <head>.',
      steps: [
        'Create a 1200x630 PNG or JPG with your logo, a one-line positioning statement, and your brand colors. Canva and Figma both have templates.',
        'Export at <300KB and host it at a stable URL on your domain (not a CDN that might block hotlinking).',
        'Add to the <head> of every page: <meta property="og:image" content="https://yoursite.com/og-image.png" />',
        'Add <meta property="og:image:width" content="1200" /> and <meta property="og:image:height" content="630" /> on the same page for cleaner render.',
        'Add alt text: <meta property="og:image:alt" content="Short description of what the image shows" />',
        'Validate with opengraph.xyz and the LinkedIn Post Inspector — both show the live preview.',
      ],
      estimatedTime: '45-90 minutes (including image design)',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'opengraph.xyz (validator)', url: 'https://www.opengraph.xyz' },
        { label: 'LinkedIn Post Inspector', url: 'https://www.linkedin.com/post-inspector/' },
      ],
    },
    expertOffer: {
      title: "I'll design + deploy your social preview image.",
      summary:
        'Custom 1200x630 preview image designed in your brand style, OG meta tags deployed across every page, validated live on LinkedIn, X, Slack, and iMessage.',
      turnaround: '2-3 days',
      deliverable: 'Live social preview renders cleanly everywhere your URL gets shared.',
      cta: { label: 'Book a social preview setup', href: calendlyUrl('missing-og-image') },
    },
  },

  // Missing favicon
  {
    id: 'missing-favicon',
    category: 'site-meta',
    severity: 'warning',
    triggers: {
      ids: ['missing-favicon'],
      citationIncludes: ['favicon', 'icon'],
      labelIncludes: ['favicon', 'site icon'],
    },
    problem: 'Your site has no favicon.',
    whyItMatters:
      "The favicon is the tiny icon shown in browser tabs, bookmarks, and history. Without one, every tab of your site displays a generic globe or blank square — it reads as unfinished or untrusted to anyone scanning their tabs. It's also a signal to Google and search result displays.",
    diy: {
      summary: 'Generate a favicon set and link it from your <head>.',
      steps: [
        'Start with a square source image of your logo at 512x512 or larger.',
        'Use realfavicongenerator.net — upload the image, pick your background, download the generated set.',
        'Upload the generated files to your server root (e.g., /favicon.ico, /apple-touch-icon.png, /favicon-32x32.png, etc.).',
        'Paste the HTML snippet the generator produces into your <head> on every page.',
        'Test by opening your site in a browser and checking the tab.',
      ],
      estimatedTime: '20-30 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Real Favicon Generator', url: 'https://realfavicongenerator.net' },
      ],
    },
    expertOffer: {
      title: "I'll generate + deploy your favicon set.",
      summary:
        'Full favicon set generated from your logo, deployed to every browser context (tabs, bookmarks, iOS home screen, Android chrome), and linked from every page.',
      turnaround: '1 day',
      deliverable: 'Favicon renders in every browser, every device.',
      cta: { label: 'Book a 30-min fix', href: calendlyUrl('missing-favicon') },
    },
  },

  // Missing apple-touch-icon
  {
    id: 'missing-apple-touch-icon',
    category: 'site-meta',
    severity: 'info',
    triggers: {
      ids: ['missing-apple-touch-icon'],
      citationIncludes: ['appleTouchIcon', 'apple-touch-icon'],
      labelIncludes: ['apple touch icon', 'ios home screen'],
    },
    problem: 'Your site has no Apple touch icon.',
    whyItMatters:
      "When someone on iOS saves your site to their home screen (Add to Home Screen), iOS looks for an apple-touch-icon. Without one, your site shows up as a default screenshot or a plain icon — reads as low-effort. It's a small polish but it shows on every iPhone user who bookmarks you.",
    diy: {
      summary: 'Add a 180x180 touch icon and link it from your <head>.',
      steps: [
        'Create a 180x180 PNG with your logo. Keep the important content centered and leave ~15% padding on all sides (iOS rounds corners).',
        'Save as apple-touch-icon.png in your server root.',
        'Add to <head>: <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
        'Test by saving your site to an iPhone home screen.',
      ],
      estimatedTime: '15-20 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Apple: Configuring Web Apps', url: 'https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html' },
      ],
    },
    expertOffer: {
      title: "I'll add touch icon support across iOS + Android.",
      summary:
        'Touch icons generated at every spec size, manifest.json added for Android PWA support, meta tags deployed and validated.',
      turnaround: '1 day',
      deliverable: 'Save-to-home-screen looks clean on iOS and Android.',
      cta: { label: 'Book a 30-min fix', href: calendlyUrl('missing-apple-touch-icon') },
    },
  },

  // Missing theme-color
  {
    id: 'missing-theme-color',
    category: 'site-meta',
    severity: 'info',
    triggers: {
      ids: ['missing-theme-color'],
      citationIncludes: ['themeColor', 'theme-color'],
      labelIncludes: ['theme color', 'theme-color'],
    },
    problem: 'Your site has no mobile browser theme color.',
    whyItMatters:
      "On Android Chrome and some other mobile browsers, <meta name='theme-color'> sets the color of the browser chrome around your site — the address bar, status bar, task switcher thumbnail. Without it, the browser stays default gray or white, breaking the visual continuity of your brand when users scroll or switch tabs. Small but noticeable.",
    diy: {
      summary: 'Add one line of meta to your <head>.',
      steps: [
        'Pick the hex color that best matches your brand\'s primary surface.',
        'Add to <head>: <meta name="theme-color" content="#yourhex" />',
        'If you support dark mode, add a variant: <meta name="theme-color" content="#darkhex" media="(prefers-color-scheme: dark)" />',
        'Test on Android Chrome by opening your site and watching the address bar tint.',
      ],
      estimatedTime: '5 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'MDN: theme-color', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name/theme-color' },
      ],
    },
    expertOffer: {
      title: "Trivial fix — I can drop it in during a quick call.",
      summary:
        'Theme color meta tags deployed on every page, including dark-mode variant if you support it. About 5 minutes of work.',
      turnaround: '15 minutes',
      deliverable: 'Theme color renders correctly in Android Chrome.',
      cta: { label: 'Book a 15-min fix', href: calendlyUrl('missing-theme-color') },
    },
  },

  // Missing canonical
  {
    id: 'missing-canonical',
    category: 'site-meta',
    severity: 'warning',
    triggers: {
      ids: ['missing-canonical'],
      citationIncludes: ['canonical'],
      labelIncludes: ['canonical', 'canonical url'],
    },
    problem: 'Your site has no canonical URL declared.',
    whyItMatters:
      "The canonical tag tells Google which version of a page is the 'real' one when there are duplicates or near-duplicates (http vs https, www vs non-www, trailing slash, URL parameters). Without it, Google picks one itself — sometimes the wrong one. This can split your ranking signals across multiple URL variants and demote the page you actually wanted to rank.",
    diy: {
      summary: 'Add <link rel="canonical"> to every page.',
      steps: [
        'For each page, decide the canonical URL — usually the clean, HTTPS, www-or-non-www version without query strings.',
        'Add to <head>: <link rel="canonical" href="https://yoursite.com/this-page" />',
        'Use the page\'s OWN canonical — not the homepage URL for every page. Each page is its own canonical.',
        'For duplicate URLs (e.g., /page and /page?ref=twitter), the canonical on both should point to /page.',
        'Verify in Google Search Console → Coverage → Indexed pages.',
      ],
      estimatedTime: '30-60 minutes (depending on page count)',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Google: Consolidate duplicate URLs', url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls' },
      ],
    },
    expertOffer: {
      title: "I'll canonicalize every page on your site.",
      summary:
        'Audit your URL variants, set the right canonical on every page, deploy, and verify in Search Console. Prevents ranking signal splitting across URL variants.',
      turnaround: '2-3 days',
      deliverable: 'Canonical URLs live on every page, verified in Search Console.',
      cta: { label: 'Book a canonical fix', href: calendlyUrl('missing-canonical') },
    },
  },

  // Missing og:site_name
  {
    id: 'missing-og-site-name',
    category: 'site-meta',
    severity: 'info',
    triggers: {
      ids: ['missing-og-site-name'],
      citationIncludes: ['siteName', 'og:site_name'],
      labelIncludes: ['site name', 'og site name', 'og:site_name'],
    },
    problem: 'Your site has no og:site_name declared.',
    whyItMatters:
      "og:site_name is the tiny brand label that appears above the title in rich previews on Slack, LinkedIn, Discord, and some other platforms. Without it, previews show the domain (yoursite.com) or nothing — shipping the og:site_name lets you display your actual brand name consistently in every share.",
    diy: {
      summary: 'Add one line to your <head>.',
      steps: [
        'Decide your brand display name (usually your company name as you want it to appear in share previews).',
        'Add to <head> on every page: <meta property="og:site_name" content="Your Brand" />',
        'Verify on opengraph.xyz or LinkedIn Post Inspector.',
      ],
      estimatedTime: '5 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Open Graph Protocol', url: 'https://ogp.me' },
      ],
    },
    expertOffer: {
      title: "Trivial fix — bundled with an OG audit.",
      summary:
        'I usually bundle this with a full OG/social preview audit since they tend to have multiple gaps. Quick 30-min session.',
      turnaround: '30 minutes',
      deliverable: 'Site name shows in every rich share preview.',
      cta: { label: 'Book a 30-min OG audit', href: calendlyUrl('missing-og-site-name') },
    },
  },

  // Missing Twitter Card
  {
    id: 'missing-twitter-card',
    category: 'site-meta',
    severity: 'info',
    triggers: {
      ids: ['missing-twitter-card'],
      citationIncludes: ['twitter:card', 'twitterCard'],
      labelIncludes: ['twitter card', 'twitter:card', 'x card'],
    },
    problem: 'Your site has no Twitter Card meta.',
    whyItMatters:
      "Twitter/X uses its own meta tag (twitter:card) to render rich previews. If OG tags are present, X often falls back gracefully — but the preview type (small image vs large image card) isn't under your control. Adding explicit twitter:card meta ensures your URL renders as a large-image card with your preferred image, every time.",
    diy: {
      summary: 'Add Twitter Card meta to your <head>.',
      steps: [
        'Decide the card type — "summary_large_image" is the default for most sites (full-width preview image).',
        'Add to <head>: <meta name="twitter:card" content="summary_large_image" />',
        'If you have a Twitter/X handle: <meta name="twitter:site" content="@yourhandle" />',
        'Twitter reads og:image, og:title, og:description by default — make sure those are set (see the missing-og-image solution if not).',
        'Validate with cards-dev.twitter.com (Twitter\'s legacy validator, still works).',
      ],
      estimatedTime: '15-20 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'X Developer: Cards docs', url: 'https://developer.x.com/en/docs/twitter-for-websites/cards/overview/abouts-cards' },
      ],
    },
    expertOffer: {
      title: "Bundle with an OG + social preview audit.",
      summary:
        'Twitter Cards + OG tags + image validation in one pass. Ensures every social share renders as a rich preview card.',
      turnaround: '1-2 days',
      deliverable: 'Twitter/X shares render as large-image cards with your chosen image.',
      cta: { label: 'Book a social audit', href: calendlyUrl('missing-twitter-card') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Style Guide card — typography + color + hierarchy
  // ────────────────────────────────────────────────────────────────────────

  // No brand typography
  {
    id: 'no-brand-typography',
    category: 'style-guide',
    severity: 'warning',
    triggers: {
      ids: ['no-brand-typography', 'single-font-family', 'no-type-hierarchy-fonts'],
      citationIncludes: ['fontFamilies', 'fontFamily', "source='system'"],
      labelIncludes: ['system font', 'no brand typography', 'single font family', 'same font'],
    },
    problem: 'Your site has no custom typography.',
    whyItMatters:
      "Typography is the fastest way users form a quality impression. A site that relies entirely on system fonts (Arial, Helvetica, Times New Roman) reads as default or unfinished — even before readers process the words. One well-chosen web font pair (heading + body) measurably shifts perceived quality and brand recognition without any content changes.",
    diy: {
      summary: 'Choose a heading + body font pair and load them via Google Fonts or a similar CDN.',
      steps: [
        'Pick a heading font that matches your brand mood (e.g. a serif for editorial, a geometric sans for tech, a humanist sans for warmth). Fontpair.co and typewolf.com are good starting points.',
        'Pick a body font that pairs with it (typically a neutral sans-serif for readability — Inter, IBM Plex Sans, and Source Sans are safe defaults).',
        'Load both via Google Fonts — add the <link> tag to your <head> with font-display: swap.',
        'In your CSS, set font-family on the :root or body: font-family: "Your Body Font", system-ui, sans-serif;',
        'Set a distinct font-family on h1-h6 using your heading font.',
        'Verify the fonts load and render by opening DevTools → Network → filter Font.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Google Fonts', url: 'https://fonts.google.com' },
        { label: 'Font Pair', url: 'https://www.fontpair.co' },
        { label: 'Typewolf', url: 'https://www.typewolf.com' },
      ],
    },
    expertOffer: {
      title: "I'll pair and deploy your brand typography.",
      summary:
        'Font pair research based on your positioning, loaded with proper font-display + preload, deployed across all typography roles (headings, body, UI). Before/after screenshots included.',
      turnaround: '2-3 days',
      deliverable: 'Custom typography live across every page, loaded performantly.',
      cta: { label: 'Book a typography setup', href: calendlyUrl('no-brand-typography') },
    },
  },

  // Body text too small
  {
    id: 'body-text-too-small',
    category: 'style-guide',
    severity: 'warning',
    triggers: {
      ids: ['body-text-too-small', 'body-text-under-optimal'],
      citationIncludes: ['bodySystem.fontSize'],
      labelIncludes: ['body text', 'body font', 'font size', 'too small', 'under optimal'],
    },
    problem: 'Your body text is smaller than the readable baseline.',
    whyItMatters:
      "16px is the modern baseline for body text. Anything smaller hurts legibility on mobile (where most traffic lives), forces iOS to auto-zoom when users tap inputs, and measurably reduces dwell time and conversion. Under 14px is a real accessibility problem. This is one of the cheapest design fixes with the biggest UX payoff.",
    diy: {
      summary: 'Set body font-size to 16px minimum, bump line-height to 1.5+.',
      steps: [
        'In your CSS, find your body or :root font-size declaration.',
        'Set: font-size: 16px (or 1rem if you\'re using rem throughout).',
        'Also set: line-height: 1.5 or 1.6 for body copy — tight leading makes small text feel even smaller.',
        'For long-form reading (blog posts, docs), consider 17px or 18px. Medium uses 18-20px for a reason.',
        'Check every responsive breakpoint — sometimes the mobile stylesheet overrides to 14px. Keep 16px on mobile.',
        'Verify on a real phone, not just DevTools responsive mode.',
      ],
      estimatedTime: '20-40 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'web.dev: Font sizes', url: 'https://web.dev/articles/font-size' },
      ],
    },
    expertOffer: {
      title: "I'll rebalance your typography for mobile readability.",
      summary:
        'Body sizing audit, line-height tuning, fluid-scale implementation via clamp() so the sizing adapts correctly across screen sizes. Covers every page.',
      turnaround: '1-2 days',
      deliverable: 'Body text at 16px+ on mobile, properly scaled up on desktop, verified on real devices.',
      cta: { label: 'Book a typography fix', href: calendlyUrl('body-text-too-small') },
    },
  },

  // No brand color
  {
    id: 'no-brand-color',
    category: 'style-guide',
    severity: 'warning',
    triggers: {
      ids: ['no-brand-color', 'generic-color-scheme'],
      citationIncludes: ['colors.primary', 'colors.secondary', 'colors.neutral'],
      labelIncludes: ['brand color', 'grayscale', 'no hue', 'generic color'],
    },
    problem: 'Your site has no distinctive brand color.',
    whyItMatters:
      "Color is the single fastest way users recognize a brand — before they read the logo, before they parse a headline, they see the color. A site that's all grayscale (or a default blue) signals no deliberate design choices, and every visit feels slightly generic. Even one saturated brand color, applied consistently to CTAs, links, and key accents, measurably lifts brand recall.",
    diy: {
      summary: 'Pick a primary brand color and apply it systematically.',
      steps: [
        'Pick a color that fits your positioning: warm + inviting (coral, terracotta), professional + trusted (navy, forest green), tech + innovative (electric blue, violet), bold + energetic (red, orange).',
        'Use a tool like Coolors or Refactoring UI\'s color guide to generate a 9-shade scale (50-900) from your base color.',
        'Define the scale as CSS custom properties on :root: --brand-50, --brand-500, --brand-900.',
        'Apply --brand-500 to all CTAs, primary buttons, links, and key accents.',
        'Use lighter shades (50-200) for subtle backgrounds and tinted sections.',
        'Audit: every new UI component that needs "color" should pull from this scale. No off-palette hex values.',
      ],
      estimatedTime: '1-2 hours',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'Coolors', url: 'https://coolors.co' },
        { label: 'Refactoring UI: Color', url: 'https://www.refactoringui.com/previews/building-your-color-palette' },
      ],
    },
    expertOffer: {
      title: "I'll design + deploy a brand color system.",
      summary:
        'Color research based on your positioning, full 9-shade scale generated and tested for accessibility, deployed as CSS custom properties and applied across CTAs, links, and accent elements.',
      turnaround: '2-3 days',
      deliverable: 'Live brand color system applied consistently across every page.',
      cta: { label: 'Book a brand color setup', href: calendlyUrl('no-brand-color') },
    },
  },

  // Thin color palette
  {
    id: 'thin-color-palette',
    category: 'style-guide',
    severity: 'info',
    triggers: {
      ids: ['thin-color-palette', 'no-color-shade-scale'],
      citationIncludes: ['colors.secondary', 'shades'],
      labelIncludes: ['thin palette', 'color palette', 'no secondary', 'shade scale'],
    },
    problem: 'Your color palette is thin.',
    whyItMatters:
      "A mature design system uses a multi-color palette with shade scales — primary for CTAs, secondary for supporting elements, neutral for surfaces, and occasional accents for emphasis. A thin palette (primary + maybe one neutral) makes interfaces feel flat, reduces your ability to create visual hierarchy, and forces you to use opacity tricks that muddy the design.",
    diy: {
      summary: 'Expand to a 3-color system (primary + secondary + neutral) with 9 shades each.',
      steps: [
        'Keep your existing primary color as the base.',
        'Add a secondary color: something complementary (use a color wheel) that contrasts but harmonizes.',
        'Add a neutral scale: a warm grey or cool grey — NOT pure black/white. Something like zinc, slate, or stone from Tailwind\'s palette.',
        'Generate a 9-shade scale for each (50 → 900).',
        'Define all scales as CSS custom properties and audit which shades you actually use. Most sites use 2-3 shades per color actively.',
      ],
      estimatedTime: '1-2 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Tailwind Color Palette', url: 'https://tailwindcss.com/docs/customizing-colors' },
      ],
    },
    expertOffer: {
      title: "I'll expand your palette into a full design system.",
      summary:
        'Multi-color palette with validated contrast ratios, shade scales deployed as tokens, and a usage audit so every UI surface pulls from the system consistently.',
      turnaround: '3-4 days',
      deliverable: 'Complete color system documented and applied site-wide.',
      cta: { label: 'Book a design system pass', href: calendlyUrl('thin-color-palette') },
    },
  },

  // Weak visual hierarchy
  {
    id: 'weak-visual-hierarchy',
    category: 'style-guide',
    severity: 'warning',
    triggers: {
      ids: ['weak-visual-hierarchy', 'no-type-scale', 'no-letter-spacing-discipline'],
      citationIncludes: ['headingSystem.fontSize', 'bodySystem.fontSize', 'letterSpacing'],
      labelIncludes: ['weak hierarchy', 'type scale', 'no hierarchy', 'letter spacing'],
    },
    problem: 'Your typography has no clear visual hierarchy.',
    whyItMatters:
      "Hierarchy is what lets users scan a page in 2 seconds to find what they're looking for. When headings and body are nearly the same size and weight, every section reads as equally important — which means nothing reads as important. Scannability drops, dwell time drops, conversion drops. A type scale (1.25×, 1.333×, 1.5× multipliers between sizes) creates instant visual rhythm.",
    diy: {
      summary: 'Apply a modular type scale with clear size and weight differences.',
      steps: [
        'Pick a scale ratio — 1.25 (major third) for dense layouts, 1.333 (perfect fourth) for more contrast, 1.5 (perfect fifth) for editorial punch.',
        'From a 16px body base, compute: h4=20px, h3=25px (25.6, round), h2=32px (31.25, round), h1=40px.',
        'Set headings to a heavier weight (600-700) and body to regular (400).',
        'Add negative letter-spacing (-0.02em to -0.04em) on large headings — it tightens optical spacing and reads more intentional.',
        'Add slight positive letter-spacing (0.02em) on small UI text and all-caps labels.',
        'Check the scale visually — h1 through h4 should feel distinctly different at a glance, not like "slightly bigger" variants.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Type Scale', url: 'https://typescale.com' },
        { label: 'Refactoring UI: Hierarchy', url: 'https://www.refactoringui.com/previews/creating-hierarchy-without-relying-on-color' },
      ],
    },
    expertOffer: {
      title: "I'll rebuild your typography with a proper scale.",
      summary:
        'Full type system audit, modular scale implementation with fluid sizing via clamp(), weight and letter-spacing tuning across all typography roles, deployed and verified across breakpoints.',
      turnaround: '3-5 days',
      deliverable: 'Live type scale with clear hierarchy at every breakpoint.',
      cta: { label: 'Book a type system build', href: calendlyUrl('weak-visual-hierarchy') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Intake Terminal — run health (how the audit itself went)
  // ────────────────────────────────────────────────────────────────────────

  // PSI failed
  {
    id: 'run-psi-failed',
    category: 'run-health',
    severity: 'warning',
    triggers: {
      ids: ['run-psi-failed'],
      citationIncludes: ['pagespeed_failed', 'pagespeed_skipped'],
      labelIncludes: ['psi', 'pagespeed', 'lighthouse unavailable'],
    },
    problem: 'PageSpeed Insights data is missing from this audit.',
    whyItMatters:
      "PageSpeed Insights powers your Core Web Vitals, mobile performance score, and a handful of SEO red flags. When it can't run (rate limiting, site unreachable, or a Lighthouse rendering error), those parts of your SEO card are blank. The audit still ran, but SEO-specific quality signals are thin until we can re-measure.",
    diy: {
      summary: 'Re-run the audit in a few minutes.',
      steps: [
        'PSI has a public quota — if you ran several audits in quick succession, you may be rate-limited. Wait 10-15 minutes.',
        'Verify your site is publicly reachable at the URL provided (not behind a VPN, login wall, or maintenance page).',
        'If the site is new, Lighthouse can time out on heavy first-paint. A re-run usually succeeds.',
        'If PSI keeps failing, set PAGESPEED_API_KEY in your env to a higher quota.',
      ],
      estimatedTime: '15 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'PageSpeed Insights (manual check)', url: 'https://pagespeed.web.dev' },
      ],
    },
    expertOffer: {
      title: "I'll re-run the audit with a hardened PSI call.",
      summary:
        'Higher-quota PSI key, retry logic, and a manual Lighthouse fallback — this card fills in with real data.',
      turnaround: '15 minutes',
      deliverable: 'Live PSI data repopulated in your SEO + Performance card.',
      cta: { label: 'Book a re-run session', href: calendlyUrl('run-psi-failed') },
    },
  },

  // Fetch failed
  {
    id: 'run-fetch-failed',
    category: 'run-health',
    severity: 'critical',
    triggers: {
      ids: ['run-fetch-failed'],
      citationIncludes: ['fetch_failed'],
      labelIncludes: ['site fetch', 'fetch failed', 'site unreachable'],
    },
    problem: "Your site couldn't be reached by the audit.",
    whyItMatters:
      "The pipeline couldn't fetch any pages from your URL. This usually means a typo in the URL, a DNS issue, a site that requires authentication, Cloudflare blocking our user agent, or a site that's genuinely down. Without page content, every card downstream is operating on empty data.",
    diy: {
      summary: "Verify the URL, then re-run.",
      steps: [
        'Open the exact URL used for the audit in a browser — does it load?',
        'If it requires login, the audit can only see the public version. Either provide a public URL or note that private pages are out of scope.',
        'If Cloudflare is blocking non-browser traffic: whitelist our user agent "BrandintelBot/1.0" in Cloudflare WAF.',
        'If the site is genuinely down: wait for recovery, then re-run.',
        'Double-check the protocol: https:// vs http:// — some sites redirect one to the other but block direct access to the non-canonical variant.',
      ],
      estimatedTime: '10-20 minutes',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll diagnose why your site isn't reachable.",
      summary:
        'Quick 20-min session. I test the URL from multiple vantage points, check for WAF/firewall blocks, and either fix the access path or confirm the site needs upstream attention.',
      turnaround: '20 minutes',
      deliverable: 'Either a clean re-run or a specific infrastructure issue identified and documented.',
      cta: { label: 'Book a diagnostic', href: calendlyUrl('run-fetch-failed') },
    },
  },

  // Synth failed
  {
    id: 'run-synth-failed',
    category: 'run-health',
    severity: 'warning',
    triggers: {
      ids: ['run-synth-failed'],
      citationIncludes: ['synthesize_failed', 'synthesize_empty'],
      labelIncludes: ['synth', 'synthesis', 'brand analysis'],
    },
    problem: 'The AI brand analysis stage returned no data.',
    whyItMatters:
      "The synthesis stage is what turns the raw page content into structured brand signals (tone, positioning, target audience, opportunities). When it fails or returns empty, cards that rely on it — Brief, Industry, Business Model, Content Angle, Draft Post — fall back to thin or generic copy. The visual cards usually still work; the strategic ones don't.",
    diy: {
      summary: 'Usually a content-thinness issue. Re-run when the site has more to read.',
      steps: [
        'Check the homepage and top pages for readable body text (not just menus and footers).',
        'If your site is mostly interactive (e.g. a game, a tool, a landing page), the audit has thin signal to work with. Add a short About or Services page with 2-3 paragraphs.',
        'If synth threw an error specifically (not empty-returned), re-run the audit — Anthropic API can hit transient rate limits.',
      ],
      estimatedTime: '15-30 minutes (plus content additions if needed)',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll write the content baseline your audit needs.",
      summary:
        "I'll draft a short About + Services baseline (300-500 words across key pages) so the synthesis stage has enough to work from on the next run.",
      turnaround: '1-2 days',
      deliverable: 'Deployed baseline content + clean re-run of the audit.',
      cta: { label: 'Book a content baseline session', href: calendlyUrl('run-synth-failed') },
    },
  },

  // Style guide skipped
  {
    id: 'run-style-guide-skipped',
    category: 'run-health',
    severity: 'info',
    triggers: {
      ids: ['run-style-guide-skipped'],
      citationIncludes: ['style_guide_extraction_failed', 'style_guide_extraction_threw'],
      labelIncludes: ['style guide extraction', 'design system extraction'],
    },
    problem: 'Design system extraction was skipped this run.',
    whyItMatters:
      "The Style Guide card falls back to mock/placeholder tokens when the extractor can't run. It's a soft failure — the rest of the audit is fine — but the Style Guide card won't reflect your actual typography or colors until the extractor successfully parses your CSS.",
    diy: {
      summary: 'Re-run the audit. If it persists, the extractor is likely timing out on very large stylesheets.',
      steps: [
        'Trigger a fresh audit run.',
        'If Style Guide still falls back: check your CSS bundle size. The extractor caps at ~60KB. Minified Tailwind or a large CSS-in-JS bundle may exceed that.',
        'If you control the site: serve a smaller critical-CSS bundle for above-the-fold rendering.',
      ],
      estimatedTime: '10 minutes (re-run)',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll tune the extractor for your stack.",
      summary:
        'Quick debugging session — identify why CSS extraction is failing and either raise the cap or swap to a manual token import for your site.',
      turnaround: '30 minutes',
      deliverable: 'Style guide card populates with real brand tokens on the next run.',
      cta: { label: 'Book a 30-min fix', href: calendlyUrl('run-style-guide-skipped') },
    },
  },

  // Evidence thin
  {
    id: 'run-evidence-thin',
    category: 'run-health',
    severity: 'warning',
    triggers: {
      ids: ['run-evidence-thin'],
      citationIncludes: ['evidence.thin', 'runtime.health.thin'],
      labelIncludes: ['thin content', 'evidence thin', 'body text totaled'],
    },
    problem: 'Your site has very little visible body content for the audit to analyze.',
    whyItMatters:
      "The pipeline totaled under 200 characters of body text across all crawled pages — essentially a nav + footer + maybe a tagline. That's not enough to generate a confident brand analysis, content opportunities, or positioning signals. Most of your cards will render with limited depth as a result.",
    diy: {
      summary: 'Add readable body content to your top pages.',
      steps: [
        'Identify your top 3 pages: homepage, About, Services (or equivalents).',
        'Target 200-400 words per page minimum. Short, scannable paragraphs are fine — quality over length.',
        'Focus on: what you do in plain language, who it\'s for, one concrete outcome/benefit.',
        'Even if your site is image- or interaction-heavy (games, tools, products), add a short text layer — screen readers and crawlers need it too.',
        'Re-run the audit after deploying the content.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll write the baseline content your site needs.",
      summary:
        'Copywriting for homepage, About, and Services (or equivalents) — tuned to your positioning and ready to deploy.',
      turnaround: '3-5 days',
      deliverable: 'Live content on 3 key pages, audit re-run confirms the thin flag is gone.',
      cta: { label: 'Book a content baseline', href: calendlyUrl('run-evidence-thin') },
    },
  },

  // Run completed cleanly (positive)
  {
    id: 'run-completed-cleanly',
    category: 'run-health',
    severity: 'info',
    triggers: {
      ids: ['run-completed-cleanly'],
      citationIncludes: [],
      labelIncludes: ['audit completed cleanly', 'clean run', 'no warnings'],
    },
    problem: 'Your audit ran cleanly — no issues to flag here.',
    whyItMatters:
      "Every stage completed without warnings. Your site was reachable, content had enough depth for the AI to synthesize, PageSpeed returned full Lighthouse data, and every downstream card has grounded signals to work with. This is the \"everything worked\" signal — take your insights from the other cards with confidence.",
    diy: {
      summary: "Nothing to do here — the audit is clean.",
      steps: [
        'Focus on the findings in the SEO, Site Meta, and Style Guide cards — those are the real action items.',
        'If you want deeper analysis (competitor comparison, ongoing monitoring, retention audits), that\'s where the real work lives.',
      ],
      estimatedTime: '0 minutes',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "Your audit is clean — want ongoing monitoring?",
      summary:
        'Monthly audit runs with change detection (new issues flagged, regressions caught) so you catch SEO / content / design drift before it hurts rankings.',
      turnaround: 'Ongoing (monthly)',
      deliverable: 'Monthly health reports delivered to your inbox + a dashboard of trending signals.',
      cta: { label: 'Book a monitoring setup', href: calendlyUrl('run-completed-cleanly') },
    },
  },

  // No pages fetched (critical)
  {
    id: 'run-no-pages-fetched',
    category: 'run-health',
    severity: 'critical',
    triggers: {
      ids: ['run-no-pages-fetched'],
      citationIncludes: ['pagesFetched = 0', 'pagesFetched: 0'],
      labelIncludes: ['no pages', 'zero pages', 'nothing crawled'],
    },
    problem: 'Zero pages were successfully crawled.',
    whyItMatters:
      "The audit couldn't fetch any content at all. This is effectively the same as a failed audit — every card downstream is operating on no signal. Usually caused by the site being unreachable, blocking our user agent, or requiring authentication to view any page.",
    diy: {
      summary: 'Same fix as the fetch-failed solution — verify the URL and access.',
      steps: [
        'Open the URL in a fresh browser window — does it load without login?',
        'If your hosting uses Cloudflare or similar, whitelist our user agent: "BrandintelBot/1.0".',
        'Check that the URL used the correct protocol (http vs https) and matches your canonical domain.',
        'Re-run the audit.',
      ],
      estimatedTime: '10-15 minutes',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll get your audit unblocked.",
      summary:
        'Diagnose whether the issue is DNS, WAF, authentication, or a redirect loop — then unblock it so the audit can run against your real content.',
      turnaround: '30 minutes',
      deliverable: 'Clean audit run with real content reflected across every card.',
      cta: { label: 'Book a diagnostic', href: calendlyUrl('run-no-pages-fetched') },
    },
  },

  // Single page crawled (info)
  {
    id: 'run-single-page',
    category: 'run-health',
    severity: 'info',
    triggers: {
      ids: ['run-single-page'],
      citationIncludes: ['pagesFetched = 1', 'pagesFetched: 1'],
      labelIncludes: ['only homepage', 'single page', 'only one page'],
    },
    problem: 'Only your homepage was crawled — no About, Services, or Contact pages found.',
    whyItMatters:
      "The audit looks for common URL patterns (/about, /services, /contact) to build a fuller picture. When it only finds the homepage, the audit is working with a single signal source. E-E-A-T analysis (trust, authority) and content depth analysis rely on multi-page coverage.",
    diy: {
      summary: 'Add About and Contact pages (or confirm they exist at non-standard URLs).',
      steps: [
        'Check your site\'s nav — do About and Contact pages exist? If yes, what are their URLs?',
        'If they exist at non-standard URLs (e.g., /team instead of /about), the crawler missed them. You can point the audit explicitly.',
        'If they don\'t exist: create at minimum a simple About page (who you are, one photo) and a Contact page (email, phone, location). These are fundamental trust signals.',
        'Re-run the audit after adding the pages.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll build your About + Contact + trust layer.",
      summary:
        'Copy for About + Contact pages, photo staging if needed, and deployment. Same turnaround as the no-contact-signals solution.',
      turnaround: '5-7 days',
      deliverable: 'Live About + Contact pages, audit confirms they\'re crawled on re-run.',
      cta: { label: 'Book a trust layer build', href: calendlyUrl('run-single-page') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Website & Landing Page card — conversion readiness
  // ────────────────────────────────────────────────────────────────────────

  // No primary CTA
  {
    id: 'no-primary-cta',
    category: 'conversion',
    severity: 'critical',
    triggers: {
      ids: ['no-primary-cta'],
      citationIncludes: ['ctaTexts = []', 'ctaTexts: []', 'ctaTexts.length = 0'],
      labelIncludes: ['no cta', 'no primary cta', 'no call-to-action'],
    },
    problem: 'Your homepage has no clear call-to-action.',
    whyItMatters:
      "Without a CTA, there's no conversion path. Every visitor who arrives motivated has to guess what you want them to do next — book a call? buy? subscribe? download? — and that friction kills intent. Studies consistently show that adding a single clear CTA above the fold lifts conversion rates by 20-60% depending on category. This is the single highest-leverage fix on any landing page.",
    diy: {
      summary: 'Add one clear CTA above the fold, naming the exact action.',
      steps: [
        'Decide your primary desired action. Common options: "Book a call" (B2B services), "Start free trial" (SaaS), "Get pricing" (enterprise), "Shop now" (ecommerce), "Sign up" (newsletters/community).',
        'Place it above the fold — visible without scrolling, ideally right in or beside the hero headline.',
        'Style it distinctly — solid background, high contrast, larger than surrounding body text. The CTA should be the first thing eyes track to.',
        'Use action verbs, not filler. "Book a 30-min strategy call" beats "Learn more." "Get your pricing" beats "Click here."',
        'Test: show the page to someone who\'s never seen it, ask "what should I do next?" If they hesitate more than 2 seconds, the CTA isn\'t clear enough.',
      ],
      estimatedTime: '1-2 hours',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'CXL: CTA best practices', url: 'https://cxl.com/blog/cta-buttons/' },
      ],
    },
    expertOffer: {
      title: "I'll rebuild your hero + CTA for conversion.",
      summary:
        'Conversion-focused hero rewrite: value prop, primary CTA, visual hierarchy tuned so the desired action is unmistakable. Before/after A/B test setup included if you have traffic for it.',
      turnaround: '3-5 days',
      deliverable: 'Live hero + CTA with measurable conversion lift (or a live A/B test framework if you want to measure).',
      cta: { label: 'Book a landing page CRO session', href: calendlyUrl('no-primary-cta') },
    },
  },

  // Weak CTA text
  {
    id: 'weak-cta-text',
    category: 'conversion',
    severity: 'warning',
    triggers: {
      ids: ['weak-cta-text', 'vague-cta-verbs'],
      citationIncludes: ['ctaTexts'],
      labelIncludes: ['weak cta', 'vague cta', 'generic cta', 'learn more'],
    },
    problem: 'Your CTA text is generic — "Learn more", "Click here", or similar.',
    whyItMatters:
      "Generic CTAs ('Learn more', 'Click here', 'Read more', 'Submit') convert 30-40% worse than specific action-oriented ones ('Get pricing', 'Book a 30-min demo', 'Start free trial'). The specificity signals clarity of offer and removes the friction of 'what exactly am I signing up for?' Every word in a CTA carries weight — generic text tells the user you don't know what the offer is either.",
    diy: {
      summary: 'Rewrite every CTA to name the specific action and outcome.',
      steps: [
        'List every CTA button on your homepage (including in the nav, mid-page, and footer).',
        'For each, write a replacement that names the exact next step. Formula: <verb> + <object/outcome>. Examples:',
        '  • "Learn more" → "See how it works" or "Read the playbook"',
        '  • "Click here" → "Get started" or "Book your demo"',
        '  • "Submit" (on forms) → "Send my audit request" or "Get my free report"',
        '  • "Contact us" → "Book a 30-min call" or "Get a quote"',
        'Match the verb to the funnel stage: top-of-funnel uses "Learn/See/Read", mid-funnel uses "Start/Get/Try", bottom-funnel uses "Book/Buy/Schedule".',
        'Ship the changes and measure CTR on the updated buttons.',
      ],
      estimatedTime: '30-60 minutes',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'UX Design: CTA copy patterns', url: 'https://uxdesign.cc/call-to-action-ctas' },
      ],
    },
    expertOffer: {
      title: "I'll rewrite every CTA on your site.",
      summary:
        'Full CTA audit + rewrite pass. Every button on every page reviewed for specificity, action-orientation, and funnel-stage fit. Deployed in one session.',
      turnaround: '1-2 days',
      deliverable: 'Every CTA on the site rewritten and deployed, with before/after tracking if you want.',
      cta: { label: 'Book a CTA rewrite', href: calendlyUrl('weak-cta-text') },
    },
  },

  // No hero value prop
  {
    id: 'no-hero-value-prop',
    category: 'conversion',
    severity: 'critical',
    triggers: {
      ids: ['no-hero-value-prop', 'weak-hero-value-prop'],
      citationIncludes: ['pages[0].h1', 'h1 = []', 'h1 = null'],
      labelIncludes: ['hero value prop', 'no h1', 'no hero', 'weak hero'],
    },
    problem: 'Your homepage has no clear value proposition in the hero.',
    whyItMatters:
      "Visitors decide in under 5 seconds whether to stay on your site. The hero — your H1 and the line under it — is where that decision gets made. If the hero doesn't answer 'what does this site do for me?' in one readable sentence, you lose 60-80% of arriving visitors before they scroll. A strong value prop names the audience, the outcome, and the mechanism.",
    diy: {
      summary: 'Write a one-line value prop that names audience + outcome.',
      steps: [
        'Use the formula: [For <specific audience>], [we help you <specific outcome>] [by <mechanism>].',
        'Example: "For B2B founders, we build SEO audits that show exactly what to fix and in what order."',
        'Test it with the "so what?" test: after reading your H1, does the visitor know what you offer? If they\'d say "so what?", sharpen it.',
        'Name ONE specific audience. "For businesses" is too broad. "For e-commerce founders doing $100k-1M/yr" is specific.',
        'Name ONE specific outcome. "Better marketing" is vague. "Get your mobile LCP under 2.5s" is specific.',
        'Ship it as your H1. The subheadline (1-2 sentences under it) can elaborate on the mechanism.',
      ],
      estimatedTime: '2-4 hours (including iteration)',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'April Dunford: Obviously Awesome', url: 'https://www.aprildunford.com/obviously-awesome' },
        { label: 'CXL: Value proposition guide', url: 'https://cxl.com/blog/value-proposition/' },
      ],
    },
    expertOffer: {
      title: "I'll write + deploy your hero value proposition.",
      summary:
        'Positioning discovery session → 3 value-prop drafts → chosen version deployed on homepage. Built to specifically name your audience and the outcome you deliver, with a supporting subheadline and visual.',
      turnaround: '3-5 days',
      deliverable: 'Live hero value proposition that passes the 5-second test.',
      cta: { label: 'Book a positioning session', href: calendlyUrl('no-hero-value-prop') },
    },
  },

  // No pricing signal
  {
    id: 'no-pricing-signal',
    category: 'conversion',
    severity: 'warning',
    triggers: {
      ids: ['no-pricing-signal'],
      citationIncludes: ['no page of type \'pricing\'', 'no commerce CTAs'],
      labelIncludes: ['no pricing', 'no pricing signal', 'no commerce'],
    },
    problem: 'Your site has no pricing or commerce signal visible anywhere.',
    whyItMatters:
      "A site without pricing signals can't pre-qualify visitors. Budget-conscious prospects bounce without engaging, and the ones who do engage often have mismatched expectations — leading to wasted sales conversations and lower close rates. 'Hidden pricing' strategies usually hurt more than they help, except at very high-ticket enterprise where custom quotes are the norm.",
    diy: {
      summary: 'Add a pricing signal — page, range, or starting-at number.',
      steps: [
        'Decide what pricing signal fits your model:',
        '  • Tiered SaaS: full pricing table (Free / Pro / Team / Enterprise)',
        '  • Services: "Starting at $X" or "From $X-Y/month" with a sample engagement',
        '  • Products: itemized pricing (obvious for ecommerce)',
        '  • Enterprise / custom: a page that says "Pricing starts at $X for teams of <5" and then requires a call',
        'Create a /pricing page (or add a pricing section to the homepage for simple products).',
        'Link to it from your main nav AND from relevant CTAs ("Get pricing", "See plans").',
        'Even if you can\'t publish exact numbers, publishing a range ($500-5000/month) lets prospects self-qualify.',
      ],
      estimatedTime: '4-6 hours (including copy + design)',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'Patrick Campbell: Pricing pages', url: 'https://www.priceintelligently.com/blog' },
      ],
    },
    expertOffer: {
      title: "I'll build your pricing page.",
      summary:
        'Pricing strategy interview → tiered or range-based pricing page → deployed with tracking. Covers copy, layout, and CTA placement tuned to pre-qualify and convert.',
      turnaround: '3-5 days',
      deliverable: 'Live pricing page that pre-qualifies prospects and shortens sales cycles.',
      cta: { label: 'Book a pricing page build', href: calendlyUrl('no-pricing-signal') },
    },
  },

  // Single-page conversion site
  {
    id: 'single-page-conversion-site',
    category: 'conversion',
    severity: 'warning',
    triggers: {
      ids: ['single-page-conversion-site'],
      citationIncludes: ['pages.length = 1'],
      labelIncludes: ['single-page', 'one page', 'single page site'],
    },
    problem: 'Your conversion path is one page deep.',
    whyItMatters:
      "A single-page site gives visitors one decision: convert now, or leave. There's nowhere to learn more, build trust, verify credibility, or explore offers. Even for simple products, adding a handful of supporting pages (About, Pricing, Case studies, Contact) dramatically lifts both SEO ranking potential (more indexed URLs) and mid-funnel conversion (visitors who need more context before buying).",
    diy: {
      summary: 'Build out the core supporting pages — About, Pricing, Case studies, Contact.',
      steps: [
        'Identify the 3-4 pages that matter most for your funnel. For most services businesses: About, Pricing, Case studies / Portfolio, Contact.',
        'For each page, write or collect the content — 300-500 words minimum per page.',
        'Link to them from your main nav. Don\'t bury them in a footer-only nav.',
        'Link between them contextually — e.g., mention a case study inside your pricing page, link to About from the homepage hero.',
        'Make sure the primary CTA appears on every page, not just the homepage.',
      ],
      estimatedTime: '1-2 weeks (including content)',
      skillLevel: 'intermediate',
    },
    expertOffer: {
      title: "I'll build out your multi-page site.",
      summary:
        'Scope interview → sitemap → copy for 4 supporting pages (About, Pricing, Case studies, Contact) → designed and deployed. Tied together with a nav + internal linking strategy.',
      turnaround: '2-3 weeks',
      deliverable: 'Full multi-page site with supporting conversion paths and cross-linking.',
      cta: { label: 'Book a site build', href: calendlyUrl('single-page-conversion-site') },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Brand Identity & Design card — identity coherence & completeness
  // ────────────────────────────────────────────────────────────────────────

  // Brand name inconsistency
  {
    id: 'brand-name-inconsistency',
    category: 'brand-identity',
    severity: 'warning',
    triggers: {
      ids: ['brand-name-inconsistency', 'brand-name-minor-variation'],
      citationIncludes: ['siteMeta.siteName', 'pages[0].h1', 'synth headline'],
      labelIncludes: ['brand name', 'name inconsistency', 'name varies'],
    },
    problem: 'Your brand name varies across different parts of the site.',
    whyItMatters:
      "When your site uses \"Acme\" in the header, \"Acme Studio\" in the page title, and \"Acme Design Co\" in the OG preview, each variation splits search recall and brand memory. Google treats them as weakly related entities. Visitors pattern-match to whichever version they saw first, and word-of-mouth fragments. It's a subtle signal that reads as \"no brand guidelines in place\" to anyone paying attention — including sophisticated prospects.",
    diy: {
      summary: "Lock one canonical brand name and propagate it everywhere.",
      steps: [
        'Decide your canonical brand name. The one you want customers to say aloud. Usually the shortest, cleanest version.',
        'Audit every surface: page <title>, og:title, og:site_name, H1, logo alt text, footer copyright, email signature, social profiles.',
        'Replace every variation with the canonical version. If you need a tagline, make it clearly a tagline: "Acme — the voice AI platform" not "Acme Voice AI".',
        'Document the rule in a one-page brand sheet so future team members don\'t drift.',
        'Re-run the audit and confirm the variations are gone.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'beginner',
    },
    expertOffer: {
      title: "I'll lock your brand naming across every touchpoint.",
      summary:
        'Full naming audit across site, social, meta, and email. Canonical version chosen, propagated, and documented in a short brand guidelines doc so it stays consistent.',
      turnaround: '3-5 days',
      deliverable: 'Every touchpoint uses the same brand name, backed by a documented standard.',
      cta: { label: 'Book a brand naming session', href: calendlyUrl('brand-name-inconsistency') },
    },
  },

  // Brand on default platform
  {
    id: 'brand-on-default-platform',
    category: 'brand-identity',
    severity: 'info',
    triggers: {
      ids: ['brand-on-default-platform'],
      citationIncludes: ['squarespace-cdn', 'wixstatic', 'webflow.com', 'wp-content/themes/twenty', 'cdn.shopify'],
      labelIncludes: ['default platform', 'squarespace default', 'wix default', 'wordpress default', 'template default'],
    },
    problem: 'Your brand assets are hosted on platform-default CDNs.',
    whyItMatters:
      "When your OG image URL points to `static1.squarespace.com/static/default-social-preview.png` (or similar defaults from Wix, WordPress, Webflow), it signals that the site is running a template without customized brand assets. Prospects who look under the hood — developers, designers, careful buyers — notice. It's a small tell that marks the brand as less mature than a site running deliberately produced custom assets.",
    diy: {
      summary: "Produce custom brand assets and host them on your own domain.",
      steps: [
        'Design a custom OG image (1200x630) with your logo, positioning statement, and brand colors. Upload it to your domain.',
        'Design a custom favicon set (see the missing-favicon solution). Host it on your domain.',
        'Update the <head> tags to point to your new assets, replacing the platform defaults.',
        'Delete or rename the default assets if your platform exposes them via settings (Squarespace: Site Header → Branding; Wix: Settings → Social Sharing).',
        'Validate on opengraph.xyz — the preview should now render your custom image, hosted on your domain.',
      ],
      estimatedTime: '2-4 hours (including asset design)',
      skillLevel: 'beginner',
      helpfulLinks: [
        { label: 'opengraph.xyz (validator)', url: 'https://www.opengraph.xyz' },
      ],
    },
    expertOffer: {
      title: "I'll produce and deploy your custom brand asset kit.",
      summary:
        'Custom OG image, favicon set, apple-touch-icon, and manifest assets — all designed in your brand style, deployed to your domain, validated across platforms. No more platform defaults anywhere.',
      turnaround: '1 week',
      deliverable: 'Full custom brand asset kit live, validated on LinkedIn, X, Slack, iMessage, and browser chrome.',
      cta: { label: 'Book an asset kit build', href: calendlyUrl('brand-on-default-platform') },
    },
  },

  // Thin brand positioning
  {
    id: 'thin-brand-positioning',
    category: 'brand-identity',
    severity: 'warning',
    triggers: {
      ids: ['thin-brand-positioning', 'thin-brand-summary'],
      citationIncludes: ['brandOverview.positioning', 'brandOverview.summary'],
      labelIncludes: ['thin positioning', 'thin summary', 'weak positioning', 'no positioning'],
    },
    problem: "Your site doesn't clearly state what your brand stands for.",
    whyItMatters:
      "When the AI synthesis can't extract a clear positioning from your site, that's because the site itself doesn't state one clearly — and visitors have the same problem. A site without a sharp positioning statement leaves every prospect to invent their own story about what you do, who you're for, and why you're different. You lose the framing battle before the conversation starts. This is one of the highest-leverage brand investments you can make.",
    diy: {
      summary: "Write a one-paragraph positioning statement and put it on the site.",
      steps: [
        'Use a positioning framework. Classic: "For <specific audience>, <brand> is the <category> that <key differentiator>. Unlike <alternatives>, <brand> <reason to believe>."',
        'Example: "For B2B SaaS founders, Acme is the onboarding platform that makes first-run setup take 90 seconds. Unlike Intercom and other incumbents, Acme is purpose-built for dev-heavy products where onboarding is a technical, not just visual, problem."',
        'Name ONE audience. "For businesses" fails. "For B2B SaaS founders doing $1-10M ARR" succeeds.',
        'Name ONE differentiator. Not a list — one load-bearing claim that sets you apart.',
        'Put the positioning statement ON your site: as hero subhead, as About page opener, as meta description. Consistently.',
        'Test it: ask 3 strangers what the brand does after reading the hero. If their descriptions differ, the positioning is still too broad.',
      ],
      estimatedTime: '1-2 weeks (including iteration)',
      skillLevel: 'intermediate',
      helpfulLinks: [
        { label: 'April Dunford: Obviously Awesome', url: 'https://www.aprildunford.com/obviously-awesome' },
        { label: 'April Dunford: Sales Pitch', url: 'https://www.aprildunford.com/books/sales-pitch' },
      ],
    },
    expertOffer: {
      title: "I'll run a positioning sprint and deploy the output.",
      summary:
        '2-hour discovery interview → competitor mapping → 3 positioning candidates → chosen version deployed across hero, About, meta, and social. Grounded in a framework (April Dunford\'s Obviously Awesome).',
      turnaround: '1-2 weeks',
      deliverable: 'A load-bearing positioning statement, deployed and consistent across every touchpoint.',
      cta: { label: 'Book a positioning sprint', href: calendlyUrl('thin-brand-positioning') },
    },
  },

  // Generic target audience
  {
    id: 'generic-target-audience',
    category: 'brand-identity',
    severity: 'info',
    triggers: {
      ids: ['generic-target-audience'],
      citationIncludes: ['brandOverview.targetAudience'],
      labelIncludes: ['generic audience', 'target audience', 'target is broad'],
    },
    problem: "Your target audience is defined too broadly.",
    whyItMatters:
      "\"For everyone,\" \"for businesses,\" \"for modern teams\" — these are the hallmarks of an undefined audience. A site that tries to speak to everyone speaks to no one. Messaging that resonates is always specific to a narrow audience: their role, their stage, their specific problem. Narrowing the audience makes every downstream brand decision (voice, CTAs, case studies, pricing) easier and more precise.",
    diy: {
      summary: "Narrow to one specific audience segment.",
      steps: [
        'Look at your current customers (or best prospects). Identify the ONE segment that most resembles your ideal buyer — by role, company stage, problem urgency, or spend capacity.',
        'Name that segment specifically: "B2B founders at $1-10M ARR who haven\'t hired their first marketer yet" beats "growing B2B companies."',
        'Rewrite your hero + About page to speak directly TO that segment. Use their vocabulary, name their specific frustrations.',
        'Update meta description and og:description to match.',
        'If you worry you\'ll alienate other audiences — don\'t. Clarity for your core segment attracts more of them; broad messaging attracts no one strongly.',
      ],
      estimatedTime: '1 week',
      skillLevel: 'intermediate',
    },
    expertOffer: {
      title: "I'll help you narrow and deploy your target audience.",
      summary:
        'Audience discovery interview → customer research (if applicable) → narrowed audience definition → messaging rewrite tuned specifically to that segment. Deployed across site + meta + social.',
      turnaround: '1-2 weeks',
      deliverable: 'A specific, named audience reflected consistently across all brand-facing copy.',
      cta: { label: 'Book an audience sprint', href: calendlyUrl('generic-target-audience') },
    },
  },

  // Brand assets on foreign domain
  {
    id: 'brand-assets-on-foreign-domain',
    category: 'brand-identity',
    severity: 'info',
    triggers: {
      ids: ['brand-assets-on-foreign-domain'],
      citationIncludes: ['hostname', 'foreign domain', 'third-party'],
      labelIncludes: ['foreign domain', 'third-party host', 'assets scattered'],
    },
    problem: "Your brand assets are hosted on third-party domains (Imgur, Dropbox, Google Drive).",
    whyItMatters:
      "Assets scattered across third-party hosts signal that your brand identity hasn't been consolidated into a proper production pipeline. Fragile — those external services can change URLs, rate-limit hotlinks, or disappear entirely. Also unprofessional at scale: mature brands deliver their OG image and favicon from their own domain as part of a deliberate deployment, not as a quick workaround.",
    diy: {
      summary: "Move all brand assets to your own domain.",
      steps: [
        'List every externally-hosted asset: OG image, favicon, apple-touch-icon, logo, product screenshots.',
        'Download each from its current host.',
        'Upload them to your site\'s static asset directory (`/assets/`, `/static/`, `/public/`, depending on your stack).',
        'Update all HTML references to point to the new internal URLs.',
        'Add the assets to your deployment so they rebuild with each release.',
        'Test: every asset should now be served from your domain, verified via browser DevTools → Network tab.',
      ],
      estimatedTime: '2-4 hours',
      skillLevel: 'intermediate',
    },
    expertOffer: {
      title: "I'll consolidate your assets onto your domain.",
      summary:
        'Full asset audit, download-rehost for every externally-linked image or icon, deployed with cache headers tuned for performance. No more third-party dependencies.',
      turnaround: '1-2 days',
      deliverable: 'All brand assets served from your domain, with proper cache + CDN config.',
      cta: { label: 'Book an asset consolidation', href: calendlyUrl('brand-assets-on-foreign-domain') },
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
 * analyzer aggregate. NO dedup — every finding (critical/warning/info) AND
 * every triggered gap produces its own card, in the same order as the
 * PROBLEMS tab. Each card carries the finding/gap's unique severity; the
 * catalog's severity is not used to override. Parity with PROBLEMS is a
 * stronger requirement than content dedup.
 *
 * @param {{ findings?: any[], gaps?: any[] } | null} aggregate
 * @returns {Array<{ source: 'finding'|'gap', key: string, severity: string, finding: object, solution: object, isGeneric: boolean }>}
 */
export function buildSolutionsList(aggregate) {
  if (!aggregate || typeof aggregate !== 'object') return [];

  const out = [];

  const findings = Array.isArray(aggregate.findings) ? aggregate.findings : [];
  findings.forEach((f, idx) => {
    if (!f) return;
    const matched  = resolveSolution(f);
    const solution = matched || buildGenericSolution(f, 'finding');
    out.push({
      source:    'finding',
      key:       `finding-${idx}-${f.id || 'item'}`,
      severity:  f.severity || 'info',
      finding:   f,
      solution,
      isGeneric: !matched,
    });
  });

  const gaps = Array.isArray(aggregate.gaps) ? aggregate.gaps : [];
  gaps.forEach((g, idx) => {
    if (!g || !g.triggered) return;
    const matched  = resolveSolution(g);
    const solution = matched || buildGenericSolution(g, 'gap');
    out.push({
      source:    'gap',
      key:       `gap-${idx}-${g.ruleId || 'item'}`,
      severity:  g.severity || 'warning',
      finding:   g,
      solution,
      isGeneric: !matched,
    });
  });

  return out;
}

