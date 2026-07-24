# Opportunity Signals Proof Builder — evidence before response

**Status:** v1 IMPLEMENTED + SHIPPED 2026-07-24. Verified live (real Anthropic calls, no Firestore writes): no-context path against HITLOOP's actual (draft, unapproved) Client Brain correctly returned empty possibleProof + needs_evidence; a synthetic rich-context test found a high-confidence match but still chose needs_evidence over ready — the model distinguished "similar project happened" from "artifact ready to show," matching the intended conservative bias. Full SSOT: [`docs/source-of-truth/OPPORTUNITY-SIGNALS-PROOF-BUILDER.md`](../source-of-truth/OPPORTUNITY-SIGNALS-PROOF-BUILDER.md).
**Created:** 2026-07-24  
**Owner:** Market Signals / Opportunity Signals / Client Brain  
**One-line:** Add a Proof Builder layer after Opportunity Signals so the system identifies what evidence the client can show before it suggests a reply or outreach angle.

---

## Review of the feature idea

The proposed feature is directionally correct because it fixes the biggest risk in Opportunity Signals: jumping from "we found a post" to "AI wrote a reply" without proving why the response is credible.

The stronger workflow is:

```text
post found
  -> problem detected
  -> trust requirement identified
  -> relevant proof searched
  -> missing evidence questions asked
  -> proof asset recommended
  -> response angle generated only when grounded
```

The key question is:

```text
What can the client show that makes this response true?
```

For Bryan/HITLOOP, that means work like Not The Rug, Viva Acid, HITLOOP positioning, launch systems, AI-human correction examples, dashboards, visual systems, and before/after work. For other clients, the same mechanic should draw from their Client Brain proof, Knowledge Base, uploaded examples, offers, case studies, testimonials, metrics, and prior generated briefs.

## Product framing

Proof Builder is the **next action layer** for Opportunity Signals. It is not a search feature, not onboarding, and not a CRM. It sits between a detected opportunity and any response draft.

V1 should help the operator assemble proof, not automate outreach.

Primary output:

- detected problem
- what the lead needs to believe
- best proof type
- possible proof from existing work
- targeted questions for the operator/client
- recommended lightweight proof asset
- optional grounded response framework

## Non-goals for v1

Do not:

- auto-send replies
- auto-send emails
- create social post drafts automatically
- create Gmail drafts
- write to `leadgen_prospects`
- create a full CRM
- require onboarding
- promise case-study proof when the source data does not support it

The system may suggest a response only after it has an `evidence` field or explicitly marks the response as weak due to missing proof.

---

## Core rule

Every suggested response must include four fields:

```js
{
  observation: 'What did we notice?',
  relevance: 'Why does the client understand this?',
  evidence: 'What can the client show?',
  invitation: 'What is the smallest natural next step?'
}
```

If `evidence` is missing, empty, or speculative, the UI and API should flag the response as weak and should not present it as ready to use.

Suggested warning:

```text
Weak response: no concrete proof selected yet.
```

---

## Proof Builder output shape

For each selected Opportunity Signals item, produce:

```js
{
  opportunityId: 'stable item id or URL hash',
  sourceUrl: '...',
  detectedProblem: 'Their AI-built website works, but feels generic.',
  trustRequirement: 'They need to believe the client can create distinction without restarting the build.',
  proofType: 'before_after|annotated_teardown|raw_input_to_final|process_timeline|multi_asset_system|live_prototype|client_quote|measurable_result|human_ai_correction|personalized_concept',
  possibleProof: [
    {
      title: 'Not The Rug visual system',
      source: 'client_brain|knowledge_base|manual|brief|portfolio',
      whyItFits: 'Shows a distinct visual language across multiple assets.',
      confidence: 'high|medium|low'
    }
  ],
  targetedQuestions: [
    'Do you have a before image?',
    'Which generic pattern did you remove?',
    'Which three creative rules made the final work distinct?'
  ],
  recommendedProofAsset: {
    title: 'Generic to Ownable',
    format: 'Three-slide teardown',
    ingredients: [
      'Screenshot of original',
      'One sentence naming the generic pattern',
      'Screenshot of finished work',
      'Three rules that made it specific'
    ],
    effort: 'low|medium|high'
  },
  responseFramework: {
    observation: '...',
    relevance: '...',
    evidence: '...',
    invitation: '...'
  },
  readiness: 'ready|needs_evidence|not_enough_fit',
  riskNotes: []
}
```

