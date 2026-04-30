// newsletter-scribe.js — Newsletter content generation agent
//
// Parallel to not-the-rug-brief/scribe.js but produces newsletter-format
// content (Hero Story, Quick Hits, Metrics Snapshot, etc.) instead of
// social posts.
//
// Same architecture:
//   1. Receives aggregated Scout data (from aggregator.js)
//   2. Builds a prompt with brand voice + newsletter schema + brief data
//   3. Calls Sonnet for quality long-form content
//   4. Parses labeled sections from the response
//   5. Returns structured output (Guardian runs separately in Phase 2)
//
// Why a separate Scribe: newsletters have fundamentally different voice,
// structure, and length requirements than social posts. Keeping them
// separate means we can tune each independently without cross-contamination.

require('../not-the-rug-brief/load-env');
const { randomUUID } = require('crypto');
const { getProvider } = require('../not-the-rug-brief/providers');
const { MODELS, logCostEstimate, computeStageCost } = require('../not-the-rug-brief/optimizer');
const { requireClientConfig } = require('../not-the-rug-brief/clients');
const { loadBrandVoice, loadGameKnowledge } = require('../not-the-rug-brief/knowledge');
const { getIntelligenceConfig } = require('../not-the-rug-brief/intelligence');
const { logError } = require('../not-the-rug-brief/store');
const { getNewsletterSchema } = require('./newsletter-schema');
const { aggregateForNewsletter } = require('./aggregator');
const { saveNewsletterContent } = require('./store');

function getAnthropicClient() {
  return getProvider();
}

// --- Voice block construction ---

/**
 * Build the newsletter voice instruction block.
 * Loads from newsletter-voice.json if available, else adapts brand-voice.json
 * with newsletter-appropriate overrides.
 */
