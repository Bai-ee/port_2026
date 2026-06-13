'use strict';

// qa-synthesizer.js
//
// Synthesizes snapshot.brandOverview from Founder Q&A answers.
// Runs whenever answers are saved — fills empty fields, never overwrites
// existing content regardless of source. Lower priority than any prior data.

const fb  = require('../../api/_lib/firebase-admin.cjs');
const { callAnthropic } = require('./_anthropic-client');

const FIELDS = ['headline', 'summary', 'industry', 'businessModel', 'targetAudience', 'positioning'];

// ── Label resolvers ───────────────────────────────────────────────────────────

const STAGE_LABELS = {
  idea: 'Just an idea — pre-launch',
  early: 'Early stage — some work started',
  in_progress: 'In progress — needs direction',
  live: 'Live and operating',
  scaling: 'Scaling / optimizing',
};

const INTENT_LABELS = {
  launch_new: 'launch something new',
  improve_existing: 'improve existing product/service',
  fix_issues: 'fix specific issues',
  build_content: 'build content / social presence',
  automate: 'automate workflows',
  not_sure: 'not sure yet',
};

const SERVICES_LABELS = {
  branding: 'branding / identity',
  website: 'website / landing page',
  product_ui: 'app / product UI',
  social_content: 'social content / marketing',
  video_motion: 'video / motion',
  ai_automation: 'AI / automation setup',
  ongoing_creative: 'ongoing creative support',
};

const PRIORITY_LABELS = {
  speed: 'speed (get it done fast)',
  quality: 'quality (do it right)',
  cost: 'cost (budget is tight)',
  direction: 'direction (need guidance)',
};

const OUTPUT_LABELS = {
  launchable: 'something launchable',
  showable: 'something to show / pitch',
  better_performance: 'better performance',
  fully_managed: 'fully managed output',
};

function resolveMulti(values, map) {
  if (!Array.isArray(values)) values = [values].filter(Boolean);
  return values.map((v) => map[v] || v).join(', ');
}

function resolveSingle(value, map) {
  return map[value] || value || '';
}

// ── Build readable Q&A summary for the prompt ─────────────────────────────────

function buildQAContext(answers) {
  const a = answers || {};
  const lines = [];

  if (a.stage?.value)           lines.push(`Business stage: ${resolveSingle(a.stage.value, STAGE_LABELS)}`);
  if (a.currentState?.value)    lines.push(`Current state: ${resolveSingle(a.currentState.value, { nothing: 'nothing yet', rough_ideas: 'rough ideas/notes', designs: 'designs/assets', working_product: 'working site or product', existing_team: 'existing team/devs' })}`);
  if (a.intent?.value)          lines.push(`Goals: ${resolveMulti(a.intent.value, INTENT_LABELS)}`);
  if (a.services?.value)        lines.push(`Needs: ${resolveMulti(a.services.value, SERVICES_LABELS)}`);
  if (a.priority?.value)        lines.push(`Priority: ${resolveSingle(a.priority.value, PRIORITY_LABELS)}`);
  if (a.blocker?.value)         lines.push(`Main blocker: ${a.blocker.value}`);
  if (a.outputExpectation?.value) lines.push(`Success looks like: ${resolveSingle(a.outputExpectation.value, OUTPUT_LABELS)}`);
  if (a.timeline?.value)        lines.push(`Timeline: ${a.timeline.value}`);

  return lines.join('\n');
}

// ── Tool schema ───────────────────────────────────────────────────────────────

const QA_TOOL = {
  name: 'synthesize_from_qa',
  description: 'Derive brand overview fields from founder Q&A answers. Focus on MARKET POSITIONING — who they are an alternative to, the wedge, the specific audience with a specific prior pain. These fields feed a search plan — vague output produces vague briefs. Only fill fields with clear signal.',
  input_schema: {
    type: 'object',
    required: ['headline', 'summary', 'industry', 'businessModel', 'targetAudience', 'positioning'],
    properties: {
      headline: {
        type: 'string',
        description: 'Positioning-forward tagline (12 words max). Market STANCE, not a job title. Infer from stage + goals + blocker. Empty if too vague to be useful.',
      },
      summary: {
        type: 'string',
        description: 'Forward-looking market narrative (1-2 sentences): what are they building, for whom specifically, and why does it win against the alternative? Use the founder\'s own language from blocker/outputExpectation where possible.',
      },
      industry: {
        type: 'string',
        description: 'Specific market sub-sector from services + intent (e.g. "AI-Assisted Creative Services", "B2B SaaS"). Empty if unclear.',
      },
      businessModel: {
        type: 'string',
        description: 'Engagement model WITH the differentiator: how is this different from the standard alternative? Use services + priority answers. (e.g. "Project-based AI-assisted creative, not hourly retainer"). Empty if unclear.',
      },
      targetAudience: {
        type: 'string',
        description: 'Specific buyer with specific prior pain. Use the blocker answer as the primary signal. (e.g. "Founders who want AI speed without losing brand voice"). Not "fast-moving teams" — a named person with a named problem.',
      },
      positioning: {
        type: 'string',
        description: 'Market STANCE from blocker + priority + outputExpectation: who are they an alternative to, what is the wedge? (e.g. "The human alternative to autonomous AI tools"). A stance against something specific, not a skill list.',
      },
    },
  },
};

