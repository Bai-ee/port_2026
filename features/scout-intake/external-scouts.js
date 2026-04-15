'use strict';

// external-scouts.js — Unified bridge that runs enabled external scouts for
// a client based on their scoutConfig. Designed as a Phase-E runtime: it
// calls into the pre-existing scout-library's service fetchers, caches each
// output to Firestore, and returns a single `externalSignals` object the
// pipeline can thread into scribe / analyzers.
//
// Scout registry (extensible): add a new source here when a credential path
// lands. Each entry declares:
//
//   key          — storage sub-key (also `externalSignals[key]`)
//   label        — log-friendly label
//   isRunnable   — (scoutConfig) => boolean
//   run          — async fn that actually fetches. Resolves to { ok, report, cost, error }
//
// The bridge is designed to never throw: every fetcher is wrapped in
// Promise.allSettled, and unrunnable sources return `{ ok: false, reason }`
// so the pipeline can still succeed with partial signal.

const { fetchOperationalWeather }         = require('../not-the-rug-brief/services/weather');
const { fetchReviewStatusViaWebSearch }   = require('../not-the-rug-brief/services/reviews');
const { getCached, saveCached }           = require('./external-scouts-store');
const { runRedditWebSearch }              = require('./external-scouts/reddit-web-search');

// ── Scout registry ──────────────────────────────────────────────────────────

const SCOUTS = [
  {
    key:   'weather',
    label: 'Weather (NWS)',
    isRunnable: (cfg) => Boolean(cfg?.weather?.provider === 'nws' && (cfg.weather.serviceNeighborhoods || []).length),
    missingReason: 'config.weather not enabled (weather is only set for local, foot-traffic-sensitive clients)',
    run: async ({ scoutConfig, clientId }) => {
      const config = { clientId, ...scoutConfig };
      const report = await fetchOperationalWeather(config);
      return { ok: Boolean(report), report, cost: null };
    },
  },
  {
    key:   'reviews',
    label: 'Reviews (web_search)',
    isRunnable: (cfg) => Boolean(cfg?.reviews?.provider === 'web-search' && (cfg.reviews.sources || []).length),
    missingReason: 'config.reviews not enabled (reviews is only set for clients with likely GMB/Yelp/TripAdvisor presence)',
    run: async ({ scoutConfig, clientId }, previousReport) => {
      const config = { clientId, ...scoutConfig };
      const report = await fetchReviewStatusViaWebSearch(config, previousReport);
      return { ok: Boolean(report), report, cost: null };
    },
  },
  {
    key:   'reddit',
    label: 'Reddit (web_search)',
    isRunnable: (cfg) => Boolean(cfg?.reddit && Array.isArray(cfg.reddit.subreddits) && cfg.reddit.subreddits.length),
    missingReason: 'config.reddit has no subreddits',
    run: async ({ scoutConfig, clientId }) => {
      return await runRedditWebSearch({ clientId, redditConfig: scoutConfig.reddit });
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

/**
 * Run all runnable scouts for a client in parallel. Each scout independently
 * reads its previous cache (for diffs), fires its fetcher, and writes back
 * to Firestore. Returns an aggregated summary + the signals themselves.
 *
 * @param {object} input
 * @param {string} input.clientId
 * @param {object} input.scoutConfig
 * @returns {Promise<{
 *   ok: boolean,
 *   externalSignals: { weather?, reviews?, reddit? },
 *   runs: Array<{ key, status, ranMs, error?, reason? }>,
 *   totalCostUsd: number,
 * }>}
 */
async function runExternalScouts({ clientId, scoutConfig }) {
  if (!clientId) throw new Error('runExternalScouts: clientId required');
  if (!scoutConfig) return { ok: false, externalSignals: {}, runs: [], totalCostUsd: 0 };

  const started = Date.now();
  const runs = [];
  const externalSignals = {};
  let totalCostUsd = 0;

  const tasks = SCOUTS.map(async (scout) => {
    const t0 = Date.now();
    if (!scout.isRunnable(scoutConfig)) {
      runs.push({ key: scout.key, status: 'skipped', ranMs: 0, reason: scout.missingReason });
      return;
    }
    try {
      const previous = await getCached(clientId, scout.key);
      const result = await scout.run({ clientId, scoutConfig }, previous);
      if (result?.ok && result.report) {
        await saveCached(clientId, scout.key, result.report);
        externalSignals[scout.key] = result.report;
        if (typeof result.cost === 'number') totalCostUsd += result.cost;
        runs.push({ key: scout.key, status: 'ok', ranMs: Date.now() - t0, cost: result.cost ?? null });
      } else {
        runs.push({ key: scout.key, status: 'empty', ranMs: Date.now() - t0, error: result?.error || null });
      }
    } catch (err) {
      runs.push({ key: scout.key, status: 'error', ranMs: Date.now() - t0, error: err.message });
    }
  });

  await Promise.allSettled(tasks);

  const totalMs = Date.now() - started;
  const anyOk = runs.some((r) => r.status === 'ok');

  return {
    ok:               anyOk,
    externalSignals,
    runs,
    totalCostUsd:     Math.round(totalCostUsd * 10000) / 10000,
    totalMs,
    runAt:            new Date().toISOString(),
  };
}

module.exports = { runExternalScouts, SCOUTS };
