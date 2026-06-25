# Docs

Organized by function. **The active source of truth lives in [`source-of-truth/`](source-of-truth/SOURCE-OF-TRUTH.md)** — start there. The rest of this folder holds supporting, feature, and historical docs.

| Folder | What's in it |
|---|---|
| `source-of-truth/` | **Active canonical docs** — SSOT, launch pipeline/wiring/checklist, readiness tracker, docs-accuracy report. Start here. |
| `company-brain/` | Gated Client Brain docs — reusable client context schema, source toggles, card spec, downstream usage, and Bryan example seed. |
| `launch/` | Production readiness / hardening playbooks, prelaunch prompts, the docs-audit plan, signup-launch plan. |
| `dashboard-ui/` | Dashboard modal/card/terminal UI guides, style guides, wireframes (`.html`), card-description system. |
| `pipeline/` | Modular card pipeline specs, client intelligence layer, `CLAUDE_PHASE_*` runtime/worker/state/admin docs, dataflow, scout analyzer skills. |
| `features/` | Per-feature docs: `knowledge-base/` (BRAIN_*), `leadgen/`, `strategy-builder/`, `lazyweb/`, `studio/`, `marketing-brief/`, `onboarding/`. |
| `brand/` | Brand guide v2 + generation toggles. |
| `seo/` | GEO/AI-search analysis, AI-SEO prompts. |
| `audits/` | Client-specific operational audits (bai-ee-*, x-algo review). |
| `diagnostics/` | Throwaway/generated artifacts moved out of `scripts/` (render `.webm`, diag screenshots, generated brief `.html`). Regenerable; safe to delete. |
| `plans/` | Existing planning docs. |
| `storyboards/` | Existing storyboard assets. |
| `archive/` | Superseded/historical docs. `archive/2026-06-23-stale-root-docs/` holds root docs retired in the 2026-06-23 audit. |

Anything here not linked from [`source-of-truth/SOURCE-OF-TRUTH.md`](source-of-truth/SOURCE-OF-TRUTH.md) should be treated as historical/reference until verified against current code.
