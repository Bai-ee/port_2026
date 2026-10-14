# CLIENT_BRAIN.md Standard

## Purpose

`CLIENT_BRAIN.md` is the authoritative editable specification for a client's strategic identity.

It is not a research notebook. It contains approved runtime decisions only.

Humans edit the Markdown document. HITLOOP compiles it into structured runtime data:

```text
CLIENT_BRAIN.md
  -> normalize
  -> Decision Engine
  -> Firestore runtime data
  -> Dashboard cards
  -> AI prompts
  -> outputs
```

The Markdown is source. Firestore is compiled runtime state.

Studio research belongs in companion workspace documents such as `AUTHORITY_INTELLIGENCE.md`, `MARKET_INTELLIGENCE.md`, `DISCOVERY_INTELLIGENCE.md`, `CONVERSATION_INTELLIGENCE.md`, `CONTENT_LIBRARY.md`, and `RESEARCH/`. Approved conclusions from those documents may be published into `CLIENT_BRAIN.md`.

## File Contract

- Format: Markdown with optional YAML-style frontmatter.
- Schema version: `hitloop.client-brain.v1`.
- One canonical file per client: `CLIENT_BRAIN.md`.
- The established runtime document standard is defined in `COMPANY_BRAIN_DOCUMENT_STANDARD.md`.
- Project/company variants use the same structure with different scope:
  - `PROJECT_BRAIN.md`
  - `COMPANY_BRAIN.md`

## Frontmatter

```md
---
schemaVersion: hitloop.client-brain.v1
clientId: bryan-balli
clientName: Bryan Balli
status: approved
updatedAt: 2026-06-26
---
```

Supported fields:

- `schemaVersion`
- `clientId`
- `clientName`
- `status`: `draft | suggested | approved | stale`
- `updatedAt`
- `sourceStandard` (optional): the research standard the brain was built to, e.g. `studio-intelligence-standard-v1`.
  Kept in `markdownMeta.sourceStandard` for traceability; nothing gates on it.

## Required Sections

The compiler reads second-level headings as intelligence domains and third-level headings as decision fields.

```md
# Client Brain

## Identity Intelligence

### Name
Bryan Balli

### Category To Own
- Creative Systems Architecture
- Design Engineering

### Category To Avoid
- Generic AI agency
- Full-service marketing agency

### Positioning
Human-in-the-loop creative systems partner for founders and teams building AI-integrated workflows.

### Primary Audience
- Startup founders
- Creative agencies

### Offers
- Creative systems architecture
- AI workflow design

## Market Intelligence

### Search Keywords
- Creative systems
- Creative systems architect
- Creative operations

### Competitors
- Example competitor

### Thought Leaders
- @example

### Publications
- Figma blog
- Linear blog

### Communities
- Designer founders
- Creative technologists

## Discovery Intelligence

### Keywords
- Creative systems architecture
- AI workflow design

### Primary Platforms
- web
- x
- linkedin
- reddit

### Communities
- Creative technologists
- Founder Twitter

### Publications
- Figma blog
- Linear blog

### Podcasts
- Design Better

### Events
- Config

### Directories
- Product Hunt

### Awards
- Webby Awards

### Social Ecosystems
- Design Twitter
- AI Builders

### Hashtags
- #designengineering

### Watch Lists
- @example

## Authority Intelligence

### Proof Points
- 15+ years in enterprise adtech and creative technology

### Work History
- Greystripe
- ValueClick
- Conversant

### Allowed Claims
- Enterprise creative technology experience

### Prohibited Claims
- Guaranteed growth

## Content Intelligence

### Content Pillars
- AI Integration Notes
- Creative Systems

### Recurring Series
- Project Diaries

### Voice
Direct, precise, systems-minded, low-fluff.

### Voice Pillars
- name: Plainspoken | description: trade jargon for plain words | do: "I shipped X" | dont: "We're excited to announce X"
- name: Specific | description: numbers and nouns over adjectives | do: "cut load to 1.2s" | dont: "blazing fast"

### Example Posts
- type: observation | label: hook style I like | post: most "AI strategy" decks are just a feature list with a robot on the cover. the strategy is the sequencing.
- the bottleneck isn't the model, it's that nobody owns the prompt. assign one person.

### Creators I Emulate
- @swyx
- @levelsio

### Preferred Words
- shipped, built, cut, owns, bottleneck

### Formatting Rules
- short: 1–2 lines, no hashtags, lowercase ok
- medium: 3–4 short lines, one line break between ideas
- caps: never for emphasis
- emojis: none

### Do Not Say
- revolutionary
- game-changing

### Calls To Action
- Book a working session

## Opportunity Intelligence

### ICP Segments
- AI SaaS founders
- Creative agencies

### Verticals
- Developer tools
- Gaming

### Geographies
- Chicago
- San Francisco

### Lead Gen Targets
- Series A AI SaaS companies
```

