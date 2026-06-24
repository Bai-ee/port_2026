# Brain Feature Plan

## Summary

The Brain feature is a per-client knowledge base for the dashboard. It ingests pasted text, URLs, PDFs, DOCX files, and common text-like files, stores source metadata and searchable chunks in Firestore, retrieves the top matching chunks with Firestore native vector search, and exposes the result to Strategy Builder through the `knowledge-base` source toggle.

The feature is intentionally small for v1: no separate vector database, no RAG framework, no crawler, no raw-document prompt injection, and no client-side data trust.

## Public Interfaces And Invariants

- API namespace: `app/api/dashboard/knowledge-base/`
- Feature utilities: `features/knowledge-base/`
- Dashboard card: `components/dashboard/KnowledgeBaseCard.jsx`
- Card subcomponents: `components/dashboard/knowledge-base/`
- Source key: `knowledge-base`
- Stable DOM IDs: `kb-*`
- v1 item cap: 100 items per client
- Retrieval cap: topK=5 chunks
- Strategy prompt cap: hard character cap, default target 2500-3500 characters
- Route timeout: `export const maxDuration = 60`
- Client isolation: all routes resolve `clientId` from auth/context server-side
- Strategy Builder boundary: no changes outside Phase 4

## Current Repo Compatibility

The product concept mentions `client_configs/{clientId}.strategyBuilder.sources`, but the current repo saves Strategy Builder config under `dashboard_state/{clientId}.strategyBuilder.config.sources` through `app/api/dashboard/strategy-builder/config/route.js`. The Brain implementation should follow current repo behavior by default. A migration to `client_configs` requires separate explicit approval and compatibility planning.

## Firestore And Storage Model

Items:

- Path: `knowledge_base/{clientId}/items/{itemId}`
- Fields:
  - `clientId: string`
  - `title: string`
  - `type: 'text'|'url'|'pdf'|'docx'|'file'`
  - `sourceUrl: string|null`
  - `status: 'ready'|'processing'|'error'`
  - `error: string|null`
  - `chunkCount: number`
  - `charCount: number`
  - `storagePath: string|null`
  - `fileName: string|null`
  - `contentType: string|null`
  - `sizeBytes: number|null`
  - `documentParser: string|null`
  - `documentPages: number|null`
  - `documentWarnings: string[]`
  - `createdAt: Firestore Timestamp`
  - `updatedAt: Firestore Timestamp`

Chunks:

- Path: `knowledge_base/{clientId}/chunks/{chunkId}`
- Fields:
  - `clientId: string`
  - `itemId: string`
  - `position: number`
  - `text: string`
  - `tokenEstimate: number`
  - `charCount: number`
  - `sourceTitle: string`
  - `sourceUrl: string|null`
  - `embedding: vector|null`
  - `embeddingProvider: string|null`
  - `embeddingModel: string|null`
  - `embeddingDimensions: number|null`
  - `embeddingStatus: 'pending'|'embedded'|'error'`
  - `embeddingError: string|null`
  - `createdAt: Firestore Timestamp`
  - `embeddedAt: Firestore Timestamp|null`

Storage:

- Raw uploaded-file path: `knowledge-base/{clientId}/{itemId}.{ext}`
- Storage is introduced only in Phase 5.

## OSS Tooling Policy

Use:

- `cheerio`, already installed, for Phase 1 URL extraction.
- Custom chunking in `features/knowledge-base/chunk.js`.
- Direct `fetch()` for embeddings.
- Firestore native vector search for retrieval.
- `pdf-parse` in Phase 5 for PDFs only after approval.
- `mammoth` in Phase 5 for DOCX only after approval.

Avoid for v1:

- LangChain
- LlamaIndex
- Pinecone
- Weaviate
- Unstructured
- Firecrawl
- full site crawlers
- embedding provider SDKs

Optional future upgrades:

- `@mozilla/readability` plus `linkedom` for better URL article extraction if Cheerio is not good enough.
- IBM Docling for premium document/PDF parsing if PDFs become core and a heavier Python-oriented path is acceptable.
- `p-limit` only if custom concurrency limiting proves insufficient and dependency approval is granted.

## Phase 1: Storage And Ingest Backbone

Goal: Add server-side storage utilities, chunking, text ingest, URL ingest, list, and delete. No UI, embeddings, Strategy Builder wiring, or PDFs.

Create:

- `features/knowledge-base/chunk.js`
- `features/knowledge-base/store.js`
- `features/knowledge-base/url.js`
- `app/api/dashboard/knowledge-base/ingest-text/route.js`
- `app/api/dashboard/knowledge-base/ingest-url/route.js`
- `app/api/dashboard/knowledge-base/items/route.js`
- `app/api/dashboard/knowledge-base/items/[itemId]/route.js`

API:

- `POST /api/dashboard/knowledge-base/ingest-text`
  - Request: `{ "title"?: string, "text": string }`
  - Response: `{ "ok": true, "item": object, "chunkCount": number }`
- `POST /api/dashboard/knowledge-base/ingest-url`
  - Request: `{ "url": string, "title"?: string }`
  - Response: `{ "ok": true, "item": object, "chunkCount": number }`
- `GET /api/dashboard/knowledge-base/items`
  - Response: `{ "ok": true, "items": object[], "limits": { "maxItems": 100, "remaining": number } }`
