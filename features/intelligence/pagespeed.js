'use strict';

// pagespeed.js — PageSpeed Insights source module for the intelligence layer
//
// Self-contained: fetches the PSI API, normalizes the result, and translates
// it into a validated SourceRecord. Registered by intelligence-runner.cjs.

// ── PSI API fetch ─────────────────────────────────────────────────────────────

const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const SEO_RED_FLAG_AUDIT_IDS = new Set([
  'meta-description', 'document-title', 'canonical', 'is-crawlable',
  'robots-txt', 'hreflang', 'image-alt', 'http-status-code', 'link-text',
]);

const INSIGHT_AUDIT_MAP = {
  'render-blocking-resources': 'Render-blocking',
  'uses-optimized-images':     'Image delivery',
  'uses-webp-images':          'Next-gen images',
  'font-display':              'Font display',
  'legacy-javascript':         'Legacy JS',
  'uses-http2':                'Modern HTTP',
  'unsized-images':            'Unsized images',
  'lcp-lazy-loaded':           'LCP lazy-loaded',
};

const DIAGNOSTIC_AUDIT_MAP = {
  'dom-size':                    'DOM nodes',
  'bootup-time':                 'JS bootup',
  'mainthread-work-breakdown':   'Main thread',
  'total-byte-weight':           'Total bytes',
  'network-requests':            'Requests',
};

const SKIP_SCORE_MODES = new Set(['notApplicable', 'manual', 'informative']);

function toScore(val) {
  if (val == null) return null;
  return Math.round(val * 100);
}

