# GAPS — AI SEO Audit Engine

Documents gaps between the Phase 1 build and the full spec, plus integration gaps for Phase 2.

---

## Integration gaps (Phase 2 — Tasks 10, 11, 12)

### G1 — Engine not yet wired into scout-intake pipeline
- `features/scout-intake/runner.js` does not call `runAiSeoAudit`. The `AI_SEO_AUDIT_ENABLED` flag and the stage after PSI are not yet added.
- Required: Task 10 adds the stage, injects `analyzerOutputs['seo-performance'].skills['ai-seo-audit']`, re-aggregates.

### G2 — Solutions catalog has no AI visibility entries
- `features/scout-intake/solutions-catalog.mjs` has no entries for the 14 stable finding ids in Section 0.3.
- Every finding falls through to the generic "book a diagnostic call" card.
- Required: Task 11 adds one catalog entry per finding id.

### G3 — Dashboard does not render AI Visibility ring or DATA section
- `DashboardPage.jsx::renderSeoViz` renders 4 rings (Performance, SEO, Accessibility, Best Practices).
- The 5th "AI Visibility" ring and the "AI VISIBILITY" DATA-tab section require Task 12.
- The `aiVisibility` block is produced by the engine but not yet threaded through `normalize.js` → `run-lifecycle.cjs` → dashboard.

### G4 — `aiVisibility` not persisted to Firestore
- `features/scout-intake/normalize.js` does not yet merge `aiSeoAuditResult.aiVisibility` into the `seoAudit` object written to Firestore.
- Required: Task 12 threads this through normalize.js and run-lifecycle.cjs.

---

## Engine quality gaps (potential Phase 1 follow-up)

### G5 — Single-page HTML only
- The engine fetches the homepage URL and analyzes one HTML document.
- Multi-page crawling (following sitemap, internal links) is out of scope for Phase 1 but would improve accuracy for heading, content, and E-E-A-T analysis.

### G6 — Entity authority is best-effort for non-English entities
- Wikidata search uses `language=en`. Non-English brand names may miss QID resolution.
- NAP consistency relies on simple substring matching; hyphenated phone formats and address abbreviations may produce false positives.

### G7 — llms.txt link HEAD-checking may be slow
- All linked URLs in llms.txt are HEAD-checked in parallel. Sites with many links (10+) may extend audit time beyond the 30s pipeline timeout.
- Mitigation: parallel HEAD-checks are already concurrent via `Promise.allSettled`; consider capping at 10 checks if needed.

### G8 — Content analysis is single-page
- `analyzeAnswerFirst` evaluates H2 sections of the homepage only.
- Sites where blog/article pages carry the content structure will score low even if their actual content pages are answer-first.

### G9 — playwright dual-fetch not yet validated
- playwright is in `optionalDependencies` but has not been tested against a real site in this build.
- The fallback ratio heuristic is active by default until playwright is confirmed working.

### G10 — No Disallow-everything detection shortcut
- The parser correctly handles `Disallow: /` but does not short-circuit on it.
- A future optimization: detect `User-agent: * / Disallow: /` as a blanket block immediately without testing individual bots. Correctness is not affected — just speed.

---

## Test coverage gaps

### G11 — No integration test (Task 9)
- `src/__tests__/audit.integration.test.js` is not yet written.
- Required: Task 9 adds a full end-to-end integration test with fixture-served HTML.

### G12 — No tests for llmsTxtValidator, schemaExtractor, contentExtractability, entityAuthority
- Unit tests exist only for `robotsAiParser`.
- Remaining modules have no test coverage. Task 9 integration test will cover the aggregate output; per-module unit tests are a recommended follow-up.

---

## Out of scope (will not be addressed)

- LLM calls: the engine is deterministic. `model: 'native'` in metadata is load-bearing.
- Paid API dependencies: only node-fetch, cheerio, and optional playwright.
- Changes to `seo-depth-audit.md`, aggregator, or Scribe.
- Design polish beyond what is needed for the 5th ring and DATA rows.
