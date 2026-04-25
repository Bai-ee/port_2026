# SEO Action Plan — hitloop.agency
**Overall Score: 63 / 100** | Updated: 2026-04-25

---

## Critical — Fix Immediately

- [ ] **Title duplication** — all inner page layouts include `Bryan Balli` in the `title` string, and the root template (`%s · Bryan Balli`) appends it again. Strip the author name from every inner page `title`. OpenGraph titles are unaffected — leave those as-is. (30 min)

  Pattern — strip `· Bryan Balli` or `— Bryan Balli ·` from `metadata.title` in:
  `app/about/layout.jsx`, `app/contact/layout.jsx`, `app/work/layout.jsx`, `app/gallery/layout.jsx`, `app/faq/layout.jsx`, `app/services/ai-design-consulting/layout.jsx`, `app/services/brand-identity/layout.jsx`, `app/services/design-systems/layout.jsx`, `app/services/seo-geo/layout.jsx`, `app/services/web-development/layout.jsx`

- [ ] **Expand sitemap** — `app/sitemap.js` still only lists `/`. 11 pages are live and not submitted. See full snippet in `FULL-AUDIT-REPORT.md`. (30 min)

- [ ] **Fix robots.txt Sitemap directive** — change `Sitemap: /sitemap.xml` to `Sitemap: https://hitloop.agency/sitemap.xml`. (5 min)

---

## High — Fix Within 1 Week

- [ ] **Portfolio images** — 5 images over 4 MB (PNG, no lazy load, no WebP). Replace `<img>` with Next.js `<Image>` in gallery and modal components. (2–3 hrs)

- [ ] **Update `llms.txt`** — add `/faq`, `/about`, `/work`, `/services/*`, and other public pages to the page index. Currently only lists dashboard and auth routes as "core experiences." (30 min)

- [ ] **Add publication dates** — FAQ and service pages have no `datePublished`/`dateModified` on their schemas or visible on-page. AI engines weight dated content more heavily. (30 min)

---

## Medium — Fix Within 1 Month

- [ ] **Verify service page content depth** — ensure `AiDesignConsultingPage`, `BrandIdentityPage`, etc. have 300+ words of crawlable body text each.

- [ ] **Cross-link service pages to FAQ** — no in-body links between service pages and the FAQ. Internal linking passes authority and improves crawl efficiency.

- [ ] **`ProfessionalService` schema with `aggregateRating`** — wraps the testimonials into a format Google can use for rich results.

- [ ] **Defer WebGL canvas** — add intersection observer to `ox.jsx` to defer canvas init until the user scrolls to it. Reduces initial LCP on mobile.

---

## Low — Backlog

- [ ] Static `/work/[slug]` pages — case content is JS-modal-only; crawlers miss all project detail.
- [ ] Blog / editorial content — informational keyword surface.
- [ ] YouTube channel — highest AI citation correlation signal (0.737).
- [ ] Reddit presence — primary Perplexity citation source (46.7%).

---

## Score History

| Date | Score | Notes |
|------|-------|-------|
| 2026-04-21 | 27/100 | Baseline — no infrastructure |
| 2026-04-23 | 61/100 | robots.txt, llms.txt, metadata, JSON-LD, noindex, favicon |
| 2026-04-25 | 63/100 | 11 pages live, OG optimized, domain fixed, sameAs expanded; title duplication found |

---

See `FULL-AUDIT-REPORT.md` for full findings, code snippets, and category breakdown.
