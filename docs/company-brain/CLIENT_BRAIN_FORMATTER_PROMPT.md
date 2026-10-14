# Client Brain Formatter Prompt

Status: reusable prompt. Paste everything under **Prompt** into any model, then attach the inputs.

Use this when you already have material (market research, competitor notes, call transcripts, audits, social
exports, onboarding answers) and need it turned into an upload-ready `CLIENT_BRAIN.md` — or merged into an existing one.
For researching a client from scratch, use `CLIENT_BRAIN_DEEP_RESEARCH_MASTER_PROMPT.md` instead.

Standards this prompt implements: `COMPANY_BRAIN_DOCUMENT_STANDARD.md`, `CLIENT_BRAIN_MARKDOWN_STANDARD.md`.
Reference example: `clients/bryan-balli/CLIENT_BRAIN.md`.

---

## Prompt

You are formatting client research into a HITLOOP Client Brain. The Brain is a compiled runtime file: a parser reads it
and feeds search settings, watchlists, strategy, post copy, email digests and lead gen. Format errors silently break those
tools, so follow the structure exactly.

### Inputs

- `EXISTING_BRAIN` (optional): the current `CLIENT_BRAIN.md`. If present, you are **merging**, not rewriting.
- `NEW_MATERIAL`: one or more research documents, notes, transcripts or exports.
- `CLIENT_ID` and `CLIENT_NAME` (use the existing frontmatter values if present).

### Core rule

The Brain holds **approved decisions only**, not research. For every fact in `NEW_MATERIAL`, decide:

1. **Decision** (a value a tool should act on: a keyword, competitor, handle, claim, audience, pillar, CTA) → Brain.
2. **Evidence / reasoning / notes** (why, sources, quotes, stats, annotations) → companion file (see Output 2).
3. **Unclear or contradictory** → do not put it in the Brain; list it under Open Questions.

Never invent values. If the material doesn't support a field, leave the field out.

### Output 1 — `CLIENT_BRAIN.md`

Exact shape. Frontmatter, then `# Client Brain`, then only these eight `##` sections, in this order, with `###` fields.
Omit any `###` field you have no supported value for. Do not add other `##` or `#` headings.

```md
---
schemaVersion: hitloop.client-brain.v1
clientId: <CLIENT_ID>
clientName: <CLIENT_NAME>
status: draft
updatedAt: <YYYY-MM-DD>
sourceStandard: <optional; keep if the existing brain has it>
---

# Client Brain

## Identity Intelligence
### Name
### Primary Url
### X Handle
### Contact Url
### Industry
### Business Model
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
### Benchmark Accounts
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
### Instagram Handles
### Search Queries
### Source Focus
### Scout Instructions

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
### Content Tracks
### Track Targets
### Voice
### Voice Pillars
### Example Posts
### Creators I Emulate
### Preferred Words
### Formatting Rules
### Do Not Say
### Hard Constraints
### Reviewer Context
### Calls To Action
### CTA Url
### Email Tone
### Email Instructions

## Opportunity Intelligence
### ICP Segments
### Verticals
### Geographies
### Lead Gen Targets
### Disqualifiers
### Opportunity Queries

## Strategy Document
### Thesis
### Audience
### Tracks
### Formats
### Rules
### Algorithm
### Decisions
### Open questions

## Decision Drivers
### <Driver name>
Own:
- ...
Avoid:
- ...
Search:
- ...
Competitors:
- ...
KOLs:
- ...
Publications:
- ...
Communities:
- ...
Content Series:
- ...
Campaigns:
- ...
Lead Gen:
- ...
```

Field formats:

- **Lists**: one clean value per `- ` bullet. No annotations, labels, pipes, explanations or trailing notes.
  - Good: `- @jackbutcher` · `- creative systems` · `- Fractional creative directors`
  - Bad: `- Daily | @jackbutcher` · `- creative systems (high intent)` · `- Competitor X: wins on price`
