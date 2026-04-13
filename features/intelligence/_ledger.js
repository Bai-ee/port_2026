'use strict';

// _ledger.js — compute ledger totals from event records
// Pure function. No I/O, no async. No arrayUnion.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Compute 30-day ledger totals from an array of event records.
 * Filters events to those within the last 30 days.
 * Aggregates cost by provider with lastFetchedAt tracking.
 *
 * @param {Array<{ at: string, provider: string, usd: number, quotaUnits: number, durationMs?: number|null, kind?: string }>} events
 * @returns {{ totals: { usd30d: number, quotaUnits30d: number, auditsCount30d: number }, byProvider: object }}
 */
function computeLedger(events) {
  if (!Array.isArray(events)) events = [];

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const recent = events.filter((e) => {
    if (!e || !e.at) return false;
    try { return new Date(e.at).getTime() >= cutoff; } catch { return false; }
  });

  const totals = { usd30d: 0, quotaUnits30d: 0, auditsCount30d: 0 };
  const byProvider = {};

  for (const e of recent) {
    const usd   = typeof e.usd        === 'number' && isFinite(e.usd)        ? e.usd        : 0;
    const quota = typeof e.quotaUnits === 'number' && isFinite(e.quotaUnits) ? e.quotaUnits : 0;

    totals.usd30d         += usd;
    totals.quotaUnits30d  += quota;
    totals.auditsCount30d += 1;

    const provider = String(e.provider || 'unknown');
    if (!byProvider[provider]) {
      byProvider[provider] = { usd30d: 0, quotaUnits30d: 0, auditsCount30d: 0, lastFetchedAt: null };
    }
    byProvider[provider].usd30d         += usd;
    byProvider[provider].quotaUnits30d  += quota;
    byProvider[provider].auditsCount30d += 1;

    // Track the most recent fetch timestamp per provider
    const at = e.at || null;
    if (at && (!byProvider[provider].lastFetchedAt || at > byProvider[provider].lastFetchedAt)) {
      byProvider[provider].lastFetchedAt = at;
    }
  }

  // Round to 6 decimal places to eliminate floating-point drift
  totals.usd30d        = round6(totals.usd30d);
  totals.quotaUnits30d = round6(totals.quotaUnits30d);

  for (const p of Object.keys(byProvider)) {
    byProvider[p].usd30d        = round6(byProvider[p].usd30d);
    byProvider[p].quotaUnits30d = round6(byProvider[p].quotaUnits30d);
  }

  return { totals, byProvider };
}

function round6(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

module.exports = { computeLedger };
