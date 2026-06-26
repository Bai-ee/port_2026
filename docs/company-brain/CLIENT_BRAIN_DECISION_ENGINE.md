# Client Brain as Decision Engine

## Decision

Client Brain is the authoritative client decision and configuration layer for HITLOOP.

It should not only provide prompt context. It should map the data every intelligent card needs, seed empty/default card settings, preserve operator overrides, and export a transportable client package.

## Product Principle

Client Brain is the approval layer between raw client information and every downstream creative decision.

The product question is:

What information is valuable enough to become an approved decision?

The answer: only decision-grade intelligence. A source fact is not automatically a decision. A decision is the resolved, approved value the rest of HITLOOP should trust.

Example:

- Website says: `creative agency`
- Founder interview says: `AI consulting for creative operations`
- Client Brain decision says: `Human-in-the-loop AI consulting partner for creative operations`

Downstream cards should consume the decision, not re-litigate the raw facts.

Raw information goes in:

- website and basic site scrape
- onboarding answers
- uploaded docs and knowledge base items
- social profile URLs and past posts
- manual notes
- card outputs and operator overrides

Approved decisions come out:

- positioning
- audience
- voice
- offer language
- proof points
- search terms
- market categories
- competitors
- social handles and watchlists
- excluded terms and do-not-say rules
- card-specific defaults

Downstream cards then consume approved understanding instead of re-interpreting the client from scratch.

## Decision-Grade Intelligence Domains

Client Brain should organize approved decisions into six intelligence domains.

### 1. Identity Intelligence

Answers:

- who the client is
- what they actually sell
- who hires them
- what category they should own
- what category they should avoid
- what authority they can legitimately claim

Example values:

- category to own
- category to avoid
- positioning language
- service model
- audience definition
- legitimate authority claim

### 2. Market Intelligence

Answers:

- which competitors matter
- which adjacent competitors matter
- which thought leaders matter
- which publications and news sources matter
- which communities, conferences, podcasts, brands, tools, and startups matter

This domain feeds Market Insights, search configuration, watchlists, and source selection.

Example values:

- direct competitors
- adjacent competitors
- thought leaders
- industry publications
- influencers
- founder/operator accounts
- communities
- podcasts
- conferences
- brands to watch
- tools and emerging startups

### 3. Discovery Intelligence

Answers:

- where the client should be discovered
- which search terms should be monitored
- which platforms matter most
- which communities, publications, podcasts, events, directories, awards, hashtags, and watchlists should guide discovery

This domain feeds Market Insights, Lead Gen, Strategy Builder, search configuration, and watchlists.

Example values:

- discovery keywords
- primary platforms
- communities
- publications
- podcasts
- conferences and events
- directories
- awards
- social ecosystems
- hashtags
- KOL/watch lists

### 4. Authority Intelligence

Answers:

- why someone should trust this client
- what proof exists
- what claims are supported
- what claims are not supported

This is evidence, not a resume. It should separate verified proof from inferred positioning.

Example values:

- work history
- client logos
- project history
- metrics
- technical credibility
- domain credibility
- partnerships
- testimonials
- claims allowed
- claims prohibited

### 5. Content Intelligence

Answers:

- what topics the client should own
- what recurring themes matter
- what stories matter
- what formats fit
- what opinions are approved
- what topics to avoid

This domain feeds Strategy Builder, Post Me, Email Digest, and future newsletter/content systems.

Example values:

- content pillars
- recurring post series
- micro-insights
- frameworks
- stories
- opinions
- formats
- example hooks
- example phrasing
- topics to avoid

### 6. Opportunity Intelligence

Answers:

- which opportunities should HITLOOP pursue for this client
- which ICPs matter
- which verticals/geographies matter
- which partnership targets matter
- which lead-gen segments are worth testing

This domain feeds Lead Gen, outreach, partnership, and GTM cards.

Example values:

- ICP segments
- opportunity targets
- verticals
- geographies
- partnership targets
- outreach angles
- qualification signals
- disqualifiers

## Decision Drivers

The earlier `search`, `social`, `market`, and `content` sections are card-facing projections. They should be derived from a smaller set of approved Decision Drivers.

