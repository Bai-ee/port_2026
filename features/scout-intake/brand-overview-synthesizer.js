'use strict';

// brand-overview-synthesizer.js
//
// Synthesizes snapshot.brandOverview from site evidence (OG meta, headings,
// body text) and scoutConfig identity data. Used by the modular intake path
// which doesn't run the full intake synthesizer.
//
// Priority order for each field:
//   OG/meta tags → AI synthesis from page content → scoutConfig fallback
//
// Returns { brandOverview } or null on total failure.

const { callAnthropic } = require('./_anthropic-client');

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function first(...vals) {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
}

// ── Evidence extraction helpers ───────────────────────────────────────────────

function getHomepage(evidence) {
  return evidence?.pages?.find((p) => p.type === 'homepage') || evidence?.pages?.[0] || null;
}

function buildEvidenceContext(evidence, scoutConfig) {
  const home = getHomepage(evidence);
  const siteMeta = home?.siteMeta || evidence?.siteMeta || null;

  const ogTitle       = str(siteMeta?.title);
  const ogDescription = str(siteMeta?.description);
  const ogSiteName    = str(siteMeta?.ogSiteName);
  const pageTitle     = str(home?.title);
  const metaDesc      = str(home?.metaDescription);
  const h1s           = (home?.h1 || []).slice(0, 3).join(' | ');
  const h2s           = (home?.h2 || []).slice(0, 6).join(' | ');
  const navLabels     = (home?.navLabels || []).slice(0, 8).join(', ');
  const ctaTexts      = (home?.ctaTexts || []).slice(0, 6).join(' | ');
  const bodyParas     = (home?.bodyParagraphs || []).slice(0, 6).join('\n');

  // Pull text from about/services pages too
  const extraPages = (evidence?.pages || []).filter((p) => p.type !== 'homepage').slice(0, 2);
  const extraText = extraPages
    .flatMap((p) => [...(p.h1 || []), ...(p.bodyParagraphs || []).slice(0, 3)])
    .join('\n');

  const scoutName     = str(scoutConfig?.clientName);
  const scoutIndustry = str(scoutConfig?.industry);
  const scoutKeywords = Array.isArray(scoutConfig?.brandKeywords)
    ? scoutConfig.brandKeywords.slice(0, 6).join(', ')
    : '';

  return {
    ogTitle, ogDescription, ogSiteName,
    pageTitle, metaDesc,
    h1s, h2s, navLabels, ctaTexts, bodyParas,
    extraText,
    scoutName, scoutIndustry, scoutKeywords,
  };
}

// ── Deterministic fallback (no AI call) ──────────────────────────────────────
// Used when AI is unavailable or fails. Fills what can be derived without LLM.

function deterministicFallback(ctx) {
  return {
    headline:       first(ctx.ogTitle, ctx.pageTitle, ctx.ogSiteName),
    summary:        first(ctx.ogDescription, ctx.metaDesc),
    industry:       first(ctx.scoutIndustry),
    businessModel:  '',
    targetAudience: '',
    positioning:    '',
    source:         'crawl',
  };
}

// ── AI synthesis ──────────────────────────────────────────────────────────────

const SYNTH_TOOL = {
  name: 'fill_brand_overview',
  description: 'Extract brand overview fields from website evidence. Focus on MARKET POSITIONING — who they are an alternative to, what the wedge is, and who specifically the audience is with what pain point. Not a bio or resume summary.',
  input_schema: {
    type: 'object',
    required: ['headline', 'summary', 'industry', 'businessModel', 'targetAudience', 'positioning'],
    properties: {
      headline: {
        type: 'string',
        description: 'Positioning-forward tagline (12 words max). A market STANCE, not a job title. Should feel like "X for Y who hate Z" or "The [differentiator] [category]". Not "Digital Media Developer & Creative Technologist".',
      },
      summary: {
        type: 'string',
        description: 'Forward-looking market narrative (2-3 sentences): what market position does this occupy and why does it win? Against what alternative? For whom specifically? Not a bio or resume. Avoid: "seamlessly", "passionate", "experienced professional".',
      },
      industry: {
        type: 'string',
        description: 'Specific market sub-sector — not "Technology" but "AI-Assisted Creative Services" or "B2B SaaS / Dev Tools". Be as specific as evidence allows.',
      },
      businessModel: {
        type: 'string',
        description: 'Engagement model WITH the delivery differentiator: how is this different from the standard agency/freelancer/tool alternative? (e.g. "Project-based with AI leverage, not hourly retainers; outcomes over hours"). Not just a revenue category.',
      },
      targetAudience: {
        type: 'string',
        description: 'Specific buyer with specific prior pain: who has tried the old solution and been burned? (e.g. "Founders who tried AI automation tools but lost their brand voice" or "SMBs priced out of agency retainers"). Not "fast-moving teams" — a named buyer with a named problem.',
      },
      positioning: {
        type: 'string',
        description: 'Market STANCE: who is this an alternative to, and what is the wedge? (e.g. "The human-in-the-loop alternative to autonomous AI marketing — AI speed with brand judgment, not autopilot"). A stance against something specific, not a skill claim like "I am good at design and code".',
      },
    },
  },
};

