# Lead Gen Site Generation Pipeline — Master Implementation Prompt

> **Give this entire file to Claude Code.** It covers the full site generation system: DESIGN.MD auto-generation, asset scraping, the shared GSAP animation library, Vercel preview deployment, and the before/after AI readiness comparison.

---

## Overview

After a prospect is ONBOARDED (Cross-Device Layouts, SEO + Performance, AI Agent Readiness, Social Preview all completed), the operator can flag them for **website generation**. This triggers a pipeline that:

1. Scrapes all usable content + assets from their existing website
2. Auto-generates a `DESIGN.MD` creative brief combining brand system + scraped content + design evaluation
3. Allows the operator to review/customize the brief via a dashboard UI panel
4. Generates a production-quality HTML5 homepage using Tailwind CSS + shared GSAP animation library
5. Deploys the preview to Vercel
6. Runs AI Agent Readiness on the new preview URL and presents a before/after comparison

**Tech stack for generated sites:** HTML5, Tailwind CSS (CDN), GSAP + ScrollTrigger (CDN), vanilla JS. Single `index.html` file per client. Conversion to Next.js only happens post-sale.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    SITE GENERATION PIPELINE                                 │
│                                                                            │
│  ONBOARD COMPLETE                                                          │
│       │                                                                    │
│       ▼                                                                    │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐              │
│  │ CONTENT      │────▶│ DESIGN.MD    │────▶│ SITE         │              │
│  │ SCRAPER      │     │ GENERATOR    │     │ GENERATOR    │              │
│  │              │     │              │     │              │              │
│  │ Copy, images │     │ Brief from   │     │ HTML5 +      │              │
│  │ logo, assets │     │ brand system │     │ Tailwind +   │              │
│  │ from website │     │ + evaluation │     │ GSAP         │              │
│  └──────────────┘     │ + content    │     └──────────────┘              │
│                        └──────────────┘            │                      │
│                               ▲                    ▼                      │
│                    ┌──────────┴──────┐    ┌──────────────┐               │
│                    │ OPERATOR REVIEW │    │ VERCEL       │               │
│                    │ (Dashboard UI)  │    │ DEPLOY       │               │
│                    │                 │    └──────────────┘               │
│                    │ Edit brief,     │            │                      │
│                    │ upload assets,  │            ▼                      │
│                    │ confirm logo    │    ┌──────────────┐               │
│                    └─────────────────┘    │ AI READINESS │               │
│                                           │ BEFORE/AFTER │               │
│                                           └──────────────┘               │
│                                                                            │
│  CLIENT FOLDER: clients/{slug}/                                            │
│  ├── DESIGN.MD           (creative brief — source of truth)                │
│  ├── assets/             (logo, images, scraped + uploaded)                │
│  │   ├── logo.{png|svg}                                                   │
│  │   ├── hero-*.{jpg|png|webp}                                            │
│  │   ├── team-*.{jpg|png}                                                 │
│  │   └── ...                                                              │
│  ├── content.json        (scraped copy inventory)                          │
│  ├── index.html          (generated site)                                  │
│  └── preview-meta.json   (deploy URL, scores, timestamps)                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Content Scraper

### 1.1 Module: `features/leadgen/content-scraper.js`

Scrapes the prospect's existing website and extracts all reusable content and assets. This runs as part of the "Generate Site" action (after ONBOARD, when operator clicks GENERATE).

**What to extract:**