function stripMdLinks(str) {
  return String(str || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function extractCwv(loadingExperience) {
  if (!loadingExperience) return null;
  const metrics = loadingExperience.metrics || {};
  function getMetric(key) {
    const m = metrics[key];
    if (!m) return null;
    return { p75: m.percentile ?? null, category: m.category || null, displayValue: m.percentile != null ? String(m.percentile) : null };
  }
  return {
    lcp:  getMetric('LARGEST_CONTENTFUL_PAINT_MS'),
    inp:  getMetric('INTERACTION_TO_NEXT_PAINT'),
    cls:  getMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    ttfb: getMetric('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    originFallback: loadingExperience.origin_fallback === true,
  };
}

function labCategory(metric, value) {
  if (value == null) return null;
  if (metric === 'lcp') {
    if (value <= 2500) return 'FAST';
    if (value <= 4000) return 'AVERAGE';
    return 'SLOW';
  }
  if (metric === 'cls') {
    if (value <= 0.1)  return 'FAST';
    if (value <= 0.25) return 'AVERAGE';
    return 'SLOW';
  }
  return null;
}

function extractLabCwv(audits) {
  if (!audits) return null;
  const lcp  = audits['largest-contentful-paint'];
  const cls  = audits['cumulative-layout-shift'];
  const ttfb = audits['server-response-time'];
  return {
    lcp:  lcp?.numericValue  != null ? { p75: Math.round(lcp.numericValue),  category: labCategory('lcp', lcp.numericValue),  displayValue: lcp.displayValue  || null, source: 'lab' } : null,
    cls:  cls?.numericValue  != null ? { p75: Math.round(cls.numericValue * 1000) / 1000, category: labCategory('cls', cls.numericValue), displayValue: cls.displayValue || null, source: 'lab' } : null,
    ttfb: ttfb?.numericValue != null ? { p75: Math.round(ttfb.numericValue), displayValue: ttfb.displayValue || null, source: 'lab' } : null,
  };
}

function extractOpportunities(audits) {
  if (!audits) return [];
  const out = [];
  for (const [id, audit] of Object.entries(audits)) {
    if (audit.details?.type !== 'opportunity') continue;
    const savings = audit.details?.overallSavingsMs ?? 0;
    if (savings > 0) out.push({ id, title: audit.title || id, savingsMs: Math.round(savings) });
  }
  return out.sort((a, b) => b.savingsMs - a.savingsMs).slice(0, 15);
}

function extractCategoryFailures(audits, auditRefs, topN) {
  if (!audits || !auditRefs?.length) return [];
  return auditRefs
    .map((ref) => audits[ref.id])
    .filter((a) => a && a.score !== null && a.score < 1 && !SKIP_SCORE_MODES.has(a.scoreDisplayMode))
    .map((a) => ({
      id: a.id,
      title: a.title || a.id,
      description: stripMdLinks(a.description || '').slice(0, 120),
    }))
    .slice(0, topN);
}

function extractSeoRedFlags(audits) {
  if (!audits) return [];
  const out = [];
  for (const id of SEO_RED_FLAG_AUDIT_IDS) {
    const a = audits[id];
    if (!a) continue;
    if (a.score === 0 || (a.score == null && !SKIP_SCORE_MODES.has(a.scoreDisplayMode))) {
      out.push({ id, title: a.title || id, description: stripMdLinks(a.description || '').slice(0, 120) });
    }
  }
  return out;
}

function extractInsights(audits) {
  if (!audits) return [];
  const out = [];
  for (const [auditId, label] of Object.entries(INSIGHT_AUDIT_MAP)) {
    const a = audits[auditId];
    if (!a) continue;
    const value = a.displayValue || (a.numericValue != null ? String(Math.round(a.numericValue)) : null);
    if (value != null) out.push({ id: auditId, label, value, score: a.score ?? null });
  }
  return out;
}

function extractDiagnostics(audits) {
  if (!audits) return [];
  const out = [];
  for (const [auditId, label] of Object.entries(DIAGNOSTIC_AUDIT_MAP)) {
    const a = audits[auditId];
    if (!a) continue;
    let value;
    if (auditId === 'network-requests' && a.details?.items?.length != null) {
      value = String(a.details.items.length);
    } else if (auditId === 'total-byte-weight' && a.numericValue != null) {
      value = formatBytes(a.numericValue);
    } else {
      value = a.displayValue || (a.numericValue != null ? String(Math.round(a.numericValue)) : null);
    }
    if (value != null) out.push({ id: auditId, label, value });
  }
  return out;
}

function extractThirdParties(audits, topN) {
  if (!audits) return [];
  const tps = audits['third-party-summary'];
  if (!tps?.details?.items?.length) return [];
  return tps.details.items
    .filter((item) => item.entity)
    .sort((a, b) => (b.blockingTime ?? 0) - (a.blockingTime ?? 0))
    .slice(0, topN)
    .map((item) => ({
      entity: String(item.entity),
      blockingMs:    item.blockingTime != null ? Math.round(item.blockingTime) : null,
      sizeFormatted: formatBytes(item.size),
    }));
}

function extractMeta(raw) {
  const lr = raw.lighthouseResult || {};
  const warnings = Array.isArray(lr.runWarnings) ? lr.runWarnings.filter(Boolean) : [];
  return {
    lighthouseVersion: lr.lighthouseVersion || null,
    fetchTime:         lr.fetchTime || null,
    totalDurationMs:   lr.timing?.total != null ? Math.round(lr.timing.total) : null,
    warnings,
  };
}

/**
 * Fetch and normalize a PSI audit for the given URL.
 * @returns {Promise<{ ok: boolean, seoAudit: object|null, error: string|null }>}
 */
async function fetchPsiAudit(websiteUrl) {
  const apiKey = process.env.PAGESPEED_API_KEY || '';
  if (!apiKey) {
    console.warn('[PSI] PAGESPEED_API_KEY is not set — using anonymous pool (heavily rate-limited, expect 429s).');
  }

  const params = new URLSearchParams({ url: websiteUrl, strategy: 'mobile' });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) => params.append('category', c));
  if (apiKey) params.set('key', apiKey);

  const requestUrl = `${PSI_API}?${params.toString()}`;
  console.log(`[PSI] Fetching audit for ${websiteUrl}${apiKey ? '' : ' (anonymous)'}`);

  let raw;
  try {
    const res = await fetch(requestUrl, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`PSI HTTP ${res.status}: ${text.slice(0, 200)}`);
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, seoAudit: null, error: err.message };
  }

  if (raw.error) {
    const msg = raw.error.message || JSON.stringify(raw.error).slice(0, 200);
    return { ok: false, seoAudit: null, error: `PSI API error: ${msg}` };
  }

  const runtimeErr = raw.lighthouseResult?.runtimeError;
  const isPartial  = Boolean(runtimeErr?.code && runtimeErr.code !== 'NO_ERROR');
  if (isPartial) {
    console.warn(`[PSI] runtimeError detected for ${websiteUrl}: ${runtimeErr.code} — ${runtimeErr.message}`);
  }

  const categories = raw.lighthouseResult?.categories || {};
  const audits     = raw.lighthouseResult?.audits     || {};
  const loadingExp = raw.loadingExperience?.metrics ? raw.loadingExperience : raw.originLoadingExperience || null;

  const seoAudit = {
    fetchedAt:  new Date().toISOString(),
    websiteUrl,
    scores: {
      performance:   toScore(categories.performance?.score),
      seo:           toScore(categories.seo?.score),
      accessibility: toScore(categories.accessibility?.score),
      bestPractices: toScore(categories['best-practices']?.score),
    },
    coreWebVitals:    extractCwv(loadingExp),
    labCoreWebVitals: extractLabCwv(audits),
    opportunities:    extractOpportunities(audits),
    seoRedFlags:      extractSeoRedFlags(audits),
    a11yFailures:     extractCategoryFailures(audits, categories.accessibility?.auditRefs,         8),
    bpFailures:       extractCategoryFailures(audits, categories['best-practices']?.auditRefs,     6),
    insights:         extractInsights(audits),
    diagnostics:      extractDiagnostics(audits),
    thirdParties:     extractThirdParties(audits, 5),
    meta:             extractMeta(raw),
    status: isPartial ? 'partial' : 'ok',
    runtimeError: isPartial ? { code: runtimeErr.code, message: runtimeErr.message || null } : null,
    error:  null,
  };

  return { ok: true, seoAudit, error: null };
}

