# Client Brain Sources

This folder contains client-specific Studio Intelligence Workspaces.

Each client folder should follow `STUDIO_INTELLIGENCE_STANDARD.md`:

```text
CLIENT_NAME/
  CLIENT_BRAIN.md
  EDITORIAL_STRATEGY.json
  AUTHORITY_INTELLIGENCE.md
  MARKET_INTELLIGENCE.md
  DISCOVERY_INTELLIGENCE.md
  CONVERSATION_INTELLIGENCE.md
  CONTENT_LIBRARY.md
  RESEARCH/
```

`CLIENT_BRAIN.md` is the only Brain runtime source. `EDITORIAL_STRATEGY.json` is the Strategy Builder runtime pack. The other documents are Studio workspace/evidence documents.

Use this folder when a Brain should populate real card defaults, decision packs, context packs, exports, and downstream prompts.

## Clients

- `bryan-balli/CLIENT_BRAIN.md` — approved Bryan Balli runtime Brain source and current reference implementation for `COMPANY_BRAIN_DOCUMENT_STANDARD.md`.
- `bryan-balli/AUTHORITY_INTELLIGENCE.md` — Studio authority evidence workspace.
- `bryan-balli/MARKET_INTELLIGENCE.md` — Studio market evidence workspace.
- `bryan-balli/DISCOVERY_INTELLIGENCE.md` — Studio discovery evidence workspace.
- `bryan-balli/CONVERSATION_INTELLIGENCE.md` — Studio conversation ownership workspace.
- `bryan-balli/CONTENT_LIBRARY.md` — Studio reusable content workspace.
- `bryan-balli/EDITORIAL_STRATEGY.json` — Bryan campaign-first editorial strategy config for Strategy Builder.

## Load Flow

```text
clients/{client-slug}/CLIENT_BRAIN.md
  -> POST /api/dashboard/client-brain { markdownSource }
  -> compileClientBrainMarkdown()
  -> clients/{clientId}/client_brain/current
  -> Decision Pack / Card Defaults / Context Pack
```

Editorial strategy configs load separately into `dashboard_state.{clientId}.strategyBuilder.config.editorial` through the Strategy Builder config route.

```text
clients/{client-slug}/EDITORIAL_STRATEGY.json
  -> Strategy Builder > Inputs > Marketing Strategy Pack
  -> dashboard_state/{clientId}.strategyBuilder.config.editorial
  -> normalizeEditorialStrategyConfig()
  -> Editorial Strategy Engine
  -> Campaign Calendar / Daily Recommendation
```

Keep generic fixtures in the parent folder, such as `BRYAN_EXAMPLE_CLIENT_BRAIN.md`.
