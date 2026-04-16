# AI SEO Audit — Codex Handoff Prompt

Paste this as the first message to a fresh Codex session. Do not strip sections — the whole prompt is the contract.

---

## Role

You are an implementer working across two repos in a single monorepo checkout at `/Users/bballi/Documents/Repos/Bballi_Portfolio/`:

1. `ai-seo-audit/` — a Node.js engine performing AI/GEO visibility audits
2. The parent `Bballi_Portfolio` repo — a Next.js scout-intake pipeline + dashboard that will consume the engine's output

Your primary goal is to make the ai-seo-audit engine a **first-class analyzer inside the scout-intake SEO pipeline** — its findings surface on the dashboard SEO + Performance card across PROBLEMS / SOLUTIONS / DATA tabs, Scribe copy, and the card's front-facing ring visual. The standalone CLI and Express API are secondary surfaces.

## Source of truth

The canonical brief is:

**[`docs/CODEX_PROMPT_AI_SEO.md`](docs/CODEX_PROMPT_AI_SEO.md)**

Read it in full before doing anything. **Section 0 is the integration contract and is non-negotiable** — every later task must honor it. If you find conflicts between the brief and the code, surface them in your restate-before-acting step. Do not silently drift.

## Hard operating rules

1. **Read Section 0 of the brief first.** It defines the engine export signature, skill output contract, stable finding ids, aiVisibility block, catalog coverage requirement, pipeline integration point, and dashboard visual integration. Every task depends on you internalizing Section 0.

2. **Phases are hard stops.** The brief lays out 4 phases:
   - **Phase 1 — Engine quality:** Tasks 1, 3, 4, then 2
   - **Phase 2 — Integration (mandatory):** Tasks 10, 11, 12
   - **Phase 3 — Surfaces:** Tasks 5, 6, 8
   - **Phase 4 — API + tests:** Tasks 7, 9

   Execute one phase at a time. After each phase's acceptance criteria pass, report and stop for human approval. Do not start the next phase unless explicitly told to. Do not "while I'm in here" touch a later phase's code.

3. **Restate before acting.** Before any non-trivial change, write a 1–2 sentence restatement of the phase and the first step you will take.

4. **Preserve public contracts.** The `runAiSeoAudit` export signature, the skill output shape, stable finding ids, pipeline `analyzerOutputs[cardId]` shape, and Scribe's tool schema stay stable. Additive changes only unless the brief explicitly specifies a contract change.

5. **Non-fatal everywhere.** Every new call (HTTP fetch, playwright launch, pipeline stage) must be wrapped so a failure does NOT fail the caller. Record a warning and continue. The scout-intake pipeline's resilience guarantee (always returns `status: 'succeeded'` with whatever data it has plus warnings) MUST be preserved.

6. **Feature flag `AI_SEO_AUDIT_ENABLED`** gates the pipeline stage. When unset or `0`, the pipeline runs byte-for-byte identically to pre-integration behavior.

7. **Commit per section.** Message format: `ai-seo-audit/task-N: <verb> <deliverable>`. Example: `ai-seo-audit/task-10: wire engine into scout-intake pipeline`. Do not batch unrelated changes.

8. **No new paid dependencies.** node-fetch, cheerio, express (for the API wrapper), and optionally playwright are the full approved list. Playwright must be `optionalDependencies` + a runtime try/catch import, not a hard requirement. Do not add anything else without explicit approval.

9. **SSRF + abuse protection on the Express API (Task 7).** The `/audit?url=...` endpoint MUST reject private IP ranges, localhost, and cloud metadata endpoints (`169.254.169.254`, `100.100.100.200`, etc.). Scheme allowlist: `https`, `http` only. Add basic rate limiting (e.g., 10 req/min per IP). Do not expose the endpoint without these guards.

10. **Wikidata etiquette.** Set a descriptive `User-Agent: BballiAiSeoAudit/1.0 (mailto:<contact>)` on every Wikidata request. Cache responses in memory for the duration of a single audit run — don't re-query the same QID twice.

11. **No LLM calls in this engine.** The ai-seo-audit tool is deterministic — it uses node-fetch + cheerio + optional playwright only. If you're tempted to "just use Claude for this," stop and re-read the brief. The `model: 'native'` in metadata is load-bearing.

## Read before you touch

Read these in order — they define the current world:

**The brief and integration points (mandatory):**
1. [`docs/CODEX_PROMPT_AI_SEO.md`](docs/CODEX_PROMPT_AI_SEO.md) — full brief with Section 0 integration contract
2. [`features/scout-intake/skills/_output-contract.js`](features/scout-intake/skills/_output-contract.js) — the output shape every finding must validate against
3. [`features/scout-intake/skills/_aggregator.js`](features/scout-intake/skills/_aggregator.js) — how multi-skill outputs merge per card
4. [`features/scout-intake/solutions-catalog.mjs`](features/scout-intake/solutions-catalog.mjs) — authored catalog pattern for Task 11

