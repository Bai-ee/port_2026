'use strict';

const { getCard } = require('./card-contract');
const { buildCardDescription } = require('./card-description-builder');

const GUARDIAN_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1400;

function getApiKey() {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    (() => {
      try { require('dotenv/config'); } catch { /* ignore */ }
      return process.env.ANTHROPIC_API_KEY;
    })();
  return key || null;
}

async function callAnthropic(params) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function extractUsage(response) {
  const usage = response?.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const estimatedCostUsd = (inputTokens * 0.000001) + (outputTokens * 0.000005);
  return {
    model: GUARDIAN_MODEL,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

function extractToolInput(response) {
  if (!Array.isArray(response?.content)) return null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'write_seo_guardian_comment') {
      return block.input || null;
    }
  }
  return null;
}

function toSentence(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampText(value, maxChars) {
  const text = cleanText(value);
  if (!text || text.length <= maxChars) return text;
  const clipped = text.slice(0, Math.max(0, maxChars - 1)).trim();
  const withoutPartial = clipped.replace(/[,:;]\s*[^,:;]*$/, '').trim();
  return `${(withoutPartial || clipped).replace(/[.!?]*$/, '')}.`;
}

function isMeasurementFailureText(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return text.includes('timed out') ||
    text.includes('performance data unavailable') ||
    text.includes('could not capture') ||
    text.includes("couldn't capture") ||
    text.includes('audit failed') ||
    text.includes('audit ran with limited data') ||
    text.includes('pagespeed audit failed') ||
    text.includes('core web vitals data unavailable');
}

function filterRealFindings(findings = [], psiAuditStatus = null) {
  return findings.filter((finding) => {
    if (!finding) return false;
    if (psiAuditStatus === 'ok') {
      const blob = `${finding.label || ''} ${finding.detail || ''}`.toLowerCase();
      if (isMeasurementFailureText(blob)) return false;
    }
    return true;
  });
}

function filterRealHighlights(highlights = [], psiAuditStatus = null) {
  return (highlights || []).filter((highlight) => {
    if (!highlight) return false;
    if (psiAuditStatus === 'ok' && isMeasurementFailureText(highlight)) return false;
    return true;
  });
}

function pickTopIssues(findings = [], gaps = []) {
  const criticals = findings.filter((f) => f?.severity === 'critical').slice(0, 2);
  const warnings = findings.filter((f) => f?.severity === 'warning').slice(0, 2);
  const triggeredGaps = gaps.filter((g) => g?.triggered).slice(0, 2).map((g) => ({
    label: g.ruleId || 'gap',
    detail: g.evidence || '',
    severity: 'warning',
  }));
  return [...criticals, ...warnings, ...triggeredGaps].slice(0, 3);
}

function buildProviderNote(factPack, short = false) {
  const provider = factPack?.delivery?.hostingProvider;
  const confidence = factPack?.delivery?.providerConfidence;
  if (!provider || confidence !== 'high') return '';
  const model = String(factPack?.businessModel || '').toLowerCase();
  const hasCommerceModel = /e-?commerce|retail|store|shop|checkout|cart|product|marketplace|catalog|shopify/.test(model);

  if (provider === 'Shopify') {
    return short
      ? 'Built on Shopify, which usually makes sense when the site depends on cart and checkout.'
      : 'The site also appears to be built on Shopify, which usually makes sense when the business depends on built-in cart and checkout flows.';
  }
  if (provider === 'Wix' || provider === 'Squarespace' || provider === 'GoDaddy') {
    if (!hasCommerceModel) {
      return short
        ? `It also appears to be built on ${provider}, so review whether the platform cost is justified if you are not using its store or booking features.`
        : `The site also appears to be built on ${provider}. If you are not using its store or booking features, a lighter stack may cut recurring cost and give you more control.`;
    }
    return short
      ? `It also appears to be built on ${provider}, so some structure and template constraints may come from the platform itself.`
      : `The site also appears to be built on ${provider}, so some structure and template constraints may come from the platform itself.`;
  }
  return short ? `It also appears to be served from ${provider}.` : `The site also appears to be served from ${provider}.`;
}

function buildActionSentence(factPack, short = false, canonicalSignal = null) {
  const psi = factPack?.psi || {};
  const analyzer = factPack?.analyzer || {};
  const topIssue = cleanText(analyzer.topIssues?.[0]?.label);
  const opportunity = cleanText(psi.opportunities?.[0]?.title);
  const canonicalAction = cleanText(canonicalSignal?.action);
  const opportunityAction = opportunity
    ? opportunity
        .replace(/^reduce\s+/i, 'reducing ')
        .replace(/^defer\s+/i, 'deferring ')
        .replace(/^eliminate\s+/i, 'eliminating ')
        .replace(/^avoid\s+/i, 'avoiding ')
        .replace(/^serve\s+/i, 'serving ')
        .replace(/^minify\s+/i, 'minifying ')
    : '';

  if (short) {
    if (opportunityAction) return toSentence(`Start by ${opportunityAction.toLowerCase()}, then re-run the audit`);
    if (canonicalAction) return toSentence(canonicalAction);
    if (topIssue) return toSentence('Fix the top SEO issue, then re-run the audit');
    return toSentence('Re-run after the next fix to confirm the improvement');
  }

  if (opportunityAction) return toSentence(`Start by ${opportunityAction.toLowerCase()}, then re-run the audit to confirm the improvement`);
  if (canonicalAction) return toSentence(canonicalAction);
  if (topIssue) return toSentence('Fix the top SEO issue, then re-run the audit to confirm the improvement');
  return toSentence('Use the confirmed issues above as the next SEO worklist, then re-run the audit to verify the improvement');
}

function buildSeoRawDataFromFactPack(factPack) {
  const psi = factPack?.psi || {};
  const delivery = factPack?.delivery || {};
  const aiSeo = factPack?.aiSeo || {};
  return {
    auditStatus: psi.auditStatus || null,
    failureCode: psi.failureCode || null,
    failureReason: psi.failureReason || null,
    resolvedUrl: psi.finalUrl || null,
    inputUrl: psi.requestedUrl || factPack?.websiteUrl || null,
    requestedUrl: psi.requestedUrl || factPack?.websiteUrl || null,
    finalUrl: psi.finalUrl || null,
    displayedUrl: psi.finalUrl || null,
    hostType: delivery.hostType || null,
    hostService: delivery.hostService || null,
    redirectCount: delivery.redirectCount ?? null,
    performanceScore: psi.scores?.performance ?? null,
    seoScore: psi.scores?.seo ?? null,
    lcpSeconds: psi.lcpSeconds ?? null,
    lcpMs: psi.lcpMs ?? null,
    lcpSource: psi.lcpSource || null,
    aiVisibilityScore: aiSeo.score ?? null,
    aiVisibilityGrade: aiSeo.grade || null,
    aiSectionSchemaScore: factPack?.aiSeo?.sections?.schema?.score ?? null,
    aiSectionEntityScore: factPack?.aiSeo?.sections?.entity?.score ?? null,
    aiBotsBlocked: Array.isArray(aiSeo.botsBlocked) ? aiSeo.botsBlocked : [],
    wikidataEntity: aiSeo.wikidataEntity || null,
    metaDescriptionPresent: typeof aiSeo.metaDescription === 'string' ? aiSeo.metaDescription.trim().length > 0 : null,
    canonicalPresent: typeof aiSeo.canonical === 'string' ? aiSeo.canonical.trim().length > 0 : null,
    schemaTypesCount: Array.isArray(aiSeo.schemaTypes) ? aiSeo.schemaTypes.length : null,
    llmsTxtFound: typeof aiSeo.llmsTxtFound === 'boolean' ? aiSeo.llmsTxtFound : null,
  };
}

function buildCanonicalSeoSignalPack(factPack) {
  const aggregate = factPack?.analyzer?.aggregate || null;
  const rawData = buildSeoRawDataFromFactPack(factPack);
  return buildCardDescription('seo-performance', aggregate, rawData);
}

function buildSeoFactPack({
  websiteUrl = '',
  pagespeed = null,
  aiSeoAudit = null,
  seoAggregate = null,
  warnings = [],
  userContext = null,
  businessModel = '',
} = {}) {
  const facts = pagespeed?.facts || {};
  const diag = facts.diagnosticsContext || null;
  const meta = facts.lighthouseMeta || null;
  const scores = facts.scores || null;
  const coreWebVitals = facts.coreWebVitals || null;
  const labCoreWebVitals = facts.labCoreWebVitals || null;
  const psiAuditStatus = facts.auditStatus || pagespeed?.status || null;
  const psiWarnings = Array.isArray(warnings) ? warnings.filter((w) => w?.stage === 'psi') : [];
  const aiWarnings = Array.isArray(warnings) ? warnings.filter((w) => w?.stage === 'ai-seo') : [];

  const findings = filterRealFindings(seoAggregate?.findings || [], psiAuditStatus);
  const highlights = filterRealHighlights(seoAggregate?.highlights || [], psiAuditStatus);
  const gaps = (seoAggregate?.gaps || []).filter((gap) => gap?.triggered);
  const schemaTypes = Array.isArray(aiSeoAudit?.rawSignals?.schema?.types) ? aiSeoAudit.rawSignals.schema.types : [];
  const metaDescription = aiSeoAudit?.rawSignals?.technical?.metaDescription || null;
  const canonical = aiSeoAudit?.rawSignals?.technical?.canonical || null;
  const botsBlocked = Array.isArray(aiSeoAudit?.rawSignals?.robotsAi?.blockedBots)
    ? aiSeoAudit.rawSignals.robotsAi.blockedBots.map((bot) => bot?.name || bot?.id).filter(Boolean)
    : [];
  const topIssues = pickTopIssues(findings, gaps);
  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  const cls = coreWebVitals?.cls?.p75 != null ? coreWebVitals.cls : labCoreWebVitals?.cls;
  const opportunities = Array.isArray(facts.opportunities) ? facts.opportunities.slice(0, 3) : [];

  return {
    websiteUrl,
    businessModel: businessModel || '',
    userContext: userContext
      ? {
          stage: userContext.stage || null,
          priority: userContext.priority || null,
          outputExpectation: userContext.outputExpectation || null,
        }
      : null,
    psi: {
      auditStatus: psiAuditStatus,
      sourceStatus: pagespeed?.status || null,
      hasScores: Boolean(scores),
      hasLabData: Boolean(labCoreWebVitals?.lcp || labCoreWebVitals?.cls || labCoreWebVitals?.ttfb),
      hasCoreWebVitals: Boolean(coreWebVitals?.lcp || coreWebVitals?.cls || coreWebVitals?.inp || coreWebVitals?.ttfb || labCoreWebVitals?.lcp || labCoreWebVitals?.cls),
      scores: scores || null,
      lcpSeconds: lcp?.p75 != null ? Math.round((lcp.p75 / 1000) * 10) / 10 : null,
      lcpMs: lcp?.p75 != null ? Number(lcp.p75) : null,
      lcpSource: lcp?.source || null,
      lcpCategory: lcp?.category || null,
      clsValue: cls?.p75 != null ? Number(cls.p75) : null,
      finalUrl: meta?.finalUrl || diag?.resolvedUrl || null,
      requestedUrl: meta?.requestedUrl || diag?.inputUrl || websiteUrl || null,
      warningCodes: psiWarnings.map((w) => w?.code).filter(Boolean),
      warningMessages: psiWarnings.map((w) => w?.message).filter(Boolean),
      failureCode: diag?.failureCode || null,
      failureReason: diag?.failureReason || null,
      opportunities: opportunities.map((op) => ({ title: op?.title || '', savingsMs: op?.savingsMs ?? null })),
      seoRedFlags: Array.isArray(facts.seoRedFlags) ? facts.seoRedFlags.map((flag) => typeof flag === 'string' ? flag : (flag?.id || flag?.title || '')).filter(Boolean) : [],
    },
    delivery: {
      hostType: diag?.hostType || null,
      hostService: diag?.hostService || null,
      hostingProvider: diag?.hostingProvider || null,
      providerKind: diag?.providerKind || null,
      providerConfidence: diag?.providerConfidence || null,
      providerEvidence: Array.isArray(diag?.providerEvidence) ? diag.providerEvidence : [],
      redirectCount: diag?.redirectCount ?? 0,
      server: diag?.server || null,
      httpStatus: diag?.httpStatus ?? null,
    },
    aiSeo: {
      score: aiSeoAudit?.aiVisibility?.score ?? null,
      grade: aiSeoAudit?.aiVisibility?.letterGrade || null,
      sections: aiSeoAudit?.aiVisibility?.sections || null,
      schemaTypes,
      llmsTxtFound: typeof aiSeoAudit?.rawSignals?.llmsTxt?.found === 'boolean' ? aiSeoAudit.rawSignals.llmsTxt.found : null,
      canonical,
      metaDescription,
      botsBlocked,
      wikidataEntity: aiSeoAudit?.rawSignals?.entity?.qid || aiSeoAudit?.rawSignals?.entity?.wikidataUrl || null,
      warningCodes: aiWarnings.map((w) => w?.code).filter(Boolean),
      warningMessages: aiWarnings.map((w) => w?.message).filter(Boolean),
    },
    analyzer: {
      aggregate: seoAggregate
        ? {
            ...seoAggregate,
            findings,
            highlights,
            gaps: seoAggregate?.gaps || [],
          }
        : null,
      readiness: seoAggregate?.readiness || null,
      criticalCount: findings.filter((f) => f?.severity === 'critical').length,
      warningCount: findings.filter((f) => f?.severity === 'warning').length,
      topIssues,
      highlights,
    },
  };
}

function buildDeterministicSeoComment(factPack) {
  const canonical = buildCanonicalSeoSignalPack(factPack);
  const canonicalShort = cleanText(canonical?.description || '');
  const dominantSignal = canonical?.dominantSignal || null;
  const short = clampText(
    canonicalShort || 'This run returned limited SEO and performance data.',
    getCard('seo-performance')?.copy?.short?.max || 140
  );

  const expandedParts = [];
  if (dominantSignal?.finding) expandedParts.push(toSentence(dominantSignal.finding));
  if (dominantSignal?.impact) expandedParts.push(toSentence(dominantSignal.impact));

  const providerNote = buildProviderNote(factPack, false);
  if (providerNote && !canonicalShort.toLowerCase().includes(String(factPack?.delivery?.hostingProvider || '').toLowerCase())) {
    expandedParts.push(toSentence(providerNote));
  }

  expandedParts.push(buildActionSentence(factPack, false, dominantSignal));

  const expanded = expandedParts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || 'This run returned limited SEO and performance data, but there is still enough signal to guide the next fixes.';
  const recommendation = buildActionSentence(factPack, true, dominantSignal);

  return { short, expanded, recommendation };
}

function buildPrompt(factPack, existingCard = null) {
  return `You are SEO Comment Guardian for a dashboard card. Your job is to write the final SEO modal comment from the fact pack below.

FACT PACK RULES
- The final stored PSI payload is authoritative. Historical warning codes are context only and may disagree with the final payload.
- Use the same dominant-signal strategy as the SEO card description builder: pick one dominant signal and express it as finding, impact, action.
- If psi.auditStatus = "ok", NEVER say the audit failed, timed out, or that scores/Core Web Vitals were unavailable.
- If aiSeo.schemaTypes contains values, NEVER say schema is completely missing. You may call out missing specific schema types if supported.
- Only mention the hosting provider when delivery.providerConfidence = "high". Use the provider name exactly as given.
- Distinguish measurement limitations from real site issues.
- Keep the comment specific, readable, and grounded in the fact pack. No filler.

OUTPUT RULES
- short: 60-140 chars, 1-2 sentences, same facts and tone as expanded.
- expanded: 250-700 chars, 3-5 sentences.
- recommendation: one sentence <=120 chars.
- Tone: a helpful SEO professional. Clear, calm, specific, and practical. Not alarmist.
- Treat the deterministic SEO card description as the canonical strategy for the short comment.
- Lead with what we could actually measure.
- Then explain relevant hosting or delivery context when it affects interpretation.
- Then name the most important confirmed issues.
- Then explain what to do next.
- short and expanded must agree. Do not make the short harsher or more generic than the expanded.

EXISTING SEO CARD COPY (may be wrong; do not trust over the fact pack):
${existingCard ? JSON.stringify(existingCard).slice(0, 1200) : '(none)'}

CANONICAL DETERMINISTIC CARD DESCRIPTION:
${JSON.stringify(buildCanonicalSeoSignalPack(factPack), null, 2)}

FACT PACK JSON:
${JSON.stringify(factPack, null, 2)}
`;
}

function buildTool() {
  const budgets = getCard('seo-performance')?.copy?.expanded || { min: 250, max: 700 };
  return {
    name: 'write_seo_guardian_comment',
    description: 'Write the final fact-locked SEO tile summary, modal comment, and recommendation.',
    input_schema: {
      type: 'object',
      required: ['short', 'expanded', 'recommendation'],
      properties: {
        short: {
          type: 'string',
          description: `Fact-locked SEO tile summary. Target ${getCard('seo-performance')?.copy?.short?.min || 60}-${getCard('seo-performance')?.copy?.short?.max || 140} chars.`,
        },
        expanded: {
          type: 'string',
          description: `Fact-locked SEO modal copy. Target ${budgets.min}-${budgets.max} chars.`,
        },
        recommendation: {
          type: 'string',
          description: 'One actionable sentence <=120 chars.',
        },
      },
    },
  };
}

function validateSeoGuardianComment(factPack, comment) {
  const short = cleanText(comment?.short);
  const expanded = cleanText(comment?.expanded);
  const errors = [];
  const combined = `${short} ${expanded}`.trim();
  const lower = combined.toLowerCase();

  if (!short) {
    errors.push('short_comment_missing');
  }

  if (!expanded) {
    errors.push('expanded_comment_missing');
  }

  if (!combined) {
    return errors;
  }

  if (factPack?.psi?.auditStatus === 'ok' && factPack?.psi?.hasScores) {
    const forbidden = [
      /audit failed/i,
      /performance measurement was blocked/i,
      /couldn['’]t capture page(speed)? scores/i,
      /could not capture page(speed)? scores/i,
      /core web vitals data unavailable/i,
      /performance data unavailable/i,
      /lighthouse hit a timeout/i,
      /pagespeed audit timed out/i,
    ];
    if (forbidden.some((re) => re.test(combined))) {
      errors.push('claims_psi_failed_while_final_payload_is_ok');
    }
  }

  if (Array.isArray(factPack?.aiSeo?.schemaTypes) && factPack.aiSeo.schemaTypes.length > 0) {
    const forbidden = [
      /missing schema markup entirely/i,
      /no structured data/i,
      /schema markup entirely/i,
      /missing schema entirely/i,
    ];
    if (forbidden.some((re) => re.test(combined))) {
      errors.push('claims_schema_missing_when_schema_exists');
    }
  }

  if (
    factPack?.delivery?.hostingProvider &&
    factPack?.delivery?.providerConfidence === 'high' &&
    !lower.includes(String(factPack.delivery.hostingProvider).toLowerCase())
  ) {
    errors.push('high_confidence_provider_not_mentioned');
  }

  return errors;
}

async function runSeoCommentGuardian({
  websiteUrl = '',
  pagespeed = null,
  aiSeoAudit = null,
  seoAggregate = null,
  warnings = [],
  userContext = null,
  businessModel = '',
  existingCard = null,
} = {}) {
  const factPack = buildSeoFactPack({
    websiteUrl,
    pagespeed,
    aiSeoAudit,
    seoAggregate,
    warnings,
    userContext,
    businessModel,
  });

  const deterministic = buildDeterministicSeoComment(factPack);

  return {
    ok: true,
    source: 'deterministic',
    card: {
      short: deterministic.short,
      expanded: deterministic.expanded,
      recommendation: deterministic.recommendation || existingCard?.recommendation || '',
    },
    factPack,
    runCostData: null,
    validationErrors: [],
    error: null,
  };
}

module.exports = {
  buildSeoFactPack,
  buildDeterministicSeoComment,
  validateSeoGuardianComment,
  runSeoCommentGuardian,
};
