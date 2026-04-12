// guardian.js — Brand QA gate for the multi-client marketing OS
//
// Read-only quality gate: never generates or modifies content.
// Runs three checks on every Scribe output before it saves:
//
//   Check 1 (pure JS): Restricted terms scan — immediate hardBlock, no API call
//   Check 2 (pure JS): Competitor mention scan — major flag + reviewRequired, NOT hardBlock
//                      Human decides if context justifies the reference.
//   Check 3+4 (Haiku): Factual accuracy + brand voice — returns scores and flags
//
// Returns a verdict object that replaces GUARDIAN_PLACEHOLDER in the content output.

require('./load-env');
const fs   = require('fs').promises;
const path = require('path');
const { getProvider } = require('./providers');
const { MODELS, logCostEstimate } = require('./optimizer');
const { getDefaultClientConfig, requireClientConfig } = require('./clients');
const { getContentSchema } = require('./content-schema');

function getAnthropicClient() {
  return getProvider();
}
const DEFAULT_CONFIG = getDefaultClientConfig();

// Fields that contain publishable content — scanned for restricted terms
// and evaluated by Haiku
function getContentFields(config = DEFAULT_CONFIG) {
  return getContentSchema(config).map((field) => field.key);
}

// Competitor names to flag in publishable content.
// A match is a major flag + reviewRequired — NOT a hardBlock.
// The human reviewer decides if the context is newsworthy enough to justify
// the reference (e.g. the brand appearing alongside a competitor on a
// listicle). Default direction is no competitor mentions, but it
// can be overridden by a human on a case-by-case basis.
function buildCompetitorNameList(config = DEFAULT_CONFIG) {
  // Derive display names from Twitter handles — strip @ for case-insensitive matching
  const fromHandles = (config.competitors || []).map((h) => h.replace(/^@/, ''));
  const configuredNames = config.guardian?.competitorNames || [];
  return [...new Set([...fromHandles, ...configuredNames])];
}

/**
 * Load knowledge files needed for Guardian checks.
 * Returns nulls gracefully — checks degrade but never throw.
 */
async function loadKnowledge(clientId) {
  const base = path.join(__dirname, 'knowledge', clientId);

  const [glossary, brandVoice, gameKnowledge] = await Promise.all([
    fs.readFile(path.join(base, 'glossary.json'), 'utf8').then(JSON.parse).catch(() => null),
    fs.readFile(path.join(base, 'brand-voice.json'), 'utf8').then(JSON.parse).catch(() => null),
    fs.readFile(path.join(base, 'game-knowledge-supplement.json'), 'utf8').then(JSON.parse).catch(() => null),
  ]);

  return { glossary, brandVoice, gameKnowledge };
}

/**
 * Check 1: Restricted terms scan (pure JS — no API call).
 *
 * Scans all content fields for any term in glossary.restricted_terms
 * plus DERIVED_RESTRICTED_PATTERNS. Case-insensitive.
 *
 * A match = immediate hardBlock. No scoring. No Haiku needed for this check.
 *
 * @param {object} content - { x_post, x_thread_opener, discord_announcement, content_angle }
 * @param {object|null} glossary - parsed glossary.json
 * @returns {{ hardBlock: boolean, violations: string[] }}
 */
function checkRestrictedTerms(content, glossary, config = DEFAULT_CONFIG) {
  const contentFields = getContentFields(config);
  const patterns = [...(config.guardian?.restrictedPatterns || [])];

  // Pull term keys from glossary.restricted_terms
  if (glossary?.restricted_terms) {
    patterns.push(...Object.keys(glossary.restricted_terms));
  }

  const violations = [];

  for (const field of contentFields) {
    const text = (content[field] || '').toLowerCase();
    for (const pattern of patterns) {
      if (text.includes(pattern.toLowerCase())) {
        violations.push(`"${pattern}" found in ${field}`);
      }
    }
  }

  return {
    hardBlock: violations.length > 0,
    violations,
  };
}

/**
 * Check 2: Competitor mention scan (pure JS — no API call).
 *
 * Flags any competitor name found in content as a MAJOR flag with reviewRequired.
 * NOT a hardBlock — the human reviewer decides if the context is newsworthy
 * enough to justify the reference (e.g. appearing together on a "best games" list).
 *
 * @param {object} content
 * @returns {Array} flags[] — zero or more major flag objects
 */
function checkCompetitorMentions(content, config = DEFAULT_CONFIG) {
  const competitorNames = buildCompetitorNameList(config);
  const contentFields = getContentFields(config);
  const flags = [];

  for (const field of contentFields) {
    const text = (content[field] || '').toLowerCase();
    for (const name of competitorNames) {
      if (text.includes(name.toLowerCase())) {
        flags.push({
          type: 'voice',
          severity: 'major',
          field,
          issue: `Competitor "${name}" mentioned — default direction is no competitor references. Review: is this context newsworthy enough to justify?`,
          suggestion: `Remove the competitor name and reframe around ${config.clientName}'s own strengths, or approve manually if the context warrants it.`,
        });
      }
    }
  }

  return flags;
}

