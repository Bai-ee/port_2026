# Client Brain Schema

Canonical document:

`clients/{clientId}/client_brain/current`

Core fields:

```ts
type ClientBrain = {
  clientId: string;
  version: number;
  status: "draft" | "generated" | "approved" | "stale";
  identity: object;
  positioning: object;
  voice: object;
  audience: object;
  offers: object;
  proof: object;
  content: object;
  aiContextPack: {
    shortContext?: string;
    longContext?: string;
    promptRules?: string[];
    downstreamUsage?: string[];
  };
  missingData: Array<{ field: string; reason: string; priority: "low" | "medium" | "high" }>;
  sourceRefs: ClientBrainSourceRef[];
  generatedAt?: string;
  approvedAt?: string;
};
```

`sourceRefs[]` define source trust, freshness, relevance, enabled state, and use-for controls. Bryan-specific data must not be stored in schema defaults.

