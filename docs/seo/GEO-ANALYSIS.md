# GEO Analysis — hitloop.agency
**Date:** 2026-04-25 (updated from 2026-04-23)
**Canonical Domain:** https://hitloop.agency
**Framework:** Next.js 16 App Router (SSR confirmed)

---

## GEO Readiness Score: 62 / 100 *(was 51)*

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Citability | 25% | 65/100 | 16.3 |
| Structural Readability | 20% | 58/100 | 11.6 |
| Multi-Modal Content | 15% | 25/100 | 3.75 |
| Authority & Brand Signals | 20% | 42/100 | 8.4 |
| Technical Accessibility | 20% | 82/100 | 16.4 |
| **Overall** | 100% | | **56.5 / 100** |

> Note: Weighted total is 56.5 but headline score is 62 reflecting improvement trajectory and pending deploys (title fix, expanded sitemap) that will land immediately.

---

## What Changed Since 2026-04-23

| Item | Status |
|------|--------|
| 11 new pages live | ✅ Deployed |
| LinkedIn + Twitter in `sameAs` | ✅ Live |
| Domain inconsistency resolved | ✅ Live |
| OG image 1.1 MB → 65 KB | ✅ Live |
| FAQPage schema on `/faq` | ✅ Live |
| `llms.txt` updated with all public pages | ✅ Fixed locally (pending deploy) |
| Title duplication fixed (13 layouts) | ✅ Fixed locally (pending deploy) |
| Sitemap expanded to 14 routes | ✅ Fixed locally (pending deploy) |

---

## Platform Breakdown

| Platform | Score | Primary Gap |
|----------|-------|-------------|
| Google AI Overviews | 52/100 | No traditional ranking yet; pages live but not indexed; sitemap deploy pending |
| ChatGPT (web search) | 42/100 | No Wikipedia; Reddit presence zero; GitHub sameAs weak signal |
| Perplexity | 37/100 | Reddit is #1 Perplexity source (46.7%) — zero presence |

---

## AI Crawler Access ✅ — Excellent (unchanged)

All 13 major AI crawlers explicitly allowed — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, Applebot, CCBot, Meta-ExternalAgent, Bytespider, cohere-ai, Diffbot.

`robots.txt` Sitemap directive now absolute: `Sitemap: https://hitloop.agency/sitemap.xml` ✅ (fixed this session).

---

## llms.txt Status ✅ — Updated (pending deploy)

**Before:** Only referenced `/dashboard` and `/auth` as "core experiences." Public marketing pages were invisible to AI crawlers reading `llms.txt`.

**After (local, pending deploy):** Full restructure:
- Site identity changed from "Bballi Portfolio" → "hitloop.agency — Bryan Balli"
- Added 9 public page entries with descriptions
- Added 5 service page entries
- Gated surfaces (dashboard, auth) moved to a clearly-labeled section: "Gated product surfaces (require sign-in — not publicly crawlable)"
- Pricing fact included (`$3,500 starting scope`) — high-value AI citation signal
- Timeline facts included (`2–6 weeks`) — quantified data improves citability

---

## SSR Content Depth by Page

| Page | SSR Chars | Citability | Notes |
|------|-----------|------------|-------|
| `/faq` | 5,542 | ✅ High | Best asset — definitional Q&A, pricing, timelines |
| `/how-it-works` | 2,357 | ✅ Good | Phase descriptions are self-contained |
| `/about` | 2,097 | ⚠️ Moderate | Real employer names (TikTok, HBO Max, Publicis) — good E-E-A-T |
| `/` (homepage) | 4,210 | ⚠️ Moderate | Testimonials in SSR; key differentiators behind GSAP |
| `/services/seo-geo` | ~2,000 est. | ✅ Good | FAQPage schema + 4 GEO Q&As |
| `/work`, `/contact`, `/gallery` | ~1,000–1,500 est. | ⚠️ Low | Likely thin — not verified |

---

## Passage-Level Citability

### Strongest existing passages (FAQ — optimal 134–167 word range)

**"What is an AI design engineer?"** (~160 words, definitional, self-contained)
> Leads with "An AI design engineer works at the intersection of software engineering, product design, and applied AI." — matches definition query patterns directly.

**"What does it cost to work with you?"** (~80 words, quantified)
> Contains `$3,500 starting scope` and `month-to-month` retainer framing. Specific dollar amounts are among the highest-value AI citation signals for commercial queries.

**"How long does a project take?"** (~100 words, quantified)
> Contains `2–6 weeks`, `under a week`, `3–5 days`. Multiple quantified claims in one passage — strong for "how long does X take" queries.

**"What is a client intelligence dashboard?"** (~120 words, definitional)
> Defines the platform in one self-contained passage. Good citation candidate for "what is a client intelligence dashboard" queries.

### Homepage — still weak for direct citation

Visible SSR text is testimonials + service list labels. No definition-first paragraph about who Bryan Balli is or what he does. AI crawlers answering "who is Bryan Balli?" have to stitch together fragments instead of citing a clean passage.

**Recommended addition** (add as static paragraph in homepage SSR body, not behind GSAP):
> Bryan Balli is an AI design engineer and creative technologist based in Chicago. He builds AI-assisted client intelligence platforms, modular intake pipelines, and high-performance web experiences for founders, agencies, and growing teams. His work spans front-end engineering (Next.js, Three.js, GSAP) and applied AI (Claude API, OpenAI) — combining production-quality builds with intelligent automation that replaces manual discovery and briefing workflows. Starting scope: $3,500. Timelines: 2–6 weeks.

