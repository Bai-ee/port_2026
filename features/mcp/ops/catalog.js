// catalog.js - what MCP-OPS can refresh. Pure data + small helpers; no I/O.
//
// FREE groups (Mac bird queues + the template-only Today queue) run directly. The engine's own planGroup
// (features/x-strategy/agent/refresh-engine.js) is the source of truth for free vs paid. PAID groups run only through
// a cost preview -> confirm:true (single-use token), within per-refresh and global daily caps (runs.js, preview.js).

import { PLACEHOLDER_USD, MAC_ETA_SECONDS } from '../../x-strategy/agent/refresh-engine.js';

export const OPS_PHASE = 2;

const usd = (n) => `about $${n.toFixed(2)} (placeholder estimate)`;

/** runner: 'agent-mac' = queued through the agent-refresh engine; 'today-queue' = template-only regenerateToday. */
const FREE = [
  { id: 'strategy-accounts', label: 'Strategy accounts (own + benchmark timelines)', runner: 'agent-mac', maxPerDay: 10, leaseMs: 20 * 60_000,
    estimate: 'Free: Mac bird pull (refuses when the client source is the paid X API)', writes: 'x_corpora rows via the Mac worker (queue doc x_strategy_refresh_requests)', reuse: 'agent-refresh -> requestStrategyRefresh (same as request_strategy_refresh)' },
  { id: 'quote-targets', label: 'Quote targets scan', runner: 'agent-mac', maxPerDay: 10, leaseMs: 20 * 60_000,
    estimate: 'Free: Mac bird scan (refuses when the client source is the paid X API)', writes: 'quote scan queue doc; candidates land in dashboard_state / calendar requotes', reuse: 'agent-refresh -> quoteScanQueue.request (same as request_quote_scan)' },
  { id: 'hot-quotes', label: 'Hot quotes (design + music picks)', runner: 'agent-mac', maxPerDay: 10, leaseMs: 30 * 60_000,
    estimate: 'Free Mac bird reads plus one tiny judge model call (about $0.002, hard cap $0.04)', writes: 'quote scan queue doc (mode hot); picks in dashboard_state.marketingBrief.hotQuotes', reuse: 'agent-refresh -> quoteScanQueue.request mode hot' },
  { id: 'bookmarks', label: 'Bookmarks', runner: 'agent-mac', maxPerDay: 10, leaseMs: 15 * 60_000,
    estimate: 'Free: Mac bird scan', writes: 'quote scan queue doc (mode bookmarks)', reuse: 'agent-refresh -> quoteScanQueue.request mode bookmarks' },
  { id: 'recent-posts', label: 'Recent posts', runner: 'agent-mac', maxPerDay: 10, leaseMs: 10 * 60_000,
    estimate: 'Free: Mac bird scan', writes: 'quote scan queue doc (mode recent-posts); recent-posts snapshot', reuse: 'agent-refresh -> quoteScanQueue.request mode recent-posts' },
  { id: 'today-queue', label: "Today's suggestions (template drafting)", runner: 'today-queue', maxPerDay: 5, leaseMs: 5 * 60_000,
    estimate: 'Free: template drafting, no model call', writes: 'today daily-run doc (x_content daily runs); never posts, schedules or saves drafts', reuse: 'services.regenerateToday (same as regenerate_today_suggestions)' },
].map((r) => ({ ...r, costClass: 'free', group: r.id }));

