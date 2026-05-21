# Brain Feature — Master Prompt for Claude Code CLI

> **Usage:** Copy everything below the line into Claude Code CLI (Opus) from the repo root.
> It will produce a phased execution plan with file-level specifics, then pause for your approval before writing any code.

---

```
You are planning the "Brain" feature — a per-client knowledge base that ingests whitepapers, URLs, and pasted text, then exposes its contents to the existing Strategy Builder as one more toggleable data source. Your job is to produce a detailed, phased implementation plan. DO NOT write any code yet — output the plan only, then wait for my approval on each phase before executing.

## 1. PROJECT CONTEXT

This is a Next.js 16 app (App Router, ES modules) with React 19, Firebase/Firestore (`firebase-admin` v13), and Claude Sonnet via `@anthropic-ai/sdk`. The app is a multi-tenant SaaS dashboard for social media strategy generation. Each client has isolated data under `dashboard_state/{clientId}` and `client_configs/{clientId}`.

The Strategy Builder is FROZEN AND VERIFIED across 5+ phases (see docs/STRATEGY_BUILDER_PLAN.md). It generates 30-day social media posting plans by aggregating multiple data sources, sending them to Claude, and validating the structured JSON output. Everything works end-to-end including auto-posting to Twitter/X.

## 2. EXISTING PATTERNS YOU MUST FOLLOW

### Source toggle pattern (generate/route.js)
Sources are gated by a per-client enable map stored at `client_configs/{clientId}.strategyBuilder.sources`:
```js
const sourceMap = clientConfig.sources || {};
const srcOn = (key) => sourceMap?.[key]?.enabled !== false;
// Example: const seo = srcOn('seo-performance') ? { summary, topics } : null;
```
The Brain becomes source key `knowledge-base`, following this exact pattern.

### InputsPane.jsx DATA_SOURCES array
Each source is an object in the array:
```js
{ key: 'knowledge-base', label: 'Knowledge Base', card: 'knowledge-base', readiness: (ds) => /* check */ }
```
Renders as a toggle row with readiness chip (ready/partial/empty) and an open-card button.

### DashboardPage.jsx card registration
Cards are dynamically imported:
```js
const KnowledgeBaseCard = dynamic(() => import('./components/dashboard/KnowledgeBaseCard'), { loading: () => null, ssr: false });
```
And included in ONBOARDING_CARD_IDS if needed.

### prompt.js injection
Data sources are conditionally injected as compact text blocks with character caps. Example:
```js
const seoBlock = seo ? [seo.summary, line(seo.topics, 6)].filter(Boolean).join(' · ') : '';
```
The knowledge base block should follow this pattern: top-K chunks concatenated with a hard character cap, never raw documents.

### StrategyContext shape
The context object passed to prompt building includes: client, brand, brief, intelligence, media, seo, cardFindings, campaign, signals, config, sources. The Brain adds one new field.

## 3. TECH DECISIONS (CONFIRMED)

### Firestore native vector search — USE THIS, not Pinecone/Weaviate
Firestore supports native vector embeddings and `findNearest()` for nearest-neighbor search. This is the retrieval layer. Key details:
- Max 2048 dimensions supported
- Node.js `firebase-admin` supports `findNearest()` with cosine distance
- Pre-filtering with `.where('clientId', '==', clientId)` before vector search gives per-client isolation
- Handles thousands of vectors per client with no performance issues
- No separate vector DB needed

### Embeddings — plain fetch(), no SDK
Call Voyage AI (`voyage-3`, 1024 dims) or OpenAI (`text-embedding-3-small`, 1536 dims) embeddings endpoint via `fetch()`. Zero new package.json dependencies. Approval gate: which provider + where the API key lives in env.

### PDF parsing — approval gate at Phase 5
`pdf-parse` is the cheapest option (~one dep, no native build). Do not add until Phase 5, and flag it as an approval gate.

### URL scraping — cheerio is ALREADY in package.json
Cheerio v1.0.0 is already installed. No new dependency needed for HTML parsing.

### Storage
- Firestore `knowledge_base/{clientId}/items/{itemId}` — item metadata (title, type, sourceUrl, status, createdAt)
- Firestore `knowledge_base/{clientId}/chunks/{chunkId}` — chunk text, embedding vector, parent itemId, position
- Firebase Storage `knowledge-base/{clientId}/{itemId}.*` — raw file uploads (PDFs in Phase 5)

## 4. CONSTRAINTS

- **Do not rebuild or modify the Strategy Builder** except the minimal wiring in Phase 4 (one source branch in generate/route.js, one row in InputsPane, one block in prompt.js, one field in StrategyContext).
- **No silent dependency additions.** Every new package requires explicit approval before installation. Currently there are exactly 20 dependencies in package.json — keep it tight.
- **Cap items at 100 per client for v1.** Cap individual chunk length. Flag when approaching limits.
- **Top-K = 5 chunks with hard character cap** when injecting into strategy prompt. Never raw documents.
- **Follow existing design system:** accent #4ade80, surfaces rgba(255,255,255,0.04-0.12), text #e5e5e5/#888/#666, monospace font, uppercase labels at 0.08em letter-spacing, `tile-detail-tab` classes.
- **Stable DOM IDs** using kebab-case prefixed with `kb-` for testability.
- **All API routes under** `app/api/dashboard/knowledge-base/` with 60s default timeout.
- **Server-side only** for all Firestore reads/writes and embedding calls. Never trust client-supplied knowledge data.

## 5. PHASE STRUCTURE TO PLAN

Plan these phases with file-level detail (exact paths, function signatures, Firestore schema). Each phase should list: files created, files edited, Firestore collections/fields touched, API endpoints added, approval gates, and acceptance criteria.

### Phase 1: Storage + Ingest Backbone
- Firestore schema for items + chunks collections
- Chunking utility (features/knowledge-base/chunk.js) — split text into ~500-token chunks with overlap
- Ingest API routes: paste-text ingest, URL ingest (fetch + cheerio extract + chunk)
- List items API, delete item API (cascade delete chunks)
- No UI, no embeddings, no strategy wiring, no PDF
- Acceptance: can ingest text and URLs via API, chunks stored in Firestore, list and delete work

### Phase 2: Card UI
- KnowledgeBaseCard.jsx — tile + modal following existing card shell pattern
- AddItemPanel.jsx — paste text / enter URL input
- ItemsList.jsx — list items with status, delete action
- Wire into DashboardPage.jsx card registration
- Follow existing design tokens, stable kb-* DOM IDs
- Acceptance: can add items via UI, see them listed, delete them

### Phase 3: Embeddings + Retrieval
- Embed chunks on ingest (features/knowledge-base/embed.js)
- Store embedding vectors in chunk documents
- Query-time embedding of search/strategy context
- `findNearest()` retrieval with cosine distance, top-K=5
- Reindex API endpoint for re-embedding existing chunks
- APPROVAL GATE: which embedding provider (Voyage vs OpenAI vs Vertex) + env key name
- Acceptance: semantic search returns relevant chunks for a query

### Phase 4: Strategy Builder Wiring
- New `knowledge-base` source branch in generate/route.js aggregator
- New field in StrategyContext
- New compact block in prompt.js with character cap
- New source row in InputsPane.jsx DATA_SOURCES array
- Per-client toggle works end-to-end: enable → generate includes KB context → disable → excluded
- APPROVAL GATE: approve after Phase 3 verified
- Acceptance: generated strategy references knowledge base content when enabled, ignores when disabled

### Phase 5: PDF Ingest
- Add pdf-parse dependency (approval gate)
- Upload route accepting PDF via FormData
- Store raw PDF in Firebase Storage
- Extract text → chunk → embed pipeline
- APPROVAL GATE: approve pdf-parse dep before starting
- Acceptance: upload a PDF, see it chunked and searchable, strategy can reference its content

## 6. OUTPUT FORMAT

For each phase, produce:
1. **Files to create** — exact paths, purpose, key exports/functions
2. **Files to edit** — exact paths, what changes, which lines/functions affected
3. **Firestore schema** — collection paths, document fields with types
4. **API endpoints** — method, path, request/response shape, timeout
5. **Approval gates** — what needs sign-off before starting
6. **Acceptance criteria** — how to verify the phase works
7. **Risks** — what could go wrong and mitigation

Do NOT write code. Produce the plan, then stop and wait for my go-ahead on Phase 1.
```
