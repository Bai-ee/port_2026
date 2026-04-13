'use strict';

// intelligence-bootstrap-utils.cjs — pure helpers for building bootstrap.intelligence
//
// All functions are pure (no Firestore, no I/O) so they can be unit tested.
// Used by getDashboardBootstrap in client-provisioning.cjs.

const DEFAULT_SOURCE_SETTING = { enabled: true, refreshPolicy: 'manual' };

// ── Source settings normalization ─────────────────────────────────────────────

/**
 * Normalize a single source setting object.
 * Fills in missing `enabled` and `refreshPolicy` with safe defaults.
 *
 * @param {object|null|undefined} raw
 * @returns {{ enabled: boolean, refreshPolicy: string }}
 */
function normalizeSourceSetting(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SOURCE_SETTING };
  }
  return {
    enabled:       raw.enabled       !== undefined ? Boolean(raw.enabled) : DEFAULT_SOURCE_SETTING.enabled,
    refreshPolicy: raw.refreshPolicy || DEFAULT_SOURCE_SETTING.refreshPolicy,
  };
}

// ── PSI source → legacy seoAudit conversion ───────────────────────────────────

/**
 * Convert a pagespeed-insights SourceRecord into the legacy dashboard seoAudit shape.
 * Explicit field mapping — not a spread.
 *
 * Returns null only if source is null/undefined.
 * Returns an error stub for error-status sources.
 *
 * @param {object} source   SourceRecord
 * @param {string} fallbackWebsiteUrl
 * @returns {object}
 */
function psiSourceToDashboardSeoAudit(source, fallbackWebsiteUrl) {
  if (!source) return null;

  if (source.status === 'error') {
    return {
      fetchedAt:     source.fetchedAt || new Date().toISOString(),
      websiteUrl:    fallbackWebsiteUrl || '',
      scores:        null,
      coreWebVitals: null,
      opportunities: [],
      seoRedFlags:   [],
      status:        'error',
      error:         source.error || 'Intelligence source error.',
    };
  }

  const f = source.facts || {};
  return {
    fetchedAt:        source.fetchedAt,
    websiteUrl:       f.websiteUrl       || fallbackWebsiteUrl || '',
    scores:           f.scores           || null,
    coreWebVitals:    f.coreWebVitals    || null,
    labCoreWebVitals: f.labCoreWebVitals || null,
    opportunities:    f.opportunities    || [],
    seoRedFlags:      f.seoRedFlags      || [],
    a11yFailures:     f.a11yFailures     || [],
    bpFailures:       f.bpFailures       || [],
    insights:         f.insights         || [],
    diagnostics:      f.diagnostics      || [],
    thirdParties:     f.thirdParties     || [],
    meta:             f.lighthouseMeta   || null,
    runtimeError:     f.runtimeError     || null,
    status:           f.auditStatus      || 'ok',
    error:            source.error       || null,
  };
}

// ── Bootstrap intelligence payload builder ────────────────────────────────────

/**
 * Build the `bootstrap.intelligence` payload from Firestore data.
 * Pure — takes already-fetched data, returns a clean shape.
 *
 * @param {object|null}  masterDoc        result of getMaster()
 * @param {object[]}     sourceDocs       result of listSources()
 * @param {string}       clientWebsiteUrl fallback for seoAudit conversion
 * @returns {{ master: object|null, sources: object, sourceSettings: object, dashboardSeoAudit: object|null, psiSummary: string|null }}
 */
function buildIntelligencePayload(masterDoc, sourceDocs, clientWebsiteUrl) {
  const sources = {};
  for (const src of (sourceDocs || [])) {
    if (src && src.id) sources[src.id] = src;
  }

  // Normalize source settings — fill in missing enabled/refreshPolicy
  const rawSettings     = masterDoc?.sourceSettings || {};
  const sourceSettings  = {};
  const allSourceIds    = new Set([...Object.keys(sources), ...Object.keys(rawSettings)]);
  for (const srcId of allSourceIds) {
    sourceSettings[srcId] = normalizeSourceSetting(rawSettings[srcId]);
  }

  // Pre-convert PSI source to legacy-compatible seoAudit shape for the dashboard
  const psiSource       = sources['pagespeed-insights'] || null;
  const dashboardSeoAudit = psiSource ? psiSourceToDashboardSeoAudit(psiSource, clientWebsiteUrl || '') : null;
  const psiSummary      = (psiSource?.status !== 'error' ? psiSource?.summary : null) || null;
  // AI-generated narrative stored on facts.narrative after narrator runs (Phase 1)
  const psiNarrative    = (psiSource?.status === 'live' ? psiSource?.facts?.narrative : null) || null;

  return {
    master:          masterDoc || null,
    sources,
    sourceSettings,
    dashboardSeoAudit,
    psiSummary,
    psiNarrative,
  };
}

module.exports = {
  normalizeSourceSetting,
  psiSourceToDashboardSeoAudit,
  buildIntelligencePayload,
};
