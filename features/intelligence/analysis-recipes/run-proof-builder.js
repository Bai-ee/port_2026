'use strict';

// run-proof-builder.js — Proof Builder: the evidence-before-response layer for
// Opportunity Signals (docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md).
//
// Deliberately NOT registered in features/intelligence/analysis-recipes/recipes.js
// — Proof Builder runs per-selected-opportunity from its own "Build Proof"
// button, not as a general "04 Analysis Skills" report-wide toggle. Registering
// it there would let a user enable it globally and have it run over the wrong
// content (raw Scout agentData instead of a selected opportunity). It reuses
// the same callAnthropic/cost-calc mechanics as run-recipe.js, just outside
// that registry.

const { callAnthropic, extractAnthropicCostUsd } = require('../../scout-intake/_anthropic-client');

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 2000;
const INPUT_RATE = 0.000003;
const OUTPUT_RATE = 0.000015;

const WEAK_RESPONSE_WARNING = 'Weak response: no concrete proof selected yet.';

// Kept in sync with proof-builder.md's prompt body — serverless functions
// cannot rely on a runtime filesystem read for this, same convention as
// features/intelligence/analysis-recipes/recipes.js EMBEDDED_PROMPTS.
const PROMPT = String.raw`# Proof Builder (evidence before response)

You are helping an operator decide whether they have real proof before
responding to a public opportunity signal. Do NOT write a reply, post, or
outreach message. Your job is to identify what the client needs to prove, find
what evidence already exists, ask for what's missing, and only mark a response
"ready" when it is genuinely grounded.

## The core rule — evidence before response

Every response framework has four fields: observation, relevance, evidence,
invitation. If evidence would be missing, empty, generic, or speculative, you
MUST set readiness to needs_evidence (or not_enough_fit if the opportunity
doesn't fit the client's services at all) — never ready. Do not paper over
missing proof with vague claims like "we have experience with this" — that is
not evidence, it's a hope. A thin-but-honest plan that says "no concrete proof
selected yet" is REQUIRED behavior; a confident plan built on invented or
generic proof is a failure.

## What you're given

- opportunity — the detected Opportunity Signals item (trigger, likely
  problem, platform, person/company, relevant service, confidence).
- sourceItem — the raw social post, when available (more direct language
  than the analyzer's summary).
- clientContext — the CLIENT's own approved proof, when available: identity
  (who they are), positioning (their differentiation/value props), offers
  (services/CTAs), proof.projects / proof.metrics / proof.testimonials /
  proof.workHistory (their actual evidence inventory), voiceTone (light
  framing only — you are not drafting copy in their voice, just naming a
  response direction). clientContext may be null or thin. That is expected
  for a new client with no approved Client Brain yet — treat it as "no proof
  supplied," lower confidence accordingly, and lean on targetedQuestions
  instead of inventing proof. NEVER attribute a project, metric, or
  testimonial to the client unless it is literally present in clientContext
  or answers.
- answers — operator-supplied answers to previously asked questions (from a
  prior plan call). When present, use them as first-class evidence — an
  operator's direct answer is stronger signal than an inferred Client Brain
  match.

## Step 1 — detected problem & trust requirement

State the problem in the opportunity's own terms (not generic marketing
language), then state what the lead needs to believe is true about the client
before they'd respond positively. This is the "trust requirement" — it's
specific to the trigger, not a generic "we're a great agency" claim.

## Step 2 — pick ONE proof type from this catalog

1. before_after — before and after
2. annotated_teardown — annotated teardown of a specific flaw
3. raw_input_to_final — raw input → finished output
4. process_timeline — a timeline/sequence of the work
5. multi_asset_system — one system shown across multiple assets
6. live_prototype — a live, interactive result
7. client_quote — a testimonial in the client's own words
8. measurable_result — a number (conversion, engagement, revenue)
9. human_ai_correction — a human catching/fixing an AI mistake
10. personalized_concept — a concept made specifically for this lead

Pick the type that best matches the DETECTED PROBLEM, not just whatever proof
happens to exist. If the best-fit type has no available proof, say so — don't
silently substitute a weaker type without noting it in riskNotes.

## Step 3 — reusable proof-recipe patterns (guidance, not hardcoded facts)

These are common problem shapes and what tends to prove them. Use them as
pattern-matching guidance for step 1/2/targeted questions — never as a source
of facts about any specific client. The client's real proof always comes from
clientContext/answers, never from this list.

- "Our website feels generic" → needs: diagnosis of the generic pattern + a
  distinct system that preserves what worked. Proof: before/after, annotated
  teardown, human correction of AI output, multi-asset system. Ask: original
  site/direction? which generic pattern removed? which visual rules
  introduced? same page before/after? existing tech preserved? what makes it
  recognizable without the logo?
- "We need a site but can't articulate what we want" → needs: turning loose
  ideas into coherent direction without forcing the buyer to art-direct.
  Proof: raw input to final, process timeline, annotated brief. Ask: rough
  notes/conflicting references? what was extracted? early brief vs final?
  decisions made on their behalf? choices reduced?
- "Site is finished but not selling" → needs: positioning/hierarchy/
  credibility/conversion understanding, not just visual polish. Proof:
  annotated teardown, before/after, measurable result if available. Ask: what
  was unclear? offer rewritten? hierarchy reorganized? proof/CTA added? any
  analytics/inquiries/feedback?
- "We have a launch coming" → needs: one idea surviving across site, posts,
  video, graphics. Proof: multi-asset system, process timeline, live
  prototype. Ask: what assets? which channels? sequence/timeline? one
  concept → multiple deliverables? how did they connect?
- "We need content but not generic AI posts" → needs: turning real activity
  into distinctive content while keeping voice. Proof: raw input to final,
  multi-asset system, process timeline. Ask: raw info → post examples?
  multiple angles from one update? tone preserved? ongoing format/series?
- "Our brand is inconsistent" → needs: usable rules without flattening the
  work. Proof: multi-asset system, annotated teardown, process timeline. Ask:
  prior inconsistent assets? rules defined? correct/incorrect examples?
  multiple formats supported? variation without losing identity?
- "AI gives output but someone still manages it" → needs: knowing where
  automation ends and judgment begins. Proof: human correction of AI output,
  annotated teardown, process timeline. Ask: what was automated? where did
  it fail? what was corrected? what rule prevents repeat failure?
- "We need someone who can design AND build" → needs: no loss between
  creative direction and production. Proof: live prototype, before/after,
  process timeline, multi-asset system. Ask: which project concept→deploy?
  what would've been lost in handoff? technical constraint that shaped
  design? desktop/tablet/mobile shown? live experience + source design?

## Step 4 — search clientContext for possible proof

For each plausible match in clientContext.proof.* (or answers), produce a
possibleProof entry with title, source (client_brain | answers | manual),
whyItFits, and confidence. Only include items that are genuinely present in
the supplied data — an empty clientContext means an empty possibleProof
array, not an invented one.

## Step 5 — targeted questions

Ask only questions whose answer would produce USABLE evidence for the chosen
proof type — not generic discovery questions. 3–6 questions, specific to this
opportunity's problem.

## Step 6 — recommended proof asset

A lightweight, buildable package (a title, format, 3–5 concrete ingredients,
and an effort estimate) the operator could assemble quickly from what they
likely have — not a full case study.

## Step 7 — response framework + readiness

Fill observation / relevance / evidence / invitation. Apply the core rule:
evidence must cite a specific, real proof item (from possibleProof or
answers) or explicitly say none is selected yet. Set readiness:
- ready — a concrete, specific proof item backs evidence.
- needs_evidence — the opportunity fits the client, but no concrete proof is
  selected yet (this is the default when possibleProof is empty and answers
  supplied nothing usable).
- not_enough_fit — the opportunity doesn't genuinely match what this client
  offers, regardless of proof.

## Output — JSON ONLY, MANDATORY

Your entire response MUST be a single raw JSON object — no \`\`\` fences, no
"json" label, no prose before or after. Match this shape exactly:

{
  "opportunityId": "",
  "sourceUrl": "from the supplied opportunity/sourceItem, or empty",
  "detectedProblem": "...",
  "trustRequirement": "...",
  "proofType": "before_after|annotated_teardown|raw_input_to_final|process_timeline|multi_asset_system|live_prototype|client_quote|measurable_result|human_ai_correction|personalized_concept",
  "possibleProof": [
    { "title": "...", "source": "client_brain|knowledge_base|manual|brief|portfolio|answers", "whyItFits": "...", "confidence": "high|medium|low" }
  ],
  "targetedQuestions": [ "..." ],
  "recommendedProofAsset": { "title": "...", "format": "...", "ingredients": [ "..." ], "effort": "low|medium|high" },
  "responseFramework": { "observation": "...", "relevance": "...", "evidence": "...", "invitation": "..." },
  "readiness": "ready|needs_evidence|not_enough_fit",
  "riskNotes": [ "..." ]
}

Leave opportunityId as an empty string — the caller fills it in. If readiness
is not ready, responseFramework.evidence MUST literally state that no
concrete proof is selected yet (do not leave it vague or upbeat).`;

