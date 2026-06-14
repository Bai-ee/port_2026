/**
 * Onboarding survey — machine-readable mirror of docs/ONBOARDING_QUESTIONS.md.
 *
 * Hand-synced: edit the doc first, then update this file to match. The `id`
 * values and option `value` strings are stable identifiers used as Firestore
 * keys and must not be changed casually — rename = breaking migration.
 *
 * Consumers:
 *   - Survey UI (renders steps, enforces selectType).
 *   - /api/clients/[id]/onboarding (validates submitted answers).
 *   - Analysis pipeline (reads answers on answer-dependent stages).
 */

const ONBOARDING_STEPS = [
  {
    id: 'stage',
    order: 1,
    eyebrow: 'SET CONTEXT',
    title: 'Where are you at right now?',
    selectType: 'single',
    influencesAnalysis: true,
    options: [
      { value: 'idea', label: 'Just an idea' },
      { value: 'early', label: 'Early (some work started)' },
      { value: 'in_progress', label: 'In progress (needs direction)' },
      { value: 'live', label: 'Live but needs improvement' },
      { value: 'scaling', label: 'Scaling / optimizing' },
    ],
  },
  {
    id: 'intent',
    order: 2,
    eyebrow: 'INTENT',
    title: 'What are you trying to get done?',
    helper: 'Pick any that apply.',
    selectType: 'multi',
    influencesAnalysis: true,
    options: [
      { value: 'launch_new', label: 'Launch something new' },
      { value: 'improve_existing', label: 'Improve what I already have' },
      { value: 'fix_issues', label: 'Fix specific issues' },
      { value: 'build_content', label: 'Build content / visuals' },
      { value: 'automate', label: 'Automate workflows' },
      { value: 'not_sure', label: 'Not sure — need direction' },
    ],
  },
  {
    id: 'services',
    order: 3,
    eyebrow: 'SERVICES',
    title: 'What do you think you need?',
    helper: 'Pick anything. You can change this later.',
    selectType: 'multi',
    influencesAnalysis: true,
    options: [
      { value: 'branding', label: 'Branding (logo, identity)' },
      { value: 'website', label: 'Website / landing page' },
      { value: 'product_ui', label: 'App / product UI' },
      { value: 'social_content', label: 'Social content / marketing assets' },
      { value: 'video_motion', label: 'Video / motion' },
      { value: 'ai_automation', label: 'AI / automation setup' },
      { value: 'ongoing_creative', label: 'Ongoing creative support' },
    ],
  },
  {
    id: 'priority',
    order: 4,
    eyebrow: 'PRIORITY',
    title: 'What matters most right now?',
    selectType: 'single',
    influencesAnalysis: true,
    options: [
      { value: 'speed', label: 'Speed (need this fast)' },
      { value: 'quality', label: 'Quality (needs to be right)' },
      { value: 'cost', label: 'Cost (budget matters most)' },
      { value: 'direction', label: 'Direction (I need help figuring it out)' },
    ],
  },
  {
    id: 'currentState',
    order: 5,
    eyebrow: 'CURRENT STATE',
    title: 'What do you already have?',
    selectType: 'single',
    influencesAnalysis: true,
    options: [
      { value: 'nothing', label: 'Nothing yet' },
      { value: 'rough_ideas', label: 'Rough ideas / notes' },
      { value: 'designs', label: 'Designs / assets' },
      { value: 'working_product', label: 'A working site or product' },
      { value: 'existing_team', label: 'Existing team / devs' },
    ],
  },
  {
    id: 'blocker',
    order: 6,
    eyebrow: 'BIGGEST PROBLEM',
    title: "What's slowing you down right now?",
    selectType: 'text',
    maxLength: 500,
    influencesAnalysis: true,
  },
  {
    id: 'outputExpectation',
    order: 7,
    eyebrow: 'OUTPUT',
    title: 'What would a win look like?',
    selectType: 'single',
    influencesAnalysis: true,
    options: [
      { value: 'launchable', label: 'Something I can launch' },
      { value: 'showable', label: 'Something I can show / pitch' },
      { value: 'better_performance', label: 'Something that performs better' },
      { value: 'fully_managed', label: 'Something fully managed for me' },
    ],
  },
  // ── Search seeds ──────────────────────────────────────────────────────────
  // Verbatim entities that fuel SERP / social / local / events queries. NOT fed
  // to the positioning LLM (influencesAnalysis:false). Collected raw by
  // features/scout-intake/seed-extractor.js into snapshot.searchSeeds.
  // `isSeed` + `seedKey` let the extractor read them generically. These steps
  // can be answered or edited at any time, not just during first-run onboarding.
  {
    id: 'marketCategory',
    order: 8,
    eyebrow: 'MARKET',
    title: 'What category are you in? One line.',
    helper: 'Plain words a customer would use — e.g. "vegan meal prep", "B2B payroll software".',
    selectType: 'text',
    maxLength: 120,
    isSeed: true,
    seedKey: 'marketCategory',
    influencesAnalysis: false,
  },
  {
    id: 'brandKeywords',
    order: 9,
    eyebrow: 'KEYWORDS',
    title: 'Words people Google to find you.',
    helper: 'Product, service, and brand terms. Add as many as fit.',
    selectType: 'tags',
    maxItems: 15,
    isSeed: true,
    seedKey: 'brandKeywords',
    influencesAnalysis: false,
  },
  {
    id: 'location',
    order: 10,
    eyebrow: 'LOCATION',
    title: 'Primary area you serve.',
    helper: 'ZIP powers local search and nearby events. Leave blank if fully online.',
    selectType: 'composite',
    subfields: [
      { key: 'zip', label: 'ZIP', type: 'zip' },
      { key: 'city', label: 'City', type: 'text' },
    ],
    isSeed: true,
    seedKey: 'location',
    influencesAnalysis: false,
  },
  {
    id: 'competitors',
    order: 11,
    eyebrow: 'COMPETITORS',
    title: 'Who do you compete with?',
    helper: 'Name + their @handle (X or IG). 3–5 is plenty.',
    selectType: 'pairs',
    maxItems: 8,
    requireHandle: true,
    isSeed: true,
    seedKey: 'competitors',
    influencesAnalysis: false,
  },
  {
    id: 'influencers',
    order: 12,
    eyebrow: 'VOICES',
    title: 'Accounts that shape your space.',
    helper: 'Influencers, press, creators — @handles.',
    selectType: 'tags',
    itemFormat: 'handle',
    maxItems: 15,
    isSeed: true,
    seedKey: 'influencers',
    influencesAnalysis: false,
  },
  {
    id: 'events',
    order: 13,
    eyebrow: 'EVENTS',
    title: 'Events or expos your customers attend.',
    helper: 'Conferences, trade shows, local scenes.',
    selectType: 'tags',
    maxItems: 12,
    isSeed: true,
    seedKey: 'events',
    influencesAnalysis: false,
  },
  {
    id: 'customerPhrases',
    order: 14,
    eyebrow: 'CUSTOMER WORDS',
    title: 'How customers describe the problem, in their words.',
    helper: 'Real phrases you have heard. These become long-tail search terms.',
    selectType: 'tags',
    maxItems: 12,
    isSeed: true,
    seedKey: 'customerPhrases',
    influencesAnalysis: false,
  },
  {
    id: 'timeline',
    order: 15,
    eyebrow: 'TIMELINE',
    title: 'When do you want to move?',
    selectType: 'single',
    influencesAnalysis: false,
    options: [
      { value: 'asap', label: 'ASAP' },
      { value: 'few_weeks', label: 'Within a few weeks' },
      { value: 'exploring', label: 'Just exploring' },
      { value: 'not_sure', label: 'Not sure yet' },
    ],
  },
  {
    id: 'budget',
    order: 16,
    eyebrow: 'BUDGET',
    title: 'Budget range (optional)',
    selectType: 'single',
    influencesAnalysis: false,
    options: [
      { value: 'under_1k', label: 'Under $1k' },
      { value: '1k_5k', label: '$1–5k' },
      { value: '5k_15k', label: '$5–15k' },
      { value: '15k_plus', label: '$15k+' },
      { value: 'not_sure', label: 'Not sure yet' },
    ],
  },
  {
    id: 'summary',
    order: 17,
    kind: 'summary',
    eyebrow: 'NEXT STEP',
    title: "Here's where you're at",
  },
];

