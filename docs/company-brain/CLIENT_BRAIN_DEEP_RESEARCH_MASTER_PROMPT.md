# Client Brain Deep Research Master Prompt

Status: established research handoff prompt.

## Purpose

Use this document when assigning another agent to research a client and return a high-impact, upload-ready `CLIENT_BRAIN.md`.

The goal is not to create a knowledge dump. The goal is to produce a clean runtime Brain that can replace generic HITLOOP defaults for a specific client.

The returned Brain should be good enough to seed:

- Market Insights search terms, categories, competitors, sources, and watchlists
- Strategy Builder audiences, pillars, campaigns, CTAs, and guardrails
- Post Me voice, hooks, proof, offers, banned claims, and default calls to action
- Email Digest priority topics, source watchlists, executive tone, ignored topics, and escalation terms
- Lead Gen ICPs, verticals, geographies, disqualifiers, proof, and offer language
- Creative Brief and other prompt-driven cards with approved positioning, audience, tone, and proof

## Current HITLOOP Brain Standard

The runtime Brain is the approved decision layer between raw client information and downstream creative execution.

```text
Research / Source Library / onboarding / socials / notes
  -> Studio review
  -> approved decisions
  -> CLIENT_BRAIN.md
  -> compiler
  -> Firestore runtime
  -> dashboard card defaults and AI prompt context
```

Important distinction:

- Source Library stores evidence, source files, docs, URLs, notes, and retrieval context.
- `CLIENT_BRAIN.md` stores only approved strategic decisions.
- Cards consume the compiled runtime, not the raw research.

Runtime precedence:

```text
manual card setting > approved Client Brain decision > company/default template > hardcoded fallback
```

This means the Brain should fill empty or generic card settings, but it should not silently override user-edited card settings.

## What The Agent Must Return

The agent should return two separate deliverables:

1. `CLIENT_BRAIN.md`
   - This is the only file meant to be injected into the Client Brain card.
   - It must be clean, concise, decision-grade, and compiler-compatible.
   - It should not contain raw research dumps, citations, source notes, or long explanations.

2. `RESEARCH_APPENDIX.md`
   - This can contain citations, source URLs, notes, rationale, open questions, and confidence commentary.
   - This belongs in Studio workspace docs or Source Library, not in the runtime Brain.

If the user only wants one deliverable, return `CLIENT_BRAIN.md` first and place any research notes after it under a clearly separate heading outside the code block.

## Required Runtime Shape

The returned `CLIENT_BRAIN.md` must use this shape:

```md
---
schemaVersion: hitloop.client-brain.v1
clientId: client-slug
clientName: Client Name
status: draft
updatedAt: YYYY-MM-DD
sourceStandard: studio-intelligence-standard-v1
---

# Client Name Client Brain

## Identity Intelligence

## Market Intelligence

## Discovery Intelligence

## Authority Intelligence

## Content Intelligence

## Opportunity Intelligence

## Decision Drivers
```

Use `status: draft` unless the operator explicitly says the Brain is approved for runtime. Use `status: approved` only when it should become authoritative runtime input.

The compiler reads `##` headings as intelligence domains and `###` headings as decision fields. Do not replace the seven required `##` sections.

## Compiler-Critical Fields

The Brain may include extra `###` fields for human readability, but card defaults only come from fields the compiler currently understands.

Make these fields strong before adding optional context:

| Brain section | Runtime-critical fields |
| --- | --- |
| `## Identity Intelligence` | `Name`, `Category To Own`, `Category To Avoid`, `Positioning`, `Primary Audience`, `Offers`, `Authority` or `Authority Claim`, `Primary Url` |
| `## Market Intelligence` | `Search Keywords`, `Competitors`, `Adjacent Competitors`, `Thought Leaders`, `Publications`, `Communities`, `Topics To Monitor` |
| `## Discovery Intelligence` | `Keywords`, `Primary Platforms`, `Communities`, `Publications`, `Podcasts`, `Events`, `Directories`, `Awards`, `Social Ecosystems`, `Hashtags`, `Watch Lists` |
| `## Authority Intelligence` | `Proof Points`, `Work History`, `Metrics`, `Allowed Claims`, `Prohibited Claims` |
| `## Content Intelligence` | `Content Pillars`, `Recurring Series`, `Topics To Own`, `Topics To Avoid`, `Voice`, `Voice Pillars`, `Example Posts`, `Creators I Emulate`, `Preferred Words`, `Formatting Rules`, `Do Not Say`, `Calls To Action` |
| `## Opportunity Intelligence` | `ICP Segments`, `Verticals`, `Geographies`, `Lead Gen Targets`, `Disqualifiers` |
| `## Decision Drivers` | `Own`, `Avoid`, `Search`, `Competitors`, `KOLs`, `Publications`, `Communities`, `Content Series`, `Campaigns`, `Lead Gen` |