A Decision Driver is one approved strategic bet that multiple cards can use.

Example:

```json
{
  "id": "creative-systems-architecture",
  "label": "Own Creative Systems Architecture",
  "own": ["Creative Systems Architecture"],
  "avoid": ["generic AI agency", "full-service agency"],
  "search": ["creative systems", "creative systems architect", "design engineering"],
  "competitors": [],
  "kols": [],
  "publications": ["Figma blog", "Linear blog", "a16z"],
  "communities": ["designer founders", "creative technologists"],
  "contentSeries": ["AI Integration Notes", "Creative Systems"],
  "campaigns": ["Founder education", "Creative ops authority"],
  "leadGen": ["AI SaaS founders", "creative agencies", "developer tools"]
}
```

That single object can seed Market Insights, Strategy Builder, Post Me, Email Digest, and Lead Gen at the same time.

Decision Drivers should be the bridge between strategic judgment and operational card settings.

## Current Runtime

Implemented behavior:

```text
CLIENT_BRAIN.md
  -> compiler
  -> decisions.intelligence + decisions.decisionDrivers
  -> cardDefaults + aiContextPack
  -> Firestore runtime
  -> downstream cards
```

The older deterministic generator still exists as a fallback/source-assembly path, but the committed standard is Markdown source compiled into runtime state.

`CLIENT_CONTEXT` remains the compact text block for prompts.

`DECISION_PACK` is structured approved client knowledge.

`CARD_DEFAULTS` is the per-card configuration map that seeds cards. Marketing Brief / Market Signals is the first wired structured-default consumer.

`DECISION_DRIVERS` is the reusable strategic map that explains why those card defaults exist.

## Flow

### 1. Bootstrap

After onboarding, Client Brain runs from non-circular inputs:

- client record
- onboarding answers
- website URL and basic metadata
- known social profile links
- uploaded docs
- manual notes
- existing saved card configs, if any

It should not require Market Insights or web search to run first. That would create a circular dependency.

Bootstrap output is a suggested decision pack:

```json
{
  "status": "suggested",
  "decisions": {
    "intelligence": {},
    "decisionDrivers": [],
    "positioning": {},
    "audience": {},
    "voice": {},
    "offers": {},
    "proof": {},
    "search": {},
    "social": {},
    "market": {},
    "content": {}
  },
  "cardDefaults": {
    "market-insights": {},
    "strategy-builder": {},
    "post-me": {},
    "email-digest": {},
    "leadgen": {}
  }
}
```

### 2. Approval

The operator reviews suggested decisions and approves, edits, or rejects them.

Approved decisions become eligible for downstream use.

Rejected suggestions remain as history, not active guidance.

### 3. Card Seeding

Cards pull defaults from Client Brain when they open, bootstrap, or run.

The precedence rule is:

`manual card setting > approved Client Brain decision > company/default template > hardcoded fallback`

Client Brain should fill empty fields automatically. It should not silently overwrite fields the user already edited.

### 4. Independent Card Runs

After Client Brain has seeded a card, cards run independently.

Market Insights, Strategy Builder, Post Me, Email Digest, and Lead Gen should own their execution state, toggles, last runs, and run history.

Client Brain gives them approved assumptions and defaults. It does not replace their internal controls.

### 5. Feedback Loop

When a user changes a card value, the card should record whether that value is:

- a local override for this card only
- a new approved client decision
- a rejected Client Brain suggestion

If the user chooses to promote the override, the value feeds back into Client Brain.

Example:

1. Client Brain suggests `creative automation` as a search term.
2. Market Insights operator changes it to `creative ops automation`.
3. The card saves its local config immediately.
4. UI offers `Update Client Brain`.
5. If approved, Client Brain records the new term as an approved search decision and future cards can use it.

## Card Behavior

### Market Insights

Client Brain should seed:

- search terms
- excluded terms
- market categories
- competitors
- platforms to monitor
- source priorities
- known handles/accounts
- locations or verticals
- freshness preferences

Market Insights should return:

- discovered terms
- discovered competitors
- discovered accounts or handles
- validated categories
- noisy/excluded terms
- source performance notes

