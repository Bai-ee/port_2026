# Company Brain Document Standard

Status: established runtime standard.

## Purpose

The Company Brain document is the approved runtime Brain format for HITLOOP. It applies to client, company, and project Brain files that compile into Decision Packs, Context Packs, card defaults, and prompt context.

The canonical source filename remains `CLIENT_BRAIN.md` for client workspaces. Company and project variants use the same structure as `COMPANY_BRAIN.md` or `PROJECT_BRAIN.md` when the scope changes.

## Established Example

The current locked example is:

`docs/company-brain/clients/bryan-balli/CLIENT_BRAIN.md`

This file should be treated as the reference implementation for an approved runtime Brain.

## Core Rule

The Brain is not research.

The Brain contains approved strategic decisions only. Research depth, evidence, conversation reports, market notes, and working analysis live in the Studio Intelligence Workspace:

```text
CLIENT_NAME/
  CLIENT_BRAIN.md
  AUTHORITY_INTELLIGENCE.md
  MARKET_INTELLIGENCE.md
  DISCOVERY_INTELLIGENCE.md
  CONVERSATION_INTELLIGENCE.md
  CONTENT_LIBRARY.md
  RESEARCH/
```

Only approved conclusions from those documents move into the Brain.

## Required Runtime Shape

Every approved runtime Brain should use:

```md
---
schemaVersion: hitloop.client-brain.v1
clientId: client-slug
clientName: Client Name
status: approved
updatedAt: YYYY-MM-DD
sourceStandard: studio-intelligence-standard-v1
---

# Client Brain

## Identity Intelligence
## Market Intelligence
## Discovery Intelligence
## Authority Intelligence
## Content Intelligence
## Opportunity Intelligence
## Decision Drivers
```

The compiler reads second-level headings as intelligence domains and third-level headings as decision fields. Do not replace these sections with top-level `# Identity`, `# Market`, or similar outlines.

## Runtime-Safe List Rule

Runtime Brain lists must contain clean values.

Good:

```md
### Watch Lists
- @jackbutcher
- @0xCharlota

### Search Keywords
- creative systems
- design engineering

### Competitors
- Fractional creative directors for startups
- Independent creative technologists
```

Avoid annotated list values in runtime fields:

```md
- Daily | @jackbutcher
- Category | creative systems
- Direct | Fractional creative directors: compete when...
```

Those annotations belong in `NETWORK_INTELLIGENCE.md`, `MARKET_INTELLIGENCE.md`, or `DISCOVERY_INTELLIGENCE.md`. Runtime values must stay simple so Market Insights, Watchlist Pull, Strategy Builder, Lead Gen, and prompt context receive clean terms and handles.

## Decision Drivers

Decision Drivers are approved strategic operating instructions. They should use the explicit grouped format:

```md
## Decision Drivers

### Own Creative Systems Architecture

Own:
- Creative Systems Architecture

Avoid:
- Generic AI agency

Search:
- creative systems

KOLs:
- Jack Butcher

Publications:
- Figma Blog

Communities:
- Design Twitter

Content Series:
- Creative Systems Notes

Lead Gen:
- AI SaaS founders
```

## Approval Status

Use `status: draft` while reviewing or testing.

Use `status: approved` only when the Brain should become authoritative runtime input.

Approved Brains may populate:

- Decision Packs
- Context Packs
- Dashboard card defaults
- Marketing Insights search/watchlist settings
- Strategy Builder prompt context
- Post Me / social prompt context
- Email Digest and Daily Brief context
- Lead Generation defaults

## Validation Checklist

Before upload:

- Frontmatter uses `schemaVersion`, `clientId`, `clientName`, `status`, and `updatedAt`.
- Only the seven runtime sections are present.
- No raw research, source notes, or long conversation reports are included.
- List values are clean runtime values, not annotated records.
- Watchlist entries are clean handles when they should drive X monitoring.
- Prohibited claims are explicit.
- Decision Drivers are present and grouped.
- `compileClientBrainMarkdown()` succeeds.
- Missing decision count is `0` or accepted by the operator.