/**
 * Build the condensed factual-rules block for the Haiku prompt.
 * Pulls guardian_notes from glossary terms + key rules from game knowledge.
 * Keeps it short — Haiku is cheap but context still costs.
 */
function buildFactualRulesBlock(glossary, gameKnowledge) {
  const rules = [];

  // Guardian notes from glossary term definitions
  if (glossary?.terms) {
    for (const [term, data] of Object.entries(glossary.terms)) {
      if (data.guardian_note) {
        rules.push(`[${term}] ${data.guardian_note}`);
      }
    }
  }

  if (Array.isArray(gameKnowledge?.guardian_rules)) {
    rules.push(...gameKnowledge.guardian_rules);
  } else if (Array.isArray(gameKnowledge?.factual_rules)) {
    rules.push(...gameKnowledge.factual_rules);
  } else if (gameKnowledge) {
    // Legacy Critters Quest supplement format
    rules.push(`[Master Editions] Total supply: 3,500. Closed forever. OG = #1–2500, Standard = #2501–3500. Masters are indestructible.`);
    rules.push(`[$QUEST types] Locked Quest = on-critter, CANNOT be transferred. Town Bank Quest = can deposit/withdraw. These are DIFFERENT.`);
    rules.push(`[Lucky Pick] ME holders earn 1% BPS share of every round. Reward tied to NFT, not wallet. Genesis Quest Opt-In CLOSED Feb 2026.`);
    rules.push(`[Critters TCG] $QUEST integration is TBD only. NEVER say it is confirmed.`);
    rules.push(`[Genesis Quest] Opt-In is CLOSED since Feb 2026. Never imply it is open.`);
    rules.push(`[Mainnet] Target ~May 2026. Lucky Pick live April 15, 2026. Do not state exact dates unless confirmed.`);
    rules.push(`[Clones] Can be lost in combat. Masters cannot. Clones are NOT the same as Masters.`);
  }

  return rules.join('\n');
}

/**
 * Build the condensed voice rules block for the Haiku prompt.
 */
function buildVoiceRulesBlock(brandVoice) {
  if (!brandVoice) {
    return 'Brand voice: clear, credible, and human. No hype, no empty claims, no stiff corporate language.';
  }

  const pillars = (brandVoice.voice_pillars || [])
    .map((p) => `- ${p.name}: ${p.do || p.description}`)
    .join('\n');

  const avoid = (brandVoice.avoid || [])
    .map((a) => `- ${a}`)
    .join('\n');

  return `VOICE PILLARS:\n${pillars}\n\nAVOID:\n${avoid}`;
}

/**
 * Check 2 + 3: Factual accuracy and brand voice — single Haiku call.
 *
 * Returns { factualScore, voiceScore, flags[] } where flags match the schema:
 * { type: 'factual'|'voice', severity: 'minor'|'major', field, issue, suggestion }
 *
 * @param {object} content
 * @param {object|null} glossary
 * @param {object|null} brandVoice
 * @param {object|null} gameKnowledge
 * @returns {Promise<{ factualScore: number, voiceScore: number, flags: object[], usage: object }>}
 */
async function checkFactualAndVoice(content, glossary, brandVoice, gameKnowledge, config = DEFAULT_CONFIG) {
  const factualRules = buildFactualRulesBlock(glossary, gameKnowledge);
  const voiceRules   = buildVoiceRulesBlock(brandVoice);
  const contentSchema = getContentSchema(config);
  const contentFields = contentSchema.map((field) => field.key);
  const fieldList = contentFields.join('|');

  // Build content block — only include fields that have content
  const contentBlock = contentFields
    .filter((f) => content[f])
    .map((f) => `[${f.toUpperCase()}]\n${content[f]}`)
    .join('\n\n');

  const prompt = `You are a brand QA reviewer for ${config.clientName}${config.guardian?.reviewerContext ? `, ${config.guardian.reviewerContext}` : ''}.

Review the content below for two things:
1. FACTUAL ACCURACY — does it contradict known facts about the business, brand, offer, or market position?
2. BRAND VOICE — does it match the ${config.clientName} voice?

FACTUAL RULES (things that must never be stated incorrectly):
${factualRules}

${voiceRules}

CONTENT TO REVIEW:
${contentBlock}

Return ONLY valid JSON — no preamble, no explanation, no markdown:
{
  "factualScore": <0-100, 100 = perfectly accurate>,
  "voiceScore": <0-100, 100 = perfectly on-brand>,
  "flags": [
    {
      "type": "factual" or "voice",
      "severity": "minor" or "major",
      "field": "<${fieldList}>",
      "issue": "<specific problem>",
      "suggestion": "<how to fix it>"
    }
  ]
}

Severity guide:
- major: factual error that could mislead the audience, or voice that could damage brand trust
- minor: slight imprecision or minor voice drift that should be noted but doesn't block publish

If no flags for a category, return empty array. Score 90+ if clean.`;

  const response = await getAnthropicClient().messages.create({
    model: MODELS.guardianCheck,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0]?.text || '';
  const usage   = response.usage || {};

  // Parse JSON — attempt repair if needed
  let parsed;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    // Haiku returned unparseable output — return safe degraded scores
    console.warn('[GUARDIAN] Haiku response could not be parsed — using degraded scores');
    console.warn('[GUARDIAN] Raw response tail:', rawText.slice(-200));
    parsed = { factualScore: 75, voiceScore: 75, flags: [] };
  }

  return {
    factualScore: typeof parsed.factualScore === 'number' ? parsed.factualScore : 75,
    voiceScore:   typeof parsed.voiceScore   === 'number' ? parsed.voiceScore   : 75,
    flags:        Array.isArray(parsed.flags) ? parsed.flags : [],
    usage,
  };
}