async function synthesizeWithAI(ctx) {
  const lines = [
    `OG title: ${ctx.ogTitle || '(none)'}`,
    `OG description: ${ctx.ogDescription || '(none)'}`,
    `OG site name: ${ctx.ogSiteName || '(none)'}`,
    `Page title: ${ctx.pageTitle || '(none)'}`,
    `Meta description: ${ctx.metaDesc || '(none)'}`,
    ctx.h1s       ? `H1: ${ctx.h1s}` : null,
    ctx.h2s       ? `H2 sections: ${ctx.h2s}` : null,
    ctx.navLabels ? `Navigation: ${ctx.navLabels}` : null,
    ctx.ctaTexts  ? `CTAs: ${ctx.ctaTexts}` : null,
    ctx.bodyParas ? `Body text:\n${ctx.bodyParas}` : null,
    ctx.extraText ? `About/services pages:\n${ctx.extraText}` : null,
    ctx.scoutName    ? `Detected brand name: ${ctx.scoutName}` : null,
    ctx.scoutIndustry ? `Detected industry: ${ctx.scoutIndustry}` : null,
    ctx.scoutKeywords ? `Brand keywords: ${ctx.scoutKeywords}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `Analyze this website evidence and fill the brand overview fields.
Prioritize OG meta (title + description) — they are deliberately crafted brand signals.
Focus on MARKET POSITIONING: who is this an alternative to, who specifically is the audience, what is the wedge?
Avoid bio/resume language. These fields feed a search plan — vague content produces vague briefs.
Leave a field empty string only if there is genuinely no evidence for it.

${lines}

Call fill_brand_overview with your findings.`;

  const response = await callAnthropic({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    tools: [SYNTH_TOOL],
    tool_choice: { type: 'tool', name: 'fill_brand_overview' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content?.find((b) => b.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No tool_use block in synthesizer response.');
  return toolUse.input;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Synthesize snapshot.brandOverview from site evidence.
 * Always returns a brandOverview object (falls back deterministically on AI error).
 *
 * @param {object} evidence   - From fetchSiteEvidence()
 * @param {object} scoutConfig - From ensureScoutConfig() (may be null)
 * @returns {Promise<object>} brandOverview with source: 'crawl'
 */
async function synthesizeBrandOverview(evidence, scoutConfig) {
  const ctx = buildEvidenceContext(evidence, scoutConfig);

  // If there's no usable evidence at all, return minimal stub
  const hasAnyContent = ctx.ogTitle || ctx.ogDescription || ctx.pageTitle || ctx.h1s || ctx.bodyParas;
  if (!hasAnyContent) {
    return { headline: '', summary: '', industry: str(ctx.scoutIndustry), businessModel: '', targetAudience: '', positioning: '', source: 'crawl' };
  }

  try {
    const fields = await synthesizeWithAI(ctx);
    return {
      headline:       str(fields.headline),
      summary:        str(fields.summary),
      industry:       str(fields.industry) || str(ctx.scoutIndustry),
      businessModel:  str(fields.businessModel),
      targetAudience: str(fields.targetAudience),
      positioning:    str(fields.positioning),
      source: 'crawl',
    };
  } catch (err) {
    console.warn(`[brand-overview-synthesizer] AI call failed — using deterministic fallback: ${err.message}`);
    return deterministicFallback(ctx);
  }
}

module.exports = { synthesizeBrandOverview };