- `DELETE /api/dashboard/knowledge-base/items/{itemId}`
  - Response: `{ "ok": true, "deletedChunks": number }`

Acceptance:

- Authenticated text and URL ingest create one item and chunk documents.
- Item cap blocks item 101.
- List returns only the current client's items.
- Delete removes item and child chunks.

## Phase 2: Card UI

Goal: Add the Knowledge Base dashboard card and modal UI for adding pasted text/URLs and managing items.

Create:

- `components/dashboard/KnowledgeBaseCard.jsx`
- `components/dashboard/knowledge-base/AddItemPanel.jsx`
- `components/dashboard/knowledge-base/ItemsList.jsx`

Edit:

- `DashboardPage.jsx`

Acceptance:

- Dashboard can open the Knowledge Base card.
- User can add pasted text and URLs through UI.
- User can list and delete items.
- DOM IDs are stable and prefixed with `kb-`.
- UI follows existing dashboard design tokens and tab/card patterns.

## Phase 3: Embeddings And Retrieval

Goal: Embed chunks on ingest, store Firestore vectors, search semantically, and reindex old chunks.

Create:

- `features/knowledge-base/embed.js`
- `features/knowledge-base/retrieval.js`
- `app/api/dashboard/knowledge-base/search/route.js`
- `app/api/dashboard/knowledge-base/reindex/route.js`

Edit:

- Phase 1 ingest routes/utilities to embed chunks before marking an item ready.

API:

- `POST /api/dashboard/knowledge-base/search`
  - Request: `{ "query": string, "topK"?: number }`
  - Response: `{ "ok": true, "chunks": object[] }`
- `POST /api/dashboard/knowledge-base/reindex`
  - Request: `{ "itemId"?: string }`
  - Response: `{ "ok": true, "reindexed": number, "failed": number }`

Approval gate:

- Choose embedding provider and env key before implementing embeddings:
  - Voyage `voyage-3`, 1024 dimensions, env `VOYAGE_API_KEY`
  - OpenAI `text-embedding-3-small`, 1536 dimensions, env `OPENAI_API_KEY`
  - Vertex, only if Firebase/GCP deployment constraints require it

Acceptance:

- New chunks get embeddings.
- Semantic search returns relevant chunks for the authenticated client only.
- Reindex endpoint embeds existing pending chunks.
- Missing vector index errors are clear and actionable.

## Phase 4: Strategy Builder Wiring

Goal: Add Knowledge Base as a toggleable Strategy Builder source with minimal changes.

Edit:

- `app/api/dashboard/strategy-builder/generate/route.js`
- `features/strategy-builder/prompt.js`
- `features/strategy-builder/schemas.js`
- `components/dashboard/strategy-builder/InputsPane.jsx`
- `DashboardPage.jsx` only if card-open routing needs adjustment

Behavior:

- Add `knowledgeBase` to StrategyContext docs.
- If `srcOn('knowledge-base')`, retrieve top 5 chunks server-side using strategy context as the search query.
- Add a compact `KNOWLEDGE BASE` prompt block with hard character cap.
- Add a `knowledge-base` row to `DATA_SOURCES`.
- If toggle is disabled, no retrieval is performed and no KB context is injected.

Approval gate:

- Start only after Phase 3 is verified.
- Any toggle-storage migration must be approved separately.

Acceptance:

- Toggle on includes KB context in Strategy Builder generation.
- Toggle off excludes KB context.
- Generated plan validates as before.
- Strategy Builder changes remain minimal and scoped.

## Phase 5: Document Upload Ingest

Goal: Add file upload, Firebase Storage persistence, text extraction, chunking, embedding, search, and Strategy Builder availability for PDFs, DOCX files, and common text-like files.

Create:

- `features/knowledge-base/document.js`
- `app/api/dashboard/knowledge-base/upload/route.js`

Edit:

- `package.json` and lockfile only after parser dependency approval.
- `components/dashboard/KnowledgeBaseCard.jsx`
- `components/dashboard/knowledge-base/AddItemPanel.jsx`
- storage helpers as needed.

Approval gate:

- Approve `pdf-parse` installation before Phase 5 starts.
- Approve `mammoth` installation before DOCX support starts.
- Confirm v1 file size cap, default recommendation: 10 MB.

Acceptance:

- File upload stores raw file in Firebase Storage.
- Extracted text is chunked and embedded.
- PDF, DOCX, and text-like chunks are searchable.
- Strategy Builder can retrieve uploaded-file-derived chunks when Knowledge Base is enabled.

## Cross-Phase Test Plan

- Run focused unit tests for chunking and extraction helpers where practical.
- Run `npm run test` when changes touch reusable feature utilities.
- Run `npm run build` after UI or route integration phases when feasible.
- Manually verify authenticated API behavior with current dashboard auth patterns.
- In UI phases, verify layout and DOM IDs in browser at desktop and mobile widths.

## Rollout Notes

- Ship Phase 1 and Phase 2 without embeddings so item management can be validated early.
- Do not expose Strategy Builder wiring until search relevance is proven in Phase 3.
- Keep all dependency changes behind explicit approval gates.
- Keep raw content out of prompts except top retrieved chunks under cap.