const STEPS_BY_ID = Object.fromEntries(ONBOARDING_STEPS.map((step) => [step.id, step]));
const QUESTION_STEPS = ONBOARDING_STEPS.filter((step) => step.kind !== 'summary');
const ANSWER_DEPENDENT_STEP_IDS = QUESTION_STEPS
  .filter((step) => step.influencesAnalysis)
  .map((step) => step.id);
const SEED_STEPS = QUESTION_STEPS.filter((step) => step.isSeed);
const SEED_STEP_IDS = SEED_STEPS.map((step) => step.id);

function getStep(stepId) {
  return STEPS_BY_ID[stepId] || null;
}

// ── Seed value helpers ────────────────────────────────────────────────────────
// Handles must be query-ready: an @handle or a URL. Bare tokens are coerced to
// @handle so the client can type "acme" and we store "@acme" (require-handle UX).

const HANDLE_MAX = 80;
const TAG_MAX = 80;

function normalizeHandle(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.slice(0, 200);
  const bare = s.replace(/^@+/, '').trim();
  if (!bare) return '';
  return '@' + bare.slice(0, HANDLE_MAX);
}

/**
 * Validate a submitted answer value against a step's configured selectType.
 * Returns { ok: true, value } on success or { ok: false, error } on failure.
 * `value` in the success result is the normalized form stored in Firestore.
 */
