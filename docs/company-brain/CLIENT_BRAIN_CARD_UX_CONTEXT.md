# Client Brain Card UX Context

Status: working UX handoff for Client Brain / Source Library refinement.

## Purpose

This document gives a product and implementation handoff for improving the Client Brain card UX.

The key issue to solve is user clarity: operators need to understand the difference between uploading reference knowledge and injecting the approved runtime Brain.

## Product Model

HITLOOP has two related but different concepts:

```text
Source Library uploads
  -> reference documents, chunks, retrieval, Q&A
  -> useful evidence and supporting context
  -> does not become the approved runtime Brain by itself

CLIENT_BRAIN.md
  -> approved strategic decisions
  -> compiler
  -> Firestore runtime Brain
  -> Decision Pack / Context Pack / Card Defaults
  -> downstream cards and prompts
```

The user-visible confusion was that `Company Brain` sounded like the place to upload `CLIENT_BRAIN.md`, but that card behaves as a Source Library / Knowledge Base surface. The runtime injection flow lives in the `Client Brain` card.

## Required UX Outcome

An operator with a prepared `CLIENT_BRAIN.md` should immediately know:

1. Where to put the file.
2. What will happen after upload/injection.
3. Whether the Brain is draft or approved.
4. Which downstream cards will use it.
5. How this differs from normal Source Library uploads.

The ideal first-run flow:

```text
Open Client Brain
  -> Source MD is the first visible tab
  -> Choose .md or paste source
  -> Inject Brain
  -> compiler validates and saves runtime
  -> Generated tab shows approved decisions
  -> Context tab shows prompt pack
  -> Usage tab shows downstream consumers
```

## Current Implementation

Primary UI:

- `components/dashboard/ClientBrainCard.jsx`

Primary API:

- `app/api/dashboard/client-brain/route.js`
- `app/api/dashboard/client-brain/approve/route.js`
- `app/api/dashboard/client-brain/export/route.js`
- `app/api/dashboard/client-brain/generate/route.js`
- `app/api/dashboard/client-brain/sources/route.js`

Compiler/runtime:

- `features/client-brain/markdown.cjs`
- `features/client-brain/store.cjs`

Standards:

- `docs/company-brain/COMPANY_BRAIN_DOCUMENT_STANDARD.md`
- `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`
- `docs/company-brain/CLIENT_BRAIN_SCHEMA.md`
- `docs/company-brain/CLIENT_BRAIN_DECISION_ENGINE.md`

Reference Brain:

- `docs/company-brain/clients/bryan-balli/CLIENT_BRAIN.md`

## Current Card Tabs

Current tab sequence:

- `BRAIN SOURCE`
- `APPROVED BRAIN`
- `SOURCES & GAPS`
- `CONSUMERS`

`BRAIN SOURCE` is the runtime upload/editor surface.

`APPROVED BRAIN` shows compiled decision output and the transitional voice editor. Approved tone belongs in `CLIENT_BRAIN.md` under `Content Intelligence` -> `Voice`; supporting examples belong in `CONTENT_LIBRARY.md` or `CONVERSATION_INTELLIGENCE.md`.

`SOURCES & GAPS` combines legacy/generated source toggles, completion, missing decisions, discovery intelligence, and decision acquisition metadata.

`CONSUMERS` combines prompt context pack preview/copy/export tools and downstream consumer status.

## Recent UX Fixes Already Made

The card now:

- Opens on `BRAIN SOURCE` by default.
- Adds an `Inject .md` button in the top action bar.
- Allows choosing `.md`, `.markdown`, `text/markdown`, or `text/plain`.
- Allows pasting/editing Markdown source directly.
- Posts `{ markdownSource }` to `/api/dashboard/client-brain`.
- Compiles via `compileAndSaveClientBrainMarkdown()`.
- Shows template/source metadata in the Source tab.

The API route now imports `createClientBrainMarkdownTemplate` directly from `features/client-brain/markdown.cjs`, avoiding the stale `createClientBrainMarkdownTemplate is not a function` failure seen during local dev.

## UX Problem To Refine

The current system still has naming and orientation friction:

- Dashboard header may say `Source Library`, while runtime card says `Client Brain`.
- Users may upload `CLIENT_BRAIN.md` to Source Library, which stores it as retrieval evidence but does not compile it.
- The source-toggle area may look like the upload destination, but it is not the runtime Brain source editor.
- Top actions include `Regenerate`, `Regenerate (AI)`, `Approve`, and `Mark stale`; these can distract from first-run import.

## Recommended UX Direction

Use a clearer first-run hierarchy:

```text
Client Brain
  Primary action: Inject CLIENT_BRAIN.md
  Secondary action: Build from sources
  Secondary action: Approve
```

Suggested tab naming:

- `Brain Source`
- `Approved Brain`
- `Sources & Gaps`
- `Consumers`

Suggested top-level copy:

```text
Inject an approved CLIENT_BRAIN.md to make it the runtime source of truth.
Reference uploads belong in Source Library.
```

The card should distinguish three states:

- Empty: no runtime Brain compiled.
- Draft: Markdown compiled but not approved.
- Approved: downstream cards may consume it.

## Suggested First-Run Layout

When no Markdown Brain is present:

```text
[Primary panel]
Build Runtime Brain

Choose CLIENT_BRAIN.md
Paste Markdown
Inject Brain

Small note:
This compiles approved strategic decisions into the runtime Brain.
Use Source Library uploads for supporting documents and research.
```

After injection:

```text
Runtime Brain Loaded

Status: draft/approved
Schema: hitloop.client-brain.v1
Decisions: N approved
Missing decisions: N
Context pack: ready/not ready

Review Approved Understanding
Approve Brain
Export Brain
```

## Implementation Notes

Do not make Source Library uploads compile the runtime Brain automatically.

If an uploaded Source Library file is named `CLIENT_BRAIN.md`, the app may offer a callout:

```text
This looks like a runtime Brain. Open Client Brain to inject it.
```

But compilation should remain explicit because `CLIENT_BRAIN.md` changes downstream behavior.

Keep the compiler path:

```text
POST /api/dashboard/client-brain
body: { markdownSource }
```

Keep Source Library uploads for retrieval/evidence:

```text
POST /api/dashboard/knowledge-base/upload
```

## UX Guardrails

- Do not hide approval state.
- Do not imply every upload becomes runtime truth.
- Do not call the Source Library upload path the Brain compiler.
- Do not auto-approve unless the Markdown frontmatter says `status: approved`.
- Do not let generated sources overwrite a compiled Markdown Brain without explicit operator intent.
- Keep manual operator edits higher priority than generated suggestions.

## Visual/Interaction Priorities

- Make the import path visible without requiring tab scanning.
- Use one obvious primary button for the next action.
- Keep dense operational UI; avoid a marketing-style hero.
- Use clear status chips: `empty`, `draft`, `approved`, `stale`.
- Show downstream impact after injection.
- Provide validation errors near the Markdown editor.
- Keep a copyable/exportable source of the current `CLIENT_BRAIN.md`.

## Acceptance Criteria

The UX refinement is successful when:

- A first-time operator can inject `CLIENT_BRAIN.md` without asking where to upload it.
- The difference between reference uploads and runtime Brain injection is obvious.
- The card clearly reports whether downstream cards can use the Brain.
- The source Markdown remains editable/exportable.
- The API path remains deterministic and test-covered.
- Existing Source Library / Knowledge Base behavior is unchanged.

## Verification Commands

Run after UI changes:

```bash
npm test
npm run build
```

If running locally, restart the dev server after changes to CJS runtime exports/imports:

```bash
npm run dev -- --hostname 127.0.0.1
```