// Bracket-depth-aware JSON extraction — same robustness as
// components/dashboard/MarketSignalsReportBlocks.jsx's parseRecipeAnalysis,
// since models sometimes wrap output in a ```json fence despite instructions
// not to (observed live during Opportunity Signals verification).
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function arr(v) { return Array.isArray(v) ? v : []; }

// Defense in depth: enforce the evidence-before-response rule in code, not
// just the prompt. A model that ignores the instruction and marks something
// "ready" with no possibleProof/answers-backed evidence gets corrected here.
function enforceEvidenceRule(plan) {
  const evidence = String(plan?.responseFramework?.evidence || '').trim();
  const hasConcreteProof = arr(plan?.possibleProof).some((p) => String(p?.title || '').trim() && p?.confidence !== 'low');
  const evidenceLooksReal = evidence.length > 0 && !/no concrete proof/i.test(evidence);
  const canBeReady = hasConcreteProof && evidenceLooksReal;

  if (plan.readiness === 'ready' && !canBeReady) {
    plan.readiness = 'needs_evidence';
  }
  if (plan.readiness !== 'ready') {
    const warnings = arr(plan.riskNotes);
    if (!warnings.some((w) => /weak response/i.test(String(w)))) {
      plan.riskNotes = [...warnings, WEAK_RESPONSE_WARNING];
    }
    if (!evidenceLooksReal) {
      plan.responseFramework = {
        ...(plan.responseFramework || {}),
        evidence: 'No concrete proof selected yet.',
      };
    }
  }
  return plan;
}

