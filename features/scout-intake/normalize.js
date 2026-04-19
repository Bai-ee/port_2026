'use strict';

// normalize.js — Maps LLM synthesis output to the IntakePipelineResult contract
//
// This is the boundary between what the LLM returns and what the worker writes
// to Firestore. Keeps run-lifecycle.cjs compatibility while adding the new
// snapshot/signals/strategy fields.
//
// Also provides backward-compatible shims so buildDashboardProjection in
// run-lifecycle.cjs continues to work without changes. The extended projection
// in run-lifecycle.cjs will add the new fields on top.

// ── Safe accessors ─────────────────────────────────────────────────────────────

function str(val, fallback = '') {
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function arr(val) {
  return Array.isArray(val) ? val : [];
}

// ── Compat shims — maps new intake fields to run-lifecycle.cjs field names ────

/**
 * Derive scoutPriorityAction from the intake payload.
 * run-lifecycle.cjs uses this as the dashboard headline.
 */
function deriveScoutPriorityAction(intake) {
  return (
    str(intake?.strategy?.postStrategy?.approach) ||
    str(intake?.snapshot?.brandOverview?.positioning) ||
    str(intake?.snapshot?.brandOverview?.headline) ||
    null
  );
}

/**
 * Derive a content object that run-lifecycle.cjs's buildDashboardProjection
 * can read for summaryCards.
 */
function deriveContent(intake) {
  const post = str(intake?.outputsPreview?.samplePost);
  const caption = str(intake?.outputsPreview?.sampleCaption);
  if (!post && !caption) return null;
  return {
    x_post: post || null,
    content_angle: str(intake?.strategy?.contentAngles?.[0]?.angle) || null,
    ...(caption ? { caption } : {}),
  };
}

/**
 * Map opportunityMap to the contentOpportunities shape expected by
 * buildDashboardProjection (latestInsights).
 */
function deriveContentOpportunities(intake) {
  return arr(intake?.strategy?.opportunityMap).map((item) => ({
    topic: str(item.opportunity),
    whyNow: str(item.why),
    priority: item.priority || 'medium',
    format: null,
  }));
}

// ── Main normalizer ───────────────────────────────────────────────────────────

/**
 * Normalize raw intake data into an IntakePipelineResult.
 *
 * @param {object} intake - Raw output from intake-synthesizer.js
 * @param {object} meta   - { clientId, websiteUrl, runCostData, pipelineRunId }
 * @returns {IntakePipelineResult}
 */
function normalizeIntakeResult(
  intake,
  {
    clientId,
    websiteUrl,
    runCostData,
    pipelineRunId,
    artifactRefs = [],
    warnings = [],
    siteMeta = null,
    styleGuide = null,
    styleGuideCost = null,
    userContext = null,
    analyzerResults = null,
    analyzerOutputs = null,
    scribeResult = null,
    briefHtml = null,
    scoutConfig = null,
    tier = 'free',
  }
) {
  // Degrade gracefully when synthesis failed — build a minimal result from
  // whatever other data the pipeline captured (screenshots, siteMeta, etc.).
  if (!intake || typeof intake !== 'object') {
    intake = {};
  }

  const snapshot = intake.snapshot || {};
  const signals = intake.signals || {};
  const strategy = intake.strategy || {};
  const outputsPreview = intake.outputsPreview || {};
  const systemPreview = intake.systemPreview || {};

  return {
    // Identity
    status: 'succeeded',
    pipelineType: 'free-tier-intake',
    pipelineRunId,

    // ── Free-tier dashboard modules ─────────────────────────────────────────

    snapshot: {
      brandOverview: {
        headline: str(snapshot.brandOverview?.headline),
        summary: str(snapshot.brandOverview?.summary),
        industry: str(snapshot.brandOverview?.industry),
        businessModel: str(snapshot.brandOverview?.businessModel),
        targetAudience: str(snapshot.brandOverview?.targetAudience),
        positioning: str(snapshot.brandOverview?.positioning),
      },
      brandTone: {
        primary: str(snapshot.brandTone?.primary),
        secondary: str(snapshot.brandTone?.secondary),
        tags: arr(snapshot.brandTone?.tags).filter(Boolean),
        writingStyle: str(snapshot.brandTone?.writingStyle),
      },
      visualIdentity: {
        summary: str(snapshot.visualIdentity?.summary),
        colorPalette: str(snapshot.visualIdentity?.colorPalette),
        styleNotes: str(snapshot.visualIdentity?.styleNotes),
        styleGuide: styleGuide || null,
      },
    },

    signals: {
      core: arr(signals.core).map((s) => ({
        label: str(s.label),
        summary: str(s.summary),
        source: str(s.source, 'website'),
        relevance: ['high', 'medium', 'low'].includes(s.relevance) ? s.relevance : 'medium',
      })),
    },

    strategy: {
      postStrategy: {
        approach: str(strategy.postStrategy?.approach),
        frequency: str(strategy.postStrategy?.frequency),
        formats: arr(strategy.postStrategy?.formats).filter(Boolean),
      },
      contentAngles: arr(strategy.contentAngles).map((a) => ({
        angle: str(a.angle),
        rationale: str(a.rationale),
        format: str(a.format),
      })),
      opportunityMap: arr(strategy.opportunityMap).map((o) => ({
        opportunity: str(o.opportunity),
        why: str(o.why),
        priority: ['high', 'medium', 'low'].includes(o.priority) ? o.priority : 'medium',
      })),
    },

    outputsPreview: {
      samplePost: str(outputsPreview.samplePost),
      sampleCaption: str(outputsPreview.sampleCaption),
    },

    systemPreview: {
      modulesUnlocked: arr(systemPreview.modulesUnlocked).filter(Boolean).length > 0
        ? arr(systemPreview.modulesUnlocked).filter(Boolean)
        : ['Brand Overview', 'Brand Tone', 'Visual Identity', 'Signals', 'Post Strategy'],
      nextStep: str(systemPreview.nextStep),
    },

    // ── run-lifecycle.cjs compatibility shims ───────────────────────────────
    // These let buildDashboardProjection work without changes in Phase 4.
    // The extended projection in run-lifecycle.cjs will merge the new fields on top.

    scoutPriorityAction: deriveScoutPriorityAction(intake),
    content: deriveContent(intake),
    contentOpportunities: deriveContentOpportunities(intake),
    guardianFlags: null,

    // ── Brand graphics from homepage siteMeta (OG image, favicon, etc.) ────
    // Extracted by site-fetcher.js, passed through runner.js — never touches LLM.
    siteMeta: siteMeta || null,

    // ── Cost + provider metadata ────────────────────────────────────────────
    providerName: 'anthropic',
    runCostData: runCostData || null,
    styleGuideCost: styleGuideCost || null,
    userContext: userContext || null,
    analyzerResults: analyzerResults || null,
    // analyzerOutputs: { [cardId]: SkillOutput } — populated by the skill step in runner.js
    // when SCOUT_ANALYZER_SKILLS_ENABLED is set. Null when flag is off (pre-P1 path).
    analyzerOutputs: analyzerOutputs && Object.keys(analyzerOutputs).length > 0 ? analyzerOutputs : null,
    scribe: scribeResult && scribeResult.ok ? {
      cards: scribeResult.cards,
      brief: scribeResult.brief,
      cost:  scribeResult.runCostData || null,
      seoGuardian: scribeResult.seoGuardian || null,
      html:  briefHtml || null,
    } : null,
    scoutConfig: scoutConfig || null,
    tier,
    artifactRefs: Array.isArray(artifactRefs) ? artifactRefs : [],
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

// ── Style Guide Synthesizer ───────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_MAX_TOKENS = 120;

function _getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY || (() => {
    try { require('dotenv/config'); } catch { /* ignore */ }
    return process.env.ANTHROPIC_API_KEY;
  })();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  return key;
}

/**
 * Generate a one-line visual personality summary from extracted design tokens.
 * Uses claude-haiku-4-5-20251001. Falls back to a deterministic template.
 *
 * @param {object} ds - DesignSystem output from design-system-extractor.js
 * @returns {Promise<string>}
 */
async function generateStyleGuideSummary(ds) {
  const heading = ds?.typography?.headingSystem?.fontFamily || 'system-ui';
  const body    = ds?.typography?.bodySystem?.fontFamily    || heading;
  const primary = ds?.colors?.primary?.hex  || null;
  const neutral = ds?.colors?.neutral?.hex  || null;
  const framing = ds?.layout?.framing       || null;
  const motion  = ds?.motion?.level         || 'minimal';

  const prompt = [
    'Write one brief phrase (8–12 words max) describing the visual personality of this design system.',
    'Name the fonts. Be specific. No period at the end.',
    '',
    `Heading: ${heading}`,
    `Body: ${body}`,
    primary ? `Primary color: ${primary}` : null,
    neutral ? `Neutral: ${neutral}` : null,
    framing ? `Framing: ${framing}` : null,
    `Motion: ${motion}`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': _getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: HAIKU_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    if (text && text.length > 5 && text.length < 120) return text;
  } catch { /* fall through */ }

  // Deterministic fallback
  const pair = heading === body ? heading : `${heading} + ${body}`;
  return `${pair}${neutral ? ` on ${neutral}` : ''}${framing ? ` · ${framing} framing` : ''}`;
}

/**
 * Synthesize a style guide object from raw design-system-extractor output.
 * Attaches a Haiku-generated summary line.
 *
 * Attach the result to visualIdentity.styleGuide in normalizeIntakeResult once
 * the extractor is wired into runner.js (follow-up phase).
 *
 * @param {object} designSystem - From design-system-extractor.js
 * @returns {Promise<object>} styleGuide shape
 */
async function synthesizeStyleGuide(designSystem) {
  if (!designSystem || typeof designSystem !== 'object') return null;
  const summary = await generateStyleGuideSummary(designSystem);
  return {
    summary,
    confidence: designSystem.confidence || 'medium',
    typography: designSystem.typography || null,
    colors:     designSystem.colors     || null,
    layout:     designSystem.layout     || null,
    motion:     designSystem.motion     || null,
  };
}

// ── Dev mock fixture ──────────────────────────────────────────────────────────
// Used in DashboardPage.jsx while the extractor is not yet wired.
// Mirrors the exact shape returned by synthesizeStyleGuide().

const STYLE_GUIDE_MOCK = {
  summary: 'Playfair Display over Inter on warm cream with card-based framing',
  confidence: 'high',
  typography: {
    fontFamilies: [
      { family: 'Playfair Display', role: 'heading', source: 'google-fonts' },
      { family: 'Inter',            role: 'body',    source: 'google-fonts' },
    ],
    headingSystem: {
      fontFamily:    'Playfair Display',
      fontSize:      '48px',
      fontWeight:    '700',
      lineHeight:    '1.1',
      letterSpacing: '-0.02em',
    },
    bodySystem: {
      fontFamily:    'Inter',
      fontSize:      '16px',
      fontWeight:    '400',
      lineHeight:    '1.6',
      letterSpacing: 'normal',
    },
    scale: 'modular 1.25',
  },
  colors: {
    primary:   { hex: '#C3B99A', role: 'brand accent',  shades: ['#F5F1EA','#E8E0D0','#C3B99A','#9E9178','#7A6E5C'] },
    secondary: { hex: '#4A7C7E', role: 'highlight',     shades: ['#D6E8E9','#A8CDD0','#4A7C7E','#326163','#1D3C3E'] },
    tertiary:  { hex: '#D4956A', role: 'warm accent',   shades: ['#FAE8DB','#ECC5A4','#D4956A','#B5724A','#8C5335'] },
    neutral:   { hex: '#FAF7F2', role: 'background',    shades: ['#FFFFFF','#FAF7F2','#F0EBE3','#E0D8CE','#C8BCAD'] },
    mode: 'light',
    semantic: {},
  },
  layout: {
    layoutType:   'flex',
    contentWidth: 'contained',
    maxWidth:     '1200px',
    framing:      'card-based',
    grid:         '12-column',
    spacing:      { unit: '8px', scale: '8-16-24-32-48' },
    borderRadius: '8px',
  },
  motion: {
    level:                'moderate',
    durations:            ['200ms', '400ms'],
    easings:              ['ease-in-out'],
    scrollPatterns:       ['GSAP ScrollTrigger'],
    prefersReducedMotion: true,
  },
};

module.exports = { normalizeIntakeResult, synthesizeStyleGuide, STYLE_GUIDE_MOCK };
