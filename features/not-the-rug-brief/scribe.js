// scribe.js — Content production agent for the active client
// Reads Scout's latest brief and produces platform-specific content drafts.
// Why a separate agent: Scout knows what's happening, Scribe knows what to say.
// Keeping them separate means we can swap or retrain either independently.

require('./load-env');
const { getProvider } = require('./providers');
const { randomUUID } = require('crypto');
const { getLatestBrief, saveLatestContent, logError } = require('./store');
const { MODELS, logCostEstimate, computeStageCost } = require('./optimizer');
const { runGuardian } = require('./guardian');
const { getDefaultClientConfig, requireClientConfig } = require('./clients');
const { getIntelligenceConfig, normalizeIntelligence } = require('./intelligence');
const { loadBrandVoice, loadGameKnowledge } = require('./knowledge');
const { getContentSchema } = require('./content-schema');

const DEFAULT_CONFIG = getDefaultClientConfig();
function getAnthropicClient() {
  return getProvider();
}
function buildVoiceBlock(voice, config) {
  if (!voice) {
    return config.scribe?.fallbackTone
      || `Tone: clear, credible, human.
Never use: generic hype language, forced urgency, or empty superlatives.`;
  }

  const pillars = voice.voice_pillars
    .map((p) => `  - ${p.name}: ${p.description}\n    DO: ${p.do}\n    DON'T: ${p.dont || 'N/A'}`)
    .join('\n');

  const avoidList = voice.avoid.map((a) => `  - ${a}`).join('\n');

  const examples = voice.few_shot_examples
    .map((e) => `  [${e.type.toUpperCase()}] "${e.label}"\n  ${e.post}`)
    .join('\n\n');

  const formatting = Object.entries(voice.formatting_rules)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  return `BRAND VOICE:
${voice.scribe_instructions}

CORE TONE: ${voice.core_tone}
${voice.tone_description}

VOICE PILLARS:
${pillars}

AVOID:
${avoidList}

FORMATTING:
${formatting}

FEW-SHOT EXAMPLES (match this voice exactly):
${examples}`;
}

function buildInstagramFormattingBlock(voice) {
  const instagram = voice?.instagram_formatting;
  if (!instagram) return '';

  return `INSTAGRAM FORMAT PRIORITY:
- Caption length: ${instagram.caption_length || 'Keep captions concise.'}
- Hashtag strategy: ${instagram.hashtag_strategy || 'Use a restrained hashtag set.'}
- CTA style: ${instagram.cta_style || 'Use a soft CTA.'}
- Reels guidance: ${instagram.reels_guidance || 'Open strongly in the first 3 seconds.'}`;
}

function buildBusinessFactsBlock(config) {
  const gameKnowledge = loadGameKnowledge(config.clientId);
  const foundedYear = gameKnowledge?.business_facts?.founded_year;

  if (!foundedYear) return '';

  const currentYear = new Date().getFullYear();
  const currentAge = currentYear - foundedYear;

  return `BUSINESS FACTS:
- Founded year: ${foundedYear}
- Current calendar year: ${currentYear}
- If age is mentioned, use ${currentAge} years only if you need the exact age right now. Safer default: "founded in ${foundedYear}" or "since ${foundedYear}".
- Do not turn consistency into an absolute guarantee. Prefer "familiar walker", "known team", or "consistent walker relationship".`;
}

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
- Use exact dates when referencing named holidays, awareness weeks, or events.
- If an event starts in the future, do NOT say "starts today", "is here", "this week", or "now" about it.
- For future events, prefer phrasing like "starts April 12", "coming up April 12", "ahead of April 12", or "later this month".
- Only use "today" for conditions that are actually happening on ${isoDate}, such as weather or same-day operations.
- If timing is ambiguous, remove the time claim instead of guessing.
${datedEvents ? `Known dated events from Scout:\n${datedEvents}` : ''}`;
}

function buildPublishingWindowBlock(briefData) {
  const runDate = briefData.runDate instanceof Date ? briefData.runDate : new Date();
  const isoDate = runDate.toISOString().split('T')[0];

  return `TODAY POST SELECTION RULE:
- The publishable content for this run must make sense if posted on ${isoDate}.
- Do NOT make a future holiday, awareness week, or event the main hook of today's post before its actual start date.
- If a future event is 1+ days away, use it only as planning context in Content Angle or in forward-looking strategy, not as the lead line of the publishable post.
- Until the event is live, choose a post grounded in something current: today's weather, same-day operations, evergreen trust proof, neighborhood relevance, reviews, or always-on brand differentiators.
- Exception: you may write an explicit teaser only if the priority action clearly asks for a teaser or countdown. Otherwise assume the founder wants a post that can go live today without date confusion.
- If Scout surfaces both a live same-day angle and a future event angle, prefer the live same-day angle for the actual post and reserve the future event for planning notes.`;
}

// --- Prompt construction ---

/**
 * Build the Scribe prompt from Scout's brief data.
 * Loads brand-voice.json and injects it as the primary tone instruction.
 * Few-shot examples from the voice guide replace generic tone rules.
 */
function buildScribePrompt(briefData, config = getDefaultClientConfig()) {
  const {
    alertLevel,
    priorityAction,
    topEscalation,
    topSignal,
    topWeatherImpact,
    topLocalEvent,
    topReviewInsight,
    topRelationshipSignal,
    brandMentions,
    hasUpcomingEvent,
    upcomingEvent,
  } = briefData;
  const intelligence = getIntelligenceConfig(config);

  const voice = loadBrandVoice(config.clientId);
  if (!voice) {
    console.warn(`[SCRIBE] brand-voice.json not found for ${config.clientId} — using fallback tone`);
  }
  const voiceBlock = buildVoiceBlock(voice, config);
  const instagramBlock = buildInstagramFormattingBlock(voice);
  const businessFactsBlock = buildBusinessFactsBlock(config);
  const temporalGuardrailsBlock = buildTemporalGuardrailsBlock(briefData);
  const publishingWindowBlock = buildPublishingWindowBlock(briefData);
  const outputSchema = getContentSchema(config);
  const platformInterpretation = voice?.instagram_formatting
    ? `PLATFORM INTERPRETATION:
- Write for Instagram only.
- Favor caption clarity, Reel retention, and Story readability over cross-platform phrasing.
- Do not write as if this is for X/Twitter or Discord unless the schema explicitly asks for it.`
    : '';

  const zeroLiveSignal = !brandMentions || brandMentions.length === 0;
  const eventContext = hasUpcomingEvent
    ? `UPCOMING EVENT: ${upcomingEvent.event} in ${upcomingEvent.daysOut} days (${upcomingEvent.date})`
    : 'No major events within 30 days.';

  const signalContext = zeroLiveSignal
    ? 'Scout found ZERO live brand mentions today. Content must CREATE signal, not react to it.'
    : `Scout found ${brandMentions.length} brand mention(s). Top sentiment: ${brandMentions[0]?.sentiment || 'neutral'}.`;

  const primarySignalLabel = intelligence.promptPrimarySignalLabel || 'Primary Signal';
  const primarySignalContext = topSignal || intelligence.primarySignalsFallback || 'No priority signal identified.';

  const weatherLabel = intelligence.promptWeatherLabel || 'Weather Impact';
  const weatherContext = topWeatherImpact
    ? topWeatherImpact
    : (intelligence.weatherFallback || `No ${weatherLabel.toLowerCase()} surfaced this cycle.`);

  const localEventsLabel = intelligence.promptLocalEventsLabel || 'Local Events';
  const localEventsContext = topLocalEvent
    ? topLocalEvent
    : (intelligence.localEventsFallback || `No ${localEventsLabel.toLowerCase()} surfaced this cycle.`);

  const reviewLabel = intelligence.promptReviewInsightsLabel || 'Review Insights';
  const reviewContext = topReviewInsight
    ? topReviewInsight
    : `No ${reviewLabel.toLowerCase()} surfaced this cycle.`;

  const relationshipLabel = intelligence.promptRelationshipSignalsLabel || 'Relationship Signals';
  const relationshipContext = topRelationshipSignal
    ? topRelationshipSignal
    : (intelligence.relationshipSignalsFallback || `No ${relationshipLabel.toLowerCase()} surfaced this cycle.`);

  const opportunitiesLabel = intelligence.promptContentOpportunitiesLabel || 'Content Opportunities';
  const opportunitiesContext = (briefData.contentOpportunities && briefData.contentOpportunities.length > 0)
    ? `Scout found ${briefData.contentOpportunities.length} ${opportunitiesLabel.toLowerCase()}:\n${briefData.contentOpportunities.map((opportunity, i) => `  ${i + 1}. Topic: "${opportunity.title}" | Why now: ${opportunity.summary || 'n/a'} | Priority: ${opportunity.priority}${opportunity.url ? ` | URL: ${opportunity.url}` : ''}`).join('\n')}`
    : (intelligence.contentOpportunitiesFallback || `Scout found NO ${opportunitiesLabel.toLowerCase()} this cycle.`);

  const pillarHints = config.scribe?.pillarHints || {};
  const pillarHint = pillarHints[alertLevel] || 'feature_drop';
  const handle = config.primaryHandle ? ` (${config.primaryHandle})` : '';
  const role = config.scribe?.role || 'content writer';
  const hardConstraints = [
    ...(config.scribe?.hardConstraints || [
      'Every piece connects to Scout\'s priority action',
      'Never make claims Scout didn\'t surface',
      'Each output complete and ready to copy-paste',
    ]),
  ];
  const outputInstructions = outputSchema
    .map((field) => `${field.label}:\n${field.prompt}`)
    .join('\n\n');

  return `IDENTITY:
You are Scribe, ${role} for ${config.clientName}${handle}.
You produce content that is indistinguishable from the team's own voice.

${voiceBlock}
${instagramBlock ? `\n\n${instagramBlock}` : ''}
${businessFactsBlock ? `\n\n${businessFactsBlock}` : ''}
${temporalGuardrailsBlock ? `\n\n${temporalGuardrailsBlock}` : ''}
${publishingWindowBlock ? `\n\n${publishingWindowBlock}` : ''}
${platformInterpretation ? `\n\n${platformInterpretation}` : ''}

CONTENT PILLAR FOR THIS RUN: ${pillarHint}

SCOUT INPUT:
Alert Level: ${alertLevel}
Priority Action: ${priorityAction}
Key Finding: ${topEscalation}
${primarySignalLabel}: ${primarySignalContext}
${weatherLabel}: ${weatherContext}
${localEventsLabel}: ${localEventsContext}
${reviewLabel}: ${reviewContext}
${relationshipLabel}: ${relationshipContext}
${eventContext}
Signal Status: ${signalContext}
${opportunitiesLabel}: ${opportunitiesContext}

YOUR JOB:
Execute the priority action through content. Not explain it — execute it.
Match the voice and formatting patterns above exactly.

REASONING — before writing, think through:
- Which content pillar fits this moment?
- What emotion should this trigger? (curiosity / excitement / FOMO / trust / pride)
- What angle makes this feel like news, not marketing?
- What would make the intended audience save, screenshot, or share this?
- If Scout recommends multiple posts across multiple future days, do NOT write multiple posts here.
- Return exactly one publishable Instagram caption for today only.
- Keep future-post strategy in Priority Action and Content Angle, not in the publishable content field.

OUTPUT — produce all ${outputSchema.length} sections, each clearly labeled (no markdown bold, no dashes between sections):

${outputInstructions}