```js
async function scrapeClientContent(websiteUrl, options = {}) {
  // Returns:
  return {
    // ─── TEXT CONTENT ────────────────────────────────────────
    copy: {
      heroHeadline: string | null,        // largest h1 or hero text
      heroSubheadline: string | null,     // text immediately below hero h1
      aboutText: string | null,           // "about us" or "who we are" section
      missionStatement: string | null,    // if detectable
      serviceNames: string[],            // h2/h3 within services sections
      serviceDescriptions: { name, description }[],
      testimonials: { quote, author, role }[],
      ctaTexts: string[],                // button/CTA text ("Call Now", "Free Consultation")
      contactInfo: {
        phone: string | null,
        email: string | null,
        address: string | null,
        hours: string | null,
      },
      footerText: string | null,
      legalText: string | null,          // copyright, disclaimers
      tagline: string | null,
    },

    // ─── ASSETS ──────────────────────────────────────────────
    assets: {
      logo: {
        url: string | null,
        alt: string | null,
        detectedBy: 'header-img' | 'class-logo' | 'alt-logo' | 'favicon-upscale' | null,
      },
      heroImages: { url, alt, width, height }[],    // images in hero/banner area
      sectionImages: { url, alt, section }[],       // images within content sections
      teamPhotos: { url, alt }[],                   // images in team/about section
      galleryImages: { url, alt }[],                // any gallery/portfolio images
      favicon: string | null,
      ogImage: string | null,
    },

    // ─── STRUCTURE ───────────────────────────────────────────
    structure: {
      navItems: string[],                // main navigation labels
      sectionOrder: string[],            // detected section types in page order
      hasContactForm: boolean,
      hasBlog: boolean,
      hasTestimonials: boolean,
      hasTeamSection: boolean,
      hasGallery: boolean,
      hasPricing: boolean,
      footerColumns: number,
    },

    // ─── META ────────────────────────────────────────────────
    meta: {
      title: string,
      description: string,
      scrapedAt: string,
      pagesScraped: number,
      warnings: string[],
    }
  };
}
```

**Scraping strategy:**

1. Fetch the homepage HTML (reuse `features/scout-intake/modules/shared/site-fetch.js`)
2. Parse with cheerio
3. **Logo detection heuristics** (in priority order):
   - `<img>` inside `<header>` or `<nav>` with width < 300px
   - `<img>` with class/id containing "logo"
   - `<img>` with alt containing business name or "logo"
   - `<link rel="icon">` upscaled as last resort
4. **Hero detection:** First `<section>` or major `<div>` with a background image or large `<img>` + `<h1>`
5. **Section detection:** Walk the DOM for `<section>` or `<div>` boundaries with heading children. Classify by content: services (lists + descriptions), testimonials (quotes + attribution), team (photos + names), contact (form or address), etc.
6. **Image downloading:** Download all detected images to `clients/{slug}/assets/` with descriptive filenames. Skip images < 50px (icons/spacers). Convert to WebP if > 500KB.

**GBP photo fallback:** If `assets.heroImages.length === 0 && assets.sectionImages.length < 3`, fetch up to 5 photos from the Google Places Photos API using the stored `placeId`. Save them to `clients/{slug}/assets/gbp-*.jpg`.

### 1.2 Content Inventory File: `clients/{slug}/content.json`

The scraper writes its full output to this JSON file. DESIGN.MD references it. The dashboard UI reads it to show scraped content for review.

---

## Phase 2: DESIGN.MD Auto-Generation

### 2.1 Module: `features/leadgen/design-md-generator.js`

Combines data from three sources to produce the DESIGN.MD brief:

1. **Onboard results** (`prospect.onboard`) — brand system, design evaluation, AI readiness findings
2. **Content scraper output** (`clients/{slug}/content.json`) — copy inventory, structure, assets
3. **Prospect metadata** — vertical, name, location, rating, review count

### 2.2 DESIGN.MD Template Structure