- **Watch Lists / Thought Leaders / Creators I Emulate**: X handles with `@` when known; names otherwise.
- **Search Keywords / Keywords / Hashtags**: short search phrases (1–4 words), lowercase, no `#` in Keywords.
- **Positioning / Primary Audience / Voice**: one short paragraph each. `Voice` ≤ 500 characters.
- **Primary Url**: one URL on its own line.
- **X Handle**: the client's own X handle, e.g. `@hitloop`. **Instagram Handles**: Instagram accounts to watch, one per
  bullet.
- **Search Queries**: `- label: <BRAND|CATEGORY|…> | query: <search string, quotes and OR allowed> | goal: <why>`. Max 8.
- **Contact Url**: the booking/contact link used in email CTAs. **Industry**: one short phrase. **Business Model**: one
  sentence on how the client makes money.
- **Scout Instructions**: free-form guidance for the market scout (what to prioritize or ignore), ≤ 6000 characters.
- **Hard Constraints**: one rule per bullet that copy must never break (commas kept). **Reviewer Context**: one short
  paragraph telling the QA reviewer what this client is and what to protect (≤ 800 characters).
- **Email Tone**: a few words for the email digest summary voice (≤ 200 characters). **Email Instructions**: extra
  guidance for the digest summary (≤ 2000 characters).
- **Benchmark Accounts**: X handles the client measures itself against (≤ 8). **CTA Url**: the link the default call
  to action points to.
- **Opportunity Queries**: `- label: <name> | query: <search string>` per buying-signal search (≤ 10); add
  `| enabled: false` to keep a row but switch it off.
- **Source Focus**: one short paragraph telling the market scout what to look for (≤ 1000 characters).
- **Mission / Long-Term Positioning**: one sentence or short paragraph each (≤ 600 characters).
- **Strategic / Safer Public / LinkedIn-Oriented / X-Oriented One-Liner**: one line each (≤ 300 characters). The Safer
  Public line is for public copy and email; the X line is for social posts.
- **Authority Claim / Differentiators / Core Philosophy / Metrics**: one full sentence per `- ` bullet. Commas inside a
  bullet are kept (`- Engagements start at $3,500`), so never pack several values into one bullet here. Metrics only
  when the material states the number.
- **Voice Pillars**: `- name: <x> | description: <x> | do: "<example>" | dont: "<example>"`
- **Example Posts**: `- type: <observation|story|tip|announcement|…> | label: <why it's here> | post: <exact text>`
  or a bare bullet with the exact post text. Only real posts the client wrote or approved — never write new ones.
- **Formatting Rules**: `- key: value` with keys `short`, `medium`, `long`, `caps`, `emojis`, `punctuation`, `links`.
- **Preferred Words**: comma-separated or bullets.
- **Allowed / Prohibited Claims**: explicit. Anything unproven, guaranteed, or legally risky goes in Prohibited.
- **Strategy Document** (`##`, before Decision Drivers): the eight `###` titles above, exactly, each prose or short `- `
  bullets (newlines kept, no pipes needed). The Brain owns it outright: it overwrites even a confirmed strategy doc, so
  only put settled text here.
- **Content Tracks**: one bullet per track: `- label: Design | share: 50 | topics: client work; process | benchmarks: seb__design; toshioueki`.
  `share` is a percent; `topics` / `benchmarks` are `;`-separated (handles without `@`) and optional. Engines and
  promotions are not part of the Brain.
- **Track Targets**: one bullet per track: `- track: Design | postsPerDay: 2 | original-showcase: 30 | original-text: 20 | reply: 30 | quote: 15 | self-quote: 5 | video: 40`.
  `track` repeats the Content Tracks label; the type keys are percent shares (sum to 100), `video` is a cross-cut. Omit
  keys you have no figure for.
- **Decision Drivers**: 1–4 drivers, each a strategic territory. Groups: `Own:`, `Avoid:`, `Search:`, `Competitors:`,
  `KOLs:`, `Publications:`, `Communities:`, `Content Series:`, `Campaigns:`, `Lead Gen:`. Each group label on its own
  line followed by bullets. Omit empty groups.

### Merge rules (when `EXISTING_BRAIN` is given)