Those returns become candidate decisions for Client Brain approval.

### Strategy Builder

Client Brain should seed:

- audience segments
- content pillars
- recurring themes
- offers
- CTAs
- campaign guardrails
- do-not-say rules
- preferred platforms

Strategy Builder should return:

- successful angles
- edited CTAs
- rejected topics
- post formats that fit the client

### Post Me

Client Brain should seed:

- voice rules
- post angles
- handles to mention or avoid
- default CTAs
- proof points
- offer language
- banned claims

Post Me should return:

- edited post language
- approved phrasing
- rejected phrasing
- working hooks
- recurring post patterns

### Email Digest

Client Brain should seed:

- priority topics
- source watchlists
- executive tone
- digest sections
- ignored topics
- escalation keywords

Email Digest should return:

- topics the user repeatedly cares about
- sections the user disables
- watchlist terms to add or remove

### Lead Gen

Client Brain should seed:

- ICP
- verticals
- geography
- disqualifiers
- offer language
- proof points
- qualifying questions

Lead Gen should return:

- high-performing verticals
- excluded prospects
- objections discovered during outreach
- offer language that converts

## Data Model

Canonical runtime document:

`clients/{clientId}/client_brain/current`

Current top-level concepts:

```ts
type ClientBrainDecisionEngine = {
  decisions: {
    positioning?: DecisionSection;
    audience?: DecisionSection;
    voice?: DecisionSection;
    offers?: DecisionSection;
    proof?: DecisionSection;
    search?: {
      keywords?: DecisionValue<string[]>;
      excludedTerms?: DecisionValue<string[]>;
      topicsToMonitor?: DecisionValue<string[]>;
      competitorTerms?: DecisionValue<string[]>;
    };
    social?: {
      handlesToFollow?: DecisionValue<string[]>;
      handlesToAvoid?: DecisionValue<string[]>;
      platforms?: DecisionValue<string[]>;
      replyTargets?: DecisionValue<string[]>;
      postAngles?: DecisionValue<string[]>;
    };
    market?: {
      categories?: DecisionValue<string[]>;
      verticals?: DecisionValue<string[]>;
      locations?: DecisionValue<string[]>;
      signalsToWatch?: DecisionValue<string[]>;
    };
    content?: {
      pillars?: DecisionValue<string[]>;
      recurringSeries?: DecisionValue<string[]>;
      defaultCtas?: DecisionValue<string[]>;
      doNotSay?: DecisionValue<string[]>;
    };
    intelligence?: {
      identity?: IdentityIntelligence;
      market?: MarketIntelligence;
      authority?: AuthorityIntelligence;
      content?: ContentIntelligence;
      opportunity?: OpportunityIntelligence;
    };
    decisionDrivers?: DecisionDriver[];
  };
  cardDefaults: {
    [cardId: string]: {
      fields: Record<string, DecisionValue<unknown>>;
      lastAppliedAt?: string;
      lastAppliedBy?: string;
    };
  };
  cardSettingsSnapshot: {
    [cardId: string]: {
      config: Record<string, unknown>;
      updatedAt?: string;
      source: "card" | "client-brain" | "import";
    };
  };
  decisionHistory: DecisionEvent[];
};

type DecisionValue<T> = {
  value: T;
  status: "suggested" | "approved" | "rejected" | "stale";
  confidence?: "low" | "medium" | "high";
  sourceIds?: string[];
  updatedBy?: "system" | "operator" | "import";
  updatedAt?: string;
  appliedToCards?: string[];
};

type DecisionDriver = {
  id: string;
  label: string;
  status: "suggested" | "approved" | "rejected" | "stale";
  confidence?: "low" | "medium" | "high";
  sourceIds?: string[];
  own?: string[];
  avoid?: string[];
  search?: string[];
  competitors?: string[];
  kols?: string[];
  publications?: string[];
  communities?: string[];
  contentSeries?: string[];
  campaigns?: string[];
  leadGen?: string[];
};
```

The important design choice: card configs remain operationally owned by their cards, but Client Brain keeps a synchronized snapshot and exportable map. That avoids breaking existing card behavior while still making Client Brain the portable client data package.

