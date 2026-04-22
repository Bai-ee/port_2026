# SEO Action Plan — Bballi Portfolio
**Overall Score: 27 / 100** | Date: 2026-04-21

---

## Critical (Fix Immediately)

- [ ] **`public/robots.txt`** — Disallow /dashboard, /admin, /login, /capture, /preview/*. Point to sitemap.
- [ ] **`noindex` on private pages** — Add `export const metadata = { robots: { index: false, follow: false } }` to dashboard, login, admin, capture, all preview pages.
- [ ] **`app/sitemap.js`** — Return homepage URL only. Private routes excluded.
- [ ] **Custom domain** — Register bryanballi.com or bballi.com. Connect via Vercel. Largest single SEO unlock.

## High (Within 1 Week)

- [ ] **Improve title + description** — `app/layout.jsx`. Current: "Bballi Portfolio" / "Client dashboard and portfolio". Both are internal-facing and keyword-free.
- [ ] **Add `metadataBase` + Open Graph + Twitter Card** — `app/layout.jsx`. OG image: `/img/profile2_400x400.png`.
- [ ] **Person + WebSite JSON-LD schema** — `app/page.jsx`. Establishes entity identity for Google Knowledge Graph.
- [ ] **Fix profile image alt text** — `PortfolioModal.jsx`. Change `alt=""` to `alt="Bryan Balli, AI consultant and creative technologist"`.
- [ ] **Convert `<img>` to Next.js `<Image>`** — `Header.jsx`, `PortfolioModal.jsx`, gallery. Auto WebP + lazy loading.

## Medium (Within 1 Month)

- [ ] **Compress portfolio images** — Multiple 5MB+ PNGs in `/public/img/port/`. Convert to WebP. Target < 200 KB each.
- [ ] **`public/llms.txt`** — Brief structured description for AI crawlers (ChatGPT, Perplexity, etc.).
- [ ] **`app/favicon.ico`** — No favicon exists. Add branded icon.
- [ ] **Add keyword-rich H2 below hero fold** — Support the brand tagline H1 with a crawlable keyword line.
- [ ] **Review schema for testimonials** — Mark up quotes from Sam, Rashid A., Claire B., Marco T. as schema.org `Review`.
- [ ] **Reduce canvas particle count on mobile** — 25,000 particles on narrow/touch. Cap at 8,000–10,000 for mobile.

## Low (Backlog)

- [ ] Static `/work/[slug]` pages for portfolio case content (currently JS-modal-only, invisible to crawlers)
- [ ] Blog / editorial content for informational keyword targeting
- [ ] Add LinkedIn, GitHub `sameAs` links to Person schema
- [ ] `Content-Security-Policy` header in `next.config.mjs`

---

See `FULL-AUDIT-REPORT.md` for detailed findings, code snippets, and scoring breakdown.
