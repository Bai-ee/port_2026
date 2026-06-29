// brief-summary-runner.mjs — Phase 2 of per-brief cover summaries.
//
// Orchestrates brief-summarizer.js for a client: loads the same data bag the
// brief renderer reads (dashboard_state + client_configs + social queue +
// weather), generates one cover paragraph per named brief, and writes the
// results to dashboard_state.briefSummaries[briefType]. The brief-preview
// route renders that paragraph as the cover `.sub`, replacing the run-level
// headline that was identical on every brief type.
//
// ESM on purpose: readSocialQueue (twitter-service.js) is ESM-only; the CJS
// pipeline modules come in through createRequire. Callers (worker run-brief,
// marketing-brief/run) are ESM routes.
//
// Every failure is non-fatal — a missing summary just means the cover falls
// back to the headline, never a failed run.

import { createRequire } from 'module';
import { readSocialQueue } from '../social-posting/twitter-service.js';

const require = createRequire(import.meta.url);

const fb = require('../../api/_lib/firebase-admin.cjs');
const { getClientWeather } = require('../intelligence/_weather.js');
const { summarizeBriefCover } = require('./brief-summarizer');
const { BRIEF_COMPOSITIONS } = require('./brief-sections.cjs');
const { loadClientBrainContext } = require('../client-brain/store.cjs');

const ALL_BRIEF_TYPES = Object.keys(BRIEF_COMPOSITIONS);

/** "Good morning" / "Good afternoon" / "Good evening" / "Good night" for the
 *  current moment in the given IANA timezone. Falls back to noon on a bad tz. */
function greetingFor(timeZone) {
  let hour = 12;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date())
    );
  } catch { /* unknown tz — keep noon */ }
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/**
 * Generate + store cover summaries for the given brief types.
 *
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.runId - Producing run, stamped on each entry.
 * @param {string[]} [params.briefTypes] - Defaults to every composition.
 * @returns {Promise<{ ok: boolean, written: string[], failed: string[] }>}
 */
export async function generateBriefSummaries({ clientId, runId, briefTypes = ALL_BRIEF_TYPES }) {
  let dash = null;
  let clientConfig = null;
  try {
    const [dashSnap, cfgSnap] = await Promise.all([
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
      fb.adminDb.collection('client_configs').doc(clientId).get(),
    ]);
    dash = dashSnap.exists ? dashSnap.data() : null;
    clientConfig = cfgSnap.exists ? cfgSnap.data() : null;
  } catch (err) {
    console.warn(`[brief-summaries] state load failed for ${clientId}: ${err?.message}`);
    return { ok: false, written: [], failed: briefTypes };
  }
  if (!dash) return { ok: false, written: [], failed: briefTypes };

  const [socialQueue, weather] = await Promise.all([
    readSocialQueue(clientId).catch(() => []),
    getClientWeather(clientId).catch(() => null),
  ]);

  // Same bag renderMarketingBriefHtml reads (app/api/dashboard/brief-preview).
  const data = {
    marketingBrief: dash.marketingBrief || null,
    company: {
      brandOverview: dash.snapshot?.brandOverview || null,
      brandTone: dash.snapshot?.brandTone || null,
    },
    researchConfig: clientConfig?.marketingBriefConfig || null,
    strategyData: {
      strategy30: dash.strategy30 || null,
      strategy: dash.strategy || null,
      strategyBuilder: dash.strategyBuilder?.lastPlan || null,
    },
    signalsCore: Array.isArray(dash.signals?.core) ? dash.signals.core : [],
    socialQueue,
    moduleBriefs: dash.moduleBriefs?.items || [],
    siteMeta: dash.siteMeta || null,
    watchlistKols: Array.isArray(clientConfig?.marketingBriefConfig?.kols)
      ? clientConfig.marketingBriefConfig.kols
      : [],
    weather,
  };
  // Approved Client Brain voice/positioning (optional, additive). Absent or
  // unapproved => '' => every cover paragraph reads exactly as before.
  let clientBrainContext = '';
  try {
    clientBrainContext = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 1800 });
  } catch (err) {
    console.warn(`[brief-summaries] client brain load failed for ${clientId}: ${err?.message}`);
  }

  const options = {
    clientName: clientConfig?.clientName || clientConfig?.sourceInputs?.clientName || '',
    websiteUrl: clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || '',
    // Time-of-day salutation in the CLIENT's timezone (scout-config-generator
    // stores it) — the executive brief opens with it.
    greeting: greetingFor(clientConfig?.scoutConfig?.timeZone || 'America/Chicago'),
    clientBrainContext,
  };

  const generatedAtIso = new Date().toISOString();
  const outcomes = await Promise.all(
    briefTypes.map(async (briefType) => {
      const result = await summarizeBriefCover(briefType, data, options);
      return { briefType, ...result };
    })
  );

  const entries = {};
  const written = [];
  const failed = [];
  for (const o of outcomes) {
    if (o.ok && o.summary) {
      entries[o.briefType] = {
        summary: o.summary,
        generatedAtIso,
        runId: runId || null,
        runCostData: o.runCostData || null,
      };
      written.push(o.briefType);
    } else {
      failed.push(o.briefType);
      console.warn(`[brief-summaries] ${o.briefType} skipped for ${clientId}: ${o.error}`);
    }
  }

  if (written.length) {
    try {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        { briefSummaries: entries, updatedAt: fb.FieldValue.serverTimestamp() },
        { merge: true }
      );
      console.log(`[brief-summaries] wrote ${written.length}/${briefTypes.length} for ${clientId}: ${written.join(', ')}`);
    } catch (err) {
      console.warn(`[brief-summaries] write failed for ${clientId}: ${err?.message}`);
      return { ok: false, written: [], failed: briefTypes };
    }
  }

  return { ok: written.length > 0, written, failed };
}
