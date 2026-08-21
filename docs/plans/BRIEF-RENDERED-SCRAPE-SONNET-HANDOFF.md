# Rendered Scrape + Evidence-Tier Brief — Sonnet Handoff

**Status:** implementation handoff; not started
**Written:** 2026-08-21 by Fable, from a full pipeline map of the scout-intake scrape path
**Master prompt (the target output philosophy):** `/Users/bballi/Documents/Repos/Virtual_Time_capsule/brief-agent.system.md` — read it first. Its Laws (L1 absence-requires-proof, L2 exact-tag, L3 inspect-the-artifact, L4 separate-your-limits-from-their-gaps, L5 no-silent-modules, L7 be-visibly-fair) and evidence tiers (A rendered / B transport / C inferred / D external / X not-tested) are the spec for what the brief must become.
**The failure being fixed:** the Creative Brief pipeline read a client-rendered SPA as static HTML and reported the client's site as an empty "black box" (copy, CTAs, social metadata "missing/unconfirmed"). The blindness was ours, not theirs.

---

## 0. Mission

1. Make the intake scrape see JS-rendered sites (rendered fallback via the existing Browserless `/content` path).
2. Make the Creative Brief report evidence honestly: tiered claims, crawler-vs-human parity, a coverage manifest — the master prompt's information, produced by the existing pipeline.

Work phase by phase. **Stop for user approval at the end of every phase.**

## 1. Settled facts — do not re-derive

1. **One chokepoint.** `features/scout-intake/site-fetcher.js::fetchSiteEvidence` (:467) is the ONLY site-HTML fetcher in the brief/scout path. Plain `safeFetch` (:395–397), regex extraction (no DOM parser), 8s timeout, 2MB cap, homepage + ≤3 discovered pages. `thin = totalContentChars < 200` (:27, :530–542). Every consumer funnels through it: `modules/shared/site-fetch.js:7`, `runner.js:259`, `run-brief/route.js:377`, `run-skill/route.js:146`, `scout-config-regenerate/route.js:69`, `leadgen/content-scraper.js:283`. Fix it once, everything downstream heals.
2. **Rendered capture already exists and is shipped.** `api/_lib/browserless.cjs::fetchBrowserlessContent` (:1070) POSTs to Browserless `/content`, returns `{ ok, html, bytes, durationMs }`, never throws, degrades to `{ok:false}` when `BROWSERLESS_TOKEN` unset. Reference implementation of the exact fallback pattern: `features/leadgen/content-scraper.js:292–305` (if `evidence.thin` → `fetchRenderedHtml` → swap in when longer → `meta.usedBrowserless = true`). Port that pattern; don't invent a new one.
3. **`fetchBrowserlessContent` has NO SSRF guard of its own** — caller must pre-validate (site-fetcher already validates at :474; keep that ordering).
4. **Signup runs only two modules.** `run-brief/route.js:286–294`: `trigger === 'creative-brief' || 'signup'` → `['multi-device-view','social-preview']`. The site "analysis" on signup is `modules/social-preview.js` → `runSiteFetch` → `summarizeEvidencePages` → `dashboard_state.evidence` + `dashboard_state.siteMeta` (via `run-lifecycle.cjs:874, :883`).
5. **Where the black-box prose is made:** `features/scout-intake/brief-summarizer.js` — `pageEvidenceLines` (:98, "none found in the static HTML" :110) and `captureStatusLines` (:120; the JS-render branch :135 "COULD NOT BE READ … absence is UNPROVEN"). Rendered by `app/api/dashboard/brief-preview/route.js` — the all-✗ social checklist is `socialInner` (:1198, comment :1195 "'all missing' IS the finding") reading `dashboard_state.siteMeta`; the "Your Website Status." page is `pageBuilders['website-status']` (:1222).
6. **Metadata extraction is exact-tag already** (`extractSiteMeta` :217 — og/twitter/canonical/theme-color/favicon, both attribute orders, no neighbor substitution). No JSON-LD parsing in scout-intake (cheerio-based JSON-LD checks exist only in `leadgen/quick-auditor.js:162` and `ai-seo-audit/`). cheerio is already a dependency.
7. **SPA detection already exists but feeds nothing:** `ai-seo-audit/src/utils/playwrightFetch.js::dualFetch` scores JS-dependency (Playwright optionalDependency, falls back to text/HTML-ratio heuristic in `contentExtractability.js:115–130`); `services/site-clone/lib/profile.mjs::detectPlatform` + `profiles/*.json` carry a `renderMode: static|rendered` classifier. Do NOT reuse site-clone's Playwright capture for the brief path (local/Cloud-Run only, entangled with the mirror chain; Playwright cannot run in Vercel functions). Browserless is the Vercel-safe renderer.
8. **Known trap:** `_rawHtml` is stripped before skills run (`skills/_runner.js:226–227` etc.), so `skills/site-meta-audit.md`'s `_rawHtml` lookup ALWAYS misses. Feed skills derived fields, never raw HTML.
9. **Cost:** Browserless calls are ledgered in `browserless_requests` (`createBrowserlessRequestLog`/`finalizeBrowserlessRequestLog`) and estimated on the Operating Cost card — **verify `fetchBrowserlessContent` actually writes that ledger; if it doesn't, add the log calls in Phase 1**. `docs/launch/full-audit-signup-plan.md:84` flags signup cost growth — cap rendered fetches per run.
10. **Docs that must be updated when behavior changes:** `docs/source-of-truth/CREATIVE-BRIEF-DELIVERABLES-WIRING.md` (:84–90 currently says the rendered fetch "is not built"), `docs/pipeline/PIPELINE_CONTENT_INPUTS.md` (SiteEvidence schema).

