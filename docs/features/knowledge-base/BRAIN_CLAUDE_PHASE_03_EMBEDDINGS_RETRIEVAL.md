# Brain Phase 3 - Embeddings And Retrieval

## Goal

Add embeddings and semantic retrieval. New ingests should embed chunks, Firestore should store vectors, search should use Firestore native vector search, and existing chunks should be reindexable.

Do not wire Strategy Builder yet.

## Required Reading

- `docs/BRAIN_FEATURE_PLAN.md`
- Phase 1 implementation files under `features/knowledge-base/`
- Phase 1 API routes under `app/api/dashboard/knowledge-base/`
- Firebase Firestore vector search docs for current Admin SDK usage

## Approval Gate

Stop before implementation unless a human has approved:

- embedding provider
- model
- env key name

Supported defaults:

- Voyage: `voyage-3`, 1024 dimensions, `VOYAGE_API_KEY`
- OpenAI: `text-embedding-3-small`, 1536 dimensions, `OPENAI_API_KEY`
- Vertex: only if deployment constraints require it

No embedding SDKs may be added.

## Agent Operating Model

- Lead Agent owns provider adapter, retrieval path, and final patch.
- Explorer Agent may inspect Firestore vector APIs and current Firebase helper usage.
- Worker Agent may edit only files listed in this prompt.
- Reviewer Agent verifies vector storage, client isolation, and search relevance.

## Files In Scope

Create:

- `features/knowledge-base/embed.js`
- `features/knowledge-base/retrieval.js`
- `app/api/dashboard/knowledge-base/search/route.js`
- `app/api/dashboard/knowledge-base/reindex/route.js`

Edit:

- Phase 1 ingest routes/utilities to embed chunks before marking an item `ready`.
- `features/knowledge-base/store.js` if needed for vector fields and status updates.

Do not edit Strategy Builder files.

## Implementation Requirements

- Use direct `fetch()` to the approved embedding provider.
- Read API key from the approved server env var only.
- Never expose API keys to client code.
- Batch embedding calls with a small custom concurrency limiter.
- Do not add `p-limit` unless separately approved.
- Store embedding metadata on chunk docs:
  - `embedding`
  - `embeddingProvider`
  - `embeddingModel`
  - `embeddingDimensions`
  - `embeddingStatus`
  - `embeddingError`
  - `embeddedAt`
- Use Firestore `findNearest()` with cosine distance.
- Pre-filter by `clientId` before vector search.
- Return clear errors for missing env vars, provider failures, and missing Firestore vector indexes.

## API Contracts

`POST /api/dashboard/knowledge-base/search`

- Request: `{ "query": string, "topK"?: number }`
- Clamp `topK` to 1-10; default 5.
- Response success: `{ "ok": true, "chunks": object[] }`

`POST /api/dashboard/knowledge-base/reindex`

- Request: `{ "itemId"?: string }`
- Response success: `{ "ok": true, "reindexed": number, "failed": number }`

## OSS Policy

- Direct `fetch()` only.
- No embedding SDKs.
- No LangChain or LlamaIndex.
- No vector DB packages.
- Optional `p-limit` is not allowed unless approved separately.

## Acceptance Criteria

- New text and URL ingests store embeddings.
- Search returns semantically relevant chunks for the current client only.
- Reindex embeds existing pending or failed chunks.
- Missing vector index errors are actionable.
- No Strategy Builder changes are made.

## Verification

- Run focused tests for embedding/retrieval helpers if mocked tests are practical.
- Run `npm run test` if practical.
- Manually verify search endpoint with at least two seeded knowledge items.
- Confirm no client-side bundle imports embedding code.

## Stop Point

When Phase 3 is complete, summarize:

- provider/model/env used
- files changed
- vector index requirements
- tests run
- risks or follow-ups

Then stop and wait for approval before Phase 4.
