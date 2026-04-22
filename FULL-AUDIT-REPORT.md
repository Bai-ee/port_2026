# SEO Audit Report — Bballi Portfolio
**Date:** 2026-04-21  
**URL:** https://port-2026-kohl.vercel.app  
**Framework:** Next.js (App Router, Turbopack)  
**Business Type:** Personal portfolio / freelance consulting (AI-assisted design + development)

---

## Executive Summary

**Overall SEO Health Score: 27 / 100**

The site has strong visual craft and real portfolio content, but almost no SEO infrastructure. There is no robots.txt, no sitemap, no structured data, no Open Graph tags, no per-page metadata, no favicon, no custom domain, and no AI crawler file. Private pages (dashboard, admin, login) are fully indexable. Images are unoptimized — several exceed 5 MB as PNGs. The heavy WebGL canvas animation will hurt Core Web Vitals, especially LCP on mobile.

### Top 5 Critical Issues
1. No robots.txt — search engines crawl with no guidance
2. No sitemap.xml — pages may not be discovered
3. Private pages (dashboard, admin, login) have no `noindex` — will appear in search results
4. No structured data (Person, WebSite, ProfessionalService schemas)
5. No custom domain — `*.vercel.app` undermines brand authority and ranking potential

### Top 5 Quick Wins
1. Add `robots.txt` (30 minutes)
2. Add `sitemap.xml` via Next.js `app/sitemap.js` (1 hour)
3. Add `noindex` to dashboard / login / admin pages (30 minutes)
4. Add Open Graph + Twitter Card meta tags to root layout (1 hour)
5. Add `Person` + `WebSite` JSON-LD schema to homepage (1–2 hours)

---

## Technical SEO

**Score: 22 / 100**

### robots.txt
- **CRITICAL** — No `robots.txt` file exists anywhere in `/public/`.
- Bots crawl with zero guidance. Private routes (`/dashboard`, `/admin`, `/login`, `/capture`, `/preview/*`) are fully open.
- **Fix:** Create `public/robots.txt`. Disallow private paths. Point to sitemap.

```
User-agent: *
Disallow: /dashboard
Disallow: /admin
Disallow: /login
Disallow: /capture
Disallow: /preview/
Sitemap: https://port-2026-kohl.vercel.app/sitemap.xml
```

### Sitemap
- **CRITICAL** — No sitemap.xml found. Only the homepage (`/`) and portfolio modal views matter for indexing.
- **Fix:** Add `app/sitemap.js` returning `[{ url, lastModified, changeFrequency, priority }]` for `/` only (private pages excluded).

### Canonical Tags
- **HIGH** — No canonical URLs configured. Root metadata object in `app/layout.jsx` has only `title` and `description`.
- Next.js App Router supports `metadataBase` + `alternates.canonical` — neither is set.
- **Fix:** Add `metadataBase: new URL('https://port-2026-kohl.vercel.app')` and per-page canonicals.

### noindex on Private Pages
- **CRITICAL** — `/dashboard`, `/admin`, `/admin/control`, `/login`, `/capture`, `/preview/*` pages have no metadata exports at all. They will be indexed.
- **Fix:** Add `export const metadata = { robots: { index: false, follow: false } }` to each private page.

### Custom Domain
- **HIGH** — The site runs on `port-2026-kohl.vercel.app`. There is no custom domain configured.
- `*.vercel.app` subdomains carry no domain authority. Google will not rank them competitively for personal name / skill searches.
- **Fix:** Register `bryanballi.com` or `bballi.com` and connect via Vercel.

### Favicon
- **MEDIUM** — No favicon.ico, apple-touch-icon, or web manifest found. Browser tab shows generic icon.
- **Fix:** Add `app/favicon.ico` and optionally `public/site.webmanifest`.

### Security Headers
- Not audited against live server — Vercel defaults include `X-Frame-Options: DENY` and `X-Content-Type-Options`. No custom `Content-Security-Policy` observed in `next.config.mjs`.

---

## On-Page SEO

**Score: 28 / 100**

### Title Tag
- Current: `Bballi Portfolio` (root layout `metadata.title`)
- **HIGH** — Too short, no keywords, no name, no value proposition.
- Recommended: `Bryan Balli — AI Consultant & Creative Technologist`
- Or: `Bryan Balli | Human-in-the-Loop AI Design & Development`

### Meta Description
- Current: `Client dashboard and portfolio`
- **HIGH** — Generic, internal-facing language ("Client dashboard"), not search-facing copy.
- Max 155 chars, use real value proposition from the site content.
- Recommended: `Bryan Balli is a freelance AI consultant and creative technologist who helps brands navigate AI adoption through design, code, and systems.`

