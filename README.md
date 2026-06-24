# HIT Agency Platform

Multi-tenant client platform (Next.js 16 / React 19 / Firebase / Vercel). Marketing site + a gated client dashboard whose launch surface is the **Creative Brief** and **Deliverables** buckets.

## Start here

Navigating the repo (design system, cards, admin, helper sites, backend): see **`CLAUDE.md`** at root — the orientation map (local/untracked).


**[docs/source-of-truth/SOURCE-OF-TRUTH.md](docs/source-of-truth/SOURCE-OF-TRUTH.md)** is the single canonical doc for the launch surface. Every claim there is tagged by how it was verified (`✓code file:line` vs `⚠ops` runtime vs `▢scope` gated). If any other doc disagrees with it, the other doc is stale.

Supporting docs (all in [`docs/source-of-truth/`](docs/source-of-truth/), linked from the SSOT):
- [PRODUCTION-LAUNCH-CHECKLIST.md](docs/source-of-truth/PRODUCTION-LAUNCH-CHECKLIST.md) — scope, gates, env, blockers
- [LAUNCH-DATA-PIPELINE.md](docs/source-of-truth/LAUNCH-DATA-PIPELINE.md) — signup→download pipeline
- [CREATIVE-BRIEF-DELIVERABLES-WIRING.md](docs/source-of-truth/CREATIVE-BRIEF-DELIVERABLES-WIRING.md) — card wiring map
- [ADMIN-DASHBOARD-DATA-MAP.md](docs/source-of-truth/ADMIN-DASHBOARD-DATA-MAP.md) — admin telemetry
- [PRODUCTION-READINESS-TRACKER.md](docs/source-of-truth/PRODUCTION-READINESS-TRACKER.md) — hardening status
- [DOCS-ACCURACY-REPORT.md](docs/source-of-truth/DOCS-ACCURACY-REPORT.md) — doc-by-doc verdicts
- [docs/seo/GEO-ANALYSIS.md](docs/seo/GEO-ANALYSIS.md) — SEO/AI-search

All other docs live under [`docs/`](docs/) (see its README) and are historical unless linked from the SSOT. Superseded root docs are in `docs/archive/2026-06-23-stale-root-docs/`.

## Dev

```bash
npm install
npm run dev            # local dev
npm test               # node test runner
npm run build          # production build
npm run smoke:routes   # route smoke check
```

Env: copy `.env.example` and fill values (Firebase admin, Stripe price IDs, `WORKER_SECRET`/`CRON_SECRET`, Browserless, `STUDIO_RENDER_URL`/`STUDIO_RENDER_SECRET`, Anthropic).
