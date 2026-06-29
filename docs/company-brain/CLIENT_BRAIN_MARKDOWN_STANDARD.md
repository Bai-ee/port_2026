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
| `### Formatting Rules` | `voice.formattingRules{}` (keyed) | `key: value` bullets — `short`/`medium`/`long`/`caps`/`emojis` | Scribe (`formatting_rules`), posts/replies (`Copy rules`) |
| `### Do Not Say` | `voice.bannedWords[]` | bullet list | rendered as `Do not:` everywhere |

**Two read paths, one source** (the compiled brain doc):
- `resolveVoiceProfile()` (`features/not-the-rug-brief/voice-resolver.js`) → `brand-voice.json` shape **incl. `few_shot_examples`** → Scribe + Guardian.
- `loadClientBrainContext({useFor})` (`features/client-brain/store.cjs`) → compact `CLIENT CONTEXT` text **now incl. an `Example posts (imitate this voice…)` block** → Strategy Builder, Post Me, Email Digest, and the reply-targets recipe (`recipe-run`).

**Persistence note:** `content.postExamples` has no bundle producer, so a Brain **Generate** would zero it — `generateAndSaveClientBrain` (store.cjs) preserves it across regen the same way `mergeVoice` preserves `voice.*`. The durable home is always this Markdown; re-Inject after edits.

**Legacy `brand-voice.json`** (`knowledge/{clientId}/`) is a **fallback only** — used when the approved brain has no voice content (`voice-resolver.js` precedence). Do not hand-author it as a parallel tone source.

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

KOLs:
- @example

Publications:
- Figma blog

Communities:
- Creative technologists

Content Series:
- AI Integration Notes

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