Optional fields such as `Differentiators`, `Mission`, `Long-Term Positioning`, `Strategic One-Liner`, `Partnership Targets`, `Outreach Angles`, and `Qualification Signals` can help humans review the Brain, but they should not be the only place important runtime values appear. Mirror operational values into the compiler-critical fields above.

## Runtime-Safe List Rule

All lists in the runtime Brain must be clean values.

Good:

```md
### Watch Lists
- @examplefounder
- @examplebrand

### Search Keywords
- creative systems architecture
- AI workflow governance

### Competitors
- Fractional creative directors for startups
- AI workflow consultants for creative teams
```

Bad:

```md
- Daily | @examplefounder | strong source for founder content
- Category | creative systems architecture | use in Market Insights
- Competitor | AI workflow consultants: they overlap when...
```

Annotations, notes, evidence, and rationale belong in the research appendix. Runtime lists must stay clean so they can safely become card settings.

## How The Brain Disperses Into HITLOOP Cards

The agent should understand that each Brain section has operational consequences.

### Identity Intelligence

Feeds:

- Creative Brief positioning
- Strategy Builder campaign assumptions
- Post Me offer and CTA context
- Email Digest client framing
- Lead Gen qualification language

Must define:

- who the client is
- what they sell
- who hires them
- what category they should own
- what category they should avoid
- the approved public positioning
- the legitimate authority claim

### Market Intelligence

Feeds:

- Market Insights search configuration
- competitor monitoring
- trend/source selection
- Strategy Builder market context
- Email Digest priority topics

Must define:

- search keywords
- competitors
- adjacent competitors
- thought leaders
- publications
- communities
- topics to monitor

### Discovery Intelligence

Feeds:

- Market Insights keywords and watchlists
- X/social monitoring handles
- Lead Gen discovery surfaces
- Strategy Builder platform assumptions
- search and AI discovery strategy

Must define:

- discovery keywords
- primary platforms
- communities
- publications
- podcasts
- events
- directories
- awards
- social ecosystems
- hashtags
- watch lists

Watch lists should use clean handles when available, especially for X:

```md
- @handle
```

### Authority Intelligence

Feeds:

- Post Me proof points
- Creative Brief authority framing
- Lead Gen credibility
- Email Digest executive summaries
- claim safety

Must define:

- proof points
- work history
- metrics
- allowed claims
- prohibited claims

Never invent proof. If a claim is not source-backed, either omit it or place it in the appendix as a question.

### Content Intelligence

Feeds:

- Post Me tone and few-shot examples
- Strategy Builder content pillars and recurring series
- Email Digest tone
- Creative Brief copy guidance
- reply and comment generation

Must define:

- content pillars
- recurring series
- topics to own
- topics to avoid
- voice
- voice pillars
- example posts
- creators to emulate
- preferred words
- formatting rules
- do not say
- calls to action

The strongest tone signal is `### Example Posts`. These should be original sample posts written in the client's desired voice. Do not copy third-party posts.

### Opportunity Intelligence

Feeds:

- Lead Gen defaults
- outreach targeting
- partnership targeting
- Strategy Builder audience prioritization
- Market Insights vertical/location context

Must define:

- ICP segments
- verticals
- geographies
- lead gen targets
- partnership targets
- outreach angles
- qualification signals
- disqualifiers

### Decision Drivers

Feeds:

- the explanation layer for why card defaults exist
- search/category mapping
- KOL and publication watchlists
- content series selection
- lead gen focus
- campaign strategy

Decision Drivers are the bridge between strategy and operations. Each driver should describe one strategic territory the client should own.

Required format:

```md
## Decision Drivers

### Own Strategic Territory
Own:
- Strategic Territory

Avoid:
- Generic category to avoid

Search:
- clean search keyword

Competitors:
- clean competitor or competitor category

KOLs:
- @handle

Publications:
- publication name

Communities:
- community name

Content Series:
- recurring series name

Campaigns:
- campaign name

Lead Gen:
- ICP or target segment
```

## Deep Research Instructions

Use this workflow before writing the Brain.

1. Source audit

