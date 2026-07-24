# Opportunity Signals — Proof Builder — Source of Truth

Last verified: 2026-07-24 against branch `main`.
Canonical doc for the **Proof Builder** feature. If another doc disagrees, this one wins.

Tags: `✓code file:line` = verified in code · `▢scope` = planned, not built.

## What it is

The evidence-before-response layer that sits **after** Opportunity Signals and **before** any reply/outreach could ever be drafted. For a selected opportunity card, it identifies the detected problem, what the lead needs to believe (trust requirement), the best proof type to show it, searches the client's own approved Client Brain proof for a match, asks targeted questions when nothing matches, recommends a lightweight proof asset, and produces a four-field response framework (`observation`/`relevance`/`evidence`/`invitation`) — **marked weak whenever `evidence` isn't backed by something concrete.**

**It is a separate layer, not part of Opportunity Signals' search or analyzer.** It is not onboarding, not a CRM, and in v1 it **never** drafts a ready-to-send reply, social post, email, or writes to `leadgen_prospects`. It only decides whether the operator *has enough to say something true* — and if not, what to go find.

Plan / build history: [`docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md`](../plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md).
Related: [`OPPORTUNITY-SIGNALS-CARD.md`](./OPPORTUNITY-SIGNALS-CARD.md) (the layer this sits on top of) · [`docs/company-brain/CLIENT_BRAIN_SCHEMA.md`](../company-brain/CLIENT_BRAIN_SCHEMA.md).

## Where to find it (UI)

1. Dashboard → **Market Signals** → **REPORT** tab → an **Opportunity Signals** card (needs the `opportunity-signals` recipe run first — see the Opportunity Signals doc).
2. Each opportunity has a **Build Proof** button.
3. Clicking it opens an inline panel and runs the plan automatically the first time (no separate "load" step). It shows: detected problem, trust requirement, best proof type, possible proof matches from the client's approved Client Brain, targeted questions (with inline answer inputs), a recommended lightweight proof asset, and the response framework.
4. If `readiness !== 'ready'`, a **"Weak response: no concrete proof selected yet."** banner replaces any implication that the framework is usable as-is.
5. Answering questions and clicking **Regenerate with answers** re-runs in `finalize` mode with the operator's answers folded in as first-class evidence.

## ⚠️ The core rule — evidence before response

Every response framework has four fields: `observation`, `relevance`, `evidence`, `invitation`. If `evidence` is missing, empty, generic, or speculative, `readiness` must be `needs_evidence` (or `not_enough_fit` if the opportunity doesn't genuinely match the client's services). This is enforced **twice**:

1. **In the prompt** (`proof-builder.md` / the embedded twin in `run-proof-builder.js`) — the model is instructed to self-apply the rule.
2. **In code** — `enforceEvidenceRule()` in `run-proof-builder.js` `✓code` is a defense-in-depth safety net: if the model marks something `ready` without a possibleProof item at ≥medium confidence and evidence text that doesn't read as a placeholder, the code downgrades it to `needs_evidence` and appends the weak-response warning to `riskNotes`.

**Verified live 2026-07-24** (real Anthropic calls, real opportunity data, no Firestore writes): tested against HITLOOP's own home client, whose Client Brain is currently `status: draft` (not approved) with empty `proof.*` — confirming the **no-context path** correctly returns `possibleProof: []`, `readiness: needs_evidence`, and the exact weak-response wording, with real, specific targeted questions (not generic filler). A second test with a synthetic-but-realistic rich Client Brain (Not The Rug, Viva Acid, an AI-template rebuild example) found a high-confidence proof match and cited it directly in `evidence` — but the model still chose `needs_evidence` rather than `ready`, reasoning that *knowing a similar project happened* isn't the same as *having the actual before/after artifact ready to show*. That's the intended conservative bias — a thin-but-honest plan is required behavior, not a bug.

## File map

