# SEO Audit Report — hitloop.agency
**Date:** 2026-04-25 (updated from 2026-04-23)
**Canonical Domain:** https://hitloop.agency
**Framework:** Next.js 16 App Router (SSR confirmed)
**Business Type:** Personal portfolio / AI design engineer & creative technologist

---

## Executive Summary

**Overall SEO Health Score: 63 / 100** *(27 → 61 → 63)*

All 11 new pages are now live. OG image compressed from 1.1 MB to 65 KB. Domain inconsistency resolved — all schemas now resolve to `hitloop.agency`. LinkedIn and Twitter added to `sameAs`. FAQPage JSON-LD confirmed live on `/faq` and `/services/seo-geo`.

**New issue found:** Every inner page `<title>` is duplicating "Bryan Balli" because page layout titles already include the name and the root `template: '%s · Bryan Balli'` appends it again. Example live output: `"About · Bryan Balli · Bryan Balli"`.

Two critical items from the last audit remain open: sitemap only lists `/` (while 11 pages are now live), and the `robots.txt` Sitemap directive is still a relative path.

### What Was Fixed Since 2026-04-23
1. ✅ 11 new pages deployed and live (about, work, contact, gallery, how-it-works, process, case-studies, 5 service pages)
2. ✅ OG image: `og_meta.png` (1.1 MB) → `og_meta.optimized.jpg` (65 KB)
3. ✅ Domain inconsistency: all inner page schemas now use `hitloop.agency` via env var
4. ✅ `sameAs`: LinkedIn + Twitter added alongside GitHub
5. ✅ FAQPage JSON-LD confirmed on `/faq` and `/services/seo-geo`

### Top Critical Issues
1. **Title duplication** — all inner pages render `· Bryan Balli · Bryan Balli` in `<title>`
2. **Sitemap incomplete** — only `/` listed; 11 live pages undiscoverable via sitemap
3. **robots.txt Sitemap relative** — `Sitemap: /sitemap.xml` is non-standard
4. **Portfolio images** — 5 images over 4 MB, no WebP, no Next.js `<Image>`

### Top Quick Wins
1. Strip `· Bryan Balli` / `— Bryan Balli` from inner page layout `title` strings (30 min)
2. Expand `app/sitemap.js` to all 14 public routes (30 min)
3. Fix robots.txt Sitemap to absolute URL (5 min)

---

## Technical SEO

**Score: 63 / 100** *(was 65 — slipped because sitemap gap is now more critical with 11 live pages)*

### robots.txt ✅ / ⚠️
- Comprehensive file covering 13+ AI crawlers and all major search engines.
- Private routes correctly blocked.
- **HIGH:** `Sitemap: /sitemap.xml` is still a relative path. Per the Sitemaps protocol, it must be absolute.
  - Fix: `Sitemap: https://hitloop.agency/sitemap.xml`

### Sitemap ❌ — Critical Gap Widened
- `app/sitemap.js` still only returns `/`.
- 11 pages are now live and crawlable but absent from the sitemap.
- Google and AI search engines have no structured discovery path for any page except the homepage.

Pages to add:
```
/about             priority 0.9
/work              priority 0.9
/case-studies      priority 0.8
/services/ai-design-consulting  priority 0.8
/services/brand-identity        priority 0.8
/services/design-systems        priority 0.8
/services/seo-geo               priority 0.8
/services/web-development       priority 0.8
/how-it-works      priority 0.7
/process           priority 0.7
/gallery           priority 0.7
/faq               priority 0.7
/contact           priority 0.6
```

### Canonical Tags ✅
- `metadataBase: new URL(SITE_URL)` in root layout.
- Per-page `alternates.canonical` set on all inner pages.
- Live canonical on homepage confirmed: `https://hitloop.agency`.

### noindex on Private Pages ✅
- dashboard, admin, login, capture, preview — all blocked via layout-level `robots: { index: false }`.

### Custom Domain ✅
- `hitloop.agency` is live and canonical.

### Favicon ✅
- `/img/sig.png` served as favicon, shortcut, and apple-touch-icon.

---

## On-Page SEO

**Score: 62 / 100** *(was 75 — title duplication discovered across all inner pages)*

### Title Tags — Duplication Bug ❌ Critical

The root layout sets:
```js
title: { default: '...', template: '%s · Bryan Balli' }
```

All inner page layouts set their `title` with `Bryan Balli` already included. Next.js applies the template to whatever the page exports — resulting in `Bryan Balli` appearing twice in the rendered `<title>`.

**Confirmed live:** `/about` title = `"About · Bryan Balli · Bryan Balli"`

**All affected layouts and their current (broken) titles:**

