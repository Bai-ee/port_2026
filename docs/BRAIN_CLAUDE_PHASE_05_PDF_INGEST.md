# Brain Phase 5 - Document Upload Ingest

## Goal

Add document upload support: accept PDFs, DOCX files, and common text-like files, store raw uploads in Firebase Storage, extract text, chunk, embed, search, and make uploaded-file-derived chunks available to Strategy Builder through existing Phase 4 retrieval.

## Required Reading

- `docs/BRAIN_FEATURE_PLAN.md`
- Phase 1 storage and ingest files
- Phase 3 embedding and retrieval files
- Phase 4 Strategy Builder wiring
- `api/_lib/firebase-admin.cjs`
- Existing Firebase Storage usage, especially account deletion cleanup

## Approval Gate

Stop before implementation unless a human has approved:

- adding `pdf-parse`
- adding `mammoth` if DOCX support is included
- file size cap, default recommendation 10 MB

Do not install dependencies before approval.

## Agent Operating Model

- Lead Agent owns upload/extraction/storage integration and final patch.
- Explorer Agent may inspect Firebase Storage patterns and current upload/FormData route examples.
- Worker Agent may edit only files listed in this prompt.
- Reviewer Agent verifies dependency gate, file validation, storage path safety, and search behavior.

## Files In Scope

Create:

- `features/knowledge-base/document.js`
- `app/api/dashboard/knowledge-base/upload/route.js`

Edit:

- `package.json` and lockfile only after parser dependency approval.
- `components/dashboard/KnowledgeBaseCard.jsx`
- `components/dashboard/knowledge-base/AddItemPanel.jsx`
- `features/knowledge-base/store.js` if needed for storage metadata.

## Implementation Requirements

- Accept `multipart/form-data` with one file.
- Validate content type and extension defensively.
- Enforce approved size cap.
- Resolve clientId server-side.
- Create item with `type: 'pdf'`, `type: 'docx'`, or `type: 'file'`.
- Store raw upload at `knowledge-base/{clientId}/{itemId}.{ext}`.
- Extract PDFs with `pdf-parse`, DOCX files with `mammoth`, and common text-like files as UTF-8 text.
- If text is empty or nearly empty, mark item error with clear message.
- Reuse Phase 1 chunking and Phase 3 embedding pipeline.
- Surface upload progress/loading/error states in the card UI.
- Delete behavior should remove associated chunks and, if practical in this phase, the raw Storage object.

## OSS Policy

- `pdf-parse` is the approved v1 PDF dependency after gate approval.
- `mammoth` is the approved v1 DOCX dependency after gate approval.
- Do not add OCR, Docling, Unstructured, or browser-based PDF parsers in v1.
- IBM Docling is a future option only if premium document parsing is intentionally planned.

## API Contract

`POST /api/dashboard/knowledge-base/upload`

- Request: `multipart/form-data` with `file`
- Response success: `{ "ok": true, "item": object, "chunkCount": number }`

## Acceptance Criteria

- User can upload a text-based PDF, DOCX, TXT, Markdown, CSV, JSON, HTML, XML, YAML, RTF, log, or text file through the Knowledge Base card.
- Raw upload is stored in Firebase Storage.
- Extracted text becomes chunks and embeddings.
- Uploaded-file chunks are searchable.
- Strategy Builder can retrieve uploaded-file-derived chunks when Knowledge Base is enabled.
- Scanned/no-text PDFs fail clearly without crashing.

## Verification

- Run focused extraction tests if practical with a small fixture.
- Run `npm run test` if practical.
- Run `npm run build` if feasible after dependency/UI changes.
- Manually upload a small PDF, DOCX, and TXT file and verify list/search behavior.

## Stop Point

When Phase 5 is complete, summarize:

- files changed
- dependencies added
- storage behavior
- tests run
- risks or follow-ups

Then stop for final review.
