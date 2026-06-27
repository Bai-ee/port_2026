# Client Brain — As-Built State

> Status: built as a Markdown-source plus compiled-runtime system. Still gated/admin and not launch-certified.

## Committed Architecture

```text
CLIENT_BRAIN.md
  -> compileClientBrainMarkdown()
  -> compiled Client Brain runtime
  -> Decision Pack / Decision Drivers / Context Pack / Card Defaults
  -> Firestore
  -> dashboard cards and prompts
```

`CLIENT_BRAIN.md` is the human-editable source. Firestore is compiled runtime.

## As-Built Map

| Area | Current state |
|------|---------------|
| Source format | `CLIENT_BRAIN.md`, schema `hitloop.client-brain.v1` |
| Compiler | `features/client-brain/markdown.cjs` |
| Runtime store | `features/client-brain/store.cjs` |
| Firestore path | `clients/{clientId}/client_brain/current` |
| Dashboard mirror | `dashboard_state/{clientId}.clientBrain` |
| API | `app/api/dashboard/client-brain/{route,sources,generate,approve,export}` |
| Card | `components/dashboard/ClientBrainCard.jsx`, card id `client-brain` |
| Deterministic generator | `generateAndSaveClientBrain()` from discovered sources/card config |
| Markdown compiler | `compileAndSaveClientBrainMarkdown()` from Markdown source |
| Export | Legacy context fields plus `CLIENT_BRAIN_MD` and `clientPackage` |

## Runtime Fields

The compiled doc includes:

- `markdownSource`
- `markdownMeta`
- `identity`
- `positioning`
- `voice`
- `audience`
- `offers`
- `proof`
- `content`
- `discovery`
- `decisions.intelligence`
- `decisions.decisionDrivers`
- `decisions.search/social/market/content`
- `decisionAcquisition`
- `completion`
- `missingDecisionQueue`
- `cardDefaults`
- `cardSettingsSnapshot`
- `aiContextPack`
- `sourceRefs`
- `missingData`
- `contradictions`
- `confidence`

## Store Exports

Important exports from `features/client-brain/store.cjs`:

- `compileAndSaveClientBrainMarkdown`
- `createClientBrainMarkdownTemplate`
- `generateAndSaveClientBrain`
- `getClientBrain`
- `saveClientBrain`
- `saveSourceRefs`
- `saveClientBrainCardSettingsSnapshot`
- `loadClientBrainContext`
- `loadClientBrainDecisions`
- `loadClientBrainCardDefaults`
- `buildDecisionPack`
- `buildDecisionEngine`
- `buildCardDefaultsForCard`
- `buildUseForContext`
- `readClientBrainDoc`
- `markClientBrainStatus`

## API Behavior

`GET /api/dashboard/client-brain`

- Returns the compiled brain.
- Returns `markdownSource`.
- If no Markdown exists yet, returns a valid draft template.

`POST /api/dashboard/client-brain`

- With `{ markdownSource }`: compiles Markdown and saves compiled runtime.
- With `{ brain }`: legacy patch-save path for transitional UI edits.

`POST /api/dashboard/client-brain/export`

- Returns legacy `CLIENT_CONTEXT` fields.
- Returns `CLIENT_BRAIN_MD`.
- Returns `clientPackage.schemaVersion = hitloop.client-package.v1`.
- Includes compiled decisions, card defaults, card config snapshots, source manifest, and artifact manifest.

## Downstream Consumers

Prompt context consumers:

| Consumer | Status | Path |
|----------|--------|------|
| Strategy Builder | wired | `loadClientBrainContext(..., { useFor:'socialPosts' })` |
| Post Me generate-copy | wired | `loadClientBrainContext(..., { useFor:'socialPosts' })` |
| Email Digest | wired | `loadClientBrainContext(..., { useFor:'emailDigest' })` |
| Creative Brief / named covers | wired | `loadClientBrainContext(..., { useFor:'copy' })` |
| Executive / Market Brief voice | wired | `resolveVoiceProfile(clientId)` |

Structured default consumers:

| Consumer | Status | Path |
|----------|--------|------|
| Marketing Brief / Market Signals config | wired | `loadClientBrainCardDefaults(..., { cardId:'marketing-brief' })` |

The Market Signals card **surfaces** these structured defaults read-only in its SOURCES tab ("From your Client Brain", `#signals-client-brain-suggested-section`) and **auto-merges** them into the live search inputs when you click **Generate Report** (union, never clobbers manual terms). Approved-gated — an unapproved brain emits no defaults. Full flow: [`../source-of-truth/MARKET-SIGNALS-GENERATE-REPORT-FLOW.md`](../source-of-truth/MARKET-SIGNALS-GENERATE-REPORT-FLOW.md) §5.

## Client Brain Card UI

The card intentionally uses four tabs:

- `BRAIN SOURCE` — upload/paste/edit `CLIENT_BRAIN.md`, then inject/compile it.
- `APPROVED BRAIN` — reviewed compiled decisions, including the current transitional voice editor.
- `SOURCES & GAPS` — source refs, generated/acquisition state, discovery intelligence, completion, and missing decisions.
- `CONSUMERS` — context-pack preview/export and downstream consumer status.

Tone belongs in `CLIENT_BRAIN.md` under `Content Intelligence` -> `Voice`. Supporting examples belong in `CONTENT_LIBRARY.md` or `CONVERSATION_INTELLIGENCE.md`. The visible voice editor remains a transitional compiled-field editor until dashboard edits compile back into `markdownSource`.

> **Client Brain card UI:** the card modal's CSS lives only in the `dashboardCss` template literal in `DashboardPage.jsx` (not the unimported `dashboard.css`). `.client-brain-card` must stay `min-height:100%` with `> * { flex: 0 0 auto }` — a fixed `height:100%` makes flex children shrink and their `overflow:visible` content collide across sections. See the run-flow doc §9.

## Precedence

Runtime card settings:

`manual card setting > approved Client Brain decision > company/default template > hardcoded fallback`

Source/runtime:

`CLIENT_BRAIN.md source > compiled Firestore runtime`

## Remaining Work

- Make dashboard section edits update `markdownSource` and recompile, instead of patching compiled fields.
- Add version history for `CLIENT_BRAIN.md`.
- Add import flow for `.hitloop-client.json` / `.hitloop-client.zip`.
- Extend structured defaults beyond Marketing Brief / Market Signals into Strategy Builder, Post Me, Email Digest, and Lead Gen.
- Add guided interview/research UIs that write suggested decisions into the acquisition queue before approval.
