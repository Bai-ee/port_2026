# Client Brain Schema

Client Brain has two layers:

- Source: `CLIENT_BRAIN.md`
- Runtime: compiled Firestore document at `clients/{clientId}/client_brain/current`

## Source Schema

Source files follow `hitloop.client-brain.v1`.

See `CLIENT_BRAIN_MARKDOWN_STANDARD.md` for the complete Markdown contract.

Required source sections:

- `Identity Intelligence`
- `Market Intelligence`
- `Discovery Intelligence`
- `Authority Intelligence`
- `Content Intelligence`
- `Opportunity Intelligence`
- optional `Decision Drivers`

## Runtime Schema

```ts
type ClientBrain = {
  clientId: string;
  version: number;
  status: "draft" | "suggested" | "generated" | "approved" | "stale";
  generatedBy?: "markdown" | "deterministic" | "model";

  markdownSource?: string;
  markdownMeta?: {
    schemaVersion?: "hitloop.client-brain.v1" | string;
    sourceStatus?: string;
    compiledAt?: string;
    clientName?: string;
  };

  identity: {
    name?: string;
    category?: string;
    description?: string;
    stage?: string;
    location?: string;
    primaryUrl?: string;
  };

  positioning: {
    oneLiner?: string;
    authorityPosition?: string;
    differentiation?: string[];
    valueProps?: string[];
    avoidPositioning?: string[];
  };

  voice: {
    toneSummary?: string;
    writingRules?: string[];
    preferredWords?: string[];
    bannedWords?: string[];
    pillars?: Array<{ name: string; description: string; do: string; dont: string }>;
    avoidPatterns?: string[];
    formattingRules?: object | string[];
    instagramFormatting?: object;
    scribeInstructions?: string;
    dailyBriefVoice?: { role?: string; sectionsTone?: object };
    exampleGood?: string[];
    exampleBad?: string[];
  };

  audience: {
    primary?: string[];
    secondary?: string[];
    motivations?: string[];
    objections?: string[];
    platforms?: string[];
  };

  offers: {
    services?: string[];
    products?: string[];
    callsToAction?: string[];
  };

  proof: {
    projects?: string[];
    metrics?: string[];
    testimonials?: string[];
    workHistory?: string[];
  };

  content: {
    pillars?: string[] | Array<{ type: string; description: string; pattern: string }>;
    postExamples?: Array<{ type: string; label: string; post: string }>;
    recurringSeries?: string[];
    linkedInStyle?: string;
    twitterStyle?: string;
    emailDigestStyle?: string;
  };

  discovery?: DiscoveryIntelligence;

  decisions?: {
    intelligence?: IntelligenceDomains;
    decisionDrivers?: DecisionDriver[];
    identity?: object;
    positioning?: object;
    audience?: object;
    voice?: object;
    offers?: object;
    proof?: object;
    search?: object;
    social?: object;
    market?: object;
    content?: object;
  };

  decisionAcquisition?: {
    methods?: Record<"automatic" | "interview" | "research" | "feedback" | "manual", number>;
    completionScore?: number;
    domainScores?: Record<string, number>;
    missingDecisionCount?: number;
    generatedAt?: string;
  };

  completion?: {
    score: number;
    informationalOnly: true;
    domains: Record<string, {
      score: number;
      completeFields: Array<{ path: string; label: string }>;
      missingFields: Array<{ path: string; label: string }>;
      approvedCount: number;
      requiredCount: number;
      sourceScore: number;
      trustScore: number;
      freshnessScore: number;
      conflictPenalty: number;
    }>;
    generatedAt?: string;
  };

  missingDecisionQueue?: Array<{
    priority: "low" | "medium" | "high";
    domain: "identity" | "authority" | "market" | "discovery" | "content" | "opportunity" | string;
    field: string;
    label: string;
    action: string;
  }>;

  cardDefaults?: {
    [cardId: string]: {
      fields?: Record<string, DecisionValue<unknown>>;
      lastBuiltAt?: string;
      lastAppliedAt?: string;
      lastAppliedBy?: string;
    };
  };

  cardSettingsSnapshot?: {
    [cardId: string]: {
      config: Record<string, unknown>;
      source: "card" | "client-brain" | "import";
      updatedAt?: string;
    };
  };

  aiContextPack: {
    shortContext?: string;
    longContext?: string;
    promptRules?: string[];
    downstreamUsage?: string[];
  };

  sourceRefs: ClientBrainSourceRef[];
  missingData: Array<{ field: string; reason: string; priority: "low" | "medium" | "high" }>;
  contradictions?: Array<{ field: string; values: Array<{ value: string; sources: string[] }>; note: string }>;
  confidence?: "low" | "medium" | "high";
  regenerationError?: string | null;
  generatedAt?: string;
  approvedAt?: string;
};

type DecisionValue<T> = {
  value: T;
  status: "suggested" | "approved" | "rejected" | "stale";
  confidence?: "low" | "medium" | "high";
  sourceIds?: string[];
  updatedBy?: "system" | "operator" | "import";
  updatedAt?: string;
  appliedToCards?: string[];
  acquisition?: {
    method: "automatic" | "interview" | "research" | "feedback" | "manual";
    confidenceReason?: string;
    researchRequired?: boolean;
    lastValidatedAt?: string;
    validationStatus?: "pending" | "approved" | "stale" | "rejected";
  };
};

type DiscoveryIntelligence = {
  keywords?: string[];
  primaryPlatforms?: string[];
  communities?: string[];
  publications?: string[];
  podcasts?: string[];
  events?: string[];
  directories?: string[];
  awards?: string[];
  socialEcosystems?: string[];
  hashtags?: string[];
  watchLists?: string[];
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

## Notes

- `markdownSource` is the authoritative editable source once present.
- `decisions.*`, `cardDefaults`, and `aiContextPack` are compiled/generated state.
- `sourceRefs[]` still support generated-source mode and legacy source toggles.
- Bryan-specific data must never be stored in schema defaults.
