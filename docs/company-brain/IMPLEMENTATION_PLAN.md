# Client Brain — As-Built + Remaining Work

> Status: **built (v1) and wired into Strategy Builder.** This file is the as-built
> record. The original forward-plan prose is retired — the system already exists in
> the tree. Read this before extending it.

## What Client Brain is

Upstream brand/tone/positioning context layer. Market Insights decides **what** to
talk about; Client Brain decides **how** the client should sound, what claims are
allowed, what positioning to reinforce, what language to avoid. Downstream cards
consume it **optionally** — absent/unapproved brain ⇒ output is unchanged.

Bryan / HITLOOP is **example-only** (`BRYAN_EXAMPLE_CLIENT_BRAIN.md`). No client is
hardcoded in runtime logic.

## As-built map (differs from the original plan — trust this)

| Area | Original plan said | Actually built |
|------|--------------------|----------------|
| Module | ESM `store.js` + `context.js` + `source-normalizer.js` | One CJS file `features/client-brain/store.cjs` (repo feature-logic convention) |
| Firestore path | `client_brains/{clientId}` | `clients/{clientId}/client_brain/current` (subcollection); dashboard mirror written to `dashboard_state/{clientId}.clientBrain` |
| Context fn | `loadClientBrainContext(clientId,{useFor,maxChars})` | Same signature now (see Gap 1 below) **plus** `requireApproved` |
| Routes | route/sources/generate/approve | those **+ `export/`** under `app/api/dashboard/client-brain/` |
| Card | `client-brain` card | `components/dashboard/ClientBrainCard.jsx`, card id `client-brain` |
| Generator | LLM | **deterministic v1** — assembles from enabled sources, no model dependency |

### Files
- Store / logic: `features/client-brain/store.cjs` (+ `__tests__/store.test.js`)
- API: `app/api/dashboard/client-brain/{route,sources,generate,approve,export}.js`,
  shared `_context.cjs` (`resolveDashboardClientContext` — resolves clientId
  server-side; never trusts client-supplied id)
- UI: `components/dashboard/ClientBrainCard.jsx`, card wired in `DashboardPage.jsx`
- Docs: `docs/company-brain/*`
- Downstream (live): `app/api/dashboard/strategy-builder/generate/route.js`,
  `features/strategy-builder/{prompt.js,schemas.js}`

### Data shape (current)
`clients/{clientId}/client_brain/current`: `clientId, version, status
(draft|generated|approved|stale), identity, positioning, voice, audience, offers,
proof, content, aiContextPack{shortContext,longContext,promptRules,downstreamUsage},
missingData[], sourceRefs[], generatedAt, approvedAt, timestamps`.
Each `sourceRefs[]`: `id, sourceType, label, enabled, trustLevel, freshness,
relevance, useFor{tone,strategy,copy,audience,proof,positioning,offers,emailDigest,
socialPosts,marketingInsights}, url, filePath, summary, extractedFields,
manualNotes, doNotUseNotes, timestamps`.

### Store exports
`getClientBrain, saveClientBrain, saveSourceRefs, generateAndSaveClientBrain,
markClientBrainStatus, loadClientBrainContext, buildUseForContext,
buildAutoSourceRefs, buildClientBrainDraft, buildDashboardMirror,
confidenceFromSources, normalizeSourceRef, DEFAULT_USE_FOR, CLIENT_BRAIN_VERSION`.

## Closed gaps (this pass)

**Gap 1 — `useFor` filtering wired into the emitted context.**
`loadClientBrainContext(clientId,{useFor,maxChars=2500,requireApproved=true})`:
- `useFor` (string or array, e.g. `'socialPosts'`) selects which sections render via
  `USE_FOR_SECTIONS`, and is **gated by the per-source `useFor` toggles** —
  `buildUseForContext` returns `''` if no enabled source votes for any requested
  purpose. Aggregated `doNotUseNotes` from enabled sources fold into "Do not".
- Output is the labeled `CLIENT CONTEXT` block (Identity / About / Positioning /
  Voice / Do / Do not / Audience / Proof / Offers / Content pillars).
- No `useFor` ⇒ legacy behavior (returns `aiContextPack.shortContext`).

**Gap 2 — approval precedence enforced.**
`requireApproved` now defaults **true**: only `status==='approved'` brains feed
downstream copy. Draft/generated brains are ignored unless a caller opts in with
`requireApproved:false`. Strategy Builder calls
`loadClientBrainContext(clientId,{useFor:'socialPosts',maxChars:2500})`.

Both covered by `__tests__/store.test.js`.

