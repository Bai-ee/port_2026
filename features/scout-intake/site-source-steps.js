'use strict';

// site-source-steps.js
//
// The brand/scout source steps the run-brief worker runs after the intake
// modules, extracted from app/api/worker/run-brief/route.js so the signup path
// is testable without importing the route:
//
//   fetchSiteEvidence (free crawl) → ensureScoutConfig (1 Haiku call, only when
//   no scoutConfig exists / site changed / force; onboarding seeds unioned on
//   creation) → mergeMarketingBriefConfig (deterministic) → dashboard_state
//   .evidence → synthesizeBrandOverview → mergeBrandOverview (user fields win)
//   → dashboard_state.snapshot.brandOverview.
//
// `brandOverviewUseModel: false` (signup) keeps the brand overview
// deterministic so the whole signup run stays within 2 Anthropic calls
// (scout-config + onboarding summary). Every step is non-fatal.
//
// ensureSignupBrainDraft: end-of-signup Client Brain DRAFT from the sources
// above. Deterministic (no LLM), never writes Brain Markdown, never approves,
// skipped entirely when a Brain doc already exists.

function defaultDeps() {
  return {
    fb: require('../../api/_lib/firebase-admin.cjs'),
    fetchSiteEvidence: require('./site-fetcher').fetchSiteEvidence,
    ensureScoutConfig: require('./scout-config-generator').ensureScoutConfig,
    buildUserContext: require('./user-context').buildUserContext,
    buildSearchSeeds: require('./seed-extractor').buildSearchSeeds,
    mergeMarketingBriefConfig: require('./marketing-brief-config-merger').mergeMarketingBriefConfig,
    summarizeEvidencePages: require('./normalize').summarizeEvidencePages,
    synthesizeBrandOverview: require('./brand-overview-synthesizer').synthesizeBrandOverview,
    mergeBrandOverview: require('./brand-overview-merger').mergeBrandOverview,
  };
}

/**
 * @returns {Promise<{ stageCosts: object[], scoutConfig: object|null, evidence: object|null, brandOverview: object|null }>}
 */
async function runSiteSourceSteps({
  clientId,
  clientConfig,
  websiteUrl,
  force = false,
  brandOverviewUseModel = true,
  onProgress = async () => {},
  deps: depsIn = null,
}) {
  const deps = depsIn || defaultDeps();
  const db = deps.fb.adminDb;
  const out = { stageCosts: [], scoutConfig: null, evidence: null, brandOverview: null };
  let scoutConfigResult = null;

  try {
    await onProgress('search-terms', 'Generating search terms + scout configuration…');
    out.evidence = await deps.fetchSiteEvidence(websiteUrl);
    const userContext = deps.buildUserContext(clientConfig);
    const clientName = clientConfig?.clientName || clientConfig?.sourceInputs?.clientName || null;
    scoutConfigResult = await deps.ensureScoutConfig({
      clientId,
      clientName,
      intakeResult: { websiteUrl },
      userContext,
      evidence: out.evidence,
      websiteUrl,
      force,
      // Onboarding seeds (signup form competitors + any survey seed answers)
      // are only applied when the scoutConfig is being created.
      searchSeeds: deps.buildSearchSeeds(clientConfig?.onboardingAnswers?.answers || null),
    });
    console.log(`[WORKER] scoutConfig ensured for ${clientId}`);
    if (scoutConfigResult?.cost) {
      out.stageCosts.push({ stage: 'scout-config', ...scoutConfigResult.cost });
    }
    out.scoutConfig = scoutConfigResult?.scoutConfig || null;

    // Flow the fresh audit into marketingBriefConfig (the card layer):
    // untouched groups refresh, user-touched groups merge-append.
    if (out.scoutConfig) {
      await deps.mergeMarketingBriefConfig(clientId, out.scoutConfig);
    }
    const capCount = out.scoutConfig?._meta?.capabilitiesActive?.length ?? 0;
    await onProgress('search-terms', `Search terms ready — ${capCount} capabilit${capCount === 1 ? 'y' : 'ies'} active.`);
  } catch (scoutErr) {
    console.warn(`[WORKER] scoutConfig generation non-fatal failure for ${clientId}: ${scoutErr?.message}`);
    await onProgress('search-terms', 'Search terms generation hit an issue — will refresh on next run.');
  }

  // Persist trimmed crawl evidence so Data Quality / Trust / Platform
  // Coverage cards refresh on recurring runs, not just first intake.
  if (out.evidence) {
    try {
      const evidenceSummary = deps.summarizeEvidencePages(out.evidence);
      if (evidenceSummary) {
        await db.collection('dashboard_state').doc(clientId).set(
          { evidence: evidenceSummary },
          { merge: true }
        );
      }
    } catch (evErr) {
      console.warn(`[WORKER] evidence summary write non-fatal failure for ${clientId}: ${evErr?.message}`);
    }
  }

  // Synthesize snapshot.brandOverview from site evidence (OG meta + page content).
  // Then merge with any user-saved content so manual edits are never overwritten.
  if (out.evidence) {
    try {
      const crawled = await deps.synthesizeBrandOverview(out.evidence, out.scoutConfig, {
        useModel: brandOverviewUseModel,
        clientId,
      });
      if (crawled) {
        const merged = await deps.mergeBrandOverview(clientId, crawled);
        if (merged) {
          await db.collection('dashboard_state').doc(clientId).update({
            'snapshot.brandOverview': merged,
          });
          out.brandOverview = merged;
          console.log(`[WORKER] snapshot.brandOverview written for ${clientId}: source=${merged.source}`);
        }
      }
    } catch (boErr) {
      console.warn(`[WORKER] brandOverview synthesis non-fatal failure for ${clientId}: ${boErr?.message}`);
    }
  }

  return out;
}

/**
 * Generate a deterministic Client Brain DRAFT for a fresh signup. Never throws.
 * @returns {Promise<{ created: boolean, skipped?: string, status?: string, error?: string }>}
 */
async function ensureSignupBrainDraft(clientId, { store: storeIn = null } = {}) {
  try {
    const store = storeIn || require('../client-brain/store.cjs');
    const existing = await store.readClientBrainDoc(clientId);
    if (existing) {
      // A prior attempt generated it but failed before marking it draft: finish that step (never touch an
      // injected Markdown Brain or any other status).
      if (existing.status === 'generated' && !existing.markdownSource) {
        const brain = await store.markClientBrainStatus(clientId, 'draft');
        return { created: false, skipped: 'exists', status: brain?.status || 'draft' };
      }
      return { created: false, skipped: 'exists' };
    }
    await store.generateAndSaveClientBrain(clientId, { mode: 'deterministic' });
    // generateAndSaveClientBrain saves status 'generated'; signup leaves a
    // draft for the owner. Code never approves a Brain.
    const brain = await store.markClientBrainStatus(clientId, 'draft');
    return { created: true, status: brain?.status || 'draft' };
  } catch (err) {
    console.warn(`[WORKER] signup Brain draft non-fatal failure for ${clientId}: ${err?.message}`);
    return { created: false, error: err?.message || String(err) };
  }
}

module.exports = { runSiteSourceSteps, ensureSignupBrainDraft };