## Voice Fidelity block (Content Intelligence) — "sound like me"

These optional `## Content Intelligence` sub-sections are the single source for tone
across the whole system for a client. Author them once here; every copy/reply surface
inherits them. All are optional — omit a section and the compiler leaves it empty, so
behavior is unchanged (back-compat).

| `CLIENT_BRAIN.md` section | Compiled field | Format | Consumed by |
|---|---|---|---|
| `### Voice` | `voice.toneSummary` (≤500 chars) | one paragraph | all voice consumers |
| `### Voice Pillars` | `voice.pillars[] {name,description,do,dont}` | `name: .. \| description: .. \| do: .. \| dont: ..` per bullet | Scribe/Guardian (`voice_pillars`); posts/replies (do/avoid lines) |
| `### Example Posts` | `content.postExamples[] {type,label,post}` → **`few_shot_examples`** | `type: .. \| label: .. \| post: ..`, **or a bare bullet** (whole line = the post) | Scribe/Guardian, Strategy Builder, Post Me, replies — the strongest "sound like me" lever |
| `### Creators I Emulate` | appended to `voice.scribeInstructions` | one handle/name per bullet | Scribe/Guardian |
| `### Preferred Words` | `voice.preferredWords[]` | comma or bullet list | rendered as `Do:` in context |
| `### Formatting Rules` | `voice.formattingRules{}` (keyed) | `key: value` bullets — `short`/`medium`/`long`/`caps`/`emojis`/`punctuation`/`links` | Scribe (`formatting_rules`, every key), Guardian (`punctuation`/`links` as `COPY RULES`, only when present), posts/replies (`Copy rules`) |
| `### Do Not Say` | `voice.bannedWords[]` | bullet list | rendered as `Do not:` everywhere |

**Two read paths, one source** (the compiled brain doc):
- `resolveVoiceProfile()` (`features/not-the-rug-brief/voice-resolver.js`) → `brand-voice.json` shape **incl. `few_shot_examples`** → Scribe + Guardian.
- `loadClientBrainContext({useFor})` (`features/client-brain/store.cjs`) → compact `CLIENT CONTEXT` text **now incl. an `Example posts (imitate this voice…)` block** → Strategy Builder, Post Me, Email Digest, and the reply-targets recipe (`recipe-run`).

**Persistence note:** `content.postExamples` has no bundle producer, so a Brain **Generate** would zero it — `generateAndSaveClientBrain` (store.cjs) preserves it across regen the same way `mergeVoice` preserves `voice.*`. The durable home is always this Markdown; re-Inject after edits.

**Legacy `brand-voice.json`** (`knowledge/{clientId}/`) is a **fallback only** — used when the approved brain has no voice content (`voice-resolver.js` precedence). Do not hand-author it as a parallel tone source.

## Optional fields beyond the core example

All optional. Omit a field and the compiler adds no key for it, so behavior is unchanged.

