# Brain Phase 1 - Storage And Ingest Backbone

## Goal

Implement the server-side backbone for the per-client Knowledge Base: chunking, Firestore item/chunk storage, pasted text ingest, URL ingest, list, and cascade delete.

Do not build UI, embeddings, PDF ingest, or Strategy Builder wiring in this phase.

## Required Reading

- `docs/BRAIN_FEATURE_PLAN.md`
- `api/_lib/firebase-admin.cjs`
- `api/_lib/auth.cjs`
- `api/_lib/client-provisioning.cjs`
- Existing authenticated route examples under `app/api/dashboard/`
- Existing Cheerio usage in `features/leadgen/content-scraper.js` or `features/leadgen/quick-auditor.js`

## Agent Operating Model

- Lead Agent owns implementation and final patch.
- Explorer Agent may inspect route/auth patterns and report exact helper usage.
- Worker Agent may edit only the files listed in this prompt.
- Reviewer Agent verifies API shapes, server-only client isolation, limits, and tests.

## Files In Scope

Create:

- `features/knowledge-base/chunk.js`
- `features/knowledge-base/store.js`
- `features/knowledge-base/url.js`
- `app/api/dashboard/knowledge-base/ingest-text/route.js`
- `app/api/dashboard/knowledge-base/ingest-url/route.js`
- `app/api/dashboard/knowledge-base/items/route.js`
- `app/api/dashboard/knowledge-base/items/[itemId]/route.js`

Optional tests:

- `features/knowledge-base/__tests__/chunk.test.js`

Do not edit Strategy Builder files.

## Implementation Requirements

- Resolve the authenticated client server-side using existing dashboard route patterns.
- Ignore any client-supplied `clientId`.
- Export `maxDuration = 60` from each route.
- Use Firestore paths:
  - `knowledge_base/{clientId}/items/{itemId}`
  - `knowledge_base/{clientId}/chunks/{chunkId}`
- Enforce 100 item cap per client before ingest.
- Chunk text into roughly 500-token chunks with overlap and a hard per-chunk character cap.
- URL ingest must use `fetch()` plus installed `cheerio`; do not add packages.
- URL extraction should remove scripts, styles, nav, footer, forms, and obvious boilerplate where practical.
- Delete must remove item and child chunks.
- Writes should use Firestore batches below batch limits.

## API Contracts

`POST /api/dashboard/knowledge-base/ingest-text`

- Request: `{ "title"?: string, "text": string }`
- Response success: `{ "ok": true, "item": object, "chunkCount": number }`
- Validate non-empty text after trimming.

`POST /api/dashboard/knowledge-base/ingest-url`

- Request: `{ "url": string, "title"?: string }`
- Response success: `{ "ok": true, "item": object, "chunkCount": number }`
- Validate http/https URLs only.

`GET /api/dashboard/knowledge-base/items`

- Response success: `{ "ok": true, "items": object[], "limits": { "maxItems": 100, "remaining": number } }`

`DELETE /api/dashboard/knowledge-base/items/{itemId}`

- Response success: `{ "ok": true, "deletedChunks": number }`

## OSS Policy

- Use existing `cheerio`.
- Do not add LangChain, LlamaIndex, Readability, Firecrawl, Unstructured, or crawler packages.
- Keep chunking custom.

## Acceptance Criteria

- Text ingest creates one item and chunk docs for the authenticated client.
- URL ingest fetches and extracts readable text, then creates item and chunks.
- List returns only current client's items.
- Delete removes item and all child chunks.
- Item 101 is rejected with a clear client-facing error.
- No route trusts client-supplied ownership.

## Verification

- Run focused tests for chunking if test file is added.
- Run `npm run test` if practical.
- Manually inspect route handlers for auth, maxDuration, and no clientId trust.

## Stop Point

When Phase 1 is complete, summarize:

- files changed
- API endpoints added
- tests run
- any risks or follow-ups

Then stop and wait for approval before Phase 2.
