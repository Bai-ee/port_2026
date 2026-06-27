# Docs

Organized by function. **The active source of truth lives in [`source-of-truth/`](source-of-truth/SOURCE-OF-TRUTH.md)** — start there. The rest of this folder holds supporting, feature, and historical docs.

| Folder | What's in it |
|---|---|
| `source-of-truth/` | **Active canonical docs** — SSOT, launch pipeline/wiring/checklist, readiness tracker, docs-accuracy report. Start here. |
| `company-brain/` | Active gated Client Brain docs — locked Studio Intelligence Standard, Studio methodology, Markdown source standard, compiled runtime schema, decision acquisition, completion, playbooks, and Bryan workspace. |
| `launch/` | Production readiness / hardening playbooks, prelaunch prompts, the docs-audit plan, signup-launch plan. |
| `dashboard-ui/` | Dashboard modal/card/terminal UI guides, style guides, wireframes (`.html`), card-description system. |
| `pipeline/` | Modular card pipeline specs, client intelligence layer, `CLAUDE_PHASE_*` runtime/worker/state/admin docs, dataflow, scout analyzer skills. |
| `features/` | Per-feature docs: `editorial-strategy/`, `knowledge-base/` (BRAIN_*), `leadgen/`, `strategy-builder/`, `lazyweb/`, `studio/`, `marketing-brief/`, `onboarding/`. Start with each feature folder's `README.md` when present. |
| `brand/` | Brand guide v2 + generation toggles. |
| `seo/` | GEO/AI-search analysis, AI-SEO prompts. |
| `audits/` | Client-specific operational audits (bai-ee-*, x-algo review). |
| `diagnostics/` | Throwaway/generated artifacts moved out of `scripts/` (render `.webm`, diag screenshots, generated brief `.html`). Regenerable; safe to delete. |
| `plans/` | Existing planning docs. |
| `storyboards/` | Existing storyboard assets. |
| `archive/` | Superseded/historical docs. `archive/2026-06-23-stale-root-docs/` holds root docs retired in the 2026-06-23 audit. |

Anything here not linked from [`source-of-truth/SOURCE-OF-TRUTH.md`](source-of-truth/SOURCE-OF-TRUTH.md) or a feature folder `README.md` should be treated as historical/reference until verified against current code.

## Common Entry Points

- Client Brain / Company Brain: [`company-brain/README.md`](company-brain/README.md)
- Studio Intelligence Standard: [`company-brain/STUDIO_INTELLIGENCE_STANDARD.md`](company-brain/STUDIO_INTELLIGENCE_STANDARD.md)
- Company Brain Document Standard: [`company-brain/COMPANY_BRAIN_DOCUMENT_STANDARD.md`](company-brain/COMPANY_BRAIN_DOCUMENT_STANDARD.md)
- Brain document system visual map: [`dashboard-ui/brain-document-system.html`](dashboard-ui/brain-document-system.html)
- Editorial Strategy Standard: [`features/editorial-strategy/EDITORIAL_STRATEGY_STANDARD.md`](features/editorial-strategy/EDITORIAL_STRATEGY_STANDARD.md)
- HITLOOP Studio methodology: [`company-brain/HITLOOP_STUDIO_METHODOLOGY.md`](company-brain/HITLOOP_STUDIO_METHODOLOGY.md)
- Marketing Brief / Market Signals: [`features/marketing-brief/README.md`](features/marketing-brief/README.md)
- Editorial Strategy Engine: [`features/editorial-strategy/README.md`](features/editorial-strategy/README.md)
- Strategy Builder Editorial Pack tracking: [`source-of-truth/STRATEGY-BUILDER-EDITORIAL-PACK.md`](source-of-truth/STRATEGY-BUILDER-EDITORIAL-PACK.md)
- Strategy Builder upload example: [`features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json`](features/editorial-strategy/STRATEGY_BUILDER_CONFIG_PACK.example.json)
- Mockup Studio / render hosting: [`features/studio/README.md`](features/studio/README.md)