| Page | Current (broken) | Should be |
|------|-----------------|-----------|
| `/about` | `About · Bryan Balli` | `About` |
| `/contact` | `Contact · Bryan Balli` | `Contact` |
| `/work` | `Featured Work · Bryan Balli` | `Featured Work` |
| `/gallery` | `Gallery · Bryan Balli` | `Gallery` |
| `/faq` | `FAQ — AI Design Engineer & Creative Technologist · Bryan Balli` | `FAQ — AI Design Engineer & Creative Technologist` |
| `/services/ai-design-consulting` | `AI Design Consulting — Bryan Balli · AI Design Engineer` | `AI Design Consulting — AI Design Engineer` |
| `/services/brand-identity` | `Brand Identity — Bryan Balli · Design System Extraction & Visual Identity` | `Brand Identity — Design System Extraction & Visual Identity` |
| `/services/design-systems` | `Design Systems — Bryan Balli · Component Libraries & Token Architecture` | `Design Systems — Component Libraries & Token Architecture` |
| `/services/seo-geo` | `SEO & GEO — Bryan Balli · AI-Assisted SEO & Generative Engine Optimization` | `SEO & GEO — AI-Assisted SEO & Generative Engine Optimization` |
| `/services/web-development` | `Web Development — Bryan Balli · Next.js, GSAP & Three.js` | `Web Development — Next.js, GSAP & Three.js` |

Note: OpenGraph `title` values are not affected — they use the hardcoded string directly.

### Meta Descriptions ✅
- Root: substantive, search-facing.
- Per-page descriptions set and differentiated across all layouts.

### Heading Structure
- Homepage H1: `"YOUR HUMAN IN THE LOOP"` — brand tagline, low keyword density.
- Visually hidden H2 in SSR: `"AI design engineer and creative technologist — portfolio, case studies, and AI-assisted client intelligence dashboards."` ✅ — good crawlable fallback.
- Inner pages use `InnerPageShell` — heading structure not verified on live pages.

### Internal Linking
- Navigation links exist to all inner pages via header.
- No in-body cross-linking between service pages or between service pages and the FAQ.

---

## Content Quality

**Score: 65 / 100** *(was 58)*

### What's Improved
- 11 pages live with distinct content per page.
- FAQ has deep, crawlable Q&A content (5,542 chars SSR) covering pricing, timelines, tech stack, and process.
- Service pages have metadata, schema, and keyword targeting in place.

### E-E-A-T
- **Experience/Expertise:** `worksFor` on About schema lists Publicis, Epsilon, Conversant, Alliance Data. `knowsAbout` covers 8 technical domains. Real testimonials from TikTok, HBO Max, Epsilon, TST — all in SSR.
- **Authoritativeness:** GitHub sameAs active. LinkedIn and Twitter now added.
- **Trust:** No Wikipedia entry. No Reddit or YouTube presence. No publication dates on any page.

### Thin Content Risk
- Service page body content not verified — `AiDesignConsultingPage`, `BrandIdentityPage` etc. are JSX components, content depth unknown.
- GSAP-animated content (slide panels, hover reveals) requires JS — some AI crawlers miss it.

### Content Gaps
- No blog, editorial, or long-form content.
- No dates on any page — AI engines weight dated content more heavily.

---

## Schema / Structured Data

**Score: 82 / 100** *(was 75)*

### Implemented ✅
- **Homepage:** Person (`@id: hitloop.agency#bryan-balli`), WebSite, 4× Review — all using `hitloop.agency`
- **About:** Person schema — domain fixed to `hitloop.agency`
- **Work:** ItemList schema
- **All 5 service pages:** Service schema — domains fixed
- **FAQ:** FAQPage schema (10 Q&A pairs)
- **SEO/GEO service page:** FAQPage schema (4 GEO-specific Q&As) + Service schema
- **Contact:** ContactPage schema
- **Gallery:** ImageGallery schema

### sameAs ✅
- GitHub ×2, LinkedIn, Twitter — deployed and live on homepage JSON-LD.

### Remaining Gap
- `ProfessionalService` with `aggregateRating` — not yet added. Would strengthen rich result eligibility once ratings are established.
- `worksFor` / employment history schema only on About page — not referenced from homepage Person entity.

---

## Performance (Core Web Vitals)

**Score: 35 / 100** *(was 32)*

### OG Image ✅ — Fixed
- `og_meta.optimized.jpg`: 65 KB at 1200×630 — correct size and format.

### Portfolio Images ❌ — Unchanged
| File | Size |
|------|------|
| `frame_4.png` | 5.6 MB |
| `frame_2.png` | 5.3 MB |
| `critters_game1.png` | 5.1 MB |
| `frame_8.png` | 4.7 MB |
| `frame_6.png` | 3.3 MB |

Total: 24+ MB of uncompressed PNGs. No `<Image>` component, no lazy loading, no WebP conversion. Severe LCP impact on mobile.

### WebGL Canvas
- Homepage canvas (`ox.jsx`) — 25,000 particles, loads on entry, not deferred.

---

## Images

**Score: 32 / 100** *(was 28)*

- OG image: ✅ fixed.
- Portfolio images: all PNG, all oversized, no responsive sizing, no lazy load.
- Alt text: not re-verified on new pages — check `InnerPageShell`, gallery, and service page images.

---

## AI Search Readiness

**Score: 70 / 100** *(was 65)*

