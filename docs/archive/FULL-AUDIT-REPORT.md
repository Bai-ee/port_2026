# SEO Audit Report — Bballi Portfolio
**Date:** 2026-04-23 (updated from 2026-04-21 baseline)
**URL:** https://port-2026-kohl.vercel.app (no custom domain live yet)
**Framework:** Next.js 16 (App Router, Turbopack)
**Business Type:** Personal portfolio / AI design engineer & creative technologist

---

## Executive Summary

**Overall SEO Health Score: 61 / 100** *(up from 27/100 two days ago)*

Major structural work completed since the last audit: robots.txt, sitemap, llms.txt, per-page metadata, OG/Twitter cards, JSON-LD schemas, noindex on private pages, GA4 analytics, and favicon are all now in place. The site has gone from no SEO infrastructure to a solid baseline.

Remaining blockers: the sitemap only lists the homepage while 10+ new public pages exist, domain names are inconsistent across schemas (`bballi.com` vs `bryanballi.com` vs the live Vercel URL), portfolio images are still uncompressed PNGs (5.6 MB), and no custom domain is live.

### What Was Fixed
1. ✅ `robots.txt` — comprehensive, includes 15+ AI crawlers
2. ✅ `llms.txt` — detailed, covers platform architecture and use cases
3. ✅ Root layout metadata — full OG, Twitter Card, keywords, GA4
4. ✅ JSON-LD — Person, WebSite, and Review schemas on homepage
5. ✅ Per-page metadata — About, Work, all 5 service pages have layouts with metadata + schema
6. ✅ `noindex` — dashboard, admin, login, capture, preview all blocked via layout.jsx
7. ✅ Favicon — `app/icon.png` present
8. ✅ GA4 analytics — wired via `AnalyticsPageView` + gtag script

### Top 5 Remaining Critical Issues
1. Sitemap lists only `/` — 10 new public pages are not submitted to search engines
2. Domain inconsistency — schemas use `bryanballi.com`, root layout falls back to `bballi.com`, live site is `port-2026-kohl.vercel.app`
3. Portfolio images uncompressed — frame_4.png is 5.6 MB (no WebP, no `<Image>`)
4. `robots.txt` Sitemap directive is a relative path — must be absolute
5. No custom domain live — `*.vercel.app` carries no domain authority

### Top 5 Quick Wins
1. Expand `app/sitemap.js` to include all public routes (30 min)
2. Fix `robots.txt` Sitemap line to absolute URL (5 min)
3. Pick one canonical domain and make all schemas consistent (30 min)
4. Convert heavy portfolio images to WebP using Next.js `<Image>` (2–3 hrs)
5. Add LinkedIn/Twitter to `sameAs` in homepage Person schema (15 min)

---

## Technical SEO

**Score: 65 / 100** *(was 22/100)*

### robots.txt ✅ — Fixed
- Comprehensive file with `User-agent: *` defaults plus explicit rules for Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, and 10+ others.
- Private routes correctly blocked: `/api/`, `/dashboard/`, `/auth/`, `/login`, `/admin`, `/preview/`, `/capture/`.
- **ISSUE — HIGH:** `Sitemap: /sitemap.xml` is a relative URL. Per the Sitemaps protocol, the Sitemap directive must be an absolute URL.
  - Fix: `Sitemap: https://port-2026-kohl.vercel.app/sitemap.xml` (or the custom domain once live).

### Sitemap ⚠️ — Partial
- `app/sitemap.js` exists and uses env-var-driven URL — good pattern.
- **CRITICAL:** Only `/` is listed. The site now has 10+ public pages:
  - `/about`, `/work`, `/contact`, `/gallery`, `/how-it-works`, `/process`, `/faq`, `/case-studies`
  - `/services/ai-design-consulting`, `/services/brand-identity`, `/services/design-systems`, `/services/seo-geo`, `/services/web-development`
- These pages will not be discovered or prioritized by search engines until added to the sitemap.

### Canonical Tags ✅ — Fixed
- `metadataBase` set in root layout.
- Individual pages declare `alternates: { canonical: '/slug' }` in their layouts.

### noindex on Private Pages ✅ — Fixed
- `dashboard`, `admin`, `login`, `capture`, `preview` layouts all export `robots: { index: false, follow: false, nocache: true }`. Correctly implemented at layout level so all child routes inherit.