Review every provided source. If web access is available, research the client website, LinkedIn, X/Twitter, public interviews, podcasts, GitHub, product pages, press, reviews, and visible customer/community signals.

2. Identity synthesis

Resolve conflicting claims into one approved positioning direction. Do not store every source's wording equally. Decide what HITLOOP should believe about the client.

3. Market mapping

Identify direct competitors, adjacent competitors, category alternatives, relevant thought leaders, publications, communities, podcasts, events, and emerging topics.

4. Discovery mapping

Find the actual terms, handles, hashtags, communities, directories, platforms, and ecosystems that should drive discovery, search, market monitoring, social listening, and lead gen.

5. Authority extraction

Extract only defensible proof: work history, shipped projects, clients, metrics, testimonials, technical credibility, domain credibility, partnerships, and allowed claims. Flag unsupported claims in the appendix.

6. Voice synthesis

Read the client's actual writing if available. Produce a tone summary, voice pillars, preferred words, formatting rules, do-not-say list, and original example posts that imitate the client's desired style without copying source text.

7. Opportunity mapping

Define ICPs, verticals, geographies, lead gen targets, partnership targets, outreach angles, qualification signals, and disqualifiers.

8. Decision Driver construction

Create 3-8 strategic Decision Drivers. Each should be operational enough to seed search, content, campaigns, watchlists, and lead gen.

9. Runtime validation

Before returning the file, verify:

- frontmatter is present and valid
- seven required `##` sections exist
- important decision fields use `###` headings
- list values are clean and unannotated
- handles are formatted as handles where known
- no raw research dump is inside `CLIENT_BRAIN.md`
- unsupported claims are absent or listed as prohibited/open questions
- the Brain can seed Market Insights, Strategy Builder, Post Me, Email Digest, and Lead Gen

## Copy-Ready Master Prompt

Use the following prompt with another research agent.

