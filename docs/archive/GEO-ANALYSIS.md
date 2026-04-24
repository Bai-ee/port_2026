# GEO Analysis — hitloop.agency
**Date:** 2026-04-23
**Canonical Domain:** https://hitloop.agency
**Framework:** Next.js 16 App Router (SSR confirmed)

---

## GEO Readiness Score: 51 / 100

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Citability | 25% | 58/100 | 14.5 |
| Structural Readability | 20% | 52/100 | 10.4 |
| Multi-Modal Content | 15% | 25/100 | 3.75 |
| Authority & Brand Signals | 20% | 35/100 | 7.0 |
| Technical Accessibility | 20% | 78/100 | 15.6 |
| **Overall** | 100% | | **51.3 / 100** |

---

## Platform Breakdown

| Platform | Score | Primary Gap |
|----------|-------|-------------|
| Google AI Overviews | 42/100 | Only homepage ranks; 10+ new pages not yet deployed |
| ChatGPT (web search) | 38/100 | No Wikipedia entry, no Reddit presence; GitHub sameAs too weak |
| Perplexity | 33/100 | Reddit is #1 Perplexity source (46.7% citations) — zero presence |

---

## AI Crawler Access ✅ — Excellent

All major AI crawlers explicitly allowed in `robots.txt`:

| Crawler | Status |
|---------|--------|
| GPTBot (OpenAI) | ✅ Allowed |
| OAI-SearchBot (OpenAI) | ✅ Allowed |
| ChatGPT-User | ✅ Allowed |
| ClaudeBot (Anthropic) | ✅ Allowed |
| anthropic-ai | ✅ Allowed |
| PerplexityBot | ✅ Allowed |
| Google-Extended | ✅ Allowed |
| Applebot / Applebot-Extended | ✅ Allowed |
| CCBot (Common Crawl) | ✅ Allowed |
| Meta-ExternalAgent | ✅ Allowed |
| Bytespider (TikTok) | ✅ Allowed |
| cohere-ai | ✅ Allowed |
| Diffbot | ✅ Allowed |

**One issue:** `Sitemap: /sitemap.xml` is a relative URL — non-standard. Should be absolute: `Sitemap: https://hitloop.agency/sitemap.xml`.

---

## llms.txt Status ✅ — Present, Needs Update

`/llms.txt` is live and accessible. Content is detailed and accurate:
- Platform architecture described clearly
- Modular card pipeline explained (Multi-Device View → Social Preview → Brand Snapshot → SEO Performance)
- Technical stack listed (Next.js, Firebase, Anthropic API, Browserless)
- AI summarization conventions included — strong signal for LLM citation

**Issues:**
1. References `/dashboard` and `/auth` as core experiences — these are gated private routes. AI crawlers following these links will hit `noindex` pages. Remove or re-label as "Signed-in only" to avoid confusion.
2. Does not list new public marketing pages (`/faq`, `/work`, `/about`, `/services/*`). Add these for crawl discoverability.
3. Contact email is present — good entity signal.

**Recommended additions to llms.txt:**
```
## Public pages
- [FAQ](/faq): Common questions about AI design engineering, engagement structure, pricing, and the intake pipeline.
- [Work](/work): Selected projects spanning AI-assisted platforms, Three.js experiences, and design systems.
- [About](/about): Background, experience, and the technical/design methodology behind the work.
- [Services: AI Design Consulting](/services/ai-design-consulting): Scope and approach for AI-assisted consulting engagements.
```

---

## Server-Side Rendering Check ✅ — Confirmed

Next.js App Router renders content server-side. Verified via live HTML inspection:
- Homepage: 108 KB HTML, ~4,210 chars of visible text in SSR output
- FAQ: ~5,542 chars of visible text — all Q&A content is present in raw HTML
- All metadata, JSON-LD, OG tags, and heading elements are in the initial HTML response

**Issue:** GSAP-animated content (`StackedSlidesSection` panel headings, `HoverRevealList` service items) uses `visibility: hidden` as initial state. The text IS present in the DOM at SSR time, but `visibility: hidden` elements may be ignored by some AI crawlers.
- The visually hidden H2 (`position:absolute; left:-10000px`) IS accessible to crawlers ✅
- Slide panel H2 (`id="panel-hero-headline"`, `visibility:hidden`) — text present but hidden

---

## Passage-Level Citability Analysis

### FAQ Page — Best Citability Asset (Score: 78/100)

The FAQ at `/faq` is the strongest GEO asset on the site. Content is:
- Question-based headings — matches how AI queries are formed
- Self-contained answers (80–200 words each) — within the optimal 134–167 word range
- Specific facts: pricing ($3,500 start), timelines (2–6 weeks, 3–5 days for design systems), team names

**High-citability passages identified:**

*"What is an AI design engineer?"* — ~160 words, self-contained, definitional. Near-optimal length for AI citation. Leads with a clear definition sentence ("An AI design engineer works at the intersection of software engineering, product design, and applied AI.")

*"What does it cost?"* — Contains specific pricing ($3,500 starting scope, month-to-month retainer option). Specific dollar figures are high-value AI citation signals.

*"How long does a project take?"* — Specific timelines (2–6 weeks, under 1 week for intake brief, 3–5 days for design system). Quantified claims are the most citable content type.

**One gap:** No publication or last-updated date visible in SSR output. Dates improve AI selection confidence significantly.

### Homepage — Weak Citability (Score: 38/100)