## Proof types

Use this small proof-format catalog:

1. Before and after
2. Annotated teardown
3. Raw input to final output
4. Process timeline
5. System across multiple assets
6. Live prototype
7. Client quote
8. Measurable result
9. Human correction of AI output
10. Personalized concept for the lead

The system should not assume all proof types are available. It should select the best format based on the detected problem and ask only questions that could produce usable evidence.

---

## Reusable proof recipes

These are default templates. They should be data, not hardcoded one-off logic.

### 1. Our website feels generic

They need to see:

- the client can identify why something feels generic
- the client can translate that diagnosis into a distinct visual system
- the client can preserve what works while changing the identity

Possible proof:

- before/after
- annotated teardown
- human correction of AI output
- system across multiple assets

Questions:

- Do you have the original website or direction?
- Which generic pattern did you remove?
- Which visual rules did you introduce?
- Can you show the same page before and after?
- Did you preserve existing technical work?
- What now makes the final result recognizable without the logo?

Proof package: **Generic to Ownable**

- screenshot of original
- one sentence identifying the generic pattern
- screenshot of finished work
- three rules that made it specific to the brand

### 2. We need a new website, but cannot explain what we want

They need to see:

- the client can turn loose ideas into coherent direction
- the client can make creative decisions without forcing the buyer to become the creative director

Possible proof:

- raw input to final output
- process timeline
- annotated creative brief

Questions:

- Do you have rough notes from the client?
- Did they provide conflicting references?
- What did you extract from those references?
- Can you show an early brief beside the final result?
- Which decisions did you make on their behalf?
- How did you reduce the number of choices they needed to make?

Proof package: **From Messy Notes to Direction**

- raw client input
- organized creative brief
- design rules
- final screen

### 3. Our website is finished, but it is not helping us sell

They need to see:

- the client understands positioning, hierarchy, credibility, and conversion
- the client can improve the offer, not just polish visuals

Possible proof:

- annotated teardown
- before/after
- measurable result when available

Questions:

- What was unclear before?
- Did you rewrite the offer?
- Did you reorganize the homepage hierarchy?
- What proof was missing from the original site?
- Did you introduce a clearer next step?
- Do you have analytics, inquiries, responses, or qualitative feedback?

Proof package: **The Website Was Not the Offer**

- original headline
- problem with the original framing
- revised headline and page order
- new proof or CTA
- result, when available

### 4. We have a launch coming up

They need to see:

- the client can create the connected system around a launch
- the client can make one idea survive across site, posts, video, and graphics

Possible proof:

- system across multiple assets
- process timeline
- live prototype

Questions:

- What launch assets did you create?
- Which channels did the work need to survive across?
- Was there a timeline or sequence?
- Did you turn one concept into multiple deliverables?
- How did the site, posts, video, and graphics connect?
- What changed as the launch approached?

Proof package: **One Launch, One System**

- landing page
- announcement post
- countdown asset
- social preview
- motion or video
- final event/result

### 5. We need more content, but do not want generic AI posts

They need to see:

- the client can turn real company activity into distinctive content
- the client can preserve voice and point of view

Possible proof:

- raw input to final output
- system across multiple assets
- process timeline

Questions:

- Do you have examples of raw information becoming posts?
- Can you show the source material and final post?
- Did you create multiple angles from one update?
- How did you keep the client's tone?
- Did you build an ongoing format or content series?
- Which content could only have come from that client?

Proof package: **Source to Signal**

- raw Discord message, announcement, or brief
- key insight extracted
- final post
- visual asset
- follow-up variation

### 6. Our brand is inconsistent

They need to see:

- the client can establish usable rules without flattening the work
- the client can make variation feel consistent

Possible proof:

- system across multiple assets
- annotated teardown
- process timeline

Questions:

- Did the client have multiple inconsistent assets?
- What rules did you define?
- Can you show correct and incorrect use?
- Did the system support multiple formats?
- Could another person use the rules successfully?
- Did the rules allow variation without losing identity?

Proof package: **A System, Not a Moodboard**

- existing inconsistencies
- core visual rules
- usage examples
- multiple outputs produced from the same system

### 7. AI gives us output, but someone still has to manage it

They need to see:

- the client knows where automation ends and human judgment begins
- the client can correct AI output and create rules that prevent repeat failure

Possible proof:

- human correction of AI output
- annotated teardown
- process timeline

Questions:

- What part was automated?
- Where did the automated result fail?
- What did you correct manually?
- Which decision required taste or client context?
- How did you create repeatable rules after correcting it?
- What does the client no longer need to supervise?

Proof package: **The Human Pass**

- raw automated output
- what was technically correct
- what was creatively wrong
- the correction
- the rule added to prevent the issue next time

### 8. We need someone who can design and build

They need to see:

- the client can carry an idea from creative direction into production
- the client can prevent handoff loss between design and engineering

Possible proof:

- live prototype
- before/after
- process timeline
- system across multiple assets

Questions:

- Which project did you own from concept through deployment?
- What interaction would have been lost in a handoff?
- What design decision required technical understanding?
- What engineering constraint changed the creative direction?
- Can you show desktop, tablet, and mobile?
- Can you show the live experience and its source design?

Proof package: **No Handoff Gap**

- initial direction
- design
- interaction
- responsive implementation
- live result

---

## Suggested architecture

Prefer an explicit route/action for building proof around one selected opportunity rather than making the Opportunity Signals analyzer heavier.

Recommended route:

```text
POST /api/dashboard/opportunity-signals/proof-builder
```

Input:

```js
{
  opportunity: { ... },          // selected opportunity from parsed analysis
  sourceItem: { ... },           // optional raw pool item if available
  answers: { ... },              // optional operator answers from the interview step
  mode: 'plan' | 'finalize'
}
```

Output:

```js
{
  ok: true,
  proofPlan: { ... },
  generatedAt: '...'
}
```

Suggested persistence:

```js
dashboard_state/{clientId}.marketingBrief.proofBuilderRuns[stableOpportunityKey]
```

If array persistence is awkward or risks document growth, store only the latest proof plan:

```js
dashboard_state/{clientId}.marketingBrief.latestProofBuilder
```

Keep this lightweight in v1. Do not create a new top-level collection unless the UI requires history.

## Context sources

The Proof Builder should load the client's approved context:

- Client Brain proof/projects/metrics/testimonials
- Client Brain positioning/offers/voice
- Knowledge Base material when available
- current Opportunity Signals opportunity
- the original source post/item
- optional operator answers

Relevant existing files to inspect:

- `docs/source-of-truth/OPPORTUNITY-SIGNALS-CARD.md`
- `features/client-brain/store.cjs`
- `docs/company-brain/CLIENT_BRAIN_SCHEMA.md`
- `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md`
- `app/api/dashboard/recipe-run/route.js`
- `features/intelligence/analysis-recipes/opportunity-signals.md`
- `components/dashboard/MarketSignalsReportBlocks.jsx`
- `DashboardPage.jsx`

## UI behavior

Add a Proof Builder action from each Opportunity Signals card.

Suggested states:

1. **Build Proof** button
2. proof plan loads
3. show detected problem and trust requirement
4. show possible proof matches
5. show targeted questions
6. let operator answer questions inline
7. regenerate/finalize proof package
8. show response framework with readiness status

The response framework is not a post draft. It is a grounded outline:

- observation
- relevance
- evidence
- invitation

If no evidence is selected, display a weak-response warning.

## Acceptance criteria

- Each Opportunity Signals card can open Proof Builder.
- Proof Builder identifies the detected problem and trust requirement.
- Proof Builder recommends a proof type from the fixed proof-format catalog.
- Proof Builder searches approved client context for possible proof.
- Proof Builder asks targeted evidence-producing questions.
- Proof Builder recommends a lightweight proof asset.
- Proof Builder produces the four-field response framework.
- Missing evidence marks the response as weak/not ready.
- No social reply, email, CRM, or leadgen write is created in v1.
- Works for Bryan/HITLOOP using Bryan's Client Brain proof, but remains client-agnostic.

---

## Master prompt for Sonnet

You are working in `/Users/bballi/Documents/Repos/Bballi_Portfolio`.

Implement **Opportunity Signals Proof Builder** as the next layer after the already-shipped Opportunity Signals feature.

Read these docs first:

```text
docs/source-of-truth/OPPORTUNITY-SIGNALS-CARD.md
docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md
docs/company-brain/CLIENT_BRAIN_SCHEMA.md
docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md
```