- All AI crawlers allowed. `llms.txt` live. sameAs expanded. 11 pages now live and crawlable.
- FAQ is the strongest citability asset: definitional, quantified, self-contained answers.
- **Gap:** `llms.txt` still only lists dashboard and auth as "core experiences" — new public pages not referenced.
- **Gap:** No YouTube or Reddit presence.
- **Gap:** No publication dates on any page.

---

## Sitemap Analysis

**Score: 30 / 100** *(unchanged — fix not deployed)*

Sitemap lists 1 URL. 11 public pages are live and not submitted.

---

## Priority Action Plan

### Critical — Fix Immediately

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 1 | **Title duplication** — strip `· Bryan Balli` / `— Bryan Balli` from all inner page layout `title` strings | 10 layout files | 30 min |
| 2 | **Expand sitemap** — add all 13 public routes | `app/sitemap.js` | 30 min |
| 3 | **Fix robots.txt Sitemap** — change to absolute URL | `public/robots.txt` | 5 min |

### High — Fix Within 1 Week

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 4 | **Portfolio images** — convert to WebP with Next.js `<Image>` | gallery/modal components | 2–3 hrs |
| 5 | **Update `llms.txt`** — add all public pages to the index | `public/llms.txt` | 30 min |
| 6 | **Add publication dates** to FAQ and service pages | layout files | 30 min |

### Medium — Fix Within 1 Month

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 7 | Verify service page content depth (300+ words per page) | service page components | varies |
| 8 | Add cross-links between service pages and FAQ | service page components | 1 hr |
| 9 | `ProfessionalService` schema with aggregateRating | `app/page.jsx` | 1 hr |
| 10 | Defer WebGL canvas init until scroll | `ox.jsx` | 1–2 hrs |

### Low — Backlog

| # | Issue | Notes |
|---|-------|-------|
| 11 | Static `/work/[slug]` pages | Case content currently JS-modal-only |
| 12 | Blog / editorial content | Informational keyword ranking |
| 13 | YouTube presence | Highest-correlation AI citation signal (0.737) |
| 14 | Reddit presence | Primary Perplexity citation source |

---

## SEO Health Scorecard

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Technical SEO | 22% | 63/100 | 13.9 |
| Content Quality | 23% | 65/100 | 14.9 |
| On-Page SEO | 20% | 62/100 | 12.4 |
| Schema / Structured Data | 10% | 82/100 | 8.2 |
| Performance (CWV) | 10% | 35/100 | 3.5 |
| AI Search Readiness | 10% | 70/100 | 7.0 |
| Images | 5% | 32/100 | 1.6 |
| **Overall** | **100%** | | **61.5 / 100** |

---

## Score History

| Date | Score | Key changes |
|------|-------|-------------|
| 2026-04-21 | 27/100 | Baseline — no infrastructure |
| 2026-04-23 | 61/100 | robots.txt, llms.txt, sitemap, metadata, JSON-LD, noindex, favicon |
| 2026-04-25 | 63/100 | 11 pages live, OG image optimized, domain fixed, sameAs expanded; title duplication found |

---

## Quick Fix: Title Duplication

Remove the author name from all inner page layout `title` strings. The root template adds ` · Bryan Balli` automatically.

**Pattern:** in each `app/*/layout.jsx`, change:
```js
// Before
title: 'About · Bryan Balli',

// After
title: 'About',
```

Service pages follow the same pattern — strip ` — Bryan Balli` from the middle:
```js
// Before
title: 'AI Design Consulting — Bryan Balli · AI Design Engineer',

// After
title: 'AI Design Consulting — AI Design Engineer',
```

OpenGraph titles are unaffected (they bypass the template) — leave those as-is.

---

## Quick Fix: Sitemap (`app/sitemap.js`)

```js
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const PUBLIC_ROUTES = [
  { path: '/',                                  priority: 1.0, freq: 'weekly'  },
  { path: '/about',                             priority: 0.9, freq: 'monthly' },
  { path: '/work',                              priority: 0.9, freq: 'weekly'  },
  { path: '/case-studies',                      priority: 0.8, freq: 'weekly'  },
  { path: '/services/ai-design-consulting',     priority: 0.8, freq: 'monthly' },
  { path: '/services/brand-identity',           priority: 0.8, freq: 'monthly' },
  { path: '/services/design-systems',           priority: 0.8, freq: 'monthly' },
  { path: '/services/seo-geo',                  priority: 0.8, freq: 'monthly' },
  { path: '/services/web-development',          priority: 0.8, freq: 'monthly' },
  { path: '/how-it-works',                      priority: 0.7, freq: 'monthly' },
  { path: '/process',                           priority: 0.7, freq: 'monthly' },
  { path: '/gallery',                           priority: 0.7, freq: 'monthly' },
  { path: '/faq',                               priority: 0.7, freq: 'monthly' },
  { path: '/contact',                           priority: 0.6, freq: 'monthly' },
];

export default function sitemap() {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map(({ path, priority, freq }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: freq,
    priority,
  }));
}
```