### Custom Domain ❌ — Not Yet Live
- Site still served from `port-2026-kohl.vercel.app`. No `bballi.com` or `bryanballi.com` configured.
- **Inconsistency risk:** root layout falls back to `https://bballi.com`; inner page schemas hardcode `https://bryanballi.com`. These need to converge on one domain before it goes live, or schemas will have mismatched entity URLs.

### Favicon ✅ — Fixed
- `app/icon.png` present. Next.js serves this as `favicon.ico` automatically.
- `icons` in root layout points to `/img/sig.png` — the brand signature mark. Acceptable.

### Security Headers
- Vercel default headers apply. No custom `Content-Security-Policy` in `next.config.mjs`.

---

## On-Page SEO

**Score: 75 / 100** *(was 28/100)*

### Title ✅ — Fixed
- Root: `Bryan Balli — AI Design Engineer & Creative Technologist Portfolio`
- Template: `%s · Bryan Balli`
- Per-page titles set on About, Work, all service pages.

### Meta Description ✅ — Fixed
- Root description is substantive and search-facing.
- Per-page descriptions set and differentiated.

### Per-Page Metadata ✅ — Fixed (for existing layouts)
- About, Work, Contact, Gallery, How It Works, Process, and all 5 service pages have `export const metadata` in their layout files with page-specific titles, descriptions, keywords, OG, and canonical.
- **GAP — MEDIUM:** `app/case-studies/layout.jsx` and `app/faq/layout.jsx` may not have metadata — not verified. Check and add if missing.

### Open Graph & Twitter ✅ — Fixed
- Root layout has full OG and Twitter Card config with `og_meta.png` as the share image.
- `@bai_ee` Twitter handle set on both `site` and `creator`.
- **MEDIUM:** OG image (`/img/og_meta.png`) is 1.1 MB. Recommended max is 300 KB for fast social unfurling. Compress or convert to WebP/JPG.

### Heading Structure
- H1: `YOUR HUMAN IN THE LOOP` — brand tagline, not keyword-rich.
- New inner pages have proper heading structure through their respective page components.
- **LOW:** Consider a visually hidden or below-fold `<h2>` on the homepage for crawlers that surfaces keyword-rich copy.

### Internal Linking
- Site now has real navigable pages via `InnerPageShell`. Portfolio items appear to remain JS-modal-only on the homepage.
- **MEDIUM:** If the new `/work` and `/case-studies` pages contain static, crawlable project descriptions, internal links from the homepage to those pages would pass authority and improve indexation.

---

## Content Quality

**Score: 58 / 100** *(was 44/100)*

### What's Good
- Site now has 10+ public pages with distinct content — about, work, services, process, contact, gallery, FAQ, how-it-works, case studies.
- `llms.txt` is detailed and accurate — covers platform architecture, technical substrate, and modular card pipeline descriptions.
- Homepage testimonials now include real names, job titles, and companies (TikTok, HBO Max, Epsilon, TST).
- Service pages segmented by offering (AI design consulting, brand identity, design systems, SEO/GEO, web development).

### E-E-A-T Signals
- **Experience:** Work history now surfaced with named employers. Schema `worksFor` array on About page lists Publicis, Epsilon, Conversant, Alliance Data.
- **Expertise:** Technical stack called out in `knowsAbout` (Three.js, GSAP, Firebase, Claude API) — good.
- **Authoritativeness:** GitHub sameAs links added. No LinkedIn or Twitter yet in `sameAs`. No external press or published articles.
- **Trust:** Profile photo alt text issue may persist — confirm `alt="Bryan Balli"` on profile image.

### Thin Content Risk
- Service page content depth not verified — if `AiDesignConsultingPage`, `BrandIdentityPage`, etc. are shallow, they will not rank for service queries.
- The `HoverRevealList` and GSAP-animated slide content still renders on interaction — AI crawlers that don't execute JS will miss this content.

### Content Gaps
- No blog, editorial, or long-form content for informational queries ("how to choose an AI consultant", "what is GEO", etc.).
- FAQ page exists — verify it has substantive Q&A and consider adding FAQPage JSON-LD schema.

---

## Schema / Structured Data

**Score: 75 / 100** *(was 3/100)*