### Per-Page Metadata
- **HIGH** — No page-level `metadata` exports on any route. Every page inherits the root generic title/description.
- The homepage, dashboard, login, admin, capture, and preview pages all need their own `export const metadata` blocks.

### Heading Structure
- H1: `"YOUR HUMAN IN THE LOOP"` — visually strong, stylistically on-brand, but zero keyword signal for search.
  - This is acceptable if the page has other keyword-rich content, but the H1 is fixed as a brand tagline.
  - Consider a visually hidden or below-fold H2 like "Freelance AI Consultant & Creative Technologist — Bryan Balli" for crawlers.
- H2: Used in `StackedSlidesSection` (`panel-hero-headline` slide headings) and testimonial-like sections.
- H3: Used in `HoverRevealList` for item titles.
- Structure is reasonable for a single-page layout — just needs keyword presence.

### Internal Linking
- The site is a single-page application. Portfolio items open as modals — their content is JS-rendered, not separate crawlable URLs.
- **MEDIUM** — All portfolio case content is inaccessible to crawlers. Consider adding static `/work/[slug]` pages if search discovery of work matters.

---

## Content Quality

**Score: 44 / 100**

### What's Good
- Real testimonials with named people and companies (Sam / Onward, Rashid A. / Hossy, Claire B. / Carduvy, Marco T. / HEC)
- Clear value proposition in the subheadline: *"I step into your business, map what's working, fix what's not, and build what's missing"*
- Genuine work history with real roles and companies
- Differentiated positioning around "human-in-the-loop AI" — a real keyword cluster

### E-E-A-T Signals
- **Experience:** Work history from 2014 covers front-end, interactive production, creative direction, and AI consulting. Good.
- **Expertise:** Technical depth visible in project complexity (WebGL, GSAP, Firebase, Next.js). Not surfaced in crawlable text.
- **Authoritativeness:** No external links or press mentions on the homepage. No published articles, GitHub links, or external profiles referenced.
- **Trust:** Profile image is present but uses empty `alt=""`. Testimonials are uncited (no LinkedIn links, no company URLs).

### Thin Content Risk
- Slide/section content in `StackedSlidesSection` is loaded from JS — if Google can't execute the animation, key differentiators won't be indexed.
- The `HoverRevealList` items (service differentiators) render only on hover in the DOM — may not be indexed.

### Readability
- Copy is strong and concise. Not padded. Reads well.
- Lacks FAQ, blog, or any long-form content. No content depth to rank for informational queries.

---

## Schema / Structured Data

**Score: 3 / 100**

**CRITICAL** — No JSON-LD or any structured data anywhere in the codebase.

### Missing Schemas

**1. Person (highest priority)**
```json
{
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Bryan Balli",
  "url": "https://port-2026-kohl.vercel.app",
  "jobTitle": "AI Consultant & Creative Technologist",
  "description": "Freelance consultant specializing in human-in-the-loop AI systems, interactive builds, and digital strategy.",
  "image": "https://port-2026-kohl.vercel.app/img/profile2_400x400.png",
  "sameAs": []
}
```