// ── Translation helpers ────────────────────────────────────────────────────────

function buildSummary(seoAudit) {
  const { scores, coreWebVitals, labCoreWebVitals, opportunities, runtimeError } = seoAudit;

  if (runtimeError) {
    const code = runtimeError.code || 'UNKNOWN';
    return `Partial audit — Lighthouse could not fully render the page (${code}). Category scores may be incomplete.`;
  }

  const parts = [];

  if (scores?.performance != null) {
    const label = scores.performance >= 90 ? 'excellent' : scores.performance >= 50 ? 'moderate' : 'poor';
    parts.push(`Mobile performance is ${label} at ${scores.performance}/100`);
  }
  if (scores?.seo != null) {
    const label = scores.seo >= 90 ? 'strong' : scores.seo >= 70 ? 'moderate' : 'weak';
    parts.push(`SEO fundamentals are ${label} at ${scores.seo}/100`);
  }

  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  if (lcp?.p75 != null) {
    parts.push(`LCP is ${(lcp.p75 / 1000).toFixed(1)}s${lcp.category ? ` (${lcp.category})` : ''}`);
  }

  if (opportunities?.length) {
    const n = opportunities.length;
    parts.push(`${n} optimization opportunit${n === 1 ? 'y' : 'ies'} identified`);
  }

  return parts.length
    ? parts.join('. ') + '.'
    : 'PageSpeed audit completed — no score data available.';
}

function buildSignals(seoAudit) {
  const signals = [];
  const { scores, coreWebVitals, labCoreWebVitals, opportunities, seoRedFlags, a11yFailures, bpFailures, runtimeError } = seoAudit;

  if (runtimeError) {
    signals.push(`Partial audit: ${runtimeError.code} — ${runtimeError.message || 'Lighthouse could not fully load the page'}`);
  }

  if (scores?.performance  != null) signals.push(`Mobile performance score ${scores.performance}/100`);
  if (scores?.seo          != null) signals.push(`SEO score ${scores.seo}/100`);
  if (scores?.accessibility != null) signals.push(`Accessibility score ${scores.accessibility}/100`);
  if (scores?.bestPractices != null) signals.push(`Best practices score ${scores.bestPractices}/100`);

  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  if (lcp?.p75 != null) {
    const src = lcp.source === 'lab' ? ' (lab)' : '';
    signals.push(`LCP is ${(lcp.p75 / 1000).toFixed(1)}s — ${lcp.category || 'unrated'}${src}`);
  }
  const inp = coreWebVitals?.inp;
  if (inp?.p75 != null) {
    signals.push(`INP is ${inp.p75}ms — ${inp.category || 'unrated'}`);
  }
  const cls = coreWebVitals?.cls?.p75 != null ? coreWebVitals.cls : labCoreWebVitals?.cls;
  if (cls?.p75 != null) {
    const src = cls.source === 'lab' ? ' (lab)' : '';
    signals.push(`CLS is ${Number(cls.p75).toFixed(2)}${src}`);
  }

  (opportunities || []).slice(0, 5).forEach((op) => {
    signals.push(`Top fix: ${op.title} — saves ${op.savingsMs}ms`);
  });

  if (seoRedFlags?.length) {
    seoRedFlags.slice(0, 3).forEach((flag) => {
      const id = typeof flag === 'string' ? flag : (flag.id || 'unknown');
      signals.push(`SEO flag failing: ${id}`);
    });
  } else if (scores?.seo != null) {
    signals.push('No critical SEO flags found');
  }

  (a11yFailures || []).slice(0, 3).forEach((flag) => {
    signals.push(`Accessibility flag failing: ${flag.title || flag.id}`);
  });

  (bpFailures || []).slice(0, 2).forEach((flag) => {
    signals.push(`Best practices flag failing: ${flag.title || flag.id}`);
  });

  return signals;
}