### Implemented
- **Homepage (`app/page.jsx`):** Person (with `@id`, `knowsAbout`, `sameAs`, `alternateName`), WebSite, and 4× Review schemas — well-formed.
- **About layout:** Person schema (redundant with homepage but acceptable for the page context).
- **Work layout:** ItemList schema with 4 listed projects.
- **Service layouts:** Service-specific schemas (verified on ai-design-consulting, brand-identity, seo-geo).
- **Contact/Gallery layouts:** Schema present (type not fully verified).

### Issues

**HIGH — Domain inconsistency across schemas:**
- `app/page.jsx` (homepage): uses `SITE_URL` env var → falls back to `https://bballi.com`
- `app/about/layout.jsx`: hardcodes `https://bryanballi.com`
- All service layouts: hardcode `https://bryanballi.com`
- These create two distinct entity URLs for the same Person — Google will treat them as different entities or ignore one.
- Fix: pick one domain (likely `bryanballi.com` if that's the intended custom domain), move it to an env var, and use it consistently everywhere.

**MEDIUM — `sameAs` is GitHub-only:**
- Homepage Person schema: `sameAs: ['https://github.com/Bai-ee', 'https://github.com/Bai-ee/port_2026']`
- Both point to GitHub. No LinkedIn, no Twitter/X.
- Fix: add LinkedIn profile URL and `https://twitter.com/bai_ee` to the array.

**MEDIUM — Missing FAQPage schema:**
- `app/faq/` exists but no FAQPage JSON-LD verified. FAQPage schema is eligible for Google rich results.

**LOW — Review schema limitation:**
- Reviews are `Review` items on a Person entity. This is valid but Google typically surfaces AggregateRating on product/service entities more prominently. Consider wrapping in a `ProfessionalService` with `aggregateRating` once 3+ reviews are added.

---

## Performance (Core Web Vitals)

**Score: 32 / 100** *(was 30/100 — minimal change)*

### Image Weight — Still Severe ❌
| File | Size | Status |
|------|------|--------|
| `/img/port/frame_4.png` | 5.6 MB | No change |
| `/img/port/frame_2.png` | 5.3 MB | No change |
| `/img/port/critters_game1.png` | 5.1 MB | No change |
| `/img/port/frame_8.png` | 4.7 MB | No change |
| `/img/og_meta.png` | 1.1 MB | OG image too large |

Total heavy payload unchanged. Next.js `<Image>` not yet applied to portfolio images.

### WebGL Canvas
- Homepage WebGL canvas unchanged. Still loads on entry, not deferred.

### Font Loading
- 3 Google Font families, `display=swap`, `preconnect` — unchanged, acceptable.

---

## Images

**Score: 28 / 100** *(was 25/100)*

- Format: all portfolio images still PNG. No WebP conversion.
- Size: 5 images over 4 MB. Total portfolio image payload exceeds 25 MB.
- `<img>` vs `<Image>`: portfolio images still use raw `<img>` tags — no responsive sizing, no lazy-load, no auto-WebP.
- **OG image:** 1.1 MB is too large for a social meta image. Target < 300 KB at 1200×630 px.

---

## AI Search Readiness

**Score: 65 / 100** *(was 12/100)*

### llms.txt ✅ — Added
- `/public/llms.txt` is comprehensive. Covers what the platform does, the modular card pipeline, technical stack, conventions for AI summarization, and contact info.
- AI crawlers (ChatGPT, Perplexity, Claude.ai) can extract entity facts directly.

### Crawler Access ✅ — Fixed
- `robots.txt` explicitly allows GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot, and others. No AI crawlers blocked.

### Citability
- Homepage H1 and subheadline are citable. Testimonials with real names/companies are strong citation candidates.
- Schema provides entity anchoring — AI systems can now associate the site with "Bryan Balli, AI Design Engineer."
- `sameAs` GitHub links provide entity disambiguation, but LinkedIn/Twitter would strengthen this further.

### Remaining Gaps
- Most JS-animated content (GSAP reveals, hover items) still requires JS execution — basic AI crawlers miss this.
- No FAQ or editorial content for informational AI Overview inclusion.

---

## Sitemap Analysis

**Score: 30 / 100** *(was 0/100)*

`app/sitemap.js` exists but only includes the homepage.

### Pages that should be in the sitemap
```
/ (homepage)          — priority 1.0
/about                — priority 0.9
/work                 — priority 0.9
/case-studies         — priority 0.8
/services/ai-design-consulting  — priority 0.8
/services/brand-identity        — priority 0.8
/services/design-systems        — priority 0.8
/services/seo-geo               — priority 0.8
/services/web-development       — priority 0.8
/how-it-works         — priority 0.7
/process              — priority 0.7
/gallery              — priority 0.7
/faq                  — priority 0.7
/contact              — priority 0.6
```

### Pages to keep excluded
`/dashboard`, `/login`, `/admin`, `/preview/*`, `/capture`, `/api/*`

---

## Priority Action Plan

### Critical — Fix Immediately

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 1 | Expand sitemap to include all 13 public pages | `app/sitemap.js` | 30 min |
| 2 | Fix robots.txt Sitemap to absolute URL | `public/robots.txt` | 5 min |
| 3 | Resolve domain inconsistency — pick one and use env var everywhere | all layout.jsx files | 1 hr |

### High — Fix Within 1 Week

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 4 | Convert portfolio images to WebP / use Next.js `<Image>` | PortfolioModal.jsx, gallery components | 2–3 hrs |
| 5 | Compress OG image from 1.1 MB to < 300 KB | `/public/img/og_meta.png` | 30 min |
| 6 | Add LinkedIn + Twitter to `sameAs` in homepage Person schema | `app/page.jsx` | 15 min |
| 7 | Verify case-studies and FAQ layouts have metadata | `app/case-studies/layout.jsx`, `app/faq/layout.jsx` | 30 min |

### Medium — Fix Within 1 Month

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 8 | Add FAQPage JSON-LD to FAQ route | `app/faq/layout.jsx` | 30 min |
| 9 | Add `ProfessionalService` schema with aggregateRating once 3+ reviews live | `app/page.jsx` | 1 hr |
| 10 | Defer WebGL canvas init until scroll (reduce mobile LCP) | `ox.jsx` | 1–2 hrs |
| 11 | Audit inner page content depth — ensure service pages have 300+ words each | all service page components | varies |
| 12 | Custom domain — connect `bryanballi.com` in Vercel | Vercel dashboard | 1 hr |

### Low — Backlog

| # | Issue | Notes |
|---|-------|-------|
| 13 | Static `/work/[slug]` pages for individual case studies | Currently JS-modal-only on homepage |
| 14 | Blog / editorial content for informational queries | "What is GEO", "AI consulting for SMBs" |
| 15 | CSP header in `next.config.mjs` | Security hardening |
| 16 | Keyword-rich H2 below hero fold on homepage | Crawlable keyword signal alongside brand tagline |

---

## SEO Health Scorecard

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Technical SEO | 22% | 65/100 | 14.3 |
| Content Quality | 23% | 58/100 | 13.3 |
| On-Page SEO | 20% | 75/100 | 15.0 |
| Schema / Structured Data | 10% | 75/100 | 7.5 |
| Performance (CWV) | 10% | 32/100 | 3.2 |
| AI Search Readiness | 10% | 65/100 | 6.5 |
| Images | 5% | 28/100 | 1.4 |
| **Overall** | **100%** | | **61.2 / 100** |

---

## Quick Fix Code Snippets

### 1. Expanded sitemap (`app/sitemap.js`)
```js
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://bryanballi.com');

const PUBLIC_ROUTES = [
  { path: '/',                                  priority: 1.0, freq: 'weekly' },
  { path: '/about',                             priority: 0.9, freq: 'monthly' },
  { path: '/work',                              priority: 0.9, freq: 'weekly' },
  { path: '/case-studies',                      priority: 0.8, freq: 'weekly' },
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

### 2. robots.txt Sitemap fix (`public/robots.txt`)
Replace the last line:
```
# Before (relative — non-standard):
Sitemap: /sitemap.xml

# After (absolute):
Sitemap: https://bryanballi.com/sitemap.xml
```

### 3. Consistent SITE_URL in inner page schemas
Replace hardcoded `https://bryanballi.com` across layout files with:
```js
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://bryanballi.com';

const personSchema = {
  url: SITE_URL,
  // ...
};
```

### 4. Add LinkedIn/Twitter to sameAs (`app/page.jsx`)
```js
sameAs: [
  'https://github.com/Bai-ee',
  'https://github.com/Bai-ee/port_2026',
  'https://www.linkedin.com/in/bryanballi',  // add real LinkedIn slug
  'https://twitter.com/bai_ee',
],
```