## Precedence (in the Strategy prompt)
Approved Client Brain > manual campaign guardrails > Knowledge Base > Brand Snapshot
> website scrape > Market Insights. Client Brain improves tone/copy — it does **not**
change Market Insights signal selection, and does **not** replace
`strategyBuilder.lastPlan` (the shared strategy output other cards read).

## Downstream consumers (Phase 8)
Pattern (all backwards-compatible — absent/unapproved brain ⇒ `''` ⇒ unchanged output):
`const c = await loadClientBrainContext(clientId,{useFor:'…'}); …${c ? 'CLIENT BRAIN CONTEXT:\n'+c : ''}…`

| Consumer | Status | useFor | Where |
|----------|--------|--------|-------|
| Strategy Builder (day-of post + 30-day plan) | ✅ wired | `socialPosts` | `app/api/dashboard/strategy-builder/generate/route.js` |
| Post Me (brief draft post) | ✅ via Strategy Builder | — | `content.x_post` is the strategy output (`brief-preview/route.js:308`) |
| Post Me (social-posting `generate-copy`) | ✅ wired | `socialPosts` | `app/api/social-posting/route.js` → `generatePromoCopy(brand,{clientBrainContext})` |
| Email Digest (executive summary) | ✅ wired | `emailDigest` | `app/api/admin/daily-digest/route.js` → `generateBriefSummary({clientBrainContext})` |
| Market/Executive Brief (Scribe + Guardian) | ✅ wired | voice profile | `features/not-the-rug-brief/{scribe.js:413,guardian.js:308}` → `resolveVoiceProfile` (Client Brain → `brand-voice.json`, `requireApproved:true`) |
| Creative Brief + all named-brief covers | ✅ wired | `copy` | `features/scout-intake/brief-summary-runner.mjs` → `summarizeBriefCover({clientBrainContext})` (exec/creative/generic paths) |

All Phase 8 consumers wired. Two voice paths exist by design:
- **`resolveVoiceProfile`** (`voice-resolver.js`) — reads the structured Client Brain
  doc (`readClientBrainDoc`); feeds Scribe + Guardian (the executive/market brief LLM).
- **`loadClientBrainContext`** (`store.cjs`) — emits the scoped `CLIENT CONTEXT`
  string; feeds Strategy Builder, Post Me, Email Digest, brief covers.

## Card gating — verified
`client-brain` is `category:'knowledge'`. Non-admins have the entire `knowledge`
nav bucket locked (`NON_ADMIN_LOCKED_NAV_KEYS`, `DashboardPage.jsx:2421`) and the
card is **not** in `NON_ADMIN_UNLOCKED_CARD_IDS` (`:2397`). Only admins bypass ⇒
effectively admin-gated. No change made.

## Phase 6 refinements — done
- **Contradiction detection** — `detectContradictions(sourceRefs)` (`store.cjs`) flags
  enabled-source disagreement on name/category/URL (URL-normalized). Stored as
  `brain.contradictions[]`; surfaced in the card (Brain Health "Conflicts" metric +
  Generated-tab list).
- **Stronger confidence** — `computeBrainConfidence({sourceRefs,missingData,contradictions})`
  demotes the source-only score one rank per high-priority gap and per contradiction.
  Stored as `brain.confidence`; mirror + card prefer it (local source-only estimate is
  the fallback for older brains).
- **Optional model regeneration** — `generateAndSaveClientBrain(clientId,{mode:'llm'})`
  → `refineDraftWithModel` refines free-text fields strictly from source evidence via a
  tool-call (`CLIENT_BRAIN_TOOL`, model `CLIENT_BRAIN_MODEL`/sonnet) and rebuilds
  shortContext. Non-fatal: any failure keeps the deterministic draft + records
  `regenerationError`. Route: `generate/route.js` body `{mode:'llm'}`. Card: **Regenerate (AI)**
  button. `brain.generatedBy` = `deterministic` | `model`.
- **Manual field editing** — by design: edit at the **source** card via the Generated-tab
  deep links (`SECTION_CARD`) then regenerate; **voice** is inline-editable (VOICE tab →
  Scribe/Guardian). No competing inline whole-brain editor.
- **Voice preserved across regenerate** — `mergeVoice(prevVoice, freshVoice)` overlays any
  non-empty prior voice field (VOICE-tab edits + seeded superset) onto the rebuild, so
  regenerate only fills previously-empty voice fields. AI refine runs after and may still
  override `toneSummary`.
- **Source-specific extraction** — already implemented per source type in
  `buildAutoSourceRefs` (client record, website, brand overview/snapshot, marketing
  brief, creative brief, intelligence digest, KB).

## Remaining work
- **`useFor` exactness:** `USE_FOR_SECTIONS` is a coarse map; tune per downstream
  once more consumers land.