**2. WebSite**
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Bryan Balli Portfolio",
  "url": "https://port-2026-kohl.vercel.app"
}
```

**3. ProfessionalService / Consulting**
For the consulting/services angle — add a `ProfessionalService` or `LocalBusiness` schema if a geographic market is relevant.

**4. Review / AggregateRating**
Testimonials from Sam (Onward), Rashid A. (Hossy), Claire B. (Carduvy) could be marked up as `Review` under the `Person` or `ProfessionalService` entity for rich result eligibility.

---

## Performance (Core Web Vitals)

**Score: 30 / 100** *(lab estimate — no CrUX field data available)*

### Image Weight — Severe
| File | Size | Issue |
|------|------|-------|
| `/img/port/frame_4.png` | 5.6 MB | No WebP conversion, no lazy load |
| `/img/port/frame_2.png` | 5.3 MB | Same |
| `/img/port/critters_game1.png` | 5.1 MB | Same |
| `/img/port/frame_8.png` | 4.7 MB | Same |
| `/img/device_template.png` | 2.2 MB | Same |

Total portfolio image payload exceeds 25 MB uncompressed. This will cause severe LCP failures on mobile and slow connections.

**Fix:** Use Next.js `<Image>` component everywhere — it auto-converts to WebP, applies responsive sizing, and lazy-loads. Current code uses raw `<img>` tags throughout.

### WebGL Canvas
- A 25,000-particle WebGL canvas (`ox.jsx`) is loaded on the homepage hero.
- `dynamic(() => import('./ox.jsx'), { ssr: false })` prevents SSR crash, but the canvas is not deferred — it loads on page entry.
- Heavy GPU load will impact INP and CLS on mid-range mobile devices.
- **Fix:** Add intersection observer or scroll-triggered canvas init to defer WebGL until the user scrolls to the canvas area. Or lower default `particleCount` to 8,000–12,000 on mobile.

### Font Loading
- Three Google Font families (Doto, Space Grotesk, Space Mono) loaded via `<link>` in `<head>`.
- `display=swap` is set — good. `preconnect` to fonts.googleapis.com is present — good.
- FOUT is mitigated, but three font family requests add latency.

### GSAP / ScrollTrigger
- GSAP ScrollTrigger is registered and used for reveal animations. Multiple `useLayoutEffect` calls.
- Animated elements use `opacity: 0` as initial state and are revealed on scroll — confirmed by recent commit fixing mobile visibility bug.
- On mobile/reduced-motion, GSAP context early-returns and elements must be force-shown via CSS (recently fixed).

---

## Images

**Score: 25 / 100**

### Alt Text
- `Header.jsx`: `<img src="/img/sig.png" alt="" aria-hidden="true">` — signature as decoration, acceptable.
- `PortfolioModal.jsx`: Profile image with `alt=""` — profile photo of the site owner **should** have descriptive alt text like `alt="Bryan Balli, AI consultant and creative technologist"`.
- Portfolio images in the gallery — not inspected but likely have no alt text if they follow the same pattern.

### Format
- All portfolio images are PNG. None converted to WebP or AVIF.
- Next.js `<Image>` would handle this automatically.

### Sizing
- No `width`/`height` attributes on `<img>` tags — causes layout shift (CLS impact).

---

## AI Search Readiness

**Score: 12 / 100**

### llms.txt
- **Missing.** No `/public/llms.txt` file.
- AI crawlers (ChatGPT, Perplexity, Claude.ai web) have no structured signal about what this site is, who Bryan Balli is, or what content is citable.

### Crawler Access
- The site is heavily JavaScript-dependent. Most content (portfolio modals, slide panels, hover reveals) requires JS execution.
- Googlebot can execute JS; simpler AI crawlers cannot. Content behind GSAP reveals may not be indexed by AI engines.

### Citability
- The homepage H1 (`YOUR HUMAN IN THE LOOP`) and subheadline copy are good citation candidates — concise, unique claims.
- The testimonials section contains high-quality quotes — but they're behind scroll animations that some crawlers may not trigger.
- No FAQ, no long-form editorial, no published articles that AI systems can cite back to this entity.

### Entity Clarity
- No schema signals to tell AI engines that this site represents "Bryan Balli, the AI consultant."
- No `sameAs` links to LinkedIn, GitHub, Twitter — entity disambiguation is zero.

---

## Sitemap Analysis

**Score: 0 / 100** — No sitemap exists.

Public crawlable pages that should be in a sitemap:
- `/` (homepage)

Pages that should be **excluded** from both sitemap and index:
- `/dashboard`, `/login`, `/admin`, `/admin/control`, `/capture`, `/preview/*`

---

## Priority Action Plan

### Critical — Fix Immediately

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 1 | Add `robots.txt` | `public/robots.txt` | 30 min |
| 2 | Add `noindex` to private pages | `app/dashboard/page.jsx`, `app/login/page.jsx`, `app/admin/page.jsx`, `app/admin/control/page.jsx`, `app/capture/page.jsx`, `app/preview/*/page.jsx` | 30 min |
| 3 | Add `sitemap.js` | `app/sitemap.js` | 45 min |
| 4 | Register a custom domain | Vercel + registrar | 1–2 hrs |

### High — Fix Within 1 Week

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 5 | Improve root title + description | `app/layout.jsx` | 15 min |
| 6 | Add `metadataBase` + canonical config | `app/layout.jsx` | 15 min |
| 7 | Add Open Graph + Twitter Card tags | `app/layout.jsx` | 1 hr |
| 8 | Add Person + WebSite JSON-LD schema | `app/page.jsx` or layout | 1–2 hrs |
| 9 | Fix profile image alt text | `PortfolioModal.jsx`, `Header.jsx` | 15 min |
| 10 | Convert `<img>` to Next.js `<Image>` | `PortfolioModal.jsx`, `Header.jsx`, gallery components | 2–3 hrs |

### Medium — Fix Within 1 Month

| # | Issue | File | Est. Time |
|---|-------|------|-----------|
| 11 | Compress portfolio images to WebP | `/public/img/port/` | 1 hr |
| 12 | Add `llms.txt` | `public/llms.txt` | 30 min |
| 13 | Add `favicon.ico` + web manifest | `app/favicon.ico`, `public/manifest.webmanifest` | 1 hr |
| 14 | Add keyword-rich H2 below hero fold | `HomePage.jsx` or `StackedSlidesSection.jsx` | 30 min |
| 15 | Add Review schema for testimonials | `app/layout.jsx` or `app/page.jsx` | 1 hr |
| 16 | Reduce canvas particle count on mobile | `ox.jsx` or `HomePage.jsx` | 1–2 hrs |

### Low — Backlog

| # | Issue | Notes |
|---|-------|-------|
| 17 | Static `/work/[slug]` pages for portfolio items | Currently JS-modal-only; crawlers miss case content |
| 18 | Add blog / editorial content | Long-form AI consulting content would rank for informational queries |
| 19 | Add external profile `sameAs` links (LinkedIn, GitHub) | Entity disambiguation for Google Knowledge Graph |
| 20 | `Content-Security-Policy` header | Security hardening, not ranking impact |

---

## SEO Health Scorecard

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Technical SEO | 22% | 22/100 | 4.8 |
| Content Quality | 23% | 44/100 | 10.1 |
| On-Page SEO | 20% | 28/100 | 5.6 |
| Schema / Structured Data | 10% | 3/100 | 0.3 |
| Performance (CWV) | 10% | 30/100 | 3.0 |
| AI Search Readiness | 10% | 12/100 | 1.2 |
| Images | 5% | 25/100 | 1.3 |
| **Overall** | **100%** | | **26.3 / 100** |

---

## Quick Win Code Snippets

### 1. robots.txt (`public/robots.txt`)
```
User-agent: *
Disallow: /dashboard
Disallow: /admin
Disallow: /login
Disallow: /capture
Disallow: /preview/
Allow: /