// ── Synthesizer ───────────────────────────────────────────────────────────────

async function synthesizeBrandOverviewFromQA(answers, existingBrandInfo) {
  const qaContext = buildQAContext(answers);
  if (!qaContext) return null;

  const contextLines = [];
  if (existingBrandInfo?.headline) contextLines.push(`Existing headline: ${existingBrandInfo.headline}`);
  if (existingBrandInfo?.industry) contextLines.push(`Existing industry: ${existingBrandInfo.industry}`);
  if (existingBrandInfo?.businessModel) contextLines.push(`Existing business model: ${existingBrandInfo.businessModel}`);

  const prompt = `A founder answered intake questions about their business. Use their answers to infer brand overview fields.
Focus on MARKET POSITIONING — who they are an alternative to, what the wedge is, who specifically is the audience with what prior pain.
These fields feed a marketing search plan — generic bio content produces useless brief results.
Only fill fields where answers give clear signal; leave others empty.

FOUNDER Q&A ANSWERS:
${qaContext}
${contextLines.length ? `\nEXISTING BRAND CONTEXT (for reference):\n${contextLines.join('\n')}` : ''}

Call synthesize_from_qa with your inferences.`;

  const response = await callAnthropic({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    tools: [QA_TOOL],
    tool_choice: { type: 'tool', name: 'synthesize_from_qa' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content?.find((b) => b.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No tool_use block in QA synthesizer response.');

  const f = toolUse.input;
  return {
    headline:       (f.headline || '').trim(),
    summary:        (f.summary || '').trim(),
    industry:       (f.industry || '').trim(),
    businessModel:  (f.businessModel || '').trim(),
    targetAudience: (f.targetAudience || '').trim(),
    positioning:    (f.positioning || '').trim(),
    source: 'qa',
  };
}

// ── Minimum answers threshold ─────────────────────────────────────────────────
// Don't burn tokens on too-sparse data — require at least 2 influence answers.

function hasEnoughAnswers(answers) {
  const influencing = ['stage', 'intent', 'services', 'priority', 'currentState', 'blocker', 'outputExpectation'];
  const answered = influencing.filter((k) => answers?.[k]?.value != null && !answers?.[k]?.skipped);
  return answered.length >= 2;
}

// ── Simple field-level fill (no AI merge agent) ───────────────────────────────
// Q&A is "fill the gaps" — only populates fields that have no existing value.
// Never overwrites any field that already has content, regardless of its source.

function isSubstantive(val) {
  return typeof val === 'string' && val.trim().length >= 3;
}

function fillGaps(existing, synthesized) {
  const result = { ...(existing || {}) };
  let filled = 0;
  for (const field of FIELDS) {
    if (!isSubstantive(result[field]) && isSubstantive(synthesized[field])) {
      result[field] = synthesized[field];
      filled++;
    }
  }
  if (filled === 0) return null; // nothing new to write
  // Stamp source: preserve existing source if it was user/merged, else mark qa
  if (!result.source || result.source === 'qa') result.source = 'qa';
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read Q&A answers from client_configs, synthesize brandOverview fields,
 * fill any empty slots in dashboard_state.snapshot.brandOverview. Non-fatal.
 * Uses ref.update() with dot-notation path — avoids Firestore shallow-merge wipe.
 *
 * @param {string} clientId
 */
async function applyQAToSnapshot(clientId) {
  if (!clientId) return;

  try {
    const [configSnap, stateSnap] = await Promise.all([
      fb.adminDb.collection('client_configs').doc(clientId).get(),
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    ]);

    const answers = configSnap.data()?.onboardingAnswers?.answers || null;
    if (!answers || !hasEnoughAnswers(answers)) return;

    const existingBrand = stateSnap.data()?.snapshot?.brandOverview || null;

    const synthesized = await synthesizeBrandOverviewFromQA(answers, existingBrand);
    if (!synthesized) return;

    // Fill gaps only — never overwrite existing content
    const filled = fillGaps(existingBrand, synthesized);
    if (!filled) {
      console.log(`[qa-synthesizer] all fields already populated for ${clientId} — skipping write`);
      return;
    }

    // Use dot-notation update to avoid Firestore shallow-merge replacing snapshot
    await fb.adminDb.collection('dashboard_state').doc(clientId).update({
      'snapshot.brandOverview': filled,
    });

    console.log(`[qa-synthesizer] snapshot.brandOverview gap-filled for ${clientId}: source=${filled.source}`);
  } catch (err) {
    console.warn(`[qa-synthesizer] non-fatal failure for ${clientId}: ${err.message}`);
  }
}

module.exports = { applyQAToSnapshot };
