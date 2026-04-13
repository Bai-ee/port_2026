#!/usr/bin/env node
'use strict';

// backfill-psi-intelligence.js
//
// Migrates existing dashboard_state/{clientId}.seoAudit records into the new
// clients/{clientId}/intelligence/sources/pagespeed-insights path.
//
// Usage:
//   node scripts/backfill-psi-intelligence.js
//   node scripts/backfill-psi-intelligence.js --dry-run
//
// Requirements:
//   FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY
//   must be set (or present in .env.local).
//
// Safe to rerun: skips source docs that are already newer than the seoAudit.
// Does NOT delete or modify dashboard_state records.

// Attempt to load .env.local for local development
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
} catch {
  // dotenv not installed — rely on shell env vars
}

const path      = require('path');
const fb        = require('../api/_lib/firebase-admin.cjs');
const { seoAuditToSourceRecord } = require('../features/intelligence/pagespeed');
const { validateSourceRecord }   = require('../features/intelligence/_contract');
const {
  getSource,
  upsertSource,
  setSourceSetting,
  appendEvent,
  rebuildMasterDigestAndLedger,
} = require('../features/intelligence/_store');

const DRY_RUN   = process.argv.includes('--dry-run');
const SOURCE_ID = 'pagespeed-insights';

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

/**
 * Determine whether a seoAudit is newer than an existing source doc.
 * Used for idempotent skip logic.
 *
 * @param {{ fetchedAt?: string } | null} existingSource
 * @param {{ fetchedAt?: string } | null} seoAudit
 * @returns {boolean} true if the existing source doc should be kept (is same or newer)
 */
function existingIsNewer(existingSource, seoAudit) {
  if (!existingSource?.fetchedAt) return false;  // no existing → must write
  if (!seoAudit?.fetchedAt)       return true;   // no seoAudit timestamp → keep existing
  try {
    return new Date(existingSource.fetchedAt).getTime() >= new Date(seoAudit.fetchedAt).getTime();
  } catch {
    return false;
  }
}

/**
 * Translate a stored seoAudit object into a PSI result shape compatible with
 * seoAuditToSourceRecord. The stored seoAudit IS already the normalized output.
 *
 * @param {object} seoAudit
 * @param {string} websiteUrl  fallback if seoAudit.websiteUrl is absent
 * @returns {{ ok: boolean, seoAudit: object, error: null }}
 */
function wrapStoredSeoAudit(seoAudit, websiteUrl) {
  if (!seoAudit || seoAudit.status === 'error') {
    return {
      ok:       false,
      seoAudit: null,
      error:    seoAudit?.error || 'Stored audit has error status',
    };
  }
  // Ensure websiteUrl is set
  const audit = { ...seoAudit, websiteUrl: seoAudit.websiteUrl || websiteUrl };
  return { ok: true, seoAudit: audit, error: null };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function backfillClient(clientId, seoAudit, websiteUrl) {
  // Check idempotency: skip if existing source doc is same age or newer
  const existing = await getSource(clientId, SOURCE_ID);
  if (existingIsNewer(existing, seoAudit)) {
    return { clientId, skipped: true, reason: 'existing source doc is same or newer' };
  }

  // Translate to SourceRecord
  const psiResult    = wrapStoredSeoAudit(seoAudit, websiteUrl);
  const sourceRecord = seoAuditToSourceRecord(psiResult, websiteUrl || seoAudit.websiteUrl, null);

  // Validate before writing
  validateSourceRecord(sourceRecord);

  if (DRY_RUN) {
    return { clientId, skipped: false, dryRun: true, status: sourceRecord.status };
  }

  // Write source doc
  await upsertSource(clientId, sourceRecord);

  // Append a backfill event (distinct kind for auditability)
  await appendEvent(clientId, {
    at:         sourceRecord.fetchedAt || new Date().toISOString(),
    sourceId:   SOURCE_ID,
    provider:   sourceRecord.provider,
    kind:       'backfill',
    usd:        0,
    quotaUnits: 0,
    durationMs: null,
    note:       'migrated from dashboard_state.seoAudit',
    runId:      null,
  });

  // Initialize source settings if master has none for this source
  await setSourceSetting(clientId, SOURCE_ID, {
    // Only sets if not already present; setSourceSetting reads+merges
  });

  // Rebuild master digest + ledger
  await rebuildMasterDigestAndLedger(clientId);

  return { clientId, skipped: false, status: sourceRecord.status };
}

async function main() {
  console.log(`[backfill] Starting PSI→intelligence migration${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const snapshot = await fb.adminDb.collection('dashboard_state').get();
  const docs     = snapshot.docs.filter((d) => d.data()?.seoAudit);

  console.log(`[backfill] Found ${docs.length} dashboard_state doc(s) with seoAudit`);

  const results = { migrated: 0, skipped: 0, errored: 0 };

  for (const doc of docs) {
    const clientId = doc.id;
    const data     = doc.data();
    const seoAudit = data.seoAudit;
    // Attempt to resolve websiteUrl from client doc as fallback
    let websiteUrl = seoAudit?.websiteUrl || '';
    if (!websiteUrl) {
      try {
        const clientDoc = await fb.adminDb.collection('clients').doc(clientId).get();
        websiteUrl = clientDoc.exists ? (clientDoc.data()?.websiteUrl || '') : '';
      } catch { /* non-fatal */ }
    }

    try {
      const outcome = await backfillClient(clientId, seoAudit, websiteUrl);
      if (outcome.skipped) {
        results.skipped++;
        console.log(`[backfill] SKIP   ${clientId} — ${outcome.reason}`);
      } else {
        results.migrated++;
        console.log(`[backfill] ${DRY_RUN ? 'DRY ' : ''}OK     ${clientId} — status=${outcome.status}`);
      }
    } catch (err) {
      results.errored++;
      console.error(`[backfill] ERROR  ${clientId} — ${err.message}`);
    }
  }

  console.log(`[backfill] Done. migrated=${results.migrated} skipped=${results.skipped} errored=${results.errored}`);
  process.exit(results.errored > 0 ? 1 : 0);
}

// Export pure helpers for testing
module.exports = { existingIsNewer, wrapStoredSeoAudit };

// Run main only when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill] Fatal:', err.message);
    process.exit(1);
  });
}
