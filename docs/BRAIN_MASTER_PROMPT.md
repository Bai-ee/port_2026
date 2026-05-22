# Brain Feature - Master Prompt for Claude Code CLI

> Usage: copy everything below the line into Claude Code CLI from the repo root.
> This is the master orchestration prompt. It should read `docs/BRAIN_FEATURE_PLAN.md`,
> use the phase prompts in `docs/BRAIN_CLAUDE_PHASE_INDEX.md`, and stop at every
> phase gate for human approval.

---

```text
You are implementing the Brain feature: a per-client knowledge base that ingests pasted text, URLs, PDFs, DOCX files, and common text-like files, then exposes retrieved knowledge-base context to the existing Strategy Builder as one more toggleable data source.

Your job is to complete the feature start to finish using the gated phase prompts in this repository. Do not skip phases. Do not continue to the next phase until the current phase is implemented, verified, summarized, and explicitly approved.

## Required Reading

Read these files first:

1. docs/BRAIN_FEATURE_PLAN.md
2. docs/BRAIN_CLAUDE_PHASE_INDEX.md
3. docs/STRATEGY_BUILDER_PLAN.md
4. The phase prompt for the phase you are executing.

Also inspect the current repo before editing. In particular:

- Dashboard shell: DashboardPage.jsx
- Strategy Builder card: components/dashboard/StrategyBuilderCard.jsx
- Strategy Builder inputs: components/dashboard/strategy-builder/InputsPane.jsx
- Strategy Builder generation route: app/api/dashboard/strategy-builder/generate/route.js
- Strategy Builder config route: app/api/dashboard/strategy-builder/config/route.js
- Prompt builder: features/strategy-builder/prompt.js
- Strategy context docs: features/strategy-builder/schemas.js
- Firebase Admin helper: api/_lib/firebase-admin.cjs
- Auth/client context pattern: existing app/api/dashboard/** route handlers

## Project Context

This is a Next.js 16 App Router app using ES modules, React 19, Firebase/Firestore through firebase-admin v13, and Claude Sonnet through @anthropic-ai/sdk. The app is a multi-tenant SaaS dashboard for social media strategy generation. Client data is isolated by server-resolved clientId.

The Strategy Builder is frozen and verified. It generates 30-day social media posting plans by aggregating server-side data sources, sending compact context to Claude, and validating structured JSON output. Do not rebuild it.

## Repo-Correct Paths

Use these actual repo paths:

- Root dashboard page: DashboardPage.jsx
- Dashboard route wrapper: app/dashboard/page.jsx
- Dashboard card components: components/dashboard/
- Strategy Builder card: components/dashboard/StrategyBuilderCard.jsx
- Strategy Builder subcomponents: components/dashboard/strategy-builder/
- Strategy Builder route: app/api/dashboard/strategy-builder/generate/route.js
- Knowledge Base API namespace to add: app/api/dashboard/knowledge-base/
- Knowledge Base feature utilities to add: features/knowledge-base/

## Current Toggle Storage Caveat

The original product note says source toggles live at client_configs/{clientId}.strategyBuilder.sources. The current repo implementation saves Strategy Builder config, including sources, under dashboard_state/{clientId}.strategyBuilder.config.sources via app/api/dashboard/strategy-builder/config/route.js, and passes that config to generate/route.js.

Default implementation: follow the current repo behavior and do not migrate toggle storage.

If a human explicitly approves migration to client_configs, implement that as a separate planned change with compatibility handling. Do not sneak it into a Brain phase.

## Core Constraints

- Do not modify Strategy Builder outside Phase 4.
- In Phase 4, make only the minimal wiring: one source branch in generate/route.js, one field in StrategyContext docs, one compact prompt block, one InputsPane source row, and dashboard open-card support if needed.
- No silent dependency additions. Every new package requires explicit approval before installation.
- There are currently 20 top-level dependencies in package.json. Keep it tight.
- Use Firestore native vector search. Do not add Pinecone, Weaviate, Chroma, Supabase Vector, or another vector database.
- Embeddings use plain fetch() calls. Do not add embedding SDKs.
- All knowledge-base reads, writes, embedding calls, retrieval, and ownership checks are server-side.
- Never trust client-supplied clientId or client-supplied knowledge data.
- Cap v1 at 100 items per client.
- Retrieval cap is topK=5 chunks with a hard prompt character cap.
- Never inject raw documents into Strategy Builder prompts.
- All Knowledge Base API routes go under app/api/dashboard/knowledge-base/ and export maxDuration = 60.
- Stable DOM IDs must be kebab-case and prefixed with kb-.

## Recommended OSS Additions

Use open-source tools selectively:

- Use existing cheerio for Phase 1 URL extraction.
- Keep custom chunking in features/knowledge-base/chunk.js; do not add LangChain or LlamaIndex for v1.
- Phase 3 embeddings stay direct fetch() calls; no provider SDK.
- Phase 3 concurrency default is a small custom batch limiter. Optional p-limit only if explicitly approved.
- Phase 5 document upload uses pdf-parse for PDFs and mammoth for DOCX after approval; common text-like files use UTF-8 extraction with no extra parser.
- Future optional URL-quality upgrade: @mozilla/readability plus a DOM parser such as linkedom, only if Cheerio extraction quality is inadequate.
- Future optional premium PDF/document parsing: IBM Docling, not in v1 because it is heavier and Python-oriented.
- Explicitly avoid Pinecone, Weaviate, LangChain, LlamaIndex, Unstructured, Firecrawl, and full crawlers for v1 unless the architecture is intentionally reopened.

## Agent Operating Model

You may use agents, but preserve phase gates.

- Lead Agent owns the phase and final patch.
- Explorer Agent may inspect repo patterns and report paths/functions; read-only only.
- Worker Agent may implement scoped files for the current phase only.
- Reviewer Agent verifies diffs, tests, route behavior, and acceptance criteria.
- Agents must not modify Strategy Builder outside Phase 4.
- Agents must not add dependencies unless the phase prompt includes an approval gate that has already been satisfied.
- Each phase ends with: summarize changes, list tests run, list risks, and stop.

## Execution Rules

1. Start with docs/BRAIN_CLAUDE_PHASE_01_STORAGE_INGEST.md.
2. Execute exactly one phase at a time.
3. Verify acceptance criteria for that phase.
4. Summarize changed files and tests.
5. Stop and ask for approval before continuing.
6. If an approval gate is reached, stop before making the gated change.

Begin by reading docs/BRAIN_FEATURE_PLAN.md and docs/BRAIN_CLAUDE_PHASE_INDEX.md, then execute Phase 1 only.
```
