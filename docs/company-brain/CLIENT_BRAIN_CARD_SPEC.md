# Client Brain Card Spec

The Client Brain card is the control surface that should next expose `CLIENT_BRAIN.md` editing directly.

Current implementation groups the Brain workflow into four tabs: source editing, approved compiled Brain review, source/gap diagnostics, and downstream consumers. The product direction is:

```text
Edit CLIENT_BRAIN.md
  -> compile
  -> review compiled decisions/defaults/context
  -> approve
  -> downstream cards consume runtime
```

## Required Surfaces

Recommended tabs:

- `BRAIN SOURCE`
- `APPROVED BRAIN`
- `SOURCES & GAPS`
- `CONSUMERS`

## Brain Source

Markdown editor for `CLIENT_BRAIN.md`.

Actions:

- load current Markdown
- create template if missing
- save and compile
- approve
- mark stale
- export

## Approved Brain

Human-readable review of the compiled runtime Brain:

- Identity Intelligence
- Market Intelligence
- Discovery Intelligence
- Authority Intelligence
- Content Intelligence
- Opportunity Intelligence
- Decision Drivers

Tone belongs under Content Intelligence, not as a standalone top-level Brain category. Supporting tone examples belong in `CONTENT_LIBRARY.md` or `CONVERSATION_INTELLIGENCE.md`; approved tone belongs in `CLIENT_BRAIN.md` under `Content Intelligence` -> `Voice`.

The transitional voice editor can remain in this tab until section-level Markdown editing lands.

## Sources & Gaps

Show the informational improvement layer:

- source toggles
- overall completion score
- domain completion scores
- acquisition method counts
- missing decision queue
- Discovery Intelligence fields

This surface is diagnostic. It should not block card execution.

## Consumers

Show `aiContextPack.shortContext`, `longContext`, prompt rules, copy/export controls, and wired consumer status.

Consumers include:

- Strategy Builder
- Post Me
- Email Digest
- Creative Brief
- Executive / Market Brief voice
- Marketing Brief / Market Signals config

## Current Implementation Notes

- Current card file: `components/dashboard/ClientBrainCard.jsx`.
- Current API returns `markdownSource` and compiles `POST { markdownSource }`.
- Current `SOURCES & GAPS` tab reads `sourceRefs`, `decisionAcquisition`, `completion`, `missingDecisionQueue`, and `decisions.intelligence.discovery`.
- Voice inline editing still patches compiled runtime as a transitional path.
- Full UI conversion to Markdown-backed section editing remains pending.