Sitemap: https://port-2026-kohl.vercel.app/sitemap.xml
```

### 2. Sitemap (`app/sitemap.js`)
```js
export default function sitemap() {
  return [
    {
      url: 'https://port-2026-kohl.vercel.app',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
```

### 3. noindex on private pages (add to each)
```js
export const metadata = {
  robots: { index: false, follow: false },
};
```

### 4. Improved root layout metadata (`app/layout.jsx`)
```js
export const metadata = {
  metadataBase: new URL('https://port-2026-kohl.vercel.app'),
  title: 'Bryan Balli — AI Consultant & Creative Technologist',
  description: 'Bryan Balli helps brands navigate AI adoption through design, interactive builds, and human-in-the-loop systems. Freelance consulting, creative technology, and digital strategy.',
  openGraph: {
    title: 'Bryan Balli — AI Consultant & Creative Technologist',
    description: 'Freelance AI consultant and creative technologist. Design, code, and strategy for brands navigating AI.',
    url: 'https://port-2026-kohl.vercel.app',
    siteName: 'Bryan Balli Portfolio',
    images: [{ url: '/img/profile2_400x400.png', width: 400, height: 400, alt: 'Bryan Balli' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bryan Balli — AI Consultant & Creative Technologist',
    description: 'Human-in-the-loop AI systems, interactive builds, and digital strategy.',
    images: ['/img/profile2_400x400.png'],
  },
  alternates: {
    canonical: '/',
  },
};
```

### 5. Person + WebSite JSON-LD (add to `app/page.jsx`)
```jsx
export default function Home() {
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        name: 'Bryan Balli',
        url: 'https://port-2026-kohl.vercel.app',
        jobTitle: 'AI Consultant & Creative Technologist',
        description: 'Freelance consultant specializing in human-in-the-loop AI systems, interactive builds, and digital strategy for brands.',
        image: 'https://port-2026-kohl.vercel.app/img/profile2_400x400.png',
        sameAs: [],
      },
      {
        '@type': 'WebSite',
        name: 'Bryan Balli Portfolio',
        url: 'https://port-2026-kohl.vercel.app',
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <HomePage />
    </>
  );
}
```

### 6. llms.txt (`public/llms.txt`)
```
# Bryan Balli — AI Consultant & Creative Technologist

Bryan Balli is a freelance consultant and creative technologist who helps brands navigate AI adoption through design, interactive builds, and human-in-the-loop systems.

## What I do
- Human-in-the-loop AI systems
- Interactive web experiences and creative technology
- Brand identity and digital strategy
- Front-end development (React, Next.js, WebGL, GSAP)

## Background
- Founder & Consultant, Independent (2022–present)
- Creative Technology Director, Studio Meridian (2019–2022)
- Senior Interactive Producer, Carve Digital (2017–2019)
- Front-End Developer, Tactile Media (2014–2017)

## Contact
bryanballi@gmail.com
```