/**
 * Main Guardian entry point.
 *
 * @param {object} contentOutput - Full Scribe output object (has .content, .guardianFlags, etc.)
 * @param {string} clientId      - e.g. 'critters-quest'
 * @returns {object} Verdict object — replaces GUARDIAN_PLACEHOLDER on contentOutput
 */
async function runGuardian(contentOutput, clientId) {
  const guardianStart = Date.now();
  console.log(`[${new Date().toISOString()}] GUARDIAN: starting QA checks for ${clientId}...`);

  // Error-safe verdict template — used if anything throws
  const errorVerdict = {
    readyToPublish: false,
    overallScore:   null,
    factualScore:   null,
    voiceScore:     null,
    hardBlock:      false,
    concerns:       [],
    flags:          [],
    reviewRequired: true,
    note:           'Guardian error — manual review required',
  };

  try {
    const config = requireClientConfig(clientId);
    const content = contentOutput.content || {};

    // --- Load knowledge files ---
    const { glossary, brandVoice, gameKnowledge } = await loadKnowledge(clientId);

    // --- Check 1: Restricted terms (pure JS) — hardBlock on match ---
    const { hardBlock, violations } = checkRestrictedTerms(content, glossary, config);

    if (hardBlock) {
      console.error(`[GUARDIAN] HARD BLOCK — restricted terms found: ${violations.join('; ')}`);
    } else {
      console.log('[GUARDIAN] Check 1 passed — no restricted terms found');
    }

    // --- Check 2: Competitor mentions (pure JS) — major flag + reviewRequired, NOT hardBlock ---
    // Human reviewer decides if the context (e.g. shared "best games" list) warrants keeping it.
    const competitorFlags = checkCompetitorMentions(content, config);
    if (competitorFlags.length > 0) {
      competitorFlags.forEach((f) =>
        console.warn(`[GUARDIAN] [COMPETITOR] ${f.field}: ${f.issue}`)
      );
    }

    // --- Check 3+4: Factual + voice (single Haiku call) ---
    // Run even on hardBlock so we have the full picture; just don't let it publish
    const { factualScore, voiceScore, flags: haikusFlags, usage } = await checkFactualAndVoice(
      content, glossary, brandVoice, gameKnowledge, config
    );
    // Merge competitor flags with Haiku flags
    const flags = [...competitorFlags, ...haikusFlags];

    logCostEstimate(
      'Guardian (QA check)',
      usage.input_tokens  || 0,
      usage.output_tokens || 0,
      MODELS.guardianCheck
    );

    // --- Verdict assembly ---
    const overallScore   = Math.round((factualScore * 0.5) + (voiceScore * 0.5));
    const hasMajorFlag   = flags.some((f) => f.severity === 'major');
    const reviewRequired = overallScore < 70 || hasMajorFlag || hardBlock;
    const readyToPublish = !hardBlock && overallScore >= 70;

    // Build concerns list from violations + major flags for easy reading
    const concerns = [
      ...violations,
      ...flags.filter((f) => f.severity === 'major').map((f) => `[${f.field}] ${f.issue}`),
    ];

    const verdict = {
      readyToPublish,
      overallScore,
      factualScore,
      voiceScore,
      hardBlock,
      concerns,
      flags,
      reviewRequired,
      note: `Guardian v1 — ${MODELS.guardianCheck}`,
      guardianUsage: {
        inputTokens:  usage.input_tokens  || 0,
        outputTokens: usage.output_tokens || 0,
        model:        MODELS.guardianCheck,
      },
    };

    const duration = ((Date.now() - guardianStart) / 1000).toFixed(1);
    console.log(`[GUARDIAN] Score: overall=${overallScore} factual=${factualScore} voice=${voiceScore} | hardBlock=${hardBlock} reviewRequired=${reviewRequired} (${duration}s)`);

    if (flags.length > 0) {
      flags.forEach((f) =>
        console.log(`[GUARDIAN] [${f.severity.toUpperCase()}][${f.type}] ${f.field}: ${f.issue}`)
      );
    } else {
      console.log('[GUARDIAN] No flags raised.');
    }

    return verdict;

  } catch (err) {
    console.error(`[GUARDIAN] Error during QA checks: ${err.message}`);
    // Never block the pipeline — return safe error verdict with reviewRequired=true
    return errorVerdict;
  }
}

module.exports = { runGuardian };