## Transportable Client Package

The export route returns a versioned HITLOOP Client Package.

Recommended standard:

- primary format: JSON validated by JSON Schema
- optional archive format: ZIP containing JSON plus source/artifact manifests
- file extension: `.hitloop-client.json` for single-file export, `.hitloop-client.zip` when assets are included
- schema style: JSON Schema Draft 2020-12
- compatibility: include `schemaVersion`, `exportedAt`, `clientId`, and `sourceSystem`

Single-file shape:

```json
{
  "schemaVersion": "hitloop.client-package.v1",
  "exportedAt": "2026-06-26T00:00:00.000Z",
  "sourceSystem": "HITLOOP",
  "client": {},
  "clientBrain": {
    "status": "approved",
    "markdownSource": "...",
    "markdownMeta": {},
    "decisions": {},
    "intelligence": {},
    "decisionDrivers": [],
    "aiContextPack": {},
    "sourceRefs": []
  },
  "cardConfigs": {
    "market-insights": {},
    "strategy-builder": {},
    "post-me": {},
    "email-digest": {}
  },
  "cardSettingsSnapshot": {},
  "decisionHistory": [],
  "sourcesManifest": [],
  "artifactsManifest": []
}
```

ZIP shape:

```text
client-package.json
schema/client-package.schema.json
sources/manifest.json
artifacts/manifest.json
artifacts/...
```

Do not put large binary files directly into the JSON. Export them as archive assets with manifest entries.

## Sync Rules

### Brain to Card

Client Brain can write to a card only when:

- the target field is empty
- the target field has not been manually edited
- the operator explicitly clicks apply
- the import flow is restoring a package

### Card to Brain

A card can write back to Client Brain when:

- a manual override replaces a suggested value
- a card discovers a new term, handle, category, or setting worth preserving
- the operator explicitly promotes the value
- an approved card run produces durable strategic information

### Conflict Handling

If Client Brain and a card disagree:

- preserve the card value as the active operational value
- record the disagreement in Client Brain
- show the conflict in the Client Brain UI
- require approval before changing the approved decision

## UI Implications

Client Brain should show:

- Sources: raw inputs and evidence
- Decisions: approved understanding and structured defaults
- Card Defaults: what values each card receives
- Consumers: which cards consume each decision
- Conflicts: card overrides that disagree with approved understanding
- Export: full client package and context pack

Cards should show:

- `Suggested by Client Brain`
- `Applied from Client Brain`
- `Manual override`
- `Update Client Brain`
- `Detach from Client Brain`

This makes the relationship visible instead of magic.

## Implementation State

Done:

- `CLIENT_BRAIN.md` standard documented.
- Markdown compiler implemented in `features/client-brain/markdown.cjs`.
- Runtime decision pack, intelligence domains, decision drivers, card defaults, and context pack are generated.
- `GET /api/dashboard/client-brain` returns `markdownSource` or a template.
- `POST /api/dashboard/client-brain` compiles `{ markdownSource }`.
- Export includes `CLIENT_BRAIN_MD`, compiled package, decisions, defaults, snapshots, and manifests.
- Marketing Brief / Market Signals config consumes approved Brain defaults without overwriting manual fields.
- Marketing Brief / Market Signals config writes saved settings back into the Brain snapshot/promoted decisions.
- Compiler/store tests cover the current shape.

Available helpers:

- `loadClientBrainDecisions(clientId, { cardId })`
- `loadClientBrainCardDefaults(clientId, { cardId })`
- `loadClientBrainContext(clientId, { useFor })`
- `saveClientBrainCardSettingsSnapshot(clientId, { cardId, config, promote })`
- `compileAndSaveClientBrainMarkdown(clientId, markdownSource)`

Remaining:

- Add a first-class Markdown editor in the Client Brain card.
- Move all dashboard Brain edits to update Markdown source and recompile.
- Add version history and rollback for `CLIENT_BRAIN.md`.
- Add import flow for `.hitloop-client.json` / `.hitloop-client.zip`.
- Extend structured defaults to Strategy Builder, Post Me, Email Digest, and Lead Gen.
