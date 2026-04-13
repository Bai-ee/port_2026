'use strict';

// intelligence-runner.cjs — shared server-side intelligence execution function
//
// Registers all source modules at load time. Any route requiring this file will
// have sources available via the registry.
//
// Usage:
//   const { runIntelligenceSource, listRegisteredSourceMeta } = require('.../intelligence-runner.cjs');

const path = require('path');
const fb   = require('./firebase-admin.cjs');

const { registerSource, getSourceModule, listRegisteredSourceMeta } = require('../../features/intelligence/index');
const { validateSourceRecord }                                       = require('../../features/intelligence/_contract');
const { upsertSource, appendEvent, rebuildMasterDigestAndLedger }   = require('../../features/intelligence/_store');
const { narratePsiRecord }                                           = require('../../features/intelligence/_narrator');

// ── Source registration (idempotent at load time) ─────────────────────────────
const pagespeed = require('../../features/intelligence/pagespeed');
registerSource('pagespeed-insights', pagespeed);

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Execute one intelligence source for a client.
 *
 * Steps:
 *   1. Resolve source module from registry
 *   2. Load client doc (websiteUrl etc.)
 *   3. Execute source fetch
 *   4. Validate SourceRecord
 *   5. Write source doc
 *   6. Append ledger event
 *   7. Rebuild master digest + ledger
 *
 * @param {string} clientId
 * @param {string} sourceId
 * @param {{ runId?: string, websiteUrl?: string }} [options]
 * @returns {Promise<{ ok: boolean, sourceId: string, clientId: string, status: string, sourceRecord?: object, error?: string }>}
 */
async function runIntelligenceSource(clientId, sourceId, options = {}) {
  const { runId = null, websiteUrl: overrideUrl = null } = options;

  // 1. Resolve source module
  const mod = getSourceModule(sourceId);
  if (!mod) {
    return { ok: false, sourceId, clientId, status: 'error', error: `Source module not registered: ${sourceId}` };
  }

  // 2. Load client data
  const clientDoc = await fb.adminDb.collection('clients').doc(clientId).get();
  if (!clientDoc.exists) {
    return { ok: false, sourceId, clientId, status: 'error', error: `Client not found: ${clientId}` };
  }
  const clientData = { ...clientDoc.data(), clientId };
  if (overrideUrl) clientData.websiteUrl = overrideUrl;

  if (!clientData.websiteUrl) {
    return { ok: false, sourceId, clientId, status: 'error', error: `No websiteUrl configured for client: ${clientId}` };
  }

  // 3. Execute fetch
  let sourceRecord;
  try {
    sourceRecord = await mod.fetch(clientData);
  } catch (err) {
    console.error(`[intelligence-runner] fetch error — ${sourceId}/${clientId}: ${err.message}`);
    return { ok: false, sourceId, clientId, status: 'error', error: err.message };
  }

  // 3b. Narrator — generate AI narrative after fetch, before validation
  // Failure is non-fatal: narrative stays null, fetch still commits.
  if (sourceId === 'pagespeed-insights') {
    try {
      const narration = await narratePsiRecord(sourceRecord);
      if (narration.narrative) {
        sourceRecord.facts.narrative = narration.narrative;
        sourceRecord.cost.model        = narration.model;
        sourceRecord.cost.inputTokens  = narration.inputTokens;
        sourceRecord.cost.outputTokens = narration.outputTokens;
        console.log(`[intelligence-runner] narrative generated — ${narration.inputTokens}in/${narration.outputTokens}out tokens`);
      }
    } catch (err) {
      console.warn(`[intelligence-runner] narrator error (non-fatal) — ${err.message}`);
    }
  }

  // 4. Validate
  try {
    validateSourceRecord(sourceRecord);
  } catch (err) {
    console.error(`[intelligence-runner] validation error — ${sourceId}/${clientId}: ${err.message}`);
    return { ok: false, sourceId, clientId, status: 'error', error: err.message };
  }

  // 5. Write source doc
  await upsertSource(clientId, sourceRecord);

  // 6. Append ledger event
  await appendEvent(clientId, {
    at:         sourceRecord.fetchedAt || new Date().toISOString(),
    sourceId:   sourceRecord.id,
    provider:   sourceRecord.provider,
    kind:       'fetch',
    usd:        sourceRecord.cost?.usd        ?? 0,
    quotaUnits: sourceRecord.cost?.quotaUnits ?? 0,
    durationMs: sourceRecord.durationMs       ?? null,
    note:       sourceRecord.error            || null,
    runId,
  });

  // 7. Rebuild master digest + ledger
  await rebuildMasterDigestAndLedger(clientId);

  console.log(`[intelligence-runner] ${sourceId} OK for ${clientId} — status=${sourceRecord.status}`);
  return { ok: true, sourceId, clientId, status: sourceRecord.status, sourceRecord };
}

module.exports = {
  runIntelligenceSource,
  listRegisteredSourceMeta,
};