function normalizePlan(raw, opportunityId) {
  const plan = raw && typeof raw === 'object' ? { ...raw } : {};
  plan.opportunityId = opportunityId;
  plan.possibleProof = arr(plan.possibleProof);
  plan.targetedQuestions = arr(plan.targetedQuestions).map((q) => String(q || '').trim()).filter(Boolean);
  plan.riskNotes = arr(plan.riskNotes);
  plan.responseFramework = plan.responseFramework && typeof plan.responseFramework === 'object' ? plan.responseFramework : {};
  plan.recommendedProofAsset = plan.recommendedProofAsset && typeof plan.recommendedProofAsset === 'object' ? plan.recommendedProofAsset : null;
  if (!['ready', 'needs_evidence', 'not_enough_fit'].includes(plan.readiness)) plan.readiness = 'needs_evidence';
  return enforceEvidenceRule(plan);
}

/**
 * Run Proof Builder for one selected Opportunity Signals item.
 * @param {object} input
 * @param {object} input.content   { opportunity, sourceItem, clientContext, answers }
 * @param {string} input.opportunityId  stable id/hash the caller computed
 * @returns {Promise<{ok, proofPlan, costUsd, ms, error}>}
 */
async function runProofBuilder({ content, opportunityId }) {
  const t0 = Date.now();
  let contentBlock;
  try {
    contentBlock = JSON.stringify(content, null, 2);
  } catch {
    return { ok: false, proofPlan: null, costUsd: 0, ms: Date.now() - t0, error: 'Content not serializable.' };
  }
  if (!content?.opportunity) {
    return { ok: false, proofPlan: null, costUsd: 0, ms: Date.now() - t0, error: 'No opportunity supplied.' };
  }

  let response;
  try {
    response = await callAnthropic({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: PROMPT,
      messages: [{ role: 'user', content: `INPUT:\n${contentBlock}` }],
    });
  } catch (err) {
    return { ok: false, proofPlan: null, costUsd: 0, ms: Date.now() - t0, error: err.message };
  }

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const costUsd = Math.round(extractAnthropicCostUsd(response, { inputRate: INPUT_RATE, outputRate: OUTPUT_RATE }) * 10000) / 10000;
  const parsed = extractJson(text);
  if (!parsed) {
    return { ok: false, proofPlan: null, costUsd, ms: Date.now() - t0, error: 'Proof Builder returned unparseable output.' };
  }

  return { ok: true, proofPlan: normalizePlan(parsed, opportunityId), costUsd, ms: Date.now() - t0, error: null };
}

module.exports = { runProofBuilder, WEAK_RESPONSE_WARNING };
