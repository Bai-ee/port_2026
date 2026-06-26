# Source Toggle Model

Source toggles are still supported for generated Client Brain mode, but the committed architecture treats `CLIENT_BRAIN.md` as the authoritative source once present.

## Source Modes

### Markdown Source Mode

Primary source:

- `markdownSource`
- `sourceRefs[0].id = client-brain-md`

The compiler produces decisions, defaults, context, and source refs from the Markdown document.

### Generated Source Mode

When no Markdown source exists, the deterministic generator can assemble Client Brain from:

- client record
- client config
- dashboard state
- marketing brief config
- intelligence digest
- knowledge base items
- uploaded/manual sources

Each generated source can be enabled/disabled or scoped by intended use.

## Use-For Keys

- `tone`
- `strategy`
- `copy`
- `audience`
- `proof`
- `positioning`
- `offers`
- `emailDigest`
- `socialPosts`
- `marketingInsights`

## Rules

- Disabled sources must not steer generated context.
- `doNotUseNotes` must be honored in generated context.
- Source toggles should not mutate `CLIENT_BRAIN.md`.
- If Markdown and generated sources disagree, Markdown wins after compile.
- Manual card settings still win over compiled defaults at card runtime.
