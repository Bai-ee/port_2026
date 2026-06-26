# HITLOOP Studio Intelligence Standard v1.0

Status: locked architecture.

## Purpose

HITLOOP Studio exists to transform fragmented information into approved strategic intelligence.

Research, interviews, documents, websites, market analysis, social activity, and conversations are evidence. They are not the product.

The product is a deterministic `CLIENT_BRAIN.md` that consistently improves strategic decisions across HITLOOP.

## Core Principle

Research is never runtime.

Research produces evidence. Evidence informs decisions. Approved decisions become the Client Brain. The Client Brain powers HITLOOP.

Every document in Studio must answer exactly one question. If a document begins answering multiple questions, split it.

## Workspace Contract

Every client follows the same Studio Intelligence Workspace structure:

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

## Document Responsibilities

| Document | Question | Runtime? |
| --- | --- | --- |
| `CLIENT_BRAIN.md` | What has been approved for runtime? | Yes |
| `AUTHORITY_INTELLIGENCE.md` | Why should people trust this client? | No |
| `MARKET_INTELLIGENCE.md` | What market are they operating in? | No |
| `DISCOVERY_INTELLIGENCE.md` | How should they be discovered? | No |
| `CONVERSATION_INTELLIGENCE.md` | Which conversations should they own? | No |
| `CONTENT_LIBRARY.md` | What reusable content knowledge exists? | No |
| `RESEARCH/` | What raw evidence supports Studio work? | No |

## CLIENT_BRAIN.md

Question: What has been approved for runtime?

Purpose: Stores only approved strategic conclusions. This document is intentionally concise. Everything contained here should directly influence HITLOOP outputs.

Consumers:

- compiler
- runtime
- Decision Packs
- Context Packs
- Dashboard Cards
- Prompt Context
- Default Settings
- Strategy Builder
- Daily Brief
- Marketing Insights
- Executive Brief
- Lead Generation

Contains:

- identity
- authority summary
- market summary
- discovery summary
- content summary
- opportunity summary
- decision drivers
- voice
- runtime defaults

Never contains:

- working notes
- raw research
- draft opinions
- long competitor analysis
- long-form reasoning
- unverified claims
- pasted research dumps

## AUTHORITY_INTELLIGENCE.md

Question: Why should people trust this client?

Purpose: Documents evidence supporting authority.

Contains:

- career timeline
- employers
- clients
- projects
- products
- technologies
- case studies
- awards
- speaking
- publications
- metrics
- testimonials
- supporting evidence
- transferable lessons
- authority opportunities

Feeds the Authority section of `CLIENT_BRAIN.md`.

## MARKET_INTELLIGENCE.md

Question: What market is this client operating in?

Purpose: Develop a complete understanding of the surrounding ecosystem.

Contains:

- industry analysis
- competitors
- adjacent competitors
- KOLs
- publications
- communities
- podcasts
- conferences
- emerging startups
- trends
- market narratives
- white space
- hiring signals
- industry opportunities

Feeds Market, Opportunity, and Decision Drivers.

## DISCOVERY_INTELLIGENCE.md

Question: How should this client be discovered?

Purpose: Own search, discovery, and visibility.

Contains:

- keyword clusters
- search intent
- GEO opportunities
- LLM queries
- Reddit questions
- LinkedIn topics
- YouTube searches
- semantic relationships
- categories
- platform priorities
- discovery opportunities
- search competitors

Feeds Discovery, SEO, Content, and Decision Drivers.

## CONVERSATION_INTELLIGENCE.md

Question: Which conversations should this client own?

Purpose: Studio's primary research document.

Every conversation should follow the same methodology:

```text
Conversation
  -> Deep Research
  -> Market Understanding
  -> Client Angle
  -> Supporting Proof
  -> Supporting Projects
  -> Supporting Assets
  -> Narrative Opportunities
  -> Approved Brain Updates
```

Each conversation should include:

- current market
- current narratives
- current debates
- KOLs
- companies
- keywords
- communities
- client angle
- supporting proof
- supporting projects
- supporting assets
- content opportunities
- decision opportunities

This document is continuously enriched. It is not compiled directly. Its approved conclusions are published into `CLIENT_BRAIN.md`.

## CONTENT_LIBRARY.md

Question: What reusable content knowledge exists?

Purpose: Maintain an evergreen creative knowledge base.

Contains:

- frameworks
- stories
- case studies
- analogies
- hooks
- post series
- CTAs
- visual ideas
- objections
- FAQs
- writing patterns
- voice examples
- campaign concepts
- evergreen content

Nothing here is automatically approved. Content becomes runtime only after approval through `CLIENT_BRAIN.md`.

## RESEARCH/

Purpose: Raw research archive.

Contains:

- PDFs
- articles
- notes
- interview transcripts
- market reports
- Deep Research outputs
- screenshots
- references

This folder is evidence only. Nothing inside directly affects runtime.

## Approval Rule

All intelligence starts as evidence.

Only operator-approved conclusions move into `CLIENT_BRAIN.md`. Runtime cards, prompts, defaults, campaigns, and outputs should consume the compiled Client Brain, not the Studio research workspace.