function validateAnswer(stepId, rawValue) {
  const step = getStep(stepId);
  if (!step) return { ok: false, error: `Unknown step: ${stepId}` };
  if (step.kind === 'summary') return { ok: false, error: 'Summary step is not submittable.' };

  if (step.selectType === 'single') {
    if (typeof rawValue !== 'string') return { ok: false, error: 'Expected a string value.' };
    const allowed = step.options.some((opt) => opt.value === rawValue);
    if (!allowed) return { ok: false, error: `Value "${rawValue}" is not a valid option.` };
    return { ok: true, value: rawValue };
  }

  if (step.selectType === 'multi') {
    if (!Array.isArray(rawValue)) return { ok: false, error: 'Expected an array of values.' };
    const allowedValues = new Set(step.options.map((opt) => opt.value));
    const cleaned = [];
    const seen = new Set();
    for (const entry of rawValue) {
      if (typeof entry !== 'string') return { ok: false, error: 'Array entries must be strings.' };
      if (!allowedValues.has(entry)) return { ok: false, error: `Value "${entry}" is not a valid option.` };
      if (seen.has(entry)) continue;
      seen.add(entry);
      cleaned.push(entry);
    }
    return { ok: true, value: cleaned };
  }

  if (step.selectType === 'text') {
    if (typeof rawValue !== 'string') return { ok: false, error: 'Expected a string value.' };
    const trimmed = rawValue.trim();
    const max = step.maxLength || 500;
    if (trimmed.length > max) return { ok: false, error: `Text exceeds ${max} characters.` };
    return { ok: true, value: trimmed };
  }

  if (step.selectType === 'tags') {
    if (!Array.isArray(rawValue)) return { ok: false, error: 'Expected an array of tags.' };
    const max = step.maxItems || 20;
    const isHandle = step.itemFormat === 'handle';
    const out = [];
    const seen = new Set();
    for (const entry of rawValue) {
      if (typeof entry !== 'string') return { ok: false, error: 'Tags must be strings.' };
      let v = entry.trim();
      if (!v) continue;
      if (isHandle) {
        v = normalizeHandle(v);
        if (!v) continue;
      } else {
        v = v.slice(0, TAG_MAX);
      }
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= max) break;
    }
    return { ok: true, value: out };
  }

  if (step.selectType === 'pairs') {
    if (!Array.isArray(rawValue)) return { ok: false, error: 'Expected an array of {name, handle}.' };
    const max = step.maxItems || 10;
    const out = [];
    const seen = new Set();
    for (const entry of rawValue) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, error: 'Each item must be an object with name and handle.' };
      }
      const name = String(entry.name || '').trim().slice(0, 120);
      if (!name) continue; // drop blank rows
      const handle = normalizeHandle(entry.handle);
      if (step.requireHandle && !handle) {
        return { ok: false, error: `"${name}" needs an @handle or URL.` };
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, handle });
      if (out.length >= max) break;
    }
    return { ok: true, value: out };
  }

  if (step.selectType === 'composite') {
    if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      return { ok: false, error: 'Expected an object of subfield values.' };
    }
    const out = {};
    for (const sub of step.subfields || []) {
      const raw = rawValue[sub.key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== 'string') return { ok: false, error: `Subfield "${sub.key}" must be a string.` };
      const v = raw.trim();
      if (!v) continue;
      if (sub.type === 'zip') {
        if (!/^\d{5}(-\d{4})?$/.test(v)) return { ok: false, error: 'ZIP must be 5 digits (optionally ZIP+4).' };
        out[sub.key] = v;
      } else {
        out[sub.key] = v.slice(0, 80);
      }
    }
    return { ok: true, value: out };
  }

  return { ok: false, error: `Unsupported selectType: ${step.selectType}` };
}

module.exports = {
  ONBOARDING_STEPS,
  QUESTION_STEPS,
  STEPS_BY_ID,
  ANSWER_DEPENDENT_STEP_IDS,
  SEED_STEPS,
  SEED_STEP_IDS,
  getStep,
  validateAnswer,
  normalizeHandle,
};
