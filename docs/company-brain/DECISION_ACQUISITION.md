# Decision Acquisition

Decision Acquisition describes how a Client Brain decision entered the system and how trustworthy it is.

It extends the existing Client Brain runtime. It does not replace `Decision Pack`, `Decision Drivers`, `Card Defaults`, `Context Pack`, the Markdown compiler, Firestore path, or downstream card behavior.

## Methods

Every `DecisionValue` can include:

```ts
acquisition: {
  method: "automatic" | "interview" | "research" | "feedback" | "manual";
  confidenceReason?: string;
  researchRequired?: boolean;
  lastValidatedAt?: string;
  validationStatus?: "pending" | "approved" | "stale" | "rejected";
}
```

Method meanings:

- `automatic`: discovered from enabled sources such as website, onboarding, metadata, uploads, or deterministic card state.
- `interview`: collected through onboarding or operator/client questions.
- `research`: produced by external market, competitor, community, KOL, or publication research.
- `feedback`: promoted from durable card settings or card outputs.
- `manual`: written directly into `CLIENT_BRAIN.md` or edited by an operator.

## Runtime Summary

The runtime stores an informational summary:

- `decisionAcquisition.methods`
- `decisionAcquisition.completionScore`
- `decisionAcquisition.domainScores`
- `decisionAcquisition.missingDecisionCount`

This gives the operator a quick view of how much of the Brain came from passive discovery, direct approval, research, or operational feedback.

## Card Feedback Loop

Cards can still run independently after onboarding. When a card setting becomes durable enough to reuse, the card can promote it back into Client Brain.

Current wired example:

```text
Marketing Brief config save
  -> saveClientBrainCardSettingsSnapshot(..., { promote: true })
  -> decisions.search/social/market updated
  -> acquisition.method = "feedback"
  -> completion and missingDecisionQueue refreshed
```

The promoted value now travels with the client package and can seed future cards.

## Operator Flow

1. Client Brain compiles or regenerates suggested decisions.
2. Operator reviews missing decisions and acquisition status.
3. Operator fills gaps through interview, research, card feedback, or direct Markdown edits.
4. Approved decisions become the source for downstream defaults and prompt context.

Raw research is not the final artifact. Suggested or approved decisions are.
