// card-description-builder.mjs
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

export const CARD_ANALYZER_SOURCE_MAP = {
  'audit-summary':       'audit-summary',
  'brief':               'brief',
  'multi-device-view':   ['multi-device-view', 'intake-terminal'],
  'social-preview':      ['social-preview', 'brand-tone'],
  'business-model':      'business-model',
  'seo-performance':     ['seo-performance', 'site-performance'],
  'style-guide':         'style-guide',
  'industry':            'industry',
  'visibility-snapshot': 'visibility-snapshot',
  'priority-signal':     'priority-signal',
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
export function resolveAnalyzerSource(cardId, analyzerOutputs) {
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

export function isAuditFailureGap(ruleId) {
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

  const findings   = aggregate.findings   || [];
  const gaps       = aggregate.gaps       || [];
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
  'audit-summary':       selectAuditSummarySignal,
  'seo-performance':     selectSeoPerformanceSignal,
  'social-preview':      selectSocialPreviewSignal,
  'multi-device-view':   selectMultiDeviceSignal,
  'brief':               selectBriefSignal,
  'business-model':      selectBusinessModelSignal,
  'style-guide':         selectStyleGuideSignal,
  'industry':            selectIndustrySignal,
  'visibility-snapshot': selectVisibilitySignal,
  'priority-signal':     selectPrioritySignal,
};

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sanitizeStyleText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text
    .replace(/[_-]?[A-Za-z]+_[0-9a-f]{4,}\b/gi, (match) => {
      const cleaned = match.replace(/^[_-]+/, '').split('_')[0];
      return cleaned || '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeFontLabel(value) {
  const text = sanitizeStyleText(String(value || '').split(',')[0].replace(/["']/g, '').trim());
  if (!text) return null;
  if (/^(arial|helvetica(?: neue)?|system-ui|ui-sans-serif|sans-serif|-apple-system|blinkmacsystemfont|segoe ui)$/i.test(text)) {
    return 'System UI';
  }
  if (/^(times new roman|georgia|ui-serif|serif)$/i.test(text)) {
    return 'System Serif';
  }
  return text;
}

function isSystemFontLike(value) {
  const text = normalizeFontLabel(value);
  return text === 'System UI' || text === 'System Serif';
}

function summarizeList(value, maxItems = 2) {
  const list = String(value || '')
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length <= maxItems) return list.join(' · ') || null;
  return `${list.slice(0, maxItems).join(' · ')} +${list.length - maxItems} more`;
}

function summarizeFocusLabel(value, maxLength = 72) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function isPresentValue(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return Boolean(value);
}

function cleanAuditWeakestArea(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.toLowerCase();
}

function capitalizeAuditClause(value) {
  const text = String(value || '').trim();
  if (!text) return 'Some inputs are still missing';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function selectAuditSummarySignal({ metrics }) {
  const capturedCount = Number(metrics.capturedCount || 0);
  const totalCount = Number(metrics.totalCount || 0);
  const missingCount = Math.max(0, Number(metrics.missingCount ?? (totalCount - capturedCount)) || 0);
  const captureRatio = totalCount > 0 ? capturedCount / totalCount : 0;
  const pagesCrawled = Number(metrics.pagesCrawled || 0);
  const warningsCount = Number(metrics.warningCount || 0);
  const psiStatus = String(metrics.psiStatus || '').toLowerCase();
  const hasArtifacts = Boolean(metrics.hasScreenshot || metrics.hasMockup);
  const hasStrategy = Boolean(metrics.hasBrief || metrics.hasIndustry || metrics.hasBusinessModel);
  const weakestArea = cleanAuditWeakestArea(metrics.weakestArea);

  if (!totalCount || capturedCount === 0) {
    return {
      id: 'audit-baseline-missing',
      type: 'audit-state',
      readiness: 'critical',
      finding: 'This run did not capture a usable onboarding baseline.',
      impact: 'Without site evidence, strategy context, and audit outputs, the recommendations are low-confidence.',
      action: 'Confirm the site is reachable, then re-run onboarding to collect the baseline data.',
    };
  }

  if (captureRatio < 0.55 || pagesCrawled === 0 || psiStatus === 'error') {
    const qualityReason = psiStatus === 'error'
      ? 'the performance audit did not complete'
      : pagesCrawled === 0
        ? 'the crawler did not capture usable page evidence'
        : `${pluralize(missingCount, 'signal')} are still missing`;
    return {
      id: 'audit-baseline-thin',
      type: 'issue',
      readiness: 'critical',
      finding: `We captured ${capturedCount} of ${totalCount} onboarding signals in this run.`,
      impact: `That baseline is still thin because ${qualityReason}, so parts of the brief and recommendations are directional instead of complete.`,
      action: weakestArea
        ? `Improve the missing ${weakestArea} inputs, then re-run the audit.`
        : 'Fill the missing inputs and re-run the audit to strengthen the baseline.',
    };
  }

  if (captureRatio < 0.8 || warningsCount > 0 || psiStatus === 'partial' || !hasArtifacts || !hasStrategy) {
    const limiters = [];
    if (psiStatus === 'partial') limiters.push('the performance audit came back with limited data');
    if (warningsCount > 0) limiters.push(`${pluralize(warningsCount, 'pipeline warning')} still need review`);
    if (!hasArtifacts) limiters.push('visual artifacts are still missing');
    if (!hasStrategy) limiters.push('business context is still thin');
    if (!limiters.length && missingCount > 0) limiters.push(`${pluralize(missingCount, 'signal')} are still missing`);
    return {
      id: 'audit-baseline-partial',
      type: 'issue',
      readiness: 'partial',
      finding: `We captured ${capturedCount} of ${totalCount} onboarding signals, so the baseline is usable.`,
      impact: `${capitalizeAuditClause(limiters.join(', '))}, which means some recommendations are solid while others still need more evidence.`,
      action: weakestArea
        ? `Tighten the ${weakestArea} coverage next, then re-run the audit.`
        : 'Use this as a working baseline, then re-run after the missing inputs are filled in.',
    };
  }

  return {
    id: 'audit-baseline-strong',
    type: 'strength',
    readiness: 'healthy',
    finding: `We captured ${capturedCount} of ${totalCount} onboarding signals in this run.`,
    impact: 'That gives you a strong baseline for the brief, SEO review, and follow-on recommendations.',
    action: 'Use this run as the working baseline and refresh it after major site or messaging changes.',
  };
}

// seo-performance
// Priority: audit-state limitation → delivery/hosting caveat → critical finding → warning finding or triggered gap → strongest highlight
function extractHostname(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeComparableHost(hostname) {
  return hostname ? hostname.replace(/^www\./, '') : null;
}

function describeGatewayHost(metrics) {
  const hostService = String(metrics.hostService || '').trim();
  const value = String(metrics.hostType || '').toLowerCase();
  if (hostService === 'Internet Computer (ICP)' || value.includes('icp')) return 'Internet Computer (ICP) hosting';
  if (hostService === 'Arweave' || value.includes('arweave')) return 'an Arweave gateway';
  if (hostService === 'IPFS' || value.includes('ipfs')) return 'an IPFS gateway';
  if (hostService) return `${hostService} hosting`;
  if (value.includes('gateway')) return 'a gateway host';
  return 'an external host';
}

function isGatewayHostType(metrics) {
  const value = String(metrics.hostType || '').toLowerCase();
  return value.includes('arweave') || value.includes('ipfs') || value.includes('icp') || value.includes('gateway');
}

function hasRedirectedDestination(metrics) {
  const requestedUrl = metrics.requestedUrl || metrics.inputUrl || null;
  const finalUrl = metrics.finalUrl || metrics.resolvedUrl || metrics.displayedUrl || null;
  const redirectCount = Number(metrics.redirectCount || 0);
  const requestedHost = normalizeComparableHost(extractHostname(requestedUrl));
  const finalHost = normalizeComparableHost(extractHostname(finalUrl));

  return redirectCount > 1 ||
    Boolean(requestedHost && finalHost && requestedHost !== finalHost);
}

function pickConfirmedSeoGap(metrics, issues) {
  const confirmed = [];
  if (metrics.metaDescriptionPresent === false) confirmed.push('a missing meta description');
  if (metrics.schemaTypesCount === 0) confirmed.push('no structured data');
  if (metrics.llmsTxtFound === false) confirmed.push('no llms.txt');
  if (metrics.canonicalPresent === false) confirmed.push('no canonical URL');
  if (confirmed.length > 0) return confirmed.slice(0, 2).join(' and ');

  const issue = issues.find((candidate) => {
    const label = String(candidate?.label || candidate?.ruleId || '').toLowerCase();
    return label.includes('meta') ||
      label.includes('schema') ||
      label.includes('canonical') ||
      label.includes('llms') ||
      label.includes('entity') ||
      label.includes('robots');
  });
  return issue?.label || null;
}

function normalizeSeoIssueFinding(issue) {
  const label = String(issue?.label || issue?.ruleId || '').trim();
  const lower = label.toLowerCase();

  if (!label) return 'An SEO issue was detected.';
  if (lower.includes('largest contentful paint') || lower.includes('lcp')) {
    return 'Largest Contentful Paint is too slow.';
  }
  if (lower.includes('performance score')) {
    return 'Mobile performance needs work.';
  }
  if (lower.includes('meta description') && (lower.includes('missing') || lower.includes('absent') || lower.includes('blank'))) {
    return 'Your homepage is missing a meta description.';
  }
  if (lower.includes('structured data') || lower.includes('schema')) {
    return 'Structured data needs attention.';
  }
  if (lower.includes('canonical')) {
    return 'Canonical setup needs attention.';
  }

  return label.replace(/\s+—\s+critical performance metric failure/i, '').trim().replace(/[.!?]*$/, '.');
}

function normalizeSeoIssueImpact(issue) {
  const label = String(issue?.label || issue?.ruleId || '').toLowerCase();
  const detail = String(issue?.detail || issue?.evidence || '').trim();
  if (label.includes('largest contentful paint') || label.includes('lcp')) {
    return 'The main content is loading much later than Google recommends, which can hurt both rankings and user experience.';
  }
  if (label.includes('performance score')) {
    return 'Slow rendering and script-heavy load are likely making the site feel sluggish for visitors.';
  }
  if (label.includes('meta description')) {
    return 'That makes the page less compelling in search results and can reduce click-through rate.';
  }
  if (label.includes('structured data') || label.includes('schema')) {
    return 'That limits how clearly search engines and AI systems can interpret the page.';
  }
  if (label.includes('canonical')) {
    return 'That can make it harder for search engines to understand which URL should rank.';
  }
  if (!detail) return 'This is directly limiting your search visibility.';
  return detail.replace(/\s+—\s+/g, ' — ');
}

function normalizeSeoIssueAction(issue) {
  const label = String(issue?.label || issue?.ruleId || '').toLowerCase();
  if (label.includes('largest contentful paint') || label.includes('lcp') || label.includes('performance score')) {
    return 'Start with the highest-impact performance fix, then re-run the audit.';
  }
  if (label.includes('meta description') || label.includes('schema') || label.includes('canonical')) {
    return 'Fix this markup issue, then re-run the audit.';
  }
  return 'Check the Solutions tab for the next fix.';
}

function buildAiVisibilitySignal(metrics) {
  const aiVisibilityScore = typeof metrics.aiVisibilityScore === 'number' ? metrics.aiVisibilityScore : null;
  const schemaTypesCount = typeof metrics.schemaTypesCount === 'number' ? metrics.schemaTypesCount : null;
  const llmsTxtFound = typeof metrics.llmsTxtFound === 'boolean' ? metrics.llmsTxtFound : null;
  const blockedBots = Array.isArray(metrics.aiBotsBlocked) ? metrics.aiBotsBlocked.filter(Boolean) : [];
  const entityPresent = Boolean(metrics.wikidataEntity);
  const schemaScore = typeof metrics.aiSectionSchemaScore === 'number' ? metrics.aiSectionSchemaScore : null;
  const entityScore = typeof metrics.aiSectionEntityScore === 'number' ? metrics.aiSectionEntityScore : null;

  const highValueBots = blockedBots.filter((bot) => /gptbot|chatgpt-user|claudebot|perplexitybot|google-extended/i.test(String(bot)));

  if (highValueBots.length >= 2 || (highValueBots.length >= 1 && aiVisibilityScore != null && aiVisibilityScore < 60)) {
    const bots = highValueBots.slice(0, 2).join(' and ');
    return {
      id: 'ai-bots-blocked',
      type: 'issue',
      readiness: highValueBots.length >= 2 ? 'critical' : 'partial',
      finding: 'Some high-value AI crawlers are blocked in robots.txt.',
      impact: `${bots} ${highValueBots.length === 1 ? 'is' : 'are'} currently blocked, which can limit how often your pages are fetched or cited by AI assistants.`,
      action: 'Open access for the blocked AI crawlers, then re-run the audit.',
    };
  }

  if (llmsTxtFound === false && aiVisibilityScore != null && aiVisibilityScore < 80) {
    return {
      id: 'ai-llmstxt-missing',
      type: 'issue',
      readiness: aiVisibilityScore < 60 ? 'critical' : 'partial',
      finding: 'AI discovery signals are incomplete.',
      impact: 'No llms.txt file was found, so AI assistants have no canonical machine-readable summary of the site to reference.',
      action: 'Publish an llms.txt file, then re-run the audit.',
    };
  }

  if (schemaTypesCount === 0) {
    return {
      id: 'ai-schema-missing',
      type: 'issue',
      readiness: 'partial',
      finding: 'No structured data was detected.',
      impact: 'AI systems have very little machine-readable context about the business, which makes the site harder to interpret and cite accurately.',
      action: 'Add organization and page-level schema, then re-run the audit.',
    };
  }

  if (schemaScore != null && schemaScore < 50) {
    return {
      id: 'ai-schema-thin',
      type: 'issue',
      readiness: 'partial',
      finding: 'Structured data is present, but key business context is still thin.',
      impact: 'Some schema is already in place, but it is not yet giving AI systems enough machine-readable detail about the business and page types.',
      action: 'Expand the schema coverage, then re-run the audit.',
    };
  }

  if (!entityPresent && entityScore != null && entityScore < 50) {
    return {
      id: 'ai-entity-missing',
      type: 'issue',
      readiness: 'partial',
      finding: 'Entity authority is still weak.',
      impact: 'No strong external entity reference was found, which makes the brand harder for AI systems to disambiguate and trust.',
      action: 'Strengthen the business identity signals, then re-run the audit.',
    };
  }

  if (entityScore != null && entityScore < 50) {
    return {
      id: 'ai-entity-thin',
      type: 'issue',
      readiness: 'partial',
      finding: 'Entity authority is still weak.',
      impact: 'The brand has some entity signals, but they are still too thin for AI systems to recognize and trust it confidently.',
      action: 'Strengthen the business identity signals, then re-run the audit.',
    };
  }

  if (aiVisibilityScore != null && aiVisibilityScore >= 75 && llmsTxtFound === true && schemaTypesCount > 0) {
    return {
      id: 'ai-visibility-strong',
      type: 'strength',
      readiness: 'healthy',
      finding: 'AI discovery signals are in a good place.',
      impact: `The site already has llms.txt and structured data in place, with an AI visibility score of ${aiVisibilityScore}/100.`,
      action: 'Keep the AI foundation in place while you work on the next performance or content improvement.',
    };
  }

  return null;
}

function buildPerformanceMetricSignal(metrics) {
  const lcpSeconds = typeof metrics.lcpSeconds === 'number' ? metrics.lcpSeconds : null;
  const performanceScore = typeof metrics.performanceScore === 'number' ? metrics.performanceScore : null;

  if (lcpSeconds != null && lcpSeconds >= 4) {
    return {
      id: 'raw-lcp-critical',
      type: 'issue',
      readiness: 'critical',
      finding: 'Largest Contentful Paint is too slow.',
      impact: `This audit measured LCP at ${lcpSeconds.toFixed(1)} seconds, well above the 2.5-second target Google recommends.`,
      action: 'Start with the highest-impact performance fix, then re-run the audit.',
    };
  }

  if (lcpSeconds != null && lcpSeconds >= 2.5) {
    return {
      id: 'raw-lcp-warning',
      type: 'issue',
      readiness: 'partial',
      finding: 'Largest Contentful Paint is slower than recommended.',
      impact: `This audit measured LCP at ${lcpSeconds.toFixed(1)} seconds, so the main content is appearing later than it should.`,
      action: 'Start with the highest-impact performance fix, then re-run the audit.',
    };
  }

  if (performanceScore != null && performanceScore < 30) {
    return {
      id: 'raw-performance-critical',
      type: 'issue',
      readiness: 'critical',
      finding: 'Mobile performance is in a critical range.',
      impact: `This audit scored mobile performance at ${performanceScore}/100, which points to major rendering or script bottlenecks.`,
      action: 'Start with the highest-impact performance fix, then re-run the audit.',
    };
  }

  if (performanceScore != null && performanceScore < 60) {
    return {
      id: 'raw-performance-warning',
      type: 'issue',
      readiness: 'partial',
      finding: 'Mobile performance needs work.',
      impact: `This audit scored mobile performance at ${performanceScore}/100, so visitors are likely feeling the page load cost.`,
      action: 'Start with the highest-impact performance fix, then re-run the audit.',
    };
  }

  return null;
}

function selectSeoPerformanceSignal({ issues, strengths, metrics }) {
  if (metrics.auditStatus === 'error') {
    return {
      id:      metrics.failureCode || 'seo-audit-error',
      type:    'audit-state',
      finding: metrics.failureReason || 'PageSpeed audit could not complete.',
      impact:  'This run could not capture reliable performance measurements.',
      action:  'Fix the access issue and re-run the audit.',
    };
  }

  if (metrics.auditStatus === 'partial') {
    return {
      id:      metrics.failureCode || 'seo-audit-partial',
      type:    'audit-state',
      finding: metrics.failureReason || 'PageSpeed returned only partial audit data.',
      impact:  'Scores and Core Web Vitals may be incomplete on this run.',
      action:  'Re-run the audit after the site is fully reachable.',
    };
  }

  const confirmedGap = pickConfirmedSeoGap(metrics, issues);

  if (isGatewayHostType(metrics)) {
    return {
      id:      'gateway-hosted-context',
      type:    'hosting-context',
      finding: `Your domain forwards to ${describeGatewayHost(metrics)} before the page loads.`,
      impact:  confirmedGap
        ? `We can still confirm ${confirmedGap}, but Lighthouse is grading the gateway path, so performance numbers are directional rather than a pure read of your branded domain.`
        : 'We can still audit the page, but Lighthouse is grading the gateway path, so performance numbers are directional rather than a pure read of your branded domain.',
      action:  'Point a stable canonical domain at the final served page, test the final URL directly, and then fix the confirmed discovery gaps.',
    };
  }

  if (hasRedirectedDestination(metrics)) {
    return {
      id:      'forwarded-domain-context',
      type:    'hosting-context',
      readiness: 'partial',
      finding: 'Your homepage forwards to a different final URL before the audit begins.',
      impact:  confirmedGap
        ? `We can still confirm ${confirmedGap}, but search and performance tools are judging the destination URL instead of the branded address visitors type.`
        : 'Search and performance tools are judging the destination URL instead of the branded address visitors type.',
      action:  'Audit the resolved URL directly, reduce avoidable redirects, and make the final destination explicit with a canonical URL.',
    };
  }

  const aiSignal = buildAiVisibilitySignal(metrics);
  if (aiSignal) return aiSignal;

  const performanceSignal = buildPerformanceMetricSignal(metrics);
  if (performanceSignal) return performanceSignal;

  const critical = issues.find((i) => i.severity === 'critical');
  if (critical) {
    return {
      id:      critical.id || 'seo-critical',
      type:    'issue',
      readiness: 'critical',
      finding: normalizeSeoIssueFinding(critical),
      impact:  normalizeSeoIssueImpact(critical),
      action:  normalizeSeoIssueAction(critical),
    };
  }

  const warning = issues.find((i) => i.severity === 'warning' || i.triggered);
  if (warning) {
    const label = warning.label || warning.ruleId || 'SEO issue found';
    const type  = warning.severity ? 'issue' : 'gap';
    return {
      id:      warning.id || warning.ruleId || 'seo-warning',
      type,
      readiness: 'partial',
      finding: normalizeSeoIssueFinding(warning),
      impact:  normalizeSeoIssueImpact(warning) || 'Fixing this will improve crawlability and ranking signals.',
      action:  type === 'gap' ? null : normalizeSeoIssueAction(warning),
    };
  }

  const top = strengths[0];
  if (top) {
    return {
      id:      'seo-strength',
      type:    'strength',
      readiness: 'healthy',
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
  const requiredSignals = [
    isPresentValue(metrics.ogImage),
    isPresentValue(metrics.ogTitle),
    isPresentValue(metrics.ogDescription),
    isPresentValue(metrics.canonical),
    isPresentValue(metrics.favicon),
  ];
  const presentCount = requiredSignals.filter(Boolean).length;
  const totalSignals = requiredSignals.length;
  const secondarySignals = [
    isPresentValue(metrics.siteName),
    isPresentValue(metrics.ogImageAlt),
    isPresentValue(metrics.themeColor),
  ];
  const secondaryPresentCount = secondarySignals.filter(Boolean).length;
  const secondaryTotal = secondarySignals.length;

  if (metrics.ogImage === false) {
    return {
      id:      'og-image-missing',
      type:    'issue',
      readiness: 'critical',
      finding: 'No preview image is set.',
      impact:  `Links shared to social platforms will appear without a thumbnail, and only ${presentCount}/${totalSignals} key share signals are in place for a controlled preview.`,
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
      readiness: 'partial',
      finding: `Social preview ${what} is missing.`,
      impact:  `Platforms will substitute generic or scraped text instead of your branded copy, and only ${presentCount}/${totalSignals} key share signals are in place for a reliable share preview.`,
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
      readiness: 'partial',
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
      readiness: 'partial',
      finding: `${what} is not set.`,
      impact:  `The share surface is mostly there, but missing ${what} weakens how reliably the brand is rendered across previews and browsers.`,
      action:  null,
    };
  }

  if (secondaryPresentCount < secondaryTotal) {
    const missing = [
      !isPresentValue(metrics.siteName) && 'site name',
      !isPresentValue(metrics.ogImageAlt) && 'image alt text',
      !isPresentValue(metrics.themeColor) && 'theme color',
    ].filter(Boolean).join(', ');
    return {
      id: 'social-branding-thin',
      type: 'issue',
      readiness: 'partial',
      finding: 'Core social preview tags are in place, but the branded preview surface is still thin.',
      impact: `The main share card should render, but missing ${missing} leaves less control over how the brand is presented across platforms and devices.`,
      action: 'Fill the remaining social metadata so the preview is fully branded.',
    };
  }

  // All checks pass
  const top = strengths[0];
  return {
    id:      'social-complete',
    type:    'strength',
    readiness: 'healthy',
    finding: (typeof top === 'string' ? top : null) || 'Social preview coverage is complete.',
    impact:  `All ${totalSignals} key share signals are present, and ${secondaryPresentCount}/${secondaryTotal} secondary brand signals were captured, so shared links should render with branded copy and imagery instead of scraped fallbacks.`,
    action:  null,
  };
}

// multi-device-view
// Priority: capture failed → artifact missing → healthy capture
// This card describes audit/artifact state — no layout diagnosis without a layout analyzer.
function selectMultiDeviceSignal({ status, issues, strengths, metrics }) {
  const variantCount = Number(metrics.variantCount || 3);
  const screenshotCount = Number(metrics.screenshotCount || 0);
  const hasMockup = Boolean(metrics.hasMockup);
  const missingVariants = [
    !metrics.hasDesktop && 'desktop',
    !metrics.hasTablet && 'tablet',
    !metrics.hasMobile && 'mobile',
  ].filter(Boolean);

  if (metrics.captureDone === false && screenshotCount === 0 && !hasMockup) {
    return {
      id:      'capture-failed',
      type:    'audit-state',
      readiness: 'critical',
      finding: 'Device screenshot capture did not complete.',
      impact:  'There is no usable visual evidence for desktop, tablet, or mobile, so layout review is blocked on this run.',
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
      readiness: 'critical',
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
      readiness: 'partial',
      finding: artifactGap.label || 'One or more device views is missing.',
      impact:  artifactGap.detail || 'Full cross-device coverage requires all three breakpoints.',
      action:  null,
    };
  }

  if (screenshotCount > 0 && screenshotCount < variantCount) {
    return {
      id: 'device-coverage-partial',
      type: 'issue',
      readiness: 'partial',
      finding: `We captured ${screenshotCount} of ${variantCount} device views in this run.`,
      impact: `That gives you a partial layout baseline, but ${missingVariants.join(' and ')} coverage is still missing so responsive issues can be missed.`,
      action: 'Re-run the capture until all device views are available.',
    };
  }

  if (hasMockup && screenshotCount === 0) {
    return {
      id: 'mockup-only',
      type: 'issue',
      readiness: 'partial',
      finding: 'The device mockup rendered, but the detailed screen captures are still missing.',
      impact: 'You have a high-level visual proof point, but not enough raw layout evidence to compare desktop, tablet, and mobile behavior directly.',
      action: 'Capture the full device screenshots, then review the layout again.',
    };
  }

  if (metrics.captureDone === true || status === 'healthy' || screenshotCount === variantCount) {
    const top = strengths[0];
    return {
      id:      'device-healthy',
      type:    'strength',
      readiness: 'healthy',
      finding: (typeof top === 'string' ? top : null) || `All ${variantCount} device views were captured successfully.`,
      impact:  'Desktop, tablet, and mobile layouts are all available, so responsive review can be based on real visual evidence instead of assumptions.',
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
      action:  'I can build the brief once you complete the onboarding questions.',
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
      action:  'I can help clarify this once there\'s a pricing or services page.',
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

function selectStyleGuideSignal({ status, issues, strengths, metrics }) {
  const hasBrandedHeading = isPresentValue(metrics.headingFont) && !isSystemFontLike(metrics.headingFont);
  const hasBrandedBody = isPresentValue(metrics.bodyFont) && !isSystemFontLike(metrics.bodyFont);
  const coreTokens = [
    hasBrandedHeading,
    hasBrandedBody,
    isPresentValue(metrics.primaryColor),
    isPresentValue(metrics.neutralColor),
  ];
  const capturedCount = coreTokens.filter(Boolean).length;
  const totalCount = coreTokens.length;
  const hasSystemTypeBaseline = isPresentValue(metrics.headingFont) || isPresentValue(metrics.bodyFont);
  const headingLabel = normalizeFontLabel(metrics.headingFont);
  const bodyLabel = normalizeFontLabel(metrics.bodyFont);

  if ((capturedCount === 0 || status === 'critical') && hasSystemTypeBaseline) {
    return {
      id: 'style-guide-system-baseline',
      type: 'issue',
      readiness: 'partial',
      finding: 'A basic visual baseline came through, but typography is still relying on system fonts.',
      impact: `The run captured ${headingLabel || 'system'}${bodyLabel && bodyLabel !== headingLabel ? ` and ${bodyLabel}` : ''} instead of a clearly branded type system, so the snapshot still feels generic.`,
      action: 'Confirm one heading font and one body font, then refresh the snapshot.',
    };
  }

  if (capturedCount === 0 || status === 'critical') {
    const topIssue = issues[0];
    const safeFinding = sanitizeStyleText(topIssue?.label);
    const safeImpact = sanitizeStyleText(topIssue?.detail);
    return {
      id: 'style-guide-thin',
      type: 'issue',
      readiness: 'critical',
      finding: safeFinding || 'A usable brand system did not come through in this run.',
      impact: safeImpact || 'Typography and color foundations are still too thin, so future designs will drift instead of feeling consistent.',
      action: 'Define the core brand fonts and colors, then refresh the snapshot.',
    };
  }

  if (capturedCount < totalCount || status === 'partial' || issues.length > 0) {
    const topIssue = issues[0];
    const safeImpact = hasSystemTypeBaseline && !hasBrandedHeading && !hasBrandedBody
      ? 'Color and layout direction are visible, but the run did not confirm a dedicated branded type system yet.'
      : sanitizeStyleText(topIssue?.detail);
    return {
      id: 'style-guide-partial',
      type: 'issue',
      readiness: 'partial',
      finding: `We captured ${capturedCount} of ${totalCount} core brand tokens in this run.`,
      impact: safeImpact || 'That is enough to see the visual direction, but missing brand tokens still limit consistency across future designs.',
      action: 'Fill the missing brand tokens and refresh the snapshot.',
    };
  }

  return {
    id: 'style-guide-ready',
    type: 'strength',
    readiness: 'healthy',
    finding: `Core brand tokens are defined across ${totalCount} of ${totalCount} key areas.`,
    impact: 'Typography and color foundations are in place, so future designs can stay visually consistent instead of guessing the system.',
    action: 'Use this visual baseline as the reference for future landing pages and campaigns.',
  };
}

// industry
// Priority: unknown category → strongest resolved market category
function selectIndustrySignal({ status, issues, strengths, metrics }) {
  // rawData supplies: hasCategory (bool), categoryLabel (string|null), targetAudience (string|null), positioning (string|null)
  if (metrics.hasCategory === false || status === 'critical' || issues.length > 0) {
    const topIssue = issues[0];
    return {
      id:      'industry-unknown',
      type:    'issue',
      finding: topIssue?.label || 'Market category could not be determined.',
      impact:  topIssue?.detail || 'Without a clear category, competitive benchmarking and keyword strategy are limited.',
      action:  'Let me fix this — I can map the category once the homepage names the vertical.',
    };
  }

  if (metrics.hasCategory === true && metrics.categoryLabel) {
    const hasContext = isPresentValue(metrics.targetAudience) || isPresentValue(metrics.positioning);
    if (!hasContext) {
      return {
        id: 'industry-thin',
        type: 'issue',
        readiness: 'partial',
        finding: `Market category resolved: ${metrics.categoryLabel}.`,
        impact: 'The vertical is clear, but the buyer or positioning context is still thin, so competitor benchmarking is only partly grounded.',
        action: 'Make the audience and positioning more explicit so the category map becomes more useful.',
      };
    }
    return {
      id:      'industry-resolved',
      type:    'strength',
      readiness: 'healthy',
      finding: `Market category: ${metrics.categoryLabel}.`,
      impact:  'That gives the audit a grounded benchmark for competitors, keywords, and category-specific recommendations.',
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

function selectPrioritySignal({ status, issues, strengths, metrics }) {
  if (!metrics.hasPriority || !isPresentValue(metrics.focusLabel)) {
    const topIssue = issues[0];
    return {
      id: 'priority-missing',
      type: 'issue',
      readiness: 'critical',
      finding: topIssue?.label || 'No validated next step could be ranked from this run.',
      impact: topIssue?.detail || 'Without a clear priority, the roadmap stays broad instead of focusing effort on the highest-leverage fix.',
      action: 'Strengthen the audit baseline, then re-run to surface a sharper next step.',
    };
  }

  const hasChannel = isPresentValue(metrics.channelLabel);
  const channelSummary = summarizeList(metrics.channelLabel, 2);
  const focusLabel = summarizeFocusLabel(metrics.focusLabel);
  return {
    id: 'priority-ready',
    type: 'strength',
    readiness: hasChannel ? 'healthy' : 'partial',
    finding: `Top next step: ${focusLabel || metrics.focusLabel}.`,
    impact: hasChannel
      ? `This is the clearest move right now and already points toward ${channelSummary || metrics.channelLabel}.`
      : 'This is the clearest move right now, but the execution channel still needs confirmation.',
    action: hasChannel
      ? 'Start here before lower-priority fixes.'
      : 'Confirm the channel, then start here.',
  };
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
      action:  'I can fix this — let me show you the highest-impact changes.',
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
export function buildCardDescription(cardId, aggregate, rawData = {}) {
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

// ── Module state descriptions ─────────────────────────────────────────────────

const MODULE_STATE_DESCRIPTIONS = {
  'multi-device-view': {
    disabled:  'This card is turned off. Enable it to capture screenshots and generate a multi-device layout review. Open the next module to continue building your profile.',
    idle:      'This card is enabled and ready. Click Run to capture desktop, tablet, and mobile screenshots. Open the next module to continue building your profile.',
    failed:    (err, ctx = {}) => {
      const { hasMockup, hasFullPages } = ctx;
      if (hasMockup && hasFullPages) {
        return `The last run reported an error${err ? `: ${err}` : '.'} The mockup and full-page captures from a prior run are still available — open Details to browse them, or Retry to refresh.`;
      }
      if (hasMockup) {
        return `Mockup generated, but full-page screenshots were not captured${err ? `: ${err}` : '.'} Retry to attempt the full-page captures again.`;
      }
      if (hasFullPages) {
        return `Full-page screenshots were captured, but the composite mockup was not generated${err ? `: ${err}` : '.'} Retry to rebuild the mockup from existing captures.`;
      }
      return `Neither the multi-device mockup nor full-page screenshots were captured${err ? `: ${err}` : '.'} Retry to rebuild from existing viewport images, or open the next module to continue building your profile.`;
    },
    succeeded: (_err, ctx = {}) => {
      const { hasMockup, hasFullPages } = ctx;
      if (hasMockup && hasFullPages) {
        return 'The multi-device mockup was generated successfully and full-page captures are available for desktop, tablet, and mobile. Open Details on this card to browse every device end to end, not just the homepage. Open the next module to continue building your profile.';
      }
      if (hasMockup && !hasFullPages) {
        return 'The multi-device mockup was generated, but full-page screenshots are missing. The homepage view is accurate — Retry to capture the full pages for each device, or open the next module to continue building your profile.';
      }
      if (!hasMockup && hasFullPages) {
        return 'Full-page screenshots were captured for desktop, tablet, and mobile, but the composite mockup image was not generated — the card is showing the homepage screenshot as a fallback. Retry to rebuild the mockup, or open Details to browse the full-page captures.';
      }
      return 'The run completed but neither the multi-device mockup nor full-page screenshots were captured. Retry to rebuild from existing viewport images, or open the next module to continue building your profile.';
    },
  },
  'social-preview': {
    disabled:  'This card is turned off. Enable it to check how your site appears when shared on social platforms.',
    idle:      "This card is enabled and ready. Click Run to check your site's social preview tags.",
    failed:    (err) => `Social meta extraction failed${err ? `: ${err}` : ''}. Retry to check your OG tags and preview image.`,
    succeeded: 'Social metadata was captured. This card shows your current OG title, description, and image.',
  },
  'seo-performance': {
    disabled:  'This card is turned off. Enable it to run a PageSpeed audit and AI visibility check.',
    idle:      'This card is enabled and ready. Click Run to start a PageSpeed and AI visibility audit.',
    failed:    (err) => `The SEO audit could not complete${err ? `: ${err}` : ''}. Retry to run a fresh performance check.`,
    succeeded: 'SEO and performance data was captured. This card shows your latest audit results.',
  },
};

/**
 * Return a module-state-aware description string for a modular card.
 * Returns null when the card has no module templates or when the status
 * is transient (running/queued) — letting the standard description show.
 *
 * @param {string} cardId
 * @param {{ status: string, lastErrorMessage?: string|null }} moduleCardState
 * @returns {string|null}
 */
export function buildModuleStateDescription(cardId, moduleCardState, context = {}) {
  const templates = MODULE_STATE_DESCRIPTIONS[cardId];
  if (!templates) return null;
  const status = moduleCardState?.status;
  if (!status || status === 'running' || status === 'queued') return null;
  const template = templates[status];
  if (!template) return null;
  return typeof template === 'function'
    ? template(moduleCardState?.lastErrorMessage || null, context)
    : template;
}