HARD CONSTRAINTS:
${hardConstraints.map((line) => `- ${line}`).join('\n')}
NOTE: Guardian QA runs automatically after Scribe completes. All content is verified before save.`;
}

// --- Brief data extraction ---

/**
 * Pull the fields Scribe needs from a Scout brief.
 * We compute alertLevel and priorityAction here rather than
 * relying on server.js helpers so scribe.js works standalone.
 */
function extractBriefData(brief, config) {
  const normalized = normalizeIntelligence(brief.agentData || {}, config);
  const escalations = normalized.escalations || [];
  const intelligence = getIntelligenceConfig(config);

  // Derive alert level from highest escalation
  let alertLevel = 'QUIET';
  if (escalations.some((e) => e.level === 'CRITICAL')) alertLevel = 'CRITICAL';
  else if (escalations.some((e) => e.level === 'IMPORTANT')) alertLevel = 'IMPORTANT';

  // Use PRIORITY ACTION line from humanBrief if present, else top escalation
  const priorityActionMatch = brief.humanBrief?.match(/PRIORITY ACTION:\s*(.+)/i);
  const priorityAction = priorityActionMatch
    ? priorityActionMatch[1].trim()
    : escalations[0]?.summary || 'No priority action identified.';

  const topEscalation = escalations[0]?.summary || 'No escalations this cycle.';
  const topSignal = normalized.primarySignals[0]?.title
    || intelligence.primarySignalsFallback
    || 'No primary signals available.';
  const topWeatherImpact = normalized.weatherImpact
    ? `${normalized.weatherImpact.summary}${normalized.weatherImpact.operationalTakeaway ? ` — ${normalized.weatherImpact.operationalTakeaway}` : ''}`
    : null;
  const topLocalEvent = normalized.localEvents[0]
    ? `${normalized.localEvents[0].event}${normalized.localEvents[0].date ? ` (${normalized.localEvents[0].date})` : ''}${normalized.localEvents[0].opportunity ? ` — ${normalized.localEvents[0].opportunity}` : ''}`
    : null;
  const topReviewInsight = normalized.reviewInsights[0]?.insight || null;
  const topRelationshipSignal = normalized.relationshipSignals[0]?.summary || null;
  const brandMentions = normalized.brandMentions;
  const contentOpportunities = normalized.contentOpportunities;

  // Check if any upcoming event falls within 30 days
  const upcomingEvents = config?.upcomingEvents || [];
  const upcomingEvent = upcomingEvents.find((e) => e.daysOut <= 30) || null;

  return {
    runDate: new Date(brief.timestamp || Date.now()),
    alertLevel,
    priorityAction,
    topEscalation,
    topSignal,
    topWeatherImpact,
    topLocalEvent,
    topReviewInsight,
    topRelationshipSignal,
    brandMentions,
    localEvents: normalized.localEvents,
    contentOpportunities,
    hasUpcomingEvent: !!upcomingEvent,
    upcomingEvent,
  };
}

// --- Output parsing ---

/**
 * Parse Scribe's four labeled output sections.
 * Uses the same pattern as Scout's extractSection, but for Scribe's labels.
 */
function parseScribeOutput(text, config = getDefaultClientConfig()) {
  const sections = getContentSchema(config);
  const result = {};

  for (const section of sections) {
    // Match the label with optional markdown bold (**) wrappers and optional dashes/dividers.
    // Captures everything until the next section label (with or without bold) or end of string.
    const pattern = new RegExp(
      `\\*{0,2}${section.label}(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}\\s*\\n([\\s\\S]*?)(?=\\n\\*{0,2}[A-Z_]+(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}|\\n---\\s*\\n\\*{0,2}[A-Z_]+(?:\\s*\\([^\\n)]*\\))?\\s*:\\*{0,2}|$)`,
      'i'
    );
    const match = text.match(pattern);
    // Strip any surrounding markdown dashes or blank lines from the captured value
    result[section.key] = match ? match[1].replace(/^[-\s]+|[-\s]+$/g, '').trim() : null;
  }

  return result;
}

// --- Core execution ---

/**
 * Run the Scribe content generation cycle.
 * Loads the latest Scout brief, extracts key signals, calls Claude,
 * parses the four content pieces, and saves everything.
 */
async function runScribe(clientId = DEFAULT_CONFIG.clientId, config = null, incomingBrief = null) {
  const runId = randomUUID();
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] SCRIBE: starting run ${runId} for ${clientId}`);

  try {
    // Accept brief passed directly from the pipeline (preferred) or load from filesystem.
    // Passing brief in-memory decouples Scout → Scribe from filesystem state.
    const brief = incomingBrief || await getLatestBrief(clientId);
    if (!brief) {
      throw new Error(`No Scout brief found for ${clientId} — run Scout first`);
    }
    if (brief.status !== 'success') {
      throw new Error(`Scout brief has status '${brief.status}' — cannot generate content from a failed run`);
    }

    console.log(`[${startTime.toISOString()}] SCRIBE: loaded Scout brief from ${brief.timestamp}`);

    const resolvedConfig = config || requireClientConfig(clientId);
    const briefData = extractBriefData(brief, resolvedConfig);
    const prompt = buildScribePrompt(briefData, resolvedConfig);

    const response = await getAnthropicClient().messages.create({
      model: MODELS.briefWrite, // claude-sonnet-4-6 — quality matters for content
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const scribeInputTokens  = response.usage?.input_tokens  || 0;
    const scribeOutputTokens = response.usage?.output_tokens || 0;
    logCostEstimate('Scribe', scribeInputTokens, scribeOutputTokens, MODELS.briefWrite);
    const scribeStageCost = computeStageCost('scribe', scribeInputTokens, scribeOutputTokens, MODELS.briefWrite);

    const fullText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (!fullText.trim()) {
      throw new Error('Scribe returned no text output');
    }

    console.log(`[${new Date().toISOString()}] SCRIBE: received response (${fullText.length} chars)`);

    const content = parseScribeOutput(fullText, resolvedConfig);

    const output = {
      runId,
      timestamp: startTime.toISOString(),
      clientId,
      status: 'success',
      scoutBriefTimestamp: brief.timestamp,
      scoutAlertLevel: briefData.alertLevel,
      scoutPriorityAction: briefData.priorityAction,
      content,
      contentOpportunities: briefData.contentOpportunities,
      viralOpportunities: briefData.contentOpportunities,
      guardianFlags: null, // populated below before save
      rawOutput: fullText,
      scribeStageCost,
    };

    // Run Guardian QA before saving — ensures every saved file has a real verdict,
    // regardless of whether the caller is run.js, server.js, or standalone mode.
    output.guardianFlags = await runGuardian(output, clientId);

    // Extract guardian cost from the verdict for pipeline cost aggregation
    const guardianUsage = output.guardianFlags?.guardianUsage;
    output.guardianStageCost = guardianUsage
      ? computeStageCost('guardian', guardianUsage.inputTokens, guardianUsage.outputTokens, guardianUsage.model)
      : null;

    await saveLatestContent(clientId, output);
    console.log(`[${new Date().toISOString()}] SCRIBE: content saved for ${clientId}`);

    const duration = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}] SCRIBE: run ${runId} completed in ${duration}s`);

    return output;
  } catch (err) {
    const errContext = { module: 'scribe', runId, clientId };
    console.error(`[${new Date().toISOString()}] SCRIBE ERROR:`, err.message);
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
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : DEFAULT_CONFIG.clientId;
  const config = requireClientConfig(clientId);
  const intelligence = getIntelligenceConfig(config);
  const outputSchema = getContentSchema(config);
  console.log(`[${new Date().toISOString()}] SCRIBE: running in standalone mode`);
  runScribe(clientId, config)
    .then((output) => {
      if (output.status === 'success') {
        const { content } = output;
        for (const field of outputSchema) {
          console.log(`\n--- ${field.displayLabel.toUpperCase()} ---`);
          console.log(content[field.key]);
        }
        console.log(`\n--- ${(intelligence.contentOpportunitiesLabel || 'Content Opportunities').toUpperCase()} ---`);
        console.log(JSON.stringify(output.contentOpportunities || output.viralOpportunities || [], null, 2));
      } else {
        console.error('Run failed:', output.error);
      }
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runScribe };
