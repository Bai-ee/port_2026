'use strict';

// card-description-builder.js
//
// Deterministic onboarding tile description system.
//
// Public API:
//   resolveAnalyzerSource(cardId, analyzerOutputs) → aggregate | null
//   buildCardDescription(cardId, aggregate, rawData) → DescriptionResult
//
// Signal shape: { id, type, finding, impact, action }
//   finding — what we saw (1 short sentence)
//   impact  — why it matters (1 short sentence, may be null)
//   action  — what to do next (1 short sentence, may be null)
//
// No LLM call is made here. Scribe remains the source for expanded/modal copy.

// ── Onboarding card → analyzer source map ────────────────────────────────────
//
// Maps display card ids to the analyzer output key(s) that carry their data.
// Legacy aliases live here so DashboardPage.jsx stays clean.
//
// Format: cardId → string (primary) | string[] (primary, ...fallbacks)

const CARD_ANALYZER_SOURCE_MAP = {
  'brief':               'brief',
  'multi-device-view':   ['multi-device-view', 'intake-terminal'],
  'social-preview':      ['social-preview', 'brand-tone'],
  'business-model':      'business-model',
  'seo-performance':     ['seo-performance', 'site-performance'],
  'industry':            'industry',
  'visibility-snapshot': 'visibility-snapshot',
  'brand-voice':         ['brand-voice', 'brand-tone'],
};

function isAggregateLike(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.readiness === 'string' &&
    Array.isArray(value.findings) &&
    Array.isArray(value.gaps) &&
    Array.isArray(value.highlights)
  );
}

function extractAggregate(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (isAggregateLike(entry.aggregate)) return entry.aggregate;
  if (isAggregateLike(entry)) return entry;
  return null;
}

/**
 * Resolve the analyzer aggregate for a display card.
 * Tries each source key in order and returns the first non-null aggregate.
 *
 * @param {string} cardId
 * @param {object} analyzerOutputs  - { [sourceId]: { aggregate, skills } }
 * @returns {object|null}
 */
function resolveAnalyzerSource(cardId, analyzerOutputs) {
  if (!analyzerOutputs || !cardId) return null;
  const sources = CARD_ANALYZER_SOURCE_MAP[cardId];
  if (!sources) return extractAggregate(analyzerOutputs?.[cardId]);
  const list = Array.isArray(sources) ? sources : [sources];
  for (const sourceId of list) {
    const agg = extractAggregate(analyzerOutputs?.[sourceId]);
    if (agg) return agg;
  }
  return null;
}

// ── Audit-failure gap detection ───────────────────────────────────────────────
//
// Same pattern logic as scribe.js — both layers must classify identically.
// Examples: psi-data-unavailable, fetch-failed, synthesize-failed, audit-incomplete.

function isAuditFailureGap(ruleId) {
  if (!ruleId) return false;
  const id = String(ruleId).toLowerCase();
  return id.includes('unavailable') ||
         id.includes('-failed')     ||
         id.includes('_failed')     ||
         id.startsWith('audit-');
}

// ── Aggregate → local description model ──────────────────────────────────────

function projectFromAggregate(aggregate) {
  if (!aggregate) return { status: null, issues: [], strengths: [], metrics: {} };

  const findings  = aggregate.findings  || [];
  const gaps      = aggregate.gaps      || [];
  const highlights = aggregate.highlights || [];

  const issues = [
    ...findings.filter((f) => f.severity === 'critical' || f.severity === 'warning'),
    ...gaps.filter((g) => g.triggered && !isAuditFailureGap(g.ruleId)),
  ];

  const strengths = [
    ...highlights,
    ...findings.filter((f) => f.severity === 'info').map((f) => f.label),
  ];

  return {
    status:   aggregate.readiness || null,
    issues,
    strengths,
    metrics:  aggregate.metrics || {},
  };
}

// ── Per-card dominant-signal selectors ───────────────────────────────────────
//
// Each selector:
//   - receives projected { status, issues, strengths, metrics }
//     (metrics = aggregate.metrics merged with card-specific rawData)
//   - returns a signal { id, type, finding, impact, action } or null
//   - null → caller falls through to scribeShort → static description

const CARD_SIGNAL_SELECTORS = {
  'seo-performance':     selectSeoPerformanceSignal,
  'social-preview':      selectSocialPreviewSignal,
  'multi-device-view':   selectMultiDeviceSignal,
  'brief':               selectBriefSignal,
  'business-model':      selectBusinessModelSignal,
  'industry':            selectIndustrySignal,
  'visibility-snapshot': selectVisibilitySignal,
};