Then inspect the current implementation before editing:

- `features/scout-intake/opportunity-signals-search.js`
- `features/intelligence/analysis-recipes/opportunity-signals.md`
- `features/intelligence/analysis-recipes/recipes.js`
- `app/api/dashboard/recipe-run/route.js`
- `app/api/worker/pre-digest-refresh/route.js`
- `features/intelligence/_brief-intel.js`
- `components/dashboard/MarketSignalsReportBlocks.jsx`
- `DashboardPage.jsx`
- `app/api/admin/daily-digest/route.js`
- `features/client-brain/store.cjs`

Goal:

Do not let the product jump from "post found" to "AI-written reply." Add a Proof Builder step that asks: **What can the client show that makes this response true?**

Build v1 only:

1. Add a Proof Builder route/action for a selected Opportunity Signals item.
   - Prefer `POST /api/dashboard/opportunity-signals/proof-builder`.
   - Auth with the same client resolution pattern as nearby dashboard routes.
   - Input should accept the selected opportunity, optional raw source item, optional operator answers, and mode `plan|finalize`.
   - Output should return a structured `proofPlan`.

2. Load approved client context.
   - Use `loadClientBrainContext` or the underlying Client Brain store patterns.
   - Include proof/projects/metrics/testimonials, positioning, offers, and voice where available.
   - Include the selected opportunity and source post.
   - Include operator answers when provided.
   - Do not invent proof beyond approved context or user-supplied answers.

3. Create the Proof Builder prompt/logic.
   - It must identify:
     - detected problem
     - trust requirement
     - best proof type
     - possible proof from existing work
     - targeted questions
     - recommended lightweight proof asset
     - response framework
     - readiness status
   - Use the proof-format catalog:
     - before/after
     - annotated teardown
     - raw input to final output
     - process timeline
     - system across multiple assets
     - live prototype
     - client quote
     - measurable result
     - human correction of AI output
     - personalized concept for the lead

4. Enforce the evidence-before-response rule.
   - Every response framework must have:
     - `observation`
     - `relevance`
     - `evidence`
     - `invitation`
   - If `evidence` is missing, speculative, or empty, set readiness to `needs_evidence` and surface a warning like `Weak response: no concrete proof selected yet.`
   - Do not create a ready-to-use reply draft in v1.

5. Add UI from Opportunity Signals cards.
   - Add a `Build Proof` action on each Opportunity Signals card.
   - Open an inline panel or modal.
   - Show detected problem, trust requirement, possible proof, targeted questions, recommended proof asset, and response framework.
   - Let the operator answer questions and rerun/finalize the plan.
   - Keep the UI read-only/action-planning only; no send/draft buttons.

6. Persistence should be lightweight.
   - Store the latest proof plan under `dashboard_state/{clientId}.marketingBrief.latestProofBuilder` or a small keyed map if that is more consistent.
   - Do not create a new top-level collection unless clearly necessary.
   - Avoid unbounded arrays in `dashboard_state`.

7. Keep the feature client-agnostic.
   - Bryan/HITLOOP examples are default/test material only.
   - For any client, proof should come from that client's Client Brain, KB, or answers.
   - Do not hardcode Not The Rug, Viva Acid, or HITLOOP examples into the generic implementation.

Constraints:

- Do not modify Opportunity Signals search behavior unless required for passing through source item data.
- Do not wire this into automated email yet.
- Do not create social posts, reply drafts, Gmail drafts, or leadgen records.
- Do not add onboarding behavior.
- Preserve existing behavior when no one clicks `Build Proof`.
- Keep prompts serverless-safe if following the embedded recipe pattern.
- Add focused tests or smoke checks appropriate to the codebase.

Acceptance criteria:

- Opportunity Signals card has a working `Build Proof` action.
- Proof Builder returns a structured proof plan for a selected opportunity.
- The plan includes detected problem, trust requirement, proof type, possible proof, targeted questions, recommended asset, response framework, readiness, and risk notes.
- The response framework is marked weak/not ready when evidence is missing.
- Existing Client Brain proof is used when available.
- Operator answers can improve/finalize the proof plan.
- No reply/email/social/CRM side effects are created.

After implementation, report:

- files changed
- behavior added
- where the Proof Builder appears in the UI
- how it uses Client Brain proof
- tests/smoke checks run
- any limitations, especially around missing proof data for a client