```text
You are creating an upload-ready HITLOOP CLIENT_BRAIN.md for a specific client.

Your job is not to write a brand strategy memo. Your job is to deep research the client, resolve the research into approved strategic decisions, and return a clean runtime Brain that HITLOOP can compile into card defaults, prompt context, search settings, tone settings, discovery settings, and lead generation defaults.

Client:
- Name:
- Client ID / slug:
- Website:
- Primary geography:
- Primary platforms:
- Known social profiles:
- Known products/services:
- Known competitors:
- Existing docs or notes:
- Desired approval status: draft unless explicitly approved

Core HITLOOP rule:
CLIENT_BRAIN.md is not research. It is the approved runtime decision layer. Put evidence, citations, rationale, uncertainty, source notes, and open questions in a separate RESEARCH_APPENDIX.md. Only put clean decisions in CLIENT_BRAIN.md.

Architecture:
Research / Source Library / onboarding / socials / notes
  -> Studio review
  -> approved decisions
  -> CLIENT_BRAIN.md
  -> compiler
  -> Firestore runtime
  -> dashboard card defaults and AI prompts

Downstream precedence:
manual card setting > approved Client Brain decision > company/default template > hardcoded fallback

The Brain should be strong enough to replace generic defaults for this client across:
- Market Insights: search terms, excluded terms, categories, competitors, platforms, sources, handles, locations, verticals, freshness preferences
- Strategy Builder: audience segments, content pillars, recurring themes, offers, CTAs, campaign guardrails, do-not-say rules, preferred platforms
- Post Me: voice rules, post angles, handles to mention or avoid, proof points, offer language, default CTAs, banned claims
- Email Digest: priority topics, source watchlists, executive tone, digest sections, ignored topics, escalation keywords
- Lead Gen: ICPs, verticals, geography, disqualifiers, offer language, proof points, qualifying questions
- Creative Brief: approved positioning, audience, tone, proof, offers, and strategic guardrails

Research workflow:
1. Audit all provided sources.
2. If web access is available, research the website, LinkedIn, X/Twitter, public interviews, podcasts, GitHub, product pages, press, reviews, customers, communities, and competitor/category signals.
3. Resolve conflicting source facts into approved decisions. Do not store every source equally.
4. Map the market: competitors, adjacent competitors, thought leaders, publications, communities, podcasts, events, tools, startups, categories, and topics to monitor.
5. Map discovery: search terms, hashtags, X handles, LinkedIn sources, communities, directories, awards, social ecosystems, AI discovery/GEO terms, and places buyers already pay attention.
6. Extract authority: proof points, work history, metrics, claims allowed, claims prohibited, and unsupported claims to avoid.
7. Synthesize voice from actual writing when available. Create a tone summary, voice pillars, preferred words, formatting rules, do-not-say list, and original example posts.
8. Build opportunity intelligence: ICPs, verticals, geographies, lead gen targets, partnership targets, outreach angles, qualification signals, and disqualifiers.
9. Create 3-8 Decision Drivers that bridge strategy into card defaults.

Output requirements:
Return two files:

1. CLIENT_BRAIN.md
- Must be a standalone Markdown file.
- Must use the HITLOOP runtime schema below.
- Must contain only approved or draft strategic decisions.
- Must not include citations, research notes, long explanations, source commentary, or raw pasted notes.
- Lists must contain clean values only.
- Handles must be clean handles when known, such as @example.
- Search terms must be bare terms, not explanations.
- Competitors may be company names or competitor categories.
- Use status: draft unless the operator explicitly confirms status: approved.

2. RESEARCH_APPENDIX.md
- Include source URLs, citations, notes, confidence levels, unresolved questions, and rationale.
- Keep this separate from CLIENT_BRAIN.md.

CLIENT_BRAIN.md template to complete:

Format notes:
- `Voice Pillars` bullets must use: `name: ... | description: ... | do: ... | dont: ...`
- `Example Posts` bullets must use: `type: ... | label: ... | post: ...`
- `Formatting Rules` bullets must use keyed rules, such as `short: ...`, `medium: ...`, `caps: ...`, and `emojis: ...`
- `Partnership Targets`, `Outreach Angles`, and `Qualification Signals` are useful review fields, but mirror any operational values into `Lead Gen Targets` or `Decision Drivers` if they should affect card defaults.

---
schemaVersion: hitloop.client-brain.v1
clientId: client-slug
clientName: Client Name
status: draft
updatedAt: YYYY-MM-DD
sourceStandard: studio-intelligence-standard-v1
---

# Client Name Client Brain

## Identity Intelligence

### Name

### Category To Own

### Category To Avoid

### Positioning

### Primary Audience

### Offers

### Authority Claim

### Differentiators

### Mission

### Long-Term Positioning

### Core Philosophy

### Strategic One-Liner

### Safer Public One-Liner

### LinkedIn-Oriented One-Liner

### X-Oriented One-Liner

## Market Intelligence

### Search Keywords

### Competitors

### Adjacent Competitors

### Thought Leaders

### Publications

### Communities

### Topics To Monitor

## Discovery Intelligence

### Keywords

### Primary Platforms

### Communities

### Publications

### Podcasts

### Events

### Directories

### Awards

### Social Ecosystems

### Hashtags

### Watch Lists

## Authority Intelligence

### Proof Points

### Work History

### Metrics

### Allowed Claims

### Prohibited Claims

## Content Intelligence

### Content Pillars

### Recurring Series

### Topics To Own

### Topics To Avoid

### Voice

### Voice Pillars

### Example Posts

### Creators I Emulate

### Preferred Words

### Formatting Rules

### Do Not Say

### Calls To Action

## Opportunity Intelligence

### ICP Segments

### Verticals

### Geographies

### Lead Gen Targets

### Partnership Targets

### Outreach Angles

### Qualification Signals

### Disqualifiers

## Decision Drivers

### Own Strategic Territory 1
Own:
-

Avoid:
-

Search:
-

Competitors:
-

KOLs:
-

Publications:
-

Communities:
-

Content Series:
-

Campaigns:
-

Lead Gen:
-

Validation checklist before final answer:
- Frontmatter uses schemaVersion, clientId, clientName, status, updatedAt, and sourceStandard.
- The seven required ## sections are present.
- Decision fields are under ### headings.
- No raw research or citations are inside CLIENT_BRAIN.md.
- Runtime lists contain clean values only.
- Watch Lists use clean handles where possible.
- Search Keywords and Discovery Keywords are practical search terms.
- Content Intelligence includes voice, voice pillars, example posts, do-not-say, and CTAs.
- Authority Intelligence separates allowed claims from prohibited claims.
- Decision Drivers are present and complete.
- The file is strong enough to seed Market Insights, Strategy Builder, Post Me, Email Digest, Lead Gen, and Creative Brief defaults.
```

## Upload Guidance

Use the Client Brain card's `Source MD` / `.md` injection path for `CLIENT_BRAIN.md`.

Use Source Library for supporting docs, URLs, research appendices, notes, and evidence files.

Do not paste research appendices into the Client Brain runtime file unless their contents have been distilled into approved decision fields.