// seo-performance
// Priority: critical finding → warning finding or triggered gap → strongest highlight
function selectSeoPerformanceSignal({ issues, strengths }) {
  const critical = issues.find((i) => i.severity === 'critical');
  if (critical) {
    return {
      id:      critical.id || 'seo-critical',
      type:    'issue',
      finding: critical.label,
      impact:  critical.detail || 'This is directly limiting your search visibility.',
      action:  'Check the Solutions tab for the fix.',
    };
  }

  const warning = issues.find((i) => i.severity === 'warning' || i.triggered);
  if (warning) {
    const label = warning.label || warning.ruleId || 'SEO issue found';
    const type  = warning.severity ? 'issue' : 'gap';
    return {
      id:      warning.id || warning.ruleId || 'seo-warning',
      type,
      finding: label,
      impact:  warning.detail || warning.evidence || 'Fixing this will improve crawlability and ranking signals.',
      action:  null,
    };
  }

  const top = strengths[0];
  if (top) {
    return {
      id:      'seo-strength',
      type:    'strength',
      finding: typeof top === 'string' ? top : (top.label || 'SEO baseline looks solid'),
      impact:  'No critical issues found.',
      action:  null,
    };
  }
  return null;
}

// social-preview
// Priority: no OG image → missing title or description → missing canonical/favicon → complete
function selectSocialPreviewSignal({ issues, strengths, metrics }) {
  // rawData supplies: ogImage (bool|null), ogTitle (string|null),
  // ogDescription (string|null), canonical (string|null), favicon (bool|null)

  if (metrics.ogImage === false) {
    return {
      id:      'og-image-missing',
      type:    'issue',
      finding: 'No preview image is set.',
      impact:  'Links shared to social platforms will appear without a thumbnail, reducing clicks.',
      action:  'Add an og:image tag pointing to a 1200×630 image.',
    };
  }

  const titleMissing = metrics.ogTitle === null || metrics.ogTitle === '';
  const descMissing  = metrics.ogDescription === null || metrics.ogDescription === '';

  if (titleMissing || descMissing) {
    const what = [titleMissing && 'title', descMissing && 'description'].filter(Boolean).join(' and ');
    return {
      id:      'og-meta-missing',
      type:    'issue',
      finding: `Social preview ${what} is missing.`,
      impact:  'Platforms will substitute generic or scraped text instead of your branded copy.',
      action:  'Add the missing Open Graph meta tags.',
    };
  }

  // Check analyzer findings for any remaining social-surface issues
  const surfaceIssue = issues.find((i) =>
    /canonical|favicon|icon|og:/i.test(i.label || i.ruleId || '')
  );
  if (surfaceIssue) {
    return {
      id:      surfaceIssue.id || 'og-surface',
      type:    'issue',
      finding: surfaceIssue.label || 'Social meta surface incomplete',
      impact:  surfaceIssue.detail || surfaceIssue.evidence || null,
      action:  null,
    };
  }

  // Canonical / favicon gaps from rawData
  const canonicalMissing = metrics.canonical === null || metrics.canonical === '';
  const faviconMissing   = metrics.favicon === false || metrics.favicon === null;

  if (canonicalMissing || faviconMissing) {
    const what = [canonicalMissing && 'canonical URL', faviconMissing && 'favicon'].filter(Boolean).join(' and ');
    return {
      id:      'og-surface-missing',
      type:    'issue',
      finding: `${what} is not set.`,
      impact:  'Incomplete meta surfaces can affect SEO signals and brand display.',
      action:  null,
    };
  }

  // All checks pass
  const top = strengths[0];
  return {
    id:      'social-complete',
    type:    'strength',
    finding: (typeof top === 'string' ? top : null) || 'Social preview is fully configured.',
    impact:  'Shared links will display your image, title, and description.',
    action:  null,
  };
}