- Visible SSR text: ~4,210 chars
- Testimonials ARE in SSR output ✅ (Melissa Hsiao/TikTok, Jeanne Cheung/HBO Max, Eric Farias/Epsilon, Vanessa D'Amore/TST)
- H1 `"YOUR HUMAN IN THE LOOP"` — brand tagline, zero definitional value for AI
- No self-contained answer blocks
- No statistics or data points in crawlable text
- Key differentiators ("Human-in-the-loop AI") buried in GSAP-animated panels

### Undeployed Pages (404) — Not Yet Cited

`/about`, `/work`, `/services/*`, `/contact`, `/gallery`, `/how-it-works`, `/process`, `/case-studies` all return 404 on the live domain. These pages exist in the codebase but are untracked git files — they have not been committed or deployed. Until they are live, they contribute nothing to GEO.

---

## Brand Mention Analysis

| Platform | Presence | Notes |
|----------|----------|-------|
| Wikipedia | ❌ None | No entity page for "Bryan Balli" or "hitloop.agency" |
| Reddit | ❌ None detectable | Reddit is #1 Perplexity source, #2 ChatGPT source — zero presence is a significant gap |
| YouTube | ❌ None detectable | YouTube mentions correlate 0.737 with AI citations (highest of any signal) |
| LinkedIn | ✅ Profile exists | linkedin.com/in/bryanballi/ — now in sameAs (pending deploy) |
| GitHub | ✅ Active | github.com/Bai-ee — in sameAs |
| Twitter/X | ✅ @bai_ee | In sameAs (pending deploy) — low AI citation weight but entity disambiguation |
| Crunchbase | ❌ Not checked | Potential entity signal for agency/consulting framing |

**Key gap:** YouTube presence correlates most strongly with AI citations (0.737). Even one video demonstrating the dashboard, intake pipeline, or a design system walkthrough would substantially improve cross-platform AI visibility.

---

## Schema Recommendations

### Currently Implemented ✅
- Person (`@id: https://hitloop.agency#bryan-balli`) with `knowsAbout`, `sameAs`, `alternateName`
- WebSite with `publisher` back-reference
- 4× Review schemas linked to Person entity
- Per-page schemas on undeployed inner pages (About, Work, service layouts)

### Missing / Actionable

**1. FAQPage schema (HIGH PRIORITY)**
`/faq` has excellent Q&A content but no FAQPage JSON-LD. This is Google-eligible for rich results and a direct AI citability signal.
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is an AI design engineer?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "An AI design engineer works at the intersection of software engineering, product design, and applied AI..."
      }
    }
  ]
}
```
Add to `app/faq/layout.jsx`.

**2. sameAs — LinkedIn + Twitter pending deploy**
Already edited in `app/page.jsx` — LinkedIn and Twitter now in the array. Will take effect on next Vercel deploy.

**3. Domain inconsistency — urgent**
Live homepage JSON-LD uses `https://hitloop.agency` (correct, from env var).
Inner page layouts hardcode `https://bryanballi.com` (wrong — this domain is not live).
Once inner pages deploy, they will declare a different entity URL than the homepage — Google and AI engines will see two different Person entities.
Fix: replace `bryanballi.com` with `hitloop.agency` across all layout files, or set `NEXT_PUBLIC_SITE_URL=https://hitloop.agency` in Vercel env vars.

**4. ProfessionalService schema (MEDIUM)**
Would position the entity as a service provider for relevant query surfaces. Add to homepage or a dedicated services page once `/services/*` routes are live.

---

## Top 5 Highest-Impact Changes

| # | Change | Platform Impact | Effort |
|---|--------|----------------|--------|
| 1 | **Deploy untracked pages** — commit and push `/about`, `/work`, `/services/*`, etc. | All platforms — 10+ new indexable URLs | Low (already built) |
| 2 | **Add FAQPage JSON-LD to `/faq`** | Google rich results + AI citation lift on definitional queries | 30 min |
| 3 | **Fix domain inconsistency** — set `NEXT_PUBLIC_SITE_URL=https://hitloop.agency` in Vercel, remove `bryanballi.com` hardcodes from all layouts | Entity coherence across all AI platforms | 1 hr |
| 4 | **Publish one YouTube video** — dashboard walkthrough or design system demo | ChatGPT + Perplexity citation probability (0.737 correlation) | 2–4 hrs |
| 5 | **Add last-updated dates to FAQ answers** | AI selection confidence — dated content preferred over undated | 30 min |

---

## Content Reformatting Suggestions

### Homepage — Add a definitional paragraph in SSR

Current SSR text opens with the brand tagline and then jumps to testimonials and service lists. No self-contained paragraph about what Bryan Balli does that AI can cite.

**Suggested addition** (below hero, above testimonials — crawlable, not inside GSAP animation):
> Bryan Balli is an AI design engineer and creative technologist based in Chicago. He builds AI-assisted client dashboards, modular intake pipelines, and high-performance web experiences for founders, agencies, and growing teams. His work sits at the intersection of front-end engineering (Next.js, Three.js, GSAP) and applied AI (Claude API, OpenAI) — combining production-quality builds with intelligent automation that replaces manual discovery and briefing workflows.

This is 77 words, SSR-visible, definitional, and citable. It answers "who is Bryan Balli?" without requiring JavaScript execution.

### FAQ — Add publication date

Add `<time dateTime="2026-04-23">Last updated April 2026</time>` to the FAQ page header. AI crawlers weight dated content more heavily than undated content.

### llms.txt — Add public page index

Update `llms.txt` to list all public pages once they are deployed. The current file only references the gated dashboard and auth routes as "core experiences."

---

## RSL 1.0

RSL 1.0 (Really Simple Licensing) is not implemented. Low priority for a portfolio/consulting site — RSL matters most for high-volume content publishers. No action needed now.