// PAID groups run from MCP only through preview -> confirm:true (runs.js), within caps. `effects` is shown to the owner
// in the preview. kind: 'digest' = pre-digest-refresh phase in-process; 'x-search' = the same function with groups Set(['x-search']) (its own kind: digest kinds never reach X); 'sync' = executePaidSync; 'showcase' = route.
const DIGEST_LEASE_MS = 6 * 60_000;
export const PAID_GLOBAL_CAP_PER_DAY = 10;
const PAID = [
  { id: 'market-signals', label: 'Market Signals (Scout + watchlist)', kind: 'digest', phase: 'signals', maxPerDay: 3, leaseMs: DIGEST_LEASE_MS, estimate: usd(PLACEHOLDER_USD['market-signals']),
    effects: ['Runs the Market Signals phase: Scout, watchlist, Reddit/Instagram, opportunities.', 'Spends model credits AND metered X watchlist reads (runXScout).', 'Rewrites the stored market signals brief.', 'Creates or marks the digest delivery record (bookkeeping).'],
    writes: 'dashboard_state.marketingBrief (market signals)' },
  { id: 'analysis', label: 'Analysis (pre-digest phase=analysis)', kind: 'digest', phase: 'analysis', maxPerDay: 3, leaseMs: DIGEST_LEASE_MS, estimate: usd(PLACEHOLDER_USD.analysis),
    effects: ['Creates a digest delivery record.', 'Makes a summary LLM call (several Claude calls).', 'MAY PUBLISH a fresh hosted Executive Brief page (a public URL) when the client\'s brief link mode is "fresh".'],
    writes: 'digest delivery record; summary text; possibly a published hosted Executive Brief' },
  { id: 'renders', label: 'Renders (pre-digest phase=modules)', kind: 'digest', phase: 'modules', maxPerDay: 3, leaseMs: DIGEST_LEASE_MS, estimate: usd(PLACEHOLDER_USD.renders),
    effects: ['Runs the enabled module cards through the model pipeline.', 'Rewrites module card outputs.', 'Creates or marks the digest delivery record (bookkeeping).'],
    writes: 'dashboard_state.modules outputs' },
  { id: 'x-search', label: 'X search (Market Talk on X + Opportunity Signals with X)', kind: 'x-search', maxPerDay: 3, leaseMs: DIGEST_LEASE_MS, estimate: 'Paid X search reads, priced per post (exact call and post counts in the preview)',
    effects: ['Runs ONLY the paid X search: Market Talk on X (up to 3 searches x 10 posts) and Opportunity Signals with X (one call per enabled query row, up to 8, each max(10, maxItemsPerPlatform) posts). Not Scout, not the watchlist, not analysis.',
      'Real X API spend priced per post read; uses the owner/app X credentials (HITLOOP\'s X app), needs no client X connection, metered to this client in the X ledger; the X daily/source budget still applies inside.',
      'Opportunity X also needs the ScrapeCreators key; the same run also does Reddit/Instagram ScrapeCreators searches for opportunity signals.',
      'Creates or marks the digest delivery record (preflight) and writes dashboard_state.'],
    writes: 'dashboard_state.marketingBrief (xMarketTalk platform test + status, opportunitySignals pool)' },
  { id: 'x-monitor', label: 'X Monitor sync', kind: 'sync', syncKind: 'x_monitor_sync', leaseMs: DIGEST_LEASE_MS, estimate: 'X API reads, metered per call (estimate shown in the preview)',
    effects: ['Reads from the X API (metered, real spend, invisible on the Operating Cost card). No writes to X.'],
    writes: 'x_monitor/{accountId} snapshots, posts, audience events' },
  { id: 'strategy-review', label: 'Strategy review', kind: 'sync', syncKind: 'strategy_review', leaseMs: DIGEST_LEASE_MS, estimate: 'about $0.17 (one agent review)',
    effects: ['One Anthropic agent turn over the latest data (counts as a strategy-chat turn).', 'Creates a new chat thread; any proposals it makes stay pending cards.'],
    writes: 'strategy chat thread + pending proposals' },
  { id: 'site-showcase', label: 'Site Showcase video', kind: 'showcase', maxPerDay: 2, leaseMs: 25 * 60_000, estimate: 'one render job (route allows one active job and 6 a day; home client only)',
    effects: ['Queues a Site Showcase render job on the render service (render cost).', 'Params: focusId, format, theme.'],
    writes: 'showcase_jobs/{jobId} and the rendered video' },
].map((r) => ({ ...r, costClass: 'paid', runner: null, group: r.id }));

export const REFRESHES = Object.freeze([...FREE, ...PAID].map((r) => Object.freeze(r)));

export const EXCLUDED = Object.freeze([
  { id: 'x-api-sources', reason: "Strategy accounts / Quote targets set to the paid X API: needs the owner's confirm row in the Refresh panel." },
  { id: 'cq-brief-video', reason: 'CQ brief video worker: CRON_SECRET only and env-gated; read its status instead.' },
  { id: 'daily-email-video', reason: 'Daily email video worker: not exposed.' },
  { id: 'digest-send', reason: 'Sending or retrying the daily digest email is sending: dashboard only.' },
  { id: 'posting-publishing-sending-deleting-billing', reason: 'Posting, publishing, scheduling, sending, deleting or billing actions are never run from MCP.' },
  { id: 'client-provisioning', reason: 'Creating or provisioning clients is not exposed.' },
]);

export const findRefresh = (id) => REFRESHES.find((r) => r.id === id) || null;
export const findExcluded = (id) => EXCLUDED.find((r) => r.id === id) || null;
export const macEtaSeconds = (id) => MAC_ETA_SECONDS[id] ?? null;

/** The only strategy-handler actions MCP-OPS may reach. Everything else throws, so a future edit cannot widen what the ops instance can do. */
export const OPS_AGENT_ACTIONS = Object.freeze(['agent-refresh', 'agent-refresh-status', 'strategy-autonomy-get']);
export function restrictAgentHandlers(handlers, allowed = OPS_AGENT_ACTIONS) {
  return { handle: (action, ...rest) => {
    if (!allowed.includes(action)) throw new Error(`MCP-OPS may not call "${String(action).slice(0, 60)}".`);
    return handlers.handle(action, ...rest);
  } };
}