// multi-device-view
// Priority: capture failed → artifact missing → healthy capture
// This card describes audit/artifact state — no layout diagnosis without a layout analyzer.
function selectMultiDeviceSignal({ status, issues, strengths, metrics }) {
  // rawData supplies: captureDone (bool)
  if (metrics.captureDone === false) {
    return {
      id:      'capture-failed',
      type:    'audit-state',
      finding: 'Device screenshot capture did not complete.',
      impact:  'Layout review is unavailable until a screenshot is taken.',
      action:  'Re-run the intake to retry the capture.',
    };
  }

  // Check analyzer for explicit capture-failure gaps
  const captureFail = issues.find((i) =>
    isAuditFailureGap(i.ruleId) ||
    /screenshot|capture|mockup/i.test(i.label || i.ruleId || '')
  );
  if (captureFail) {
    return {
      id:      'capture-failed',
      type:    'audit-state',
      finding: 'Device screenshot capture did not complete.',
      impact:  captureFail.evidence || captureFail.detail || 'Layout review is unavailable until a screenshot is taken.',
      action:  'Re-run the intake to retry the capture.',
    };
  }

  const artifactGap = issues.find((i) =>
    /artifact|device|layout/i.test(i.label || i.ruleId || '')
  );
  if (artifactGap) {
    return {
      id:      'artifact-missing',
      type:    'issue',
      finding: artifactGap.label || 'One or more device views is missing.',
      impact:  artifactGap.detail || 'Full cross-device coverage requires all three breakpoints.',
      action:  null,
    };
  }

  if (metrics.captureDone === true || status === 'healthy') {
    const top = strengths[0];
    return {
      id:      'device-healthy',
      type:    'strength',
      finding: (typeof top === 'string' ? top : null) || 'Multi-device screenshots captured successfully.',
      impact:  'Desktop, tablet, and mobile views are available for review.',
      action:  null,
    };
  }

  return null;
}

// brief
// Priority: no brief / intake too thin → strongest strategic framing signal
function selectBriefSignal({ status, issues, strengths, metrics }) {
  // rawData supplies: hasBrief (bool)
  if (metrics.hasBrief === false || status === 'critical' || issues.length > 0) {
    const topIssue = issues[0];
    return {
      id:      'brief-thin',
      type:    'issue',
      finding: topIssue?.label || 'Intake data is too thin to build a reliable brief.',
      impact:  topIssue?.detail || 'Strategy, messaging, and recommendations depend on this baseline.',
      action:  'Complete the onboarding questions to generate the full brief.',
    };
  }

  const top = strengths[0];
  if (top || metrics.hasBrief === true) {
    return {
      id:      'brief-strength',
      type:    'strength',
      finding: (typeof top === 'string' ? top : top?.label) || 'Brief is complete.',
      impact:  'Business context, positioning, and strategy signals are all in place.',
      action:  null,
    };
  }
  return null;
}

// business-model
// Priority: no model detected → strongest resolved structure
function selectBusinessModelSignal({ status, issues, strengths, metrics }) {
  // rawData supplies: hasModel (bool), modelLabel (string|null)
  if (metrics.hasModel === false || status === 'critical' || issues.length > 0) {
    const topIssue = issues[0];
    return {
      id:      'model-unclear',
      type:    'issue',
      finding: topIssue?.label || 'No clear business model could be detected.',
      impact:  topIssue?.detail || 'Pricing, packaging, or service structure was not clear on the fetched pages.',
      action:  'Add a pricing or services page to make the model explicit.',
    };
  }

  if (metrics.hasModel === true && metrics.modelLabel) {
    return {
      id:      'model-resolved',
      type:    'strength',
      finding: `Business model identified: ${metrics.modelLabel}.`,
      impact:  'This shapes how content, SEO, and positioning will be structured.',
      action:  null,
    };
  }

  const top = strengths[0];
  if (top) {
    return {
      id:      'model-resolved',
      type:    'strength',
      finding: typeof top === 'string' ? top : (top.label || 'Business model is clear.'),
      impact:  'This shapes how content, SEO, and positioning will be structured.',
      action:  null,
    };
  }
  return null;
}

// industry
// Priority: unknown category → strongest resolved market category
function selectIndustrySignal({ status, issues, strengths, metrics }) {
  // rawData supplies: hasCategory (bool), categoryLabel (string|null)
  if (metrics.hasCategory === false || status === 'critical' || issues.length > 0) {
    const topIssue = issues[0];
    return {
      id:      'industry-unknown',
      type:    'issue',
      finding: topIssue?.label || 'Market category could not be determined.',
      impact:  topIssue?.detail || 'Without a clear category, competitive benchmarking and keyword strategy are limited.',
      action:  'Make your service or product vertical explicit in your homepage copy.',
    };
  }

  if (metrics.hasCategory === true && metrics.categoryLabel) {
    return {
      id:      'industry-resolved',
      type:    'strength',
      finding: `Market category: ${metrics.categoryLabel}.`,
      impact:  'Competitor benchmarking and category-specific SEO recommendations are now available.',
      action:  null,
    };
  }

  const top = strengths[0];
  if (top) {
    return {
      id:      'industry-resolved',
      type:    'strength',
      finding: typeof top === 'string' ? top : (top.label || 'Market category resolved.'),
      impact:  'Competitor benchmarking and category-specific recommendations are now available.',
      action:  null,
    };
  }
  return null;
}