- Keep every existing value unless `NEW_MATERIAL` clearly supersedes or contradicts it.
- Add new values; de-duplicate (case-insensitive, ignore `@`).
- Never delete `Example Posts`, `Voice Pillars`, `Prohibited Claims` or `Do Not Say` entries without a direct reason in the
  material.
- Carry over every `###` field the existing brain has, even when `NEW_MATERIAL` doesn't mention it. This includes the
  less common ones: `Primary Url`, `X Handle`, `Contact Url`, `Industry`, `Business Model`, `Scout Instructions`,
  `Hard Constraints`, `Reviewer Context`, `Email Tone`, `Email Instructions`, `Benchmark Accounts`, `CTA Url`,
  `Opportunity Queries`, `Content Tracks`, `Track Targets`, the whole `Strategy Document` section (every `###` in it), `Instagram Handles`, `Search Queries`, `Source Focus`, `Authority Claim`, `Differentiators`, `Mission`, `Long-Term Positioning`,
  `Core Philosophy`, the four One-Liners, `Adjacent Competitors`, `Topics To Monitor`, `Metrics`, `Topics To Own`,
  `Topics To Avoid`, `Disqualifiers`, every Formatting Rules key, and every Decision Driver group. Missing from the
  shape above is not a reason to drop a field.
- Contradictions: keep the existing value, list the conflict under Open Questions.
- Keep `clientId`/`clientName` (and `sourceStandard` if present); set `status: draft` and today's `updatedAt` (a human
  re-approves).

### Output 2 — Companion notes

For each companion file that received material, output a section with its filename as a heading and Markdown content
(free-form: sources, quotes, stats, rationale, annotated lists). Use only these files:

| File | Gets |
|---|---|
| `MARKET_INTELLIGENCE.md` | market size, trends, competitor analysis, positioning rationale |
| `DISCOVERY_INTELLIGENCE.md` | where the audience is, platform notes, annotated communities/publications/events |
| `AUTHORITY_INTELLIGENCE.md` | proof evidence, case details, metrics, testimonials, claim sources |
| `CONVERSATION_INTELLIGENCE.md` | call/interview notes, customer language, objections, quotes |
| `CONTENT_LIBRARY.md` | full post archives, content performance, examples not chosen as Example Posts |
| `NETWORK_INTELLIGENCE.md` | annotated people/handles (cadence, role, why they matter) |

Each entry should note its source (document name, date, or URL).

### Output 3 — Change report

```md
## Change Report
### Added
- <section> › <field>: <value>
### Changed
- <section> › <field>: <old> → <new> (reason)
### Removed
- <section> › <field>: <value> (reason)
### Open Questions
- <conflict or unclear item, and what would resolve it>
### Not Used
- <material ignored, and why>
```

### Final checks before you answer

- Frontmatter has all five required keys (`sourceStandard` optional); `status: draft`.
- Exactly eight `##` sections, in order (Strategy Document sits right before Decision Drivers); nothing above them except `# Client Brain`.
- Every list value is clean (no `|`, `:`, `(`, ` — ` annotations) except Voice Pillars, Example Posts, Formatting Rules, Search Queries, Opportunity Queries, Content Tracks, Track Targets, and the Strategy Document prose.
- Content Tracks rows carry `label` and `share`; Track Targets rows carry `track` and use only the keys `postsPerDay`, `original-showcase`, `original-text`, `reply`, `quote`, `self-quote`, `video`; each track's type shares sum to 100.
- Formatting Rules keys only from `short`, `medium`, `long`, `caps`, `emojis`, `punctuation`, `links`.
- When merging: every `###` field and Decision Driver group in `EXISTING_BRAIN` is still present unless the Change Report
  lists its removal with a reason.
- No invented facts, posts, metrics or handles.
- Prohibited Claims and Decision Drivers present if the material supports them.

Return Output 1 in a single ```md code block, then Output 2, then Output 3. Nothing else.

---

## After the model returns

1. Review the Change Report and Open Questions.
2. Save `CLIENT_BRAIN.md` and companion notes under `docs/company-brain/clients/<client>/`.
3. Inject via the Client Brain card (BRAIN SOURCE), confirm the compile shows 0 missing decisions (or accept them), then
   approve — only `status: approved` reaches runtime tools.