| Section › field | Compiled field | Format | Consumed by |
|---|---|---|---|
| Identity › `### Primary Url` | `identity.primaryUrl` | one URL | `Identity:` line in every context block |
| Identity › `### Authority Claim` | `positioning.authorityClaims[]` (all bullets); first → `positioning.authorityPosition` | one sentence per bullet, commas kept | `Authority:` (positioning useFors) |
| Identity › `### Differentiators` | `positioning.differentiators[]` | one sentence per bullet, commas kept | `Differentiators:` (positioning useFors) |
| Identity › `### Mission` | `identity.mission` | one sentence/paragraph (≤600) | `Mission:` (positioning useFors) |
| Identity › `### Long-Term Positioning` | `positioning.longTerm` | one sentence/paragraph (≤600) | `Long-term positioning:` (positioning useFors) |
| Identity › `### Core Philosophy` | `positioning.principles[]` | one principle per bullet, commas kept | `Principles:` (positioning + content useFors, incl. socialPosts) |
| Identity › `### Strategic One-Liner` | `positioning.channelOneLiners.strategic` | one line (≤300) | `Strategic one-liner:` (useFor `strategy`) |
| Identity › `### Safer Public One-Liner` | `positioning.channelOneLiners.safePublic` | one line (≤300) | `Public one-liner:` (positioning useFors: copy, emailDigest, …) |
| Identity › `### LinkedIn-Oriented One-Liner` | `positioning.channelOneLiners.linkedin` | one line (≤300) | compiled only — no LinkedIn consumer yet |
| Identity › `### X-Oriented One-Liner` | `positioning.channelOneLiners.x` | one line (≤300) | `X one-liner:` (useFor `socialPosts`) |
| Market › `### Adjacent Competitors` | `decisions.intelligence.market.adjacentCompetitors`, competitor search terms | list | Market Insights defaults |
| Market › `### Topics To Monitor` | `decisions.market.signalsToWatch`, search topics | list | Market Insights defaults |
| Authority › `### Metrics` | `proof.metrics[]` | one metric per bullet, commas kept (`$3,500`) | `Metrics:` (useFor `proof`, `emailDigest`), Proof Builder |
| Content › `### Topics To Own` / `### Topics To Avoid` | content pillars / driver `avoid` | list | Strategy Builder, drivers |
| Opportunity › `### Disqualifiers` | `audience.objections`, opportunity disqualifiers | list | `Objections:` (useFor `audience`) |

## Brain-owned card fields (brain-sync)

The Client Brain is the source of truth for strategy fields. `features/client-brain/brain-sync.cjs` holds the ownership
manifest: each card field has exactly one home section here.

- **Brain → card:** approving a Brain (or injecting an approved one) writes these values into every store below
  (`syncBrainToSystem`), plus the `scoutConfig` mirror. A field the Brain has nothing for is left alone.
- **Card → Brain:** saving a changed field in Market Signals / Listening rewrites its home section below and recompiles.
  Only fields changed in that save are written. Items the card can't show (past its cap, or an unsupported platform)
  are kept in the Brain.
- Approval status is kept in the Markdown frontmatter, so export / re-inject never silently un-approves.
- **One-time settings adoption:** before a client's first sync (on approve / inject of an approved Brain), its current
  settings are folded into the Brain **only where the Brain section is empty** (a derived value counts as empty). Where
  the Brain already has a value, the Brain wins and the first sync pushes it to the card. Stamped as `settingsAdoptedAt` on the Brain doc so it runs once. Preview any client read-only with
  `node scripts/client-brain/brain-sync-report.cjs <clientId>`.

