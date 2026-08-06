# Client Brain

Client Brain is HITLOOP's source-controlled strategic identity layer.

The committed architecture is:

```text
CLIENT_BRAIN.md
  -> compiler
  -> compiled Client Brain runtime
  -> Decision Pack / Decision Drivers / Context Pack / Card Defaults
  -> Firestore
  -> dashboard cards and prompts
```

`CLIENT_BRAIN.md` is the authoritative editable specification. Firestore is the compiled runtime state the application consumes.

Status: gated/admin feature. Not launch-certified.

## Start Here

Read in this order:

1. `STUDIO_INTELLIGENCE_STANDARD.md` — locked v1.0 rule: research is never runtime; approved decisions live in `CLIENT_BRAIN.md`.
2. `COMPANY_BRAIN_DOCUMENT_STANDARD.md` — established runtime Brain document standard, using Bryan's locked Brain as the reference implementation.
3. `CLIENT_BRAIN_DEEP_RESEARCH_MASTER_PROMPT.md` — copy-ready prompt for producing a complete upload-ready Brain from deep research.
4. `HITLOOP_STUDIO_METHODOLOGY.md` — how Studio work should create better Client Brain intelligence outside the code.
5. `CLIENT_BRAIN_MARKDOWN_STANDARD.md` — the canonical editable `CLIENT_BRAIN.md` source format.
6. `CLIENT_BRAIN_SCHEMA.md` — the compiled runtime shape stored in Firestore.
7. `CLIENT_BRAIN_DECISION_ENGINE.md` — how decisions, card defaults, overrides, and feedback work.
8. `DECISION_ACQUISITION.md`, `DISCOVERY_INTELLIGENCE.md`, and `CLIENT_BRAIN_COMPLETION.md` — enrichment, discovery, and scoring layers.
9. `playbooks/` — field research guides for each intelligence domain.

## Current Runtime

Canonical runtime document:

- `clients/{clientId}/client_brain/current`

Dashboard mirror:

- `dashboard_state/{clientId}.clientBrain`

Primary files:

- Markdown standard: `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`
- Decision engine model: `docs/company-brain/CLIENT_BRAIN_DECISION_ENGINE.md`
- Compiler: `features/client-brain/markdown.cjs`
- Store/runtime helpers: `features/client-brain/store.cjs`
- API namespace: `/api/dashboard/client-brain`
- Dashboard card: `components/dashboard/ClientBrainCard.jsx`

## What It Produces

The compiler and deterministic runtime builder produce:

- `markdownSource` and `markdownMeta`
- `identity`, `positioning`, `voice`, `audience`, `offers`, `proof`, `content`, `discovery`
- `decisions.intelligence`
- `decisions.decisionDrivers`
- `decisions.search`, `decisions.social`, `decisions.market`, `decisions.content`
- `decisionAcquisition`
- `completion`
- `missingDecisionQueue`
- `cardDefaults`
- `cardSettingsSnapshot`
- `aiContextPack`

## Consumer Model

Cards consume Client Brain in two ways:

- Prompt context: `loadClientBrainContext(clientId, { useFor })`
- Structured defaults: `loadClientBrainCardDefaults(clientId, { cardId })`

Manual card settings still win:

`manual card setting > approved Client Brain decision > company/default template > hardcoded fallback`

The first structured default integration is Marketing Brief / Market Signals config. It fills empty values from approved Client Brain defaults and writes card settings back into the Brain snapshot/promoted decisions on save.

## Docs

- `README.md` — this index and current status.
- `STUDIO_INTELLIGENCE_STANDARD.md` — locked v1.0 Studio workspace standard and document responsibilities.
- `COMPANY_BRAIN_DOCUMENT_STANDARD.md` — established runtime Brain document standard and validation checklist.
- `CLIENT_BRAIN_DEEP_RESEARCH_MASTER_PROMPT.md` — master prompt for assigning deep research and receiving an upload-ready `CLIENT_BRAIN.md`.
- `CLIENT_BRAIN_MARKDOWN_STANDARD.md` — source file format.
- `HITLOOP_STUDIO_METHODOLOGY.md` — outside-code Studio methodology for building the best possible Client Brain.
- `CLIENT_BRAIN_DECISION_ENGINE.md` — decision-grade intelligence model.
- `CLIENT_BRAIN_SCHEMA.md` — compiled runtime shape.
- `CLIENT_BRAIN_CARD_SPEC.md` — current/future card UI contract.
- `CLIENT_BRAIN_CARD_UX_CONTEXT.md` — handoff context for refining the Client Brain card UX/UI.
- `DOWNSTREAM_CONTEXT_USAGE.md` — how cards consume context/defaults.
- `SOURCE_TOGGLE_MODEL.md` — legacy/generated source controls.
- `DECISION_ACQUISITION.md` — how automatic, interview, research, feedback, and manual decisions enter the Brain.
- `DISCOVERY_INTELLIGENCE.md` — discovery fields that feed search, watchlists, Market Insights, Lead Gen, and Strategy Builder.
- `CLIENT_BRAIN_COMPLETION.md` — informational completion scoring and missing-decision queue.
- `playbooks/` — research playbooks for each intelligence domain.
- `clients/` — client-specific `CLIENT_BRAIN.md` sources that can be loaded into runtime.
- `BRYAN_EXAMPLE_CLIENT_BRAIN.md` — example `CLIENT_BRAIN.md` fixture content only.

## Related Feature Docs

- Marketing Brief / Market Signals: `docs/features/marketing-brief/README.md`
- Mockup Studio render docs: `docs/features/studio/README.md`
- Launch source of truth: `docs/source-of-truth/SOURCE-OF-TRUTH.md`