// visibility-snapshot
// Priority: low score (<40) → partial coverage (40–69) → strongest positive signal
function selectVisibilitySignal({ status, issues, strengths, metrics }) {
  // rawData supplies: score (number|null), letterGrade (string|null)
  const score = metrics.score ?? null;
  const grade = metrics.letterGrade || null;
  const scoreLabel = score != null ? `${score}/100${grade ? ` (${grade})` : ''}` : null;

  if (status === 'critical' || (score != null && score < 40)) {
    const topIssue = issues[0];
    return {
      id:      'visibility-low',
      type:    'issue',
      finding: scoreLabel ? `AI visibility score: ${scoreLabel}.` : (topIssue?.label || 'Visibility is low.'),
      impact:  topIssue?.detail || 'Your business is not appearing in AI-generated answers or most platform surfaces.',
      action:  'Review the Solutions tab for the highest-impact visibility fixes.',
    };
  }

  if (status === 'partial' || (score != null && score < 70)) {
    const topIssue = issues[0];
    return {
      id:      'visibility-partial',
      type:    'issue',
      finding: scoreLabel ? `Visibility is partial — ${scoreLabel}.` : (topIssue?.label || 'Partial visibility coverage.'),
      impact:  topIssue?.detail || 'Some surfaces are indexed, but coverage has gaps that are limiting reach.',
      action:  null,
    };
  }

  const top = strengths[0];
  if (top || score != null) {
    return {
      id:      'visibility-strength',
      type:    'strength',
      finding: scoreLabel ? `AI visibility score: ${scoreLabel}.` : ((typeof top === 'string' ? top : top?.label) || 'Visibility coverage is strong.'),
      impact:  'Your business is appearing across search and AI-generated surfaces.',
      action:  null,
    };
  }
  return null;
}

// ── Description renderer ──────────────────────────────────────────────────────
//
// Assembles a 1–3 sentence tile description from a dominant signal.
// Template: [What we saw]. [Why it matters]. [What to do next].
// Sentences are omitted when the value is null/empty.

function renderDescription(signal) {
  if (!signal) return null;

  // Default action when the selector didn't set one
  let action = signal.action;
  if (!action && signal.type === 'issue') {
    action = 'Let me fix this — see the Solutions tab.';
  }
  if (!action && signal.type === 'gap') {
    action = 'Let me fix this — see the Solutions tab.';
  }
  if (!action && signal.type === 'audit-state') {
    action = 'Re-run the intake to retry.';
  }

  const parts = [signal.finding, signal.impact, action].filter(Boolean);

  // Ensure each part ends with a sentence terminator
  const sentences = parts.map((p) => {
    const s = p.trim();
    return /[.!?]$/.test(s) ? s : `${s}.`;
  });

  return sentences.join(' ') || null;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic tile description for an onboarding card.
 *
 * @param {string}      cardId
 * @param {object|null} aggregate  - analyzer aggregate ({ findings, gaps, readiness, highlights })
 * @param {object}      [rawData]  - card-specific values merged into projected.metrics
 * @returns {{
 *   status: string|null,
 *   dominantSignal: object|null,
 *   description: string|null,
 *   debug: object
 * }}
 */
function buildCardDescription(cardId, aggregate, rawData = {}) {
  const projected = projectFromAggregate(aggregate);

  if (rawData && typeof rawData === 'object') {
    Object.assign(projected.metrics, rawData);
  }

  const selector       = CARD_SIGNAL_SELECTORS[cardId];
  const dominantSignal = selector ? selector(projected) : null;
  const description    = renderDescription(dominantSignal);

  return {
    status: projected.status,
    dominantSignal,
    description,
    debug: {
      cardId,
      status:           projected.status,
      issueCount:       projected.issues.length,
      strengthCount:    projected.strengths.length,
      selectedSignalId: dominantSignal?.id || null,
    },
  };
}

module.exports = {
  CARD_ANALYZER_SOURCE_MAP,
  isAuditFailureGap,
  resolveAnalyzerSource,
  buildCardDescription,
};
