# Docs Accuracy Report

Last updated: 2026-06-23
Scope: root technical docs + launch-relevant `docs/` files, judged against current code. Part of the Creative Brief & Deliverables launch audit.

## Root Docs

| Doc | Verdict | Notes |
|---|---|---|
| README.md | should-archive | Stub ("port_2026"); no technical content. |
| PRODUCTION-READINESS-TRACKER.md | accurate (source of truth) | Dated 2026-06-23; matches verified test/build/smoke state and security fixes. Updated this audit with a launch-scope section. |
| SONNET-PRODUCTION-HANDOFF.md | accurate (playbook) | Process/checklist doc, not a status claim. Keep. |
| FULL-AUDIT-REPORT.md | stale → archive | SEO audit dated 2026-04-25; title-duplication + sitemap claims superseded by GEO-ANALYSIS.md. Not launch-feature related. |
| ACTION-PLAN.md | stale → archive | SEO checklist (2026-04-25); fixes already applied locally per GEO-ANALYSIS.md. |
| GEO-ANALYSIS.md | accurate (marketing only) | Most current SEO doc; supersedes the two above. Not launch-blocking. |
| FABLE5-REBUILD-PROMPT.md | should-archive | Task spec for a rebuild; lists features as "must exist," not verified status. |
| FABLE5-REPO-MANIFEST.md | partially-accurate → archive as historical | Stack description accurate; trust-boundary/auth section pre-hardening (IDOR/per-route concerns now addressed per tracker §Security). |
| FABLE5-SCAFFOLD-PROMPT.md | should-archive | Task spec, not status. |

## Launch-Relevant `docs/` Files

| Doc | Verdict | Notes |
|---|---|---|
| docs/PRODUCTION_READINESS_MASTER_DOC.md | accurate (launch scope) | 2026-06-18; defines Studio-centric launch; explicitly marks KB / Strategy Builder / Marketing Brief / Social / Leadgen as "code present, not E2E smoked — keep gated." Aligns with this audit's scope. |
| docs/SONNET_PRODUCTION_HARDENING_PLAYBOOK.md | accurate (guide) | Phase playbook; keep. |
| docs/PRODUCTION_HARDENING_PLAN.md | superseded → archive | Pre-2026-06-18; "npm test not green" claim no longer true (now 491 passing). |
| docs/PRELAUNCH_HARDENING_SONNET_PROMPT.md | accurate (prompt template) | Acceptance criteria still useful; not a status report. |
| docs/CLAUDE_PHASE_0x_*.md, BRAIN_*, LEADGEN_*, STRATEGY_BUILDER_* | historical / out-of-scope | Phase/feature docs for gated or completed work. Not launch-feature truth. |
| docs/archive/* | stale (expected) | No action. |

## Corrections Made This Audit

- Created code-verified launch docs: `LAUNCH-DATA-PIPELINE.md`, `CREATIVE-BRIEF-DELIVERABLES-WIRING.md`, `ADMIN-DASHBOARD-DATA-MAP.md`, `PRODUCTION-LAUNCH-CHECKLIST.md`.
- Corrected two over-stated duplicate-run claims from intermediate analysis:
  - KB embedding is **not** double-called on reindex (status-filtered in `embed.js:156`); also out of launch scope.
  - Studio render duplicate enqueue is **handled** by `createRenderJob` window dedupe (`studio-render-jobs.cjs:64–90`).
- Confirmed one real (minor) finding: user brief-run routes lack an "already-running" atomic guard.
- Appended a launch-scope cross-reference section to PRODUCTION-READINESS-TRACKER.md.

## Archive Action — DONE 2026-06-23

Moved to `docs/archive/2026-06-23-stale-root-docs/` (with an index README explaining each): ACTION-PLAN.md, FULL-AUDIT-REPORT.md, FABLE5-REBUILD-PROMPT.md, FABLE5-REPO-MANIFEST.md, FABLE5-SCAFFOLD-PROMPT.md, docs/PRODUCTION_HARDENING_PLAN.md. `README.md` was rewritten (not archived) to point at the SSOT. `GEO-ANALYSIS.md` kept (current SEO doc).

Canonical source of truth created: `/SOURCE-OF-TRUTH.md` — every claim tagged `✓code file:line` / `⚠ops` / `▢scope`.
