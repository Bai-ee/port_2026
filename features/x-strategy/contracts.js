// X Strategy tab contracts (T0). Constants + typedefs + tiny validators only; pure, no I/O.
// Source: docs/plans/X-STRATEGY-TAB-MASTER-PLAN.md §5. Do not change shapes without the owner.
// Defaults are DERIVED from their source modules so they cannot drift.

import { DEFAULT_ENGINE_CONFIG } from '../x-content-inventory/engine-quota.js';
import { TIERS } from '../x-benchmark/profile.js';
import { STRATEGY_PRIORITY, DEFAULT_TYPE_FLOORS } from '../x-content-inventory/daily-loop/slots.js';

/**
 * @typedef {Object} RowsMeta  x_corpora/{handle}.rowsMeta
 * @property {number} rowCount
 * @property {{from:string,to:string}} range
 * @property {string|null} pulledAt  ISO; null for committed-json seeds
 * @property {number} viewsCoverage  0..1
 * @property {number} chunks  docs at x_corpora/{handle}/rows/{0..chunks-1}
 * @property {'bird'|'committed-json'} source
 */

/**
 * @typedef {Object} StrategyPlan  the `plan` field of x_strategy_plans/{clientId}
 * @property {number} authoredPerDay
 * @property {number} tier  derived from authoredPerDay unless pinned
 * @property {Record<string,number>} typeFloors
 * @property {Record<string,number>} typeCaps
 * @property {Object} engineTargets  mergeEngineConfig overrides
 * @property {string} benchmarkPrimary
 * @property {string} notes
 * @property {import('./content-tracks.js').ContentTrack[]} [contentTracks]  optional; absent => DEFAULT_TRACKS (old plans unchanged)
 */

/**
 * @typedef {Object} PlanHistoryEntry
 * @property {number} version
 * @property {string} at
 * @property {string} by
 * @property {'manual'|'chat'} source
 * @property {string} [proposalId]
 * @property {Object} diff
 * @property {string} reason
 */

/**
 * @typedef {Object} StrategyPlanDoc  x_strategy_plans/{clientId}
 * @property {number} version
 * @property {string} updatedAt
 * @property {string} updatedBy
 * @property {StrategyPlan} plan
 * @property {PlanHistoryEntry[]} history  last PLAN_LIMITS.historyCap
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {string} threadId
 * @property {string} kind  one of PROPOSAL_KINDS
 * @property {Object} payload
 * @property {string} summary
 * @property {string} rationale
 * @property {{source:string,figure:string}[]} evidence
 * @property {string} status  one of PROPOSAL_STATUSES
 * @property {Object} [result]
 */

export const PLAN_LIMITS = Object.freeze({
  authoredPerDayMin: 1,
  authoredPerDayMax: 16,
  historyCap: 30,
  maxBenchmarkHandles: 8, // total distinct across content tracks (content-tracks.js MAX_DISTINCT_BENCHMARKS)
  maxHandlesPerRefreshRequest: 6,
});

/** Real slot types, from daily-loop/slots.js STRATEGY_PRIORITY (not invented). */
export const KNOWN_SLOT_TYPES = Object.freeze(Object.keys(STRATEGY_PRIORITY));

export const PROPOSAL_KINDS = Object.freeze([
  'plan-change',
  'benchmarks-change',
  'suggestion-edit',
  'suggestion-dismiss',
  'suggestion-save-draft',
  'item-story',
  'regenerate-today',
  'refresh-handles',
]);

/**
 * Action each proposal kind runs on confirm (§5 table). `marketing-brief-config` is
 * NOT a ROUTE_ACTIONS member: it is the existing xGrowth save endpoint
 * (app/api/dashboard/marketing-brief/config, normalizeXGrowthProfile).
 */
export const PROPOSAL_KIND_ACTIONS = Object.freeze({
  'plan-change': 'strategy-plan-apply',
  'benchmarks-change': 'marketing-brief-config',
  'suggestion-edit': 'daily-run-edit',
  'suggestion-dismiss': 'daily-run-dismiss',
  'suggestion-save-draft': 'daily-run-save-draft',
  'item-story': 'update-item-facets',
  'regenerate-today': 'daily-run-generate',
  'refresh-handles': 'strategy-refresh',
});

export const PROPOSAL_STATUSES = Object.freeze(['pending', 'deciding', 'confirmed', 'rejected', 'failed']);

/** Evaluation caveat codes + thresholds (§5 Evaluation view model). */
export const EVALUATION_CAVEAT = Object.freeze({
  LIKES_ONLY: 'likes-only',   // views coverage < viewsCoverageMin
  FEW_ROWS: 'few-rows',       // rows < minRows
  STALE: 'stale',             // data older than staleDays
});
export const EVALUATION_THRESHOLDS = Object.freeze({ viewsCoverageMin: 0.5, minRows: 60, staleDays: 7 });

export const ROUTE_ACTIONS = Object.freeze([
  'strategy-get',
  'strategy-refresh',
  'strategy-refresh-status',
  'strategy-evaluate-handle',
  'strategy-plan-apply',
  'strategy-plan-revert',
  'strategy-chat-send',
  'strategy-chat-history',
  'strategy-proposal-decide',
  'strategy-profile-save',
]);

export const STRATEGY_COLLECTIONS = Object.freeze({
  corpora: 'x_corpora',
  plans: 'x_strategy_plans',
  chats: 'x_strategy_chats',
  refreshRequests: 'x_strategy_refresh_requests',
});

/** Tier a given cadence sits IN: highest tier with authoredPerDay <= n (min 1).
 * Not resolveTier(): that returns the NEXT step up (a recommendation), which would
 * make the default 4/day plan read as tier 2. */
export function tierForAuthoredPerDay(n) {
  const tiers = Object.keys(TIERS).map(Number).sort((a, b) => a - b);
  let t = tiers[0];
  for (const k of tiers) if (TIERS[k].authoredPerDay <= n) t = k;
  return t;
}

const authoredDefault = DEFAULT_ENGINE_CONFIG.authored.targetPerDay;

/** @type {StrategyPlan} */
export const DEFAULT_PLAN = Object.freeze({
  authoredPerDay: authoredDefault,
  tier: tierForAuthoredPerDay(authoredDefault),
  typeFloors: Object.freeze({ ...DEFAULT_TYPE_FLOORS }),
  typeCaps: Object.freeze({}),
  engineTargets: Object.freeze({}),
  benchmarkPrimary: 'seb__design',
  notes: '',
});

export const isKnownSlotType = (t) => KNOWN_SLOT_TYPES.includes(t);
export const isProposalKind = (k) => PROPOSAL_KINDS.includes(k);
export const isProposalStatus = (s) => PROPOSAL_STATUSES.includes(s);
export const isRouteAction = (a) => ROUTE_ACTIONS.includes(a);
export const isValidAuthoredPerDay = (n) =>
  Number.isInteger(n) && n >= PLAN_LIMITS.authoredPerDayMin && n <= PLAN_LIMITS.authoredPerDayMax;