```markdown
# DESIGN.MD — {Business Name}

> Auto-generated creative brief for site generation.
> Last updated: {timestamp}
> Status: DRAFT | APPROVED | GENERATING | DEPLOYED

---

## 1. CLIENT IDENTITY

- **Business:** {name}
- **Vertical:** {vertical} / {subVertical}
- **Location:** {address}
- **Rating:** {rating}★ ({reviewCount} reviews)
- **Website (current):** {websiteUrl}
- **Place ID:** {placeId}

---

## 2. VISUAL SYSTEM

### Colors
| Role | Hex | Source |
|------|-----|--------|
| Primary | {extracted or default} | brand-extraction / operator-override |
| Secondary | {extracted or default} | brand-extraction / operator-override |
| Accent | {extracted or default} | brand-extraction / operator-override |
| Background | {#ffffff or #0a0a0a} | mode detection |
| Text | {dark or light} | mode detection |
| Muted | {grey variant} | derived |

### Typography
| Role | Font | Fallback | Source |
|------|------|----------|--------|
| Heading | {extracted} | system-ui | brand-extraction |
| Body | {extracted} | -apple-system, sans-serif | brand-extraction |

### Mode
- **Light/Dark:** {detected mode}
- **Border Radius:** {vertical default — lawyers tend sharper, dental tends rounder}
- **Spacing Scale:** compact | balanced | spacious

### Visual Personality
- **Adjectives:** {3-5 words describing the target aesthetic, e.g. "authoritative, warm, modern, clean"}
- **Reference mood:** {one-sentence description of the visual direction}

---

## 3. CONTENT INVENTORY

### Hero Section
- **Headline:** "{scraped hero headline or operator-written}"
- **Subheadline:** "{scraped subheadline}"
- **CTA Text:** "{scraped CTA}" → links to: {phone / contact form / booking}
- **CTA Secondary:** "{optional second CTA}"

### About / Value Proposition
{scraped about text, verbatim}

### Services
| Service | Description |
|---------|-------------|
| {scraped name 1} | {scraped description 1} |
| {scraped name 2} | {scraped description 2} |
| ... | ... |

### Social Proof
| Quote | Author | Role |
|-------|--------|------|
| "{scraped testimonial 1}" | {author} | {role} |
| ... | ... | ... |

If no testimonials scraped: USE REVIEW EXCERPTS from Google Business reviews (rating + snippet)

### Contact Information
- **Phone:** {phone}
- **Email:** {email}
- **Address:** {address}
- **Hours:** {hours or "not listed"}

### Navigation Labels
{scraped nav items as comma-separated list}

---

## 4. ASSETS MANIFEST

### Logo
- **File:** assets/{logo-filename}
- **Format:** {png|svg|webp}
- **Status:** confirmed | needs-replacement | missing

### Hero Image(s)
| File | Description | Dimensions |
|------|-------------|-----------|
| assets/{filename} | {alt text or description} | {w}×{h} |

### Section Images
| File | Section | Description |
|------|---------|-------------|
| assets/{filename} | {services|team|gallery} | {alt text} |

### Missing Assets (operator action needed)
- [ ] {list any assets that couldn't be scraped or are too low-res}

---

## 5. PAGE STRUCTURE

### Required Sections (always present)
1. **Hero** — Full-viewport hero with headline, subheadline, CTA. GSAP: parallax background + text reveal.
2. **Services/Offerings** — Grid or cards showing core services. GSAP: staggered fade-in on scroll.
3. **Social Proof** — Testimonials or review highlights. GSAP: slide-in cards.
4. **Contact/CTA** — Phone, address, map embed or contact form. GSAP: fade-up.

### Optional Sections (include if content available)
- **About** — Value proposition paragraph + optional team photo
- **Team** — Staff grid with photos + names (if team photos available)
- **Gallery** — Work samples or office photos (if gallery images available)
- **Stats/Counters** — Years in business, cases won, patients served (if data available). GSAP: animated counters.
- **FAQ** — Common questions (if detectable from existing site)
- **Blog/News teaser** — Latest posts (if blog exists on current site)

### Section Order
{auto-detected from current site structure, or operator-customized}

---

## 6. ANIMATION DIRECTIVES

### Global Motion
- **Library:** GSAP 3 + ScrollTrigger (CDN)
- **Kit:** gsap-kit.js (shared animation presets)
- **Default easing:** power2.out
- **Scroll trigger offset:** top 85%
- **Duration range:** 0.6s–1.2s

### Per-Section Presets (from gsap-kit.js)
| Section | Preset | Notes |
|---------|--------|-------|
| Hero | `heroParallax` + `textReveal` | Background parallax on scroll, headline chars stagger in |
| Services | `staggerGrid` | Cards fade up with 0.1s stagger |
| Testimonials | `slideCards` | Horizontal slide-in on scroll |
| Stats | `counterUp` | Animated number count from 0 |
| Contact | `fadeUp` | Simple opacity + translateY |
| General | `fadeUp` | Default for any unlisted section |

### Hero Animation (the showpiece)
- Type: {parallax | video-bg | split-text | morph-shape}
- Intensity: {subtle | medium | dramatic}
- Notes: {any specific creative direction for the hero animation}

---

## 7. TECHNICAL REQUIREMENTS

### SEO & AI Readiness (built into every generated site)
- **JSON-LD:** LocalBusiness schema with all contact info + geo coordinates
- **Open Graph:** og:title, og:description, og:image, og:type=website
- **Twitter Card:** summary_large_image
- **Meta:** viewport, description, charset, canonical
- **robots.txt:** Allow all crawlers including AI bots
- **/llms.txt:** Present with business summary for LLM discoverability
- **Semantic HTML:** header, nav, main, section, footer with proper heading hierarchy
- **Alt text:** All images have descriptive alt text
- **Sitemap:** XML sitemap at /sitemap.xml

### Performance Targets
- **PageSpeed Performance:** ≥ 90
- **First Contentful Paint:** < 1.5s
- **Largest Contentful Paint:** < 2.5s
- **Total page weight:** < 2MB (images optimized, fonts subset)
- **Zero render-blocking resources** (async/defer all scripts)

### Accessibility
- **WCAG 2.1 AA** minimum
- Proper color contrast ratios
- Keyboard navigation
- Skip-to-content link
- Focus indicators

---

## 8. OPERATOR NOTES

{Free-form area for Bryan to add any creative direction, overrides, or special instructions before generation. This section is read by Claude as the highest-priority creative input.}

---

## 9. GENERATION STATUS

- **Brief generated:** {timestamp}
- **Brief approved:** {timestamp or "pending"}
- **Site generated:** {timestamp or "pending"}
- **Preview URL:** {vercel URL or "not deployed"}
- **AI Readiness (before):** {score from onboard}
- **AI Readiness (after):** {score from preview site audit}
```