| Concern | File | Notes |
|---|---|---|
| Prompt (human-editable source) | `features/intelligence/analysis-recipes/proof-builder.md` `✓code` | Full instructions: core rule, 10-type proof catalog, 8 reusable proof-recipe patterns (guidance only — never hardcoded facts about any client), output schema. |
| Runner (embedded prompt + execution) | `features/intelligence/analysis-recipes/run-proof-builder.js` `✓code` | `runProofBuilder({content, opportunityId})`. Embeds the same prompt (serverless-safe, matches `recipes.js`'s `EMBEDDED_PROMPTS` convention). Bracket-depth JSON extraction (survives a stray ` ```json ` fence, same robustness as `parseRecipeAnalysis`). `enforceEvidenceRule()` — the code-level safety net. **Deliberately NOT registered in `features/intelligence/analysis-recipes/recipes.js`** — see below. |
| Route | `app/api/dashboard/opportunity-signals/proof-builder/route.js` `✓code` | Auth (same pattern as `recipe-run`/`opportunity-signals/refresh`), rate-limited (20/10min — iterative Q&A is expected UX), derives a stable `opportunityId` (sha256 of `url` or `person+currentTrigger`, first 16 hex chars) server-side so the client never manages IDs, loads Client Brain proof context, persists only the latest plan. |
| Client Brain proof context | `loadProofClientContext()` inside the route file `✓code` | Reads `readClientBrainDoc(clientId)` directly (NOT the shared `loadClientBrainContext` string helper — that one's `buildUseForContext` only surfaces `proof.projects`/`proof.metrics`, silently dropping `testimonials`/`workHistory`, which Proof Builder needs as discrete citable items). Gated on `brain.status === 'approved'`, matching every other Client Brain consumer's convention — absent/unapproved ⇒ `null` ⇒ empty `possibleProof`, never invented. |
| Dashboard UI | `components/dashboard/MarketSignalsReportBlocks.jsx` `✓code` | `ProofBuilderPanel` (new) rendered inside `OpportunitySignalsBlock` per opportunity card. `DashboardPage.jsx` `✓code` owns the fetch logic + state (`proofBuilderState`, `buildOpportunityProof`, `toggleOpportunityProofPanel`, `updateOpportunityProofAnswer`) — mirrors the existing `replyDraftState`/`sendReplyTargetsToPostMe` pattern (network calls centralized in the page, not the leaf block). |

## ⚠️ Why this is NOT a registered analysis recipe

`recipes.js`'s `RECIPES` catalog powers the "04 · Analysis Skills" report-wide toggle list — every entry there is meant to run once per Generate Report over the whole client's stored signals. Proof Builder is invoked **per selected opportunity**, on demand, from its own button — registering it in `RECIPES` would put a "Proof Builder" checkbox in that generic list, and a user enabling it there would have it run over the wrong content entirely (there's no "selected opportunity" in a whole-report run). `run-proof-builder.js` reuses the same `callAnthropic`/cost-calc mechanics as `run-recipe.js` but stays outside that registry by design.

## Output shape (`proofPlan`)

```js
{
  opportunityId, sourceUrl, detectedProblem, trustRequirement,
  proofType, // one of the 10-type catalog
  possibleProof: [{ title, source, whyItFits, confidence }],
  targetedQuestions: [...],
  recommendedProofAsset: { title, format, ingredients: [...], effort },
  responseFramework: { observation, relevance, evidence, invitation },
  readiness: 'ready' | 'needs_evidence' | 'not_enough_fit',
  riskNotes: [...],
}
```

## Persistence

`dashboard_state/{clientId}.marketingBrief.latestProofBuilder` — a **single object** (`{opportunityId, proofPlan, generatedAt}`), overwritten each run. Deliberately not a growing array/map, per the plan doc's explicit instruction to avoid unbounded `dashboard_state` growth. Only the most recent proof plan across the whole client is remembered server-side; the dashboard's own `proofBuilderState` (keyed per opportunity index, in-session only) is what lets multiple cards stay open with distinct plans during one visit.

## Non-goals (v1)

- No reply, post, email, or CRM/leadgen write of any kind.
- Not wired into the automated email digest.
- No onboarding integration.
- Bryan/HITLOOP examples in the prompt's reusable-pattern guidance are illustrative only — never a source of facts about any specific client. Every client's real proof comes from their own `clientContext`/`answers`.

## How to extend

- **Add a proof type:** edit the 10-item catalog in `proof-builder.md` AND its embedded twin in `run-proof-builder.js` (keep them in sync, same convention as every other recipe in this repo).
- **Add a reusable proof-recipe pattern:** same two files, §3 of the prompt — keep it as pattern-matching guidance, never a hardcoded per-client fact.
- **Change persistence to keep history:** the plan doc explicitly allows a keyed map (`latestProofBuilder` → `proofBuilderRuns[opportunityId]`) if the UI later needs history — not built, `▢scope`.

## Phase status

- ✅ v1 shipped 2026-07-24: prompt + runner, route, Client Brain context loading, UI (Build Proof button + inline panel + inline Q&A + regenerate), evidence-before-response enforced in both prompt and code, verified live against real HITLOOP data (no-context path) and synthetic rich-context data (proof-match path).
- ▢scope Wiring into the automated email digest.
- ▢scope Proof-plan history (currently latest-only by design).