// ── Core translation ───────────────────────────────────────────────────────────

/**
 * Translate a PSI audit result into a SourceRecord.
 * Explicit field-by-field mapping — never a blind spread.
 *
 * @param {{ ok: boolean, seoAudit: object|null, error: string|null }} psiResult
 * @param {string} websiteUrl
 * @param {number|null} durationMs
 * @returns {object} SourceRecord
 */
function seoAuditToSourceRecord(psiResult, websiteUrl, durationMs) {
  if (!psiResult.ok) {
    return {
      id:              'pagespeed-insights',
      provider:        'google-pagespeed-v5',
      version:         '1.0.0',
      status:          'error',
      enabled:         true,
      fetchedAt:       new Date().toISOString(),
      durationMs:      typeof durationMs === 'number' ? durationMs : null,
      cost:            { usd: 0, quotaUnits: 1, model: null, inputTokens: null, outputTokens: null },
      summary:         `PSI audit failed: ${psiResult.error || 'unknown error'}`,
      signals:         [],
      facts:           { strategy: 'mobile', websiteUrl, auditStatus: 'error' },
      nextRefreshHint: 'manual',
      error:           psiResult.error || 'PSI audit failed.',
    };
  }

  const a = psiResult.seoAudit;

  return {
    id:              'pagespeed-insights',
    provider:        'google-pagespeed-v5',
    version:         '1.0.0',
    status:          'live',
    enabled:         true,
    fetchedAt:       a.fetchedAt,
    durationMs:      a.meta?.totalDurationMs != null ? a.meta.totalDurationMs : (typeof durationMs === 'number' ? durationMs : null),
    cost:            { usd: 0, quotaUnits: 1, model: null, inputTokens: null, outputTokens: null },
    summary:         buildSummary(a),
    signals:         buildSignals(a),
    facts: {
      strategy:        'mobile',
      websiteUrl:       a.websiteUrl,
      scores:           a.scores           || null,
      coreWebVitals:    a.coreWebVitals    || null,
      labCoreWebVitals: a.labCoreWebVitals || null,
      opportunities:    a.opportunities    || [],
      seoRedFlags:      a.seoRedFlags      || [],
      a11yFailures:     a.a11yFailures     || [],
      bpFailures:       a.bpFailures       || [],
      insights:         a.insights         || [],
      diagnostics:      a.diagnostics      || [],
      thirdParties:     a.thirdParties     || [],
      lighthouseMeta:   a.meta             || null,
      runtimeError:     a.runtimeError     || null,
      auditStatus:      a.status,
    },
    nextRefreshHint: 'manual',
    error:           null,
  };
}

// ── Source module export ───────────────────────────────────────────────────────

module.exports = {
  defaultEnabled: true,

  /**
   * Fetch and return a PageSpeed Insights SourceRecord.
   * @param {{ websiteUrl: string }} clientData
   * @returns {Promise<object>} SourceRecord
   */
  async fetch(clientData) {
    const websiteUrl = String(clientData?.websiteUrl || '').trim();
    if (!websiteUrl) throw new Error('pagespeed.fetch: websiteUrl is required');

    const startMs    = Date.now();
    const psiResult  = await fetchPsiAudit(websiteUrl);
    const durationMs = Date.now() - startMs;

    return seoAuditToSourceRecord(psiResult, websiteUrl, durationMs);
  },

  seoAuditToSourceRecord,
};