---

## Phase 3: Shared GSAP Animation Library

### 3.1 File: `clients/_shared/gsap-kit.js`

This file ships with every generated site (copied into the client folder or referenced from a shared CDN path). It provides scroll-triggered animation presets that any generated site can invoke declaratively.

```js
// gsap-kit.js — Shared animation presets for lead gen preview sites
// Dependencies: GSAP 3.12+ and ScrollTrigger plugin (loaded via CDN before this file)

(function() {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  const DEFAULTS = {
    duration: 0.8,
    ease: 'power2.out',
    triggerOffset: 'top 85%',
    stagger: 0.1,
  };

  // ─── PRESETS ────────────────────────────────────────────────────────────────

  const presets = {

    // Hero parallax — background image moves slower than scroll
    heroParallax: (el) => {
      const bg = el.querySelector('[data-parallax]') || el.querySelector('img');
      if (!bg) return;
      gsap.to(bg, {
        yPercent: 30,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      });
    },

    // Text reveal — characters stagger in from below
    textReveal: (el) => {
      const targets = el.querySelectorAll('[data-reveal]');
      targets.forEach((target) => {
        gsap.from(target, {
          y: 40,
          opacity: 0,
          duration: DEFAULTS.duration,
          ease: DEFAULTS.ease,
          scrollTrigger: {
            trigger: target,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
        });
      });
    },

    // Fade up — universal section entrance
    fadeUp: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      const targets = items.length ? items : [el];
      gsap.from(targets, {
        y: 30,
        opacity: 0,
        duration: DEFAULTS.duration,
        ease: DEFAULTS.ease,
        stagger: DEFAULTS.stagger,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Stagger grid — cards/items appear one by one
    staggerGrid: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      if (!items.length) return;
      gsap.from(items, {
        y: 40,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.12,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Slide cards — horizontal entrance for testimonial/card carousels
    slideCards: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      if (!items.length) return;
      gsap.from(items, {
        x: 60,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.15,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Counter up — animated number counting
    counterUp: (el) => {
      const counters = el.querySelectorAll('[data-counter]');
      counters.forEach((counter) => {
        const target = parseInt(counter.dataset.counter, 10);
        if (isNaN(target)) return;
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 2,
          ease: 'power1.out',
          scrollTrigger: {
            trigger: counter,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
          onUpdate: () => {
            counter.textContent = Math.round(obj.val).toLocaleString();
          },
        });
      });
    },

    // Scale in — for logos, badges, trust indicators
    scaleIn: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      const targets = items.length ? items : [el];
      gsap.from(targets, {
        scale: 0.8,
        opacity: 0,
        duration: 0.6,
        ease: 'back.out(1.4)',
        stagger: 0.08,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Line draw — for decorative SVG elements
    lineDraw: (el) => {
      const paths = el.querySelectorAll('path[data-draw]');
      paths.forEach((path) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.5,
          ease: 'power2.inOut',
          scrollTrigger: {
            trigger: path,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
        });
      });
    },
  };

  // ─── AUTO-INIT ──────────────────────────────────────────────────────────────
  // Sections declare their animation via data-gsap="presetName"

  function init() {
    document.querySelectorAll('[data-gsap]').forEach((el) => {
      const presetName = el.dataset.gsap;
      if (presets[presetName]) {
        presets[presetName](el);
      }
    });
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for programmatic use
  window.GsapKit = { presets, init, DEFAULTS };

})();
```