| Card field (`marketingBriefConfig`) | Home section | Card cap / notes |
|---|---|---|
| `brandName` | Identity › `Name` | |
| `brandXHandle` | Identity › `X Handle` | stored without `@` |
| `brandKeywords` | Discovery › `Keywords` | 12, short search terms only |
| `categoryTerms` | Market › `Topics To Monitor` | 12 |
| `competitors` | Market › `Competitors` | 20 |
| `kols` (Listening watchlist) | Discovery › `Watch Lists` | 20 |
| `instagramHandles` | Discovery › `Instagram Handles` | 20 |
| `sourcePlatforms` | Discovery › `Primary Platforms` | supported: web, x, reddit, instagram, youtube, tiktok, hackernews |
| `searches` | Discovery › `Search Queries` (`label: \| query: \| goal:`) | 8; derived from Keywords / Topics / Competitors when absent |
| `sourceFocus` | Discovery › `Source Focus` | derived from Positioning + Primary Audience when absent |
| `scoutInstructions` | Discovery › `Scout Instructions` | ≤6000 |
| `scribeTone` | Content › `Voice` | |
| `scribeHardConstraints` | Content › `Hard Constraints` | 20; derived from Do Not Say when absent |
| `guardianReviewerContext` | Content › `Reviewer Context` | ≤800; derived from Name + Positioning when absent |
| `guardianRestrictedPatterns` | Authority › `Prohibited Claims` | 30 (Guardian rejects false claims) |
| `opportunitySignals.queries` | Opportunity › `Opportunity Queries` (`label: \| query: [\| enabled: false]`) | 10; on/off kept per row |
| `xGrowth.ownHandle` | Identity › `X Handle` (shared with `brandXHandle`) | X Strategy profile saves write back too |
| `xGrowth.benchmarkHandles` | Market › `Benchmark Accounts` | 8 |

| Strategy Builder field (`dashboard_state.strategyBuilder.config`) | Home section | Notes |
|---|---|---|
| `vertical` | Identity › `Industry` | derived from the first Category To Own when absent |
| `campaign.ctaText` | Content › `Calls To Action` (first item) | an edit replaces only the first CTA |
| `campaign.ctaUrl` | Content › `CTA Url` | derived from Primary Url when absent |
| `campaign.guardrails` | Content › `Hard Constraints` | card shows one rule per line; derived from Do Not Say when absent |
| `editorial.operatorPreferences.avoidTopics` | Content › `Topics To Avoid` | 20 |
| `editorial.operatorPreferences.preferredNarratives` | Content › `Content Pillars` | 20 |

Operational settings stay card-owned: cadence, days, post times, signal toggles, sources, emoji/hashtag limits,
editorial campaigns, events and local signals.

| Email Digest field (`digest_config/{clientId}`) | Home section | Notes |
|---|---|---|
| `tone` | Content › `Email Tone` | ≤200; derived from the first sentence of Voice when absent; the stock default counts as empty |
| `extraInstructions` | Content › `Email Instructions` | ≤2000 |
| `contactUrl` | Identity › `Contact Url` | |

| Brand Overview field (`dashboard_state.snapshot.brandOverview`, mirrored to `client_configs`) | Home section | Notes |
|---|---|---|
| `positioning` | Identity › `Positioning` | |
| `targetAudience` | Identity › `Primary Audience` | card shows a comma-joined line; Brain keeps bullets |
| `headline` | Identity › `Strategic One-Liner` | |
| `summary` | Identity › `Mission` | |
| `businessModel` | Identity › `Business Model` | derived from Offers when absent |
| `industry` | Identity › `Industry` | derived from the first Category To Own when absent |

Derived values only fill an empty field; they never replace a value an operator tuned. The Brand Overview sync does not
run the positioning bridge (it makes a paid model call); that still runs when the card itself is saved.

Context ordering under `maxChars` (callers pass 1500–2500; the cap trims from the end): the channel one-liner
(`X one-liner` for socialPosts, `Public one-liner` for positioning useFors) sits right under `About:` so it always
survives. The other narrative lines are appended last and trimmed first. To keep room, `Positioning:` is skipped when it
repeats `About:`, `Differentiation:` shows 6 items, `Do:` 12 and `Do not:` 24 (plus any source do-not-use notes).
`Differentiators` deliberately does **not** overwrite the legacy `positioning.differentiation` (Category To Own +
Authority Claim), which existing prompts and the decision engine already read.

## Strategy Document, Content Tracks and Track Targets