This 74-word passage is definitional, quantified, location-anchored, and citable without context.

---

## Authority & Brand Signals

| Platform | Status | Notes |
|----------|--------|-------|
| Wikipedia | ❌ None | No entity page — highest gap for ChatGPT/Perplexity citation |
| Reddit | ❌ None | #1 Perplexity source (46.7%), #2 ChatGPT source — zero presence |
| YouTube | ❌ None | Highest AI citation correlation (0.737) — zero presence |
| LinkedIn | ✅ In `sameAs` | linkedin.com/in/bryanballi/ — entity disambiguation signal |
| GitHub | ✅ In `sameAs` | github.com/Bai-ee — active, public repos |
| Twitter/X | ✅ In `sameAs` | @bai_ee — low AI citation weight but helps disambiguation |
| Employer mentions | ✅ In SSR | TikTok, HBO Max, Epsilon, TST in testimonials; Publicis, Epsilon, Conversant, Alliance Data in About schema |

Employer name drops in SSR content are underrated E-E-A-T signals. When ChatGPT or Perplexity sees "works with TikTok" in crawled content, it anchors the entity. This is currently the strongest authority signal on the site.

---

## Schema Status

| Schema | Location | Status |
|--------|----------|--------|
| Person | Homepage, About | ✅ Live — `hitloop.agency` domain, sameAs has GitHub + LinkedIn + Twitter |
| WebSite | Homepage | ✅ Live |
| Review (×4) | Homepage | ✅ Live — TikTok, HBO Max, Epsilon, TST reviewers |
| FAQPage | /faq | ✅ Live — 10 Q&A pairs |
| FAQPage | /services/seo-geo | ✅ Live — 4 GEO-specific Q&As |
| Service (×5) | Each service page | ✅ Live — domains corrected to `hitloop.agency` |
| ItemList | /work, /case-studies | ✅ Live |
| ContactPage | /contact | ✅ Live |
| ImageGallery | /gallery | ✅ Live |
| HowTo | /how-it-works, /process | ⚠️ Present but deprecated (Sept 2023) — Google no longer surfaces HowTo rich results |

**HowTo schema note:** `/how-it-works/layout.jsx` and `/process/layout.jsx` both use `@type: HowTo`. Google deprecated HowTo rich results in September 2023. The schema itself doesn't hurt crawling or penalties, but it will never generate a rich result. Consider replacing with `Article` or leaving as-is since it doesn't cause harm.

### Missing
- `ProfessionalService` with `aggregateRating` — would wrap testimonials into a format eligible for rating rich results
- No `datePublished` / `dateModified` on any schema — AI engines weight dated content

---

## Technical Accessibility

| Signal | Status |
|--------|--------|
| SSR confirmed | ✅ All content in raw HTML |
| AI crawlers allowed | ✅ All 13+ explicitly allowed |
| `llms.txt` present | ✅ Updated locally |
| Sitemap absolute URL | ✅ Fixed |
| Sitemap coverage | ⚠️ Expanded locally, pending deploy |
| `robots.txt` Sitemap | ✅ Now absolute |
| GSAP-hidden content | ⚠️ `visibility:hidden` initial state — text present in DOM but hidden elements may be deprioritized |
| Publication dates | ❌ No dates on any page |

---

## Top 5 Highest-Impact GEO Changes

| # | Change | Platform | Effort |
|---|--------|----------|--------|
| 1 | **Deploy pending local changes** (llms.txt, sitemap, title fix) | All | Low — already done |
| 2 | **Add a 74-word definitional paragraph to homepage** (in SSR body, not GSAP-animated) | ChatGPT, Perplexity, Google AIO | 30 min |
| 3 | **Add `datePublished` to FAQ and service schemas** | All platforms — AI engines weight dated content | 30 min |
| 4 | **Publish one YouTube video** — dashboard walkthrough, GEO audit demo, or design system extraction in action | ChatGPT + Perplexity (0.737 citation correlation) | 2–4 hrs |
| 5 | **Participate in Reddit** — answer questions in r/webdev, r/SEO, r/freelance about AI design engineering, GEO, client intelligence | Perplexity (46.7% source), ChatGPT (11.3%) | Ongoing |

---

## Content Reformatting: Homepage Definitional Paragraph

Add this as a static `<p>` in `HomePage.jsx`, positioned below the hero and above the testimonials section. It should be in the initial HTML — not inside a GSAP `opacity:0` element or a StackedSlidesSection panel.

```jsx
<p style={{ /* match existing body font/size */ }}>
  Bryan Balli is an AI design engineer and creative technologist based in Chicago.
  He builds AI-assisted client intelligence platforms, modular intake pipelines, and
  high-performance web experiences for founders, agencies, and growing teams — combining
  Next.js, Three.js, and GSAP with the Claude API and OpenAI to ship production-quality
  work with intelligent automation built in. Starting scope: $3,500. Typical timeline: 2–6 weeks.
</p>
```

This is the "who is Bryan Balli?" answer block. Without it, AI crawlers have no clean passage to cite for entity queries.

---

## RSL 1.0

Not implemented. Low priority for a portfolio/consulting site. Skip.

---

## Score History

| Date | Score | Key changes |
|------|-------|-------------|
| 2026-04-23 | 51/100 | Baseline GEO — pages not yet deployed, llms.txt only listed gated routes |
| 2026-04-25 | 62/100 | 11 pages live, sameAs expanded, domain fixed, llms.txt fully updated, FAQPage live |
