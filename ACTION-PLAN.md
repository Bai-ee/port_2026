# SEO Action Plan — Bballi Portfolio
**Overall Score: 61 / 100** | Updated: 2026-04-23 | Previous: 27/100 (2026-04-21)

---

## Critical — Fix Immediately

- [ ] **Expand sitemap** — `app/sitemap.js` only lists `/`. Add all 13 public pages (about, work, case-studies, 5 service pages, how-it-works, process, gallery, faq, contact). See snippet in `FULL-AUDIT-REPORT.md`. (30 min)

- [ ] **Fix robots.txt Sitemap directive** — `Sitemap: /sitemap.xml` is relative. Change to absolute URL: `Sitemap: https://bryanballi.com/sitemap.xml`. (5 min)

- [ ] **Resolve domain inconsistency** — Homepage schema falls back to `https://bballi.com`; all inner page layouts hardcode `https://bryanballi.com`. Pick one (`bryanballi.com`), set it in `NEXT_PUBLIC_SITE_URL`, and replace hardcoded URLs in all layout.jsx files. (1 hr)

---

## High — Fix Within 1 Week

- [ ] **Portfolio images — WebP + `<Image>`** — frame_4.png (5.6 MB), frame_2.png (5.3 MB), critters_game1.png (5.1 MB) are uncompressed PNGs. Replace `<img>` with Next.js `<Image>` in PortfolioModal.jsx and gallery components. (2–3 hrs)

- [ ] **Compress OG image** — `/img/og_meta.png` is 1.1 MB. Target < 300 KB at 1200×630 px. Export as JPG 85% or WebP. (30 min)

- [ ] **Add LinkedIn/Twitter to `sameAs`** — homepage Person schema only has GitHub. Add LinkedIn profile URL and `https://twitter.com/bai_ee`. (15 min)

- [ ] **Verify case-studies + FAQ layouts** — Confirm `app/case-studies/layout.jsx` and `app/faq/layout.jsx` have `export const metadata` with page-specific title, description, canonical, and OG. (30 min)

---

## Medium — Fix Within 1 Month

- [ ] **FAQPage JSON-LD** — `app/faq/` exists but FAQPage schema not confirmed. Adds rich result eligibility. (30 min)

- [ ] **ProfessionalService + AggregateRating** — Once 3+ testimonials are live, wrap in a `ProfessionalService` entity with `aggregateRating`. (1 hr)

- [ ] **Defer WebGL canvas init** — Homepage canvas (`ox.jsx`) loads on entry. Add intersection observer to defer until scroll. Reduces mobile LCP. (1–2 hrs)

- [ ] **Audit service page content depth** — AiDesignConsultingPage, BrandIdentityPage, etc. need 300+ words of substantive crawlable text to rank for service queries. (varies)

- [ ] **Connect custom domain** — Register and connect `bryanballi.com` in Vercel. Update `NEXT_PUBLIC_SITE_URL` env var. (1 hr)

---

## Low — Backlog

- [ ] Static `/work/[slug]` pages — Portfolio case content is JS-modal-only. Crawlers miss all project detail.
- [ ] Blog / editorial content — Informational queries require long-form content.
- [ ] CSP header — Add `Content-Security-Policy` to `next.config.mjs`.
- [ ] Keyword H2 on homepage — Crawlable keyword line below brand tagline H1.

---

## Score History

| Date | Score | Notes |
|------|-------|-------|
| 2026-04-21 | 27/100 | Baseline — no robots.txt, sitemap, schema, OG, or noindex |
| 2026-04-23 | 61/100 | robots.txt, llms.txt, sitemap (partial), full metadata, JSON-LD, noindex, GA4, favicon |

---

See `FULL-AUDIT-REPORT.md` for detailed findings, code snippets, and scoring breakdown.