Three X Strategy surfaces are Brain-owned too (ownership manifest: `features/client-brain/brain-sync.cjs`).

**`## Strategy Document`** (its own `##` section, placed before `## Decision Drivers`). One `###` field per section of the
X Strategy document (`features/x-strategy/strategy-doc.js`), titled exactly as the doc titles them, prose or short
bullets, newlines kept:

| `###` title | Strategy doc key | Holds |
|---|---|---|
| `Thesis` | `thesis` | what the account is for and the one rule everything follows |
| `Audience` | `audience` | who to reach and what they come for |
| `Tracks` | `tracks` | the content lanes and why each exists |
| `Formats` | `formats` | which post types do which job |
| `Rules` | `rules` | do / don't, short checkable lines |
| `Algorithm` | `algorithm` | what the X ranking rewards and penalizes, as it applies here |
| `Decisions` | `decisions` | settled calls with date and evidence |
| `Open questions` | `open` | what is still being tested |

Omit a field to leave that section alone. The Brain owns the document outright: a Brain sync overwrites a section even
when the doc is already confirmed (the previous text stays in the doc's history). Saving a section in the Strategy tab
writes it back here.

**`## Content Intelligence` › `### Content Tracks`** — one bullet per track:

`- label: Design | share: 50 | topics: client work; process | benchmarks: seb__design; toshioueki`

`share` is a percent of authored posts; `topics` and `benchmarks` are `;`-separated (handles without `@`); `topics` and
`benchmarks` may be omitted. Engines and promotions stay owned by X Strategy.

**`## Content Intelligence` › `### Track Targets`** — one bullet per track:

`- track: Design | postsPerDay: 2 | original-showcase: 30 | original-text: 20 | reply: 30 | quote: 15 | self-quote: 5 | video: 40`

`track` is the track label from Content Tracks. The post-type keys are percent shares of that track's posts (they should
sum to 100); `video` is a cross-cut (percent of the track's posts that carry video). Omit a key to leave that target unset.

## Decision Drivers

Decision Drivers can be written explicitly, or the compiler can derive one from the intelligence domains.

Explicit format:

```md
## Decision Drivers

### Own Creative Systems Architecture

Own:
- Creative Systems Architecture

Avoid:
- Generic AI agency

Search:
- creative systems
- design engineering

Competitors:
- Example competitor

KOLs:
- @example

Publications:
- Figma blog

Communities:
- Creative technologists

Content Series:
- AI Integration Notes

Campaigns:
- Launch week

Lead Gen:
- AI SaaS founders
```

## Compiler Output

The compiler produces:

- `markdownSource`: original Markdown
- `markdownMeta`: schema/version/status metadata
- `identity`, `positioning`, `audience`, `voice`, `offers`, `proof`, `content`, `discovery`
- `decisions.intelligence`
- `decisions.decisionDrivers`
- `decisions.search`, `decisions.social`, `decisions.market`, `decisions.content`
- `decisionAcquisition`
- `completion`
- `missingDecisionQueue`
- `cardDefaults`
- `aiContextPack`

## Decision Acquisition

Every compiled `DecisionValue` may include acquisition metadata:

```ts
acquisition: {
  method: "automatic" | "interview" | "research" | "feedback" | "manual";
  confidenceReason?: string;
  researchRequired?: boolean;
  lastValidatedAt?: string;
  validationStatus?: "pending" | "approved" | "stale" | "rejected";
}
```

Markdown-sourced decisions default to `method: "manual"` because the document is the human-approved editing surface. Deterministic source generation defaults to `automatic`. Card settings promoted back into Client Brain use `feedback`.

## Precedence

Runtime precedence remains:

`manual card setting > approved Client Brain decision > company/default template > hardcoded fallback`

Markdown edit precedence:

`CLIENT_BRAIN.md source > compiled Firestore runtime`

Dashboard edits should eventually update the Markdown source, then recompile. Until every UI section is backed by Markdown editing, route-level promotion can continue writing compiled decisions and snapshots as a transitional bridge.