### 3.2 Usage in Generated HTML

Generated sites declare animations via `data-gsap` attributes:

```html
<section data-gsap="heroParallax" class="...">
  <img data-parallax src="assets/hero.jpg" alt="..." />
  <h1 data-reveal>Garcia & Associates</h1>
  <p data-reveal>Justice for Every Family</p>
</section>

<section data-gsap="staggerGrid" class="...">
  <div data-animate class="...">Service 1</div>
  <div data-animate class="...">Service 2</div>
  <div data-animate class="...">Service 3</div>
</section>

<section data-gsap="counterUp" class="...">
  <span data-counter="500">0</span>+ Cases Won
  <span data-counter="25">0</span> Years Experience
</section>
```

This declarative approach means the DESIGN.MD just specifies which preset goes on which section — Claude doesn't need to write GSAP code for every site.

---

## Phase 4: Site Generator

### 4.1 Module: `features/leadgen/site-generator.js`

**This is the module that calls Claude to produce the actual HTML.**

The key insight: we're NOT asking Claude to freestyle. We're giving it:
1. The full DESIGN.MD brief (colors, fonts, copy, structure, animation directives)
2. The gsap-kit.js preset system (it just needs to write `data-gsap="fadeUp"`)
3. All content verbatim from content.json (no hallucination needed)
4. Asset filenames from the client folder (it references them by path)

```js
async function generateSite(slug) {
  // 1. Read the DESIGN.MD and content.json
  const designMd = readFileSync(`clients/${slug}/DESIGN.MD`, 'utf8');
  const content = JSON.parse(readFileSync(`clients/${slug}/content.json`, 'utf8'));
  const assetManifest = listAssets(`clients/${slug}/assets/`);

  // 2. Build the generation prompt
  const prompt = buildSiteGenerationPrompt(designMd, content, assetManifest);

  // 3. Call Claude (Sonnet for quality — this is the deliverable)
  const html = await callClaude(prompt, { model: 'claude-sonnet-4-20250514', maxTokens: 16000 });

  // 4. Post-process: inject CDN links, validate HTML, optimize images references
  const finalHtml = postProcess(html, slug);

  // 5. Write to client folder
  writeFileSync(`clients/${slug}/index.html`, finalHtml);

  // 6. Copy gsap-kit.js into client folder
  copyFileSync('clients/_shared/gsap-kit.js', `clients/${slug}/gsap-kit.js`);

  return { slug, file: `clients/${slug}/index.html` };
}
```

### 4.2 Generation Prompt Structure

The prompt sent to Claude for site generation should be structured as:

```
You are generating a production-quality HTML5 homepage. You will produce a SINGLE index.html file that is self-contained, performant, and visually award-winning.

TECH STACK:
- HTML5 semantic markup
- Tailwind CSS via CDN (https://cdn.tailwindcss.com)
- GSAP 3 + ScrollTrigger via CDN
- gsap-kit.js (loaded after GSAP — provides animation presets via data-gsap attributes)
- No other dependencies. No build step. Single file.

ANIMATION SYSTEM:
You do NOT write custom GSAP code. Instead, use these data attributes on sections:
- data-gsap="heroParallax" — parallax background on scroll
- data-gsap="textReveal" — stagger characters/words in from below (add data-reveal to children)
- data-gsap="fadeUp" — universal fade + translate entrance (add data-animate to children)
- data-gsap="staggerGrid" — cards appear sequentially (add data-animate to each card)
- data-gsap="slideCards" — horizontal slide-in (add data-animate to each card)
- data-gsap="counterUp" — number counts from 0 (add data-counter="TARGET_NUMBER" to elements)
- data-gsap="scaleIn" — scale + fade entrance for badges/logos (add data-animate to children)

DESIGN BRIEF:
{full DESIGN.MD content inserted here}

CONTENT (use verbatim — do NOT rewrite or invent new copy):
{relevant sections from content.json}

AVAILABLE ASSETS (reference by relative path):
{list of files in assets/ folder}

REQUIREMENTS:
1. Mobile-first responsive design using Tailwind breakpoints (sm, md, lg, xl)
2. All colors from the VISUAL SYSTEM section — use Tailwind's arbitrary value syntax [#hexcolor]
3. Typography from VISUAL SYSTEM — load Google Fonts if specified
4. Include complete JSON-LD (LocalBusiness schema) in <head>
5. Include complete Open Graph + Twitter Card meta tags
6. Include a robots meta tag allowing all bots
7. Include an inline <script> creating /llms.txt content description
8. All images use loading="lazy" and have descriptive alt text
9. Tailwind config override in <script> for custom colors/fonts
10. Performance: async all scripts, no render-blocking resources
11. WCAG 2.1 AA: proper contrast, focus states, keyboard nav, skip link
12. Include subtle footer: "Preview redesign by Bballi Studio" with link

OUTPUT: Return ONLY the complete HTML file. No explanations, no markdown fences.
```

### 4.3 Post-Processing

After Claude returns the HTML:

1. **Validate** — Check for `<!DOCTYPE html>`, proper `<head>`, `<body>`, closing tags
2. **Inject CDN links** if Claude forgot them:
   ```html
   <script src="https://cdn.tailwindcss.com"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
   <script src="gsap-kit.js"></script>
   ```
3. **Verify JSON-LD** — parse and validate the LocalBusiness schema
4. **Check meta tags** — ensure og:title, og:description, og:image present
5. **Asset path validation** — all `src=""` and `href=""` pointing to assets/ exist in the folder

---

## Phase 5: Vercel Preview Deployment

### 5.1 Module: `features/leadgen/deploy-preview.js`

Deploys the client folder to Vercel as a static site preview.