## 2. ⛔ Standing gates (every phase)

- No deploy, no Firestore prod write, no paid call (Browserless against real sites included) without explicit user approval for that specific action. `.env.local` holds live prod creds; locally-run worker routes SPEND REAL MONEY (`worker-routes-unauthenticated-locally`). Verify with unit fixtures + fake fetch, never by running the pipeline against prod.
- No X API. Social last-post-date reads (Phase 4) = ScrapeCreators only (`docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`).
- Vercel Hobby 12-function cap — no new routes without reading `docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md`. Phases 1–3 need zero new routes.
- Preserve unrelated dirty-worktree edits; commit only with user approval, one branch per phase.
- Full gate per phase: `npm test` + `npm run build` + phase acceptance checks.
- Validation run against the real victim site (Virtual Time Capsule) is a PAID run — user triggers it, not an agent.

## 3. Phases

### Phase 1 — rendered fallback at the chokepoint (the fix)

In `site-fetcher.js`:

- After static homepage fetch, decide render need: `thin === true` OR SPA-shell signature (HTML < 10KB with an empty root div — the master prompt's heuristic). If yes → `fetchBrowserlessContent(url)` (pre-validated URL), and if `ok` and rendered HTML yields more content, rebuild that page's evidence from the rendered HTML.
- **Keep both views.** Do not discard the static extraction — store per page: `staticView` (what crawlers receive) and the primary fields from the rendered view. Add `renderMode: 'static' | 'rendered-fallback'`, `renderedVia: 'browserless'`, `renderFailed?: reason`.
- Recompute `thin` from the rendered content. Re-run `extractSiteMeta` on rendered HTML (fixes the all-✗ social checklist); keep the static `extractSiteMeta` result as `staticView.siteMeta` (Phase 2's parity diff needs it).
- Additional pages: render only those whose static text is also thin; **hard cap 4 rendered fetches per run**.
- Ledger check per settled-fact 9. Degrade honestly: Browserless unavailable ⇒ evidence carries `renderFailed`, `thin` stays true, downstream prose stays in the "could not read" register (that branch is correct honesty — keep it).
- Update `brief-summarizer.js::captureStatusLines`: new branch — when `renderMode === 'rendered-fallback'`, say the site is JS-rendered and copy was read via rendered capture (Tier A), not "COULD NOT BE READ".
- Schema ripple: `normalize.js::summarizeEvidencePages` carries the new flags; `run-lifecycle.cjs` writes them untouched.
- Tests (`node --test`, mock fetch + mock browserless): SPA shell → fallback fires → evidence populated + `thin:false`; browserless disabled → honest degrade; static-rich site → no browserless call; cap enforced.

**Accept:** unit matrix green; suite + build green; no behavior change for static-rich sites (fixture proves byte-stable evidence); `CREATIVE-BRIEF-DELIVERABLES-WIRING.md:88` claim updated.

### Phase 2 — crawler-parity + coverage manifest in stored evidence

- Per-page `crawlerParity`: static-vs-rendered for title, description, og/twitter set, H1, CTA texts, body word count. Cheap — both HTMLs already in hand from Phase 1.
- Add JSON-LD types extraction (cheerio, both views).
- og:image artifact inspection (L3): fetch the image (safeFetch, size-capped), record `{ bytes, contentType, width, height, host }` (`sharp` is already a dep). Store on `siteMeta.ogImageArtifact`.
- `coverage` object on evidence: every planned check with `ran | skipped(reason) | failed(reason)` — page crawl, rendered fallback, robots/sitemap probe (reuse `agent-ready/_fetch.js::fetchProbe` outputs), meta extraction, og-image inspection, screenshots. This is L4/L5 made durable.
- Evidence-tier tagging: derive per-field tier mechanically (rendered ⇒ A, static/transport ⇒ B, heuristic ⇒ C, not run ⇒ X) — a pure function over the evidence object, not stored per field by hand.

**Accept:** schema documented in `PIPELINE_CONTENT_INPUTS.md`; tier function unit-tested; no skill receives raw HTML (settled-fact 8).

### Phase 3 — the brief tells the truth (output upgrade)

- `brief-preview/route.js::socialInner` checklist → three states per row: **present** (+ artifact detail from Phase 2), **absent — proven** (tier named), **not tested** (reason from coverage). Never a bare ✗ from a blind read.
- New brief sub-section on `website-status`: **Crawler vs Human** — the parity diff, framed in client terms ("what Facebook/X/iMessage receive when your link is shared vs what a visitor sees"). For SPA clients this is the headline finding.
- **Coverage manifest** rendered honestly at the end of the brief page ("what this run could not see").
- `brief-summarizer.js` prompt: feed dual-view + coverage; add the master prompt's L1/L4/L7 rules to the system prompt (absence requires named tier; our limits never phrased as their gaps; credit specific good engineering).
- UI containers get stable ids per repo DOM-naming rule (e.g. `id="brief-crawler-parity-section"`, `id="brief-coverage-manifest-section"`).

**Accept:** brief preview for (a) static-rich fixture, (b) SPA fixture with rendered fallback, (c) SPA fixture with browserless down — each renders correct register; no regression on existing composer configs; user reviews rendered preview before any live-client run.

### Phase 4 — full pre-engagement brief (separate deliverable, decision-gated ⛔)

The master prompt's remaining scope — property graph (follow Log In / Get Started one hop, ≤3 subdomains), transport/security header findings, source forensics (build fingerprint, analytics + default consent state), promise-vs-implementation table, tech brief, leverage-ordered actions. Too heavy and too costly for the signup Creative Brief; build as a separate admin-triggered brief type (reusing Phase 1–2 evidence + a new analyzer skill in `features/scout-intake/skills/`), copy the master prompt into `docs/reference/` as its spec. **Do not start without an explicit user go.**

## 4. Do not

- Reuse `services/site-clone` Playwright capture in the brief path (wrong runtime).
- Add Playwright/puppeteer to Vercel functions.
- Strip or bypass `safeFetch`/SSRF validation anywhere.
- Rework `summarizeEvidencePages` shape destructively — extend it; existing consumers (skills, card-description-builder, derived-findings) read current fields.
- Let any new prose claim absence without a tier. That is the whole point.

## 5. First deliverable before code

Return to the user: (1) confirmation `fetchBrowserlessContent` does/doesn't write the `browserless_requests` ledger; (2) the Phase 1 evidence-schema diff (new fields, exact names); (3) any contradiction found between this doc and the code. Then wait for approval.