function buildNewsletterVoiceBlock(voice, config) {
  if (!voice) {
    return config.newsletter?.fallbackTone
      || `Tone: clear, informed, conversational.
Write like a sharp weekly briefing from a trusted colleague — not a marketing blast.
Never use: generic hype language, forced urgency, clickbait, or empty superlatives.
Every claim must be grounded in Scout data.`;
  }

  const pillars = voice.voice_pillars
    .map((p) => `  - ${p.name}: ${p.description}\n    DO: ${p.do}\n    DON'T: ${p.dont || 'N/A'}`)
    .join('\n');

  const avoidList = (voice.avoid || []).map((a) => `  - ${a}`).join('\n');

  // Newsletter-specific formatting differs from social — longer blocks, editorial feel
  const formatting = Object.entries(voice.formatting_rules || {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  return `NEWSLETTER VOICE:
${voice.scribe_instructions || 'Write like a sharp internal briefing — authoritative, concise, human.'}

CORE TONE: ${voice.core_tone || 'Informed, direct, credible'}
${voice.tone_description || 'Sound like you know what you\'re talking about. No filler.'}

VOICE PILLARS:
${pillars}

AVOID:
${avoidList}

NEWSLETTER FORMATTING:
${formatting}
- Paragraphs over bullets where possible — this is email, not Twitter.
- Each section should feel complete on its own but build toward the CTA.
- Front-load the most important insight in every section.`;
}

/**
 * Build the business facts block — same as social Scribe, reused for consistency.
 */
function buildBusinessFactsBlock(config) {
  const gameKnowledge = loadGameKnowledge(config.clientId);
  const foundedYear = gameKnowledge?.business_facts?.founded_year;

  if (!foundedYear) return '';

  const currentYear = new Date().getFullYear();
  const currentAge = currentYear - foundedYear;

  return `BUSINESS FACTS:
- Founded year: ${foundedYear}
- Current calendar year: ${currentYear}
- If age is mentioned, use ${currentAge} years only if exact. Safer: "founded in ${foundedYear}" or "since ${foundedYear}".`;
}

/**
 * Build temporal guardrails — adapted from scribe.js for newsletter context.
 */
function buildTemporalGuardrailsBlock(briefData) {
  const runDate = briefData.runDate instanceof Date ? briefData.runDate : new Date();
  const isoDate = runDate.toISOString().split('T')[0];

  const datedEvents = (briefData.localEvents || [])
    .filter((event) => event?.event && event?.date)
    .slice(0, 5)
    .map((event) => `- ${event.event}: ${event.date}`)
    .join('\n');

  return `TEMPORAL GUARDRAILS:
- Today is ${isoDate}.
- Use exact dates when referencing events, launches, or awareness dates.
- Do NOT say "this week" or "today" about future events unless they are genuinely happening now.
- Prefer "on [date]", "coming [date]", or "ahead of [date]" for future items.
${datedEvents ? `Known dated events from Scout:\n${datedEvents}` : ''}`;
}

/**
 * Build the metrics context block for the Scribe prompt.
 */
function buildMetricsContext(briefData) {
  const metrics = briefData.metrics || [];
  if (metrics.length === 0) return 'No quantitative metrics available this cycle.';

  return metrics
    .map((m) => `- ${m.label}: ${m.value}`)
    .join('\n');
}

/**
 * Build the upcoming events context block.
 */
function buildUpcomingContext(briefData) {
  const events = briefData.upcomingEvents || [];
  if (events.length === 0 && !briefData.topLocalEvent) {
    return 'No upcoming events within 30 days.';
  }

  const lines = [];
  if (briefData.topLocalEvent) lines.push(`- ${briefData.topLocalEvent}`);
  for (const event of events) {
    lines.push(`- ${event.event}${event.date ? ` (${event.date})` : ''} — ${event.daysOut} days out`);
  }
  return lines.join('\n');
}

// --- Prompt construction ---

/**
 * Build the full Newsletter Scribe prompt.
 *
 * @param {object} briefData - Aggregated data from aggregator.js
 * @param {object} config    - Client config
 * @returns {string} The complete prompt for Sonnet
 */
function buildNewsletterPrompt(briefData, config) {
  const voice = loadBrandVoice(config.clientId);
  if (!voice) {
    console.warn(`[NEWSLETTER-SCRIBE] brand-voice.json not found for ${config.clientId} — using fallback tone`);
  }

  const voiceBlock = buildNewsletterVoiceBlock(voice, config);
  const businessFactsBlock = buildBusinessFactsBlock(config);
  const temporalBlock = buildTemporalGuardrailsBlock(briefData);
  const metricsContext = buildMetricsContext(briefData);
  const upcomingContext = buildUpcomingContext(briefData);
  const schema = getNewsletterSchema(config);
  const intelligence = getIntelligenceConfig(config);

  const handle = config.primaryHandle ? ` (${config.primaryHandle})` : '';

  // Brand mentions summary
  const mentionCount = (briefData.brandMentions || []).length;
  const mentionContext = mentionCount === 0
    ? 'Scout found ZERO brand mentions this cycle. Newsletter should acknowledge the quiet and focus on forward-looking content.'
    : `Scout found ${mentionCount} brand mention${mentionCount === 1 ? '' : 's'}. Top: ${briefData.brandMentions[0]?.content?.slice(0, 120) || 'n/a'}`;

  // Content opportunities
  const opportunitiesContext = (briefData.contentOpportunities || []).length > 0
    ? `${briefData.contentOpportunities.length} content opportunities:\n${briefData.contentOpportunities.slice(0, 5).map((opp, i) => `  ${i + 1}. "${opp.title}" — ${opp.summary || 'n/a'} (priority: ${opp.priority})`).join('\n')}`
    : 'No content opportunities this cycle.';

  // Competitor intel
  const competitorContext = (briefData.competitorIntel || []).length > 0
    ? `${briefData.competitorIntel.length} competitor signal${briefData.competitorIntel.length === 1 ? '' : 's'}:\n${briefData.competitorIntel.slice(0, 3).map((ci) => `  - ${ci.competitor || 'Competitor'}: ${ci.finding || ci.content || 'n/a'}`).join('\n')}`
    : 'No competitor signals this cycle.';

  // Reddit signals
  const redditContext = (briefData.redditSignals || []).length > 0
    ? `${briefData.redditSignals.length} Reddit signal${briefData.redditSignals.length === 1 ? '' : 's'}:\n${briefData.redditSignals.slice(0, 3).map((rs) => `  - r/${rs.subreddit}: ${rs.summary?.slice(0, 100) || rs.title}`).join('\n')}`
    : '';

  // Existing social content angle for coherence
  const coherenceNote = briefData.existingContentAngle
    ? `NOTE — Social Scribe already produced this content angle for the same cycle:\n"${briefData.existingContentAngle}"\nThe newsletter should complement this angle, not repeat it verbatim.`
    : '';

  // Output instructions from schema
  const outputInstructions = schema
    .map((field) => `${field.label}:\n${field.prompt}`)
    .join('\n\n');

  return `IDENTITY:
You are the Newsletter Scribe for ${config.clientName}${handle}.
You write a recurring newsletter that makes recipients feel informed, not sold to.
Your output reads like a curated briefing from someone who deeply understands the space.

${voiceBlock}
${businessFactsBlock ? `\n\n${businessFactsBlock}` : ''}
${temporalBlock}

SCOUT INPUT:
Alert Level: ${briefData.alertLevel}
Priority Action: ${briefData.priorityAction}
Top Finding: ${briefData.topEscalation}
Primary Signal: ${briefData.topSignal}
${mentionContext}
${competitorContext}
${redditContext ? `\n${redditContext}` : ''}

METRICS DATA:
${metricsContext}

UPCOMING:
${upcomingContext}

CONTENT OPPORTUNITIES:
${opportunitiesContext}
${coherenceNote ? `\n${coherenceNote}` : ''}

YOUR JOB:
Turn Scout's intelligence into a newsletter that people actually read.
Each section should feel like it was written by a human who cares about this space.
Ground every claim in Scout data — never invent, speculate, or inflate.

REASONING — before writing, think through:
- What's the single most interesting thing from this cycle? Lead with that.
- What would make a subscriber forward this to a colleague?
- How does this cycle's intelligence connect to the bigger picture?
- What's the one thing the reader should DO after reading this?

OUTPUT — produce all ${schema.length} sections, each clearly labeled:

${outputInstructions}

HARD CONSTRAINTS:
- Every claim must trace to Scout data — never fabricate
- Newsletter must feel complete if any single section is read in isolation
- No hashtags, no emoji spam — this is email, not social
- Match the brand voice exactly
- If a section has no data, say so briefly rather than filling with fluff
NOTE: Guardian QA will run on this output before it's saved or sent.`;
}

// --- Output parsing ---

/**
 * Parse the Newsletter Scribe's labeled output sections.
 * Same regex approach as scribe.js parseScribeOutput.
 */
function parseNewsletterOutput(text, config = {}) {
  const sections = getNewsletterSchema(config);
  const result = {};

  for (const section of sections) {
    const pattern = new RegExp(
      `\\*{0,2}${section.label}(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}\\s*\\n([\\s\\S]*?)(?=\\n\\*{0,2}[A-Z_]+(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}|\\n---\\s*\\n\\*{0,2}[A-Z_]+(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}|$)`,
      'i'
    );
    const match = text.match(pattern);
    result[section.key] = match ? match[1].replace(/^[-\s]+|[-\s]+$/g, '').trim() : null;
  }

  return result;
}

// --- Core execution ---

/**
 * Run the Newsletter Scribe content generation cycle.
 *
 * @param {string}      clientId      - Client to generate for
 * @param {object|null} config        - Client config (resolved from registry or Firestore)
 * @param {object|null} incomingBrief - Scout brief passed directly (preferred), or null to load from store
 * @returns {Promise<object>} Newsletter output with status, content, metadata
 */
async function runNewsletterScribe(clientId, config = null, incomingBrief = null) {
  const runId = randomUUID();
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] NEWSLETTER-SCRIBE: starting run ${runId} for ${clientId}`);

  try {
    const resolvedConfig = config || requireClientConfig(clientId);

    // ── 1. Aggregate Scout data ──────────────────────────────────────
    const briefData = await aggregateForNewsletter(clientId, resolvedConfig, incomingBrief);
    if (!briefData) {
      throw new Error(`No valid Scout brief found for ${clientId} — run Scout first`);
    }

    console.log(`[${startTime.toISOString()}] NEWSLETTER-SCRIBE: aggregated data from Scout brief (${briefData.scoutBriefTimestamp})`);

    // ── 2. Build prompt ──────────────────────────────────────────────
    const prompt = buildNewsletterPrompt(briefData, resolvedConfig);

    // ── 3. Call Sonnet ───────────────────────────────────────────────
    const response = await getAnthropicClient().messages.create({
      model: MODELS.briefWrite, // claude-sonnet-4-6 — quality matters for newsletter content
      max_tokens: 4000,         // newsletters are longer than social posts
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const inputTokens  = response.usage?.input_tokens  || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    logCostEstimate('Newsletter-Scribe', inputTokens, outputTokens, MODELS.briefWrite);
    const scribeStageCost = computeStageCost('newsletter-scribe', inputTokens, outputTokens, MODELS.briefWrite);

    // ── 4. Parse response ────────────────────────────────────────────
    const fullText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (!fullText.trim()) {
      throw new Error('Newsletter Scribe returned no text output');
    }

    console.log(`[${new Date().toISOString()}] NEWSLETTER-SCRIBE: received response (${fullText.length} chars)`);

    const content = parseNewsletterOutput(fullText, resolvedConfig);

    // Check that at least the hero story was parsed
    const schema = getNewsletterSchema(resolvedConfig);
    const parsedCount = schema.filter((s) => content[s.key]).length;
    if (parsedCount === 0) {
      console.warn(`[NEWSLETTER-SCRIBE] WARNING: no sections parsed from response — raw output may have unexpected format`);
    } else {
      console.log(`[${new Date().toISOString()}] NEWSLETTER-SCRIBE: parsed ${parsedCount}/${schema.length} sections`);
    }

    // ── 5. Build output ──────────────────────────────────────────────
    const output = {
      runId,
      timestamp: startTime.toISOString(),
      clientId,
      status: 'success',
      scoutBriefTimestamp: briefData.scoutBriefTimestamp,
      scoutAlertLevel: briefData.alertLevel,
      scoutPriorityAction: briefData.priorityAction,
      content,
      guardianFlags: null, // populated by newsletter-guardian.js in Phase 2
      rawOutput: fullText,
      scribeStageCost,
    };

    // ── 6. Save ──────────────────────────────────────────────────────
    await saveNewsletterContent(clientId, output);
    const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}] NEWSLETTER-SCRIBE: run ${runId} completed in ${duration}s`);

    return output;
  } catch (err) {
    const errContext = { module: 'newsletter-scribe', runId, clientId };
    console.error(`[${new Date().toISOString()}] NEWSLETTER-SCRIBE ERROR:`, err.message);
    await logError(err, errContext);

    return {
      runId,
      timestamp: startTime.toISOString(),
      clientId,
      status: 'error',
      error: err.message,
      content: null,
      rawOutput: null,
    };
  }
}

// --- Standalone execution ---

if (require.main === module) {
  const { initProvider } = require('../not-the-rug-brief/providers');
  initProvider({ defaultProvider: 'anthropic' });

  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0
    ? process.argv[clientArgIndex + 1]
    : 'not-the-rug';

  const config = requireClientConfig(clientId);

  console.log(`[${new Date().toISOString()}] NEWSLETTER-SCRIBE: running in standalone mode for ${clientId}`);
  runNewsletterScribe(clientId, config)
    .then((output) => {
      if (output.status === 'success') {
        const schema = getNewsletterSchema(config);
        for (const field of schema) {
          console.log(`\n--- ${field.displayLabel.toUpperCase()} ---`);
          console.log(output.content[field.key] || '(empty)');
        }
      } else {
        console.error('Run failed:', output.error);
      }
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runNewsletterScribe,
  buildNewsletterPrompt,
  parseNewsletterOutput,
};