**Pipeline context (skim these):**
5. [`features/scout-intake/runner.js`](features/scout-intake/runner.js) — orchestrator. Note the PSI stage pattern (around line 394) — Task 10's new stage follows the same shape.
6. [`features/scout-intake/scribe.js`](features/scout-intake/scribe.js) — consumes `analyzerOutputs[cardId].aggregate`; confirm you understand the confidence/readiness mapping
7. [`features/scout-intake/normalize.js`](features/scout-intake/normalize.js) — threads the pipeline result into the Firestore shape the dashboard reads
8. [`api/_lib/run-lifecycle.cjs`](api/_lib/run-lifecycle.cjs) — `buildDashboardProjection` exposes the final shape to the client

**Dashboard (for Task 12):**
9. [`DashboardPage.jsx`](DashboardPage.jsx) — find `renderSeoViz` (module-scope function, takes `seoAudit` as param); Task 12 adds a 5th ring and DATA-tab section. Also review the P7 analyzer rendering around PROBLEMS/SOLUTIONS tabs — those consume the aggregate automatically once your findings are correctly shaped.

**Current engine (the subject of the work):**
10. `ai-seo-audit/src/audit.js` — orchestrator you'll refactor into a pure export in Task 10
11. `ai-seo-audit/src/llmsTxtValidator.js`
12. `ai-seo-audit/src/robotsAiParser.js`
13. `ai-seo-audit/src/schemaExtractor.js`
14. `ai-seo-audit/src/contentExtractability.js`

## Reporting format

**Before editing (each phase):**

```
## Scope
<what this phase delivers in 1-2 sentences>

## Files likely affected
- ai-seo-audit/<files>
- features/scout-intake/<files>
- DashboardPage.jsx, etc.

## Risks
<what could break>

## First step
<what you will do first — usually: read and map the current state>

Proceeding.
```

**After editing (each phase):**

```
## Files changed
<list with 1-line description each>

## Exact behavior changed
<2-4 sentences — diagnostic, not narrative>

## What stayed untouched
<1-2 sentences — explicitly call out contracts you preserved>

## Verification run
<what you ran and the result (tests, CLI invocations, etc.)>

## Manual test next
<what Bryan should check>

## Risks / not verified
<list — be honest>

Waiting for approval to proceed to Phase <N+1>.
```

## Phase map

| Phase | Tasks | Gate |
|---|---|---|
| 1 | Engine quality — Tasks 1, 3, 4, then 2 | Engine emits contract-conformant output for test URLs; all four modules have hardened logic |
| 2 | **Integration (mandatory)** — Tasks 10, 11, 12 | Live pipeline run populates `analyzerOutputs['seo-performance'].skills['ai-seo-audit']`; every finding id in Section 0.3 has a catalog entry; dashboard renders 5th ring + new DATA section |
| 3 | Surfaces — Tasks 5, 6, 8 | CLI format flags work; compare mode produces side-by-side output; llms.txt generator emits spec-valid files |
| 4 | API + tests — Tasks 7, 9 | Express server running with SSRF guard + rate limit; unit + integration tests pass via `npm test` |

## Environment

- Node 18+ ESM at the parent repo. `ai-seo-audit/` is its own package (see its package.json).
- Parent repo env vars: `ANTHROPIC_API_KEY` (already set), `PAGESPEED_API_KEY` (for PSI — not required for AI SEO), `SCOUT_ANALYZER_SKILLS_ENABLED=1`, NEW `AI_SEO_AUDIT_ENABLED` (defaults on when the engine is installed).
- Local dev: check `package.json` for the start command. The dashboard runs via `npm run dev`.
- Commit to the current working branch. Do not push. Do not open a PR unless explicitly asked.

## Out of scope

- LLM calls from inside the ai-seo-audit engine (deterministic only)
- Paid API dependencies beyond the approved list
- Changes to card contract, scribe tool schema, or aggregator logic (the aggregator already handles multi-skill — your job is to produce correctly shaped output it can consume)
- Design polish on the dashboard card beyond what's needed for the 5th ring + DATA rows to be legible
- Refactoring `seo-depth-audit.md` or any other existing skill
- Changing Scribe's model or core prompt structure

## First action

Restate Phase 1 scope. List the first 2–3 files you'll read. Produce the pre-editing report block. Then proceed with Phase 1 (Tasks 1, 3, 4, 2 in that order). Stop at the phase boundary.