```js
async function deployPreview(slug) {
  // 1. Read all files in clients/{slug}/ (index.html, gsap-kit.js, assets/*)
  // 2. Upload via Vercel API (POST /v13/deployments)
  // 3. Return the preview URL

  const files = collectDeployFiles(`clients/${slug}/`);

  const deployment = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `preview-${slug}`,
      files,
      target: 'preview',            // not production
      projectSettings: {
        framework: null,             // static site, no framework
      },
    }),
  });

  const { url } = await deployment.json();

  // 4. Write preview-meta.json
  writeJson(`clients/${slug}/preview-meta.json`, {
    previewUrl: `https://${url}`,
    deployedAt: new Date().toISOString(),
    slug,
  });

  return `https://${url}`;
}
```

### 5.2 Environment Variable

```env
VERCEL_API_TOKEN=your_vercel_token       # for programmatic deployments
VERCEL_TEAM_ID=your_team_id             # optional, for team deployments
```

---

## Phase 6: Before/After AI Readiness Comparison

### 6.1 Module: `features/leadgen/readiness-comparison.js`

After the preview deploys, run AI Agent Readiness on the new URL and compare to the onboard results.

```js
async function runReadinessComparison(slug, previewUrl, prospect) {
  // 1. Run agent readiness module on the PREVIEW URL
  const afterResult = await runAgentReadinessModule({
    clientId: `leadgen_${prospect.placeId}_preview`,
    runId: crypto.randomUUID(),
    websiteUrl: previewUrl,
  });

  // 2. Extract before scores from prospect.onboard.agentReadiness
  const before = {
    score: prospect.onboard?.agentReadiness?.score ?? null,
    verdict: prospect.onboard?.agentReadiness?.verdict ?? null,
    findings: prospect.onboard?.agentReadiness?.findings ?? [],
  };

  // 3. Build comparison
  const after = {
    score: afterResult.result?.agentReadiness?.score ?? null,
    verdict: afterResult.result?.agentReadiness?.verdict ?? null,
    findings: afterResult.result?.agentReadiness?.findings ?? [],
  };

  const comparison = {
    before,
    after,
    improvement: (after.score ?? 0) - (before.score ?? 0),
    resolvedFindings: before.findings.filter(
      (f) => !after.findings.some((af) => af.id === f.id)
    ),
    newFindings: after.findings.filter(
      (f) => !before.findings.some((bf) => bf.id === f.id)
    ),
  };

  // 4. Persist to client folder
  writeJson(`clients/${slug}/preview-meta.json`, {
    ...readJson(`clients/${slug}/preview-meta.json`),
    readinessComparison: comparison,
    comparedAt: new Date().toISOString(),
  });

  // 5. Update Firestore prospect
  await updateProspect(prospect.placeId, {
    'generation.readinessComparison': comparison,
  });

  return comparison;
}
```

### 6.2 What the Comparison Shows in the UI

```
AI AGENT READINESS
┌─────────────────────────────────────────────────┐
│  BEFORE (current site)     AFTER (preview)      │
│  ━━━━━━━━━━━━━━━━━━━━     ━━━━━━━━━━━━━━━━━    │
│  Score: 22/100             Score: 91/100        │
│  Verdict: FAILING          Verdict: EXCELLENT   │
│                                                 │
│  Improvement: +69 points                        │
│                                                 │
│  ✓ Resolved:                                    │
│    · No JSON-LD structured data                 │
│    · robots.txt blocks AI crawlers              │
│    · No /llms.txt file                          │
│    · Missing semantic HTML structure            │
│    · No Open Graph metadata                     │
│                                                 │
│  Remaining:                                     │
│    · No sitemap.xml (add in production)         │
└─────────────────────────────────────────────────┘
```

---

## Phase 7: Dashboard UI — Generate Panel

### 7.1 New UI Elements in Expanded Row

After ONBOARD completes and results are showing, a new **GENERATE** button appears. This kicks off the full generation pipeline.

The expanded row gets a new section below onboard results:

```
┌─── Generation ────────────────────────────────────────────────────┐
│                                                                    │
│  [GENERATE SITE]  ← only if onboard complete + website exists     │
│                                                                    │
│  Status: {draft | reviewing | generating | deployed}               │
│                                                                    │
│  DESIGN.MD: [View Brief] [Edit in Dashboard]                       │
│  Assets: {n} images scraped  [Upload More]                         │
│  Logo: ✓ detected / ⚠ needs confirmation  [Replace]              │
│                                                                    │
│  ┌── After generation ──────────────────────────────────────────┐ │
│  │  Preview: https://preview-garcia-law.vercel.app              │ │
│  │  [Open Preview]  [Re-generate]  [Deploy to Production]       │ │
│  │                                                              │ │
│  │  AI Readiness: 22 → 91 (+69)  ████████████████████████░░    │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 Design Brief Editor (Dashboard Panel)

A panel/modal accessible via "Edit in Dashboard" that shows key DESIGN.MD fields as form inputs:

- **Color overrides** — color pickers for primary, secondary, accent
- **Typography overrides** — font family dropdowns (Google Fonts)
- **Hero headline** — text input (pre-filled with scraped)
- **Hero subheadline** — text input
- **CTA text** — text input
- **Section order** — drag-and-drop reordering
- **Animation intensity** — slider (subtle → dramatic)
- **Operator notes** — textarea for free-form creative direction
- **Logo** — image preview + upload/replace button
- **Hero image** — image preview + upload/replace button

Changes write back to `clients/{slug}/DESIGN.MD` immediately.

---

## File Structure Summary

```
clients/
├── _shared/
│   ├── gsap-kit.js                    # Shared animation library
│   └── base-tailwind-config.js        # Shared Tailwind customizations
│
├── garcia-law-chiJ123/                # One folder per prospect
│   ├── DESIGN.MD                      # Creative brief (auto-generated, editable)
│   ├── content.json                   # Scraped content inventory
│   ├── index.html                     # Generated homepage
│   ├── gsap-kit.js                    # Copied from _shared
│   ├── preview-meta.json              # Deploy URL, scores, timestamps
│   └── assets/
│       ├── logo.png
│       ├── hero-main.jpg
│       ├── team-01.jpg
│       ├── service-01.jpg
│       └── ...
│
├── bright-smile-dental-chiJ456/
│   ├── DESIGN.MD
│   ├── content.json
│   ├── index.html
│   ├── gsap-kit.js
│   ├── preview-meta.json
│   └── assets/
│       └── ...
│
└── ...

features/leadgen/
├── content-scraper.js                 # Scrapes existing site content + assets
├── design-md-generator.js             # Produces DESIGN.MD from onboard + content
├── site-generator.js                  # Calls Claude to produce index.html
├── deploy-preview.js                  # Deploys to Vercel
├── readiness-comparison.js            # Before/after AI readiness
└── asset-manager.js                   # Image download, logo detection, GBP fallback

app/api/leadgen/
├── generate/route.js                  # POST — triggers full generation pipeline
├── design-brief/route.js             # GET/PUT — read and update DESIGN.MD
├── assets/route.js                    # POST — upload additional assets
└── deploy/route.js                    # POST — deploy preview to Vercel
```

---

## Implementation Order

1. **`clients/_shared/gsap-kit.js`** — Write the shared animation library first. Test it with a hand-authored HTML file to verify all presets work.
2. **`features/leadgen/content-scraper.js`** — Build the content extraction. Test on 3-4 real prospect websites from your existing Firestore data.
3. **`features/leadgen/design-md-generator.js`** — Build the DESIGN.MD auto-generator. Feed it real onboard data + real scraped content. Review the output for quality.
4. **`features/leadgen/site-generator.js`** — The Claude generation call. This is the hardest part to get right — iterate on the generation prompt until output quality is consistently high.
5. **`features/leadgen/asset-manager.js`** — Image downloading, logo detection heuristics, GBP fallback logic.
6. **`features/leadgen/deploy-preview.js`** — Vercel deployment integration.
7. **`features/leadgen/readiness-comparison.js`** — Before/after scoring.
8. **`app/api/leadgen/generate/route.js`** — API orchestration route.
9. **Dashboard UI** — Generate button, design brief editor, preview viewer, comparison display.
10. **End-to-end test** — Pick one real prospect, run the entire pipeline, validate the output.

---

## Critical Success Factors

### The DESIGN.MD Must Be Good Enough for One-Shot

The entire system lives or dies on DESIGN.MD quality. If the brief is vague, Claude will produce generic output. The brief must contain:
- **Exact copy** (verbatim, not summaries)
- **Exact colors** (hex values, not "blue-ish")
- **Exact asset filenames** (not "use a hero image")
- **Exact section order** (not "organize logically")
- **Exact animation presets** per section (not "add some animation")

### Content Is Reorganized, Not Rewritten

We take their words and put them in a better structure. This is critical because:
- No risk of hallucinated services or false claims
- Business owner recognizes their own language → trust
- The pitch becomes "we elevated your presentation" not "we rewrote your business"

### The gsap-kit.js Abstraction Is Key

By making animations declarative (`data-gsap="staggerGrid"`), we:
- Guarantee consistent motion quality across all generated sites
- Keep the generation prompt simple (Claude doesn't write GSAP)
- Make it easy to upgrade animations globally (edit gsap-kit.js once)
- Reduce token cost per generation (less code to produce)

### The Before/After Tells the Story

The AI Readiness comparison (22 → 91) is the close. It's a concrete, measurable improvement that the business owner can see. It's not "this looks prettier" — it's "your business is now 4x more discoverable by AI agents." That's the pitch that converts.

---

## Environment Variables (new)

```env
# Site Generation
VERCEL_API_TOKEN=your_vercel_deploy_token
VERCEL_TEAM_ID=your_team_id              # optional
GOOGLE_PLACES_PHOTOS_KEY=your_key        # for GBP photo fallback (same as GOOGLE_PLACES_API_KEY)
```

---

## Cost Estimates Per Generated Site

| Step | Cost |
|------|------|
| Content scraping | $0.00 (cheerio + fetch) |
| DESIGN.MD generation | ~$0.01 (Haiku) |
| Site generation (Sonnet) | ~$0.08–$0.15 (16K output tokens) |
| Vercel deployment | $0.00 (within free tier for previews) |
| AI Readiness comparison | ~$0.03 |
| **Total per site** | **~$0.12–$0.19** |

At $0.15 per generated preview site, producing 5 sites/day costs $0.75/day = ~$23/month.
One closed deal at $3K covers 13,000 generated previews.
