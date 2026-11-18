// xsearch.js - plan, price and summarise the paid `x-search` refresh of MCP-OPS. Pure: config, key and pricing are injected.
//
// What the run really is: refreshDigestClient(clientId, {phase:'signals', groups:Set(['x-search'])}). With only x-search in
// groups, ONLY signalsX is on (Scout, watchlist, analysis, modules are off) so it runs:
//   (1) Market Talk on X: refreshPlatformSignals(scrape:false) -> refreshXMarketTalk. Runs when the client's sourcePlatforms
//       include 'x' and a brand X handle is set; up to 3 searches x 10 posts. The route does NOT check digest
//       include.xMarketTalk on this path (the dashboard runner does), so the plan prices it whenever it would run and only
//       reports the include flag.
//   (2) Opportunity Signals with X: refreshOpportunitySignals(allowX:true). Needs the ScrapeCreators key, the feature enabled
//       and 'x' among its platforms; one X call per enabled query row (cap maxQueriesPerRun, clamp 1..8, default 4), each
//       reading max(10, maxItemsPerPlatform) posts. The same call also searches Reddit/Instagram via ScrapeCreators.
// Both legs call assertXBudget inside; the X app credentials are the owner's (HITLOOP's X app), metered to the client.

import { X_READ_USD_PER_CALL } from '../../x-strategy/agent/refresh-engine.js';

const str = (v) => String(v == null ? '' : v).trim();
const clip = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const money = (n) => `$${Number((Math.round(n * 10000) / 10000).toFixed(4))}`;

export const MARKET_TALK_MAX_QUERIES = 3;
export const MARKET_TALK_POSTS_PER_QUERY = 10;

/**
 * @param {{marketingBriefConfig?:object, include?:object, hasScrapeKey?:boolean, pricing?:{perPostReadUsd:number|null}}} inputs
 */
export function planXSearch({ marketingBriefConfig, include, hasScrapeKey, pricing } = {}) {
  const mbc = marketingBriefConfig && typeof marketingBriefConfig === 'object' ? marketingBriefConfig : {};
  const sources = new Set((Array.isArray(mbc.sourcePlatforms) ? mbc.sourcePlatforms : []).map((s) => str(s).toLowerCase()));
  const handle = str(mbc.brandXHandle).replace(/^@+/, '');
  const keywords = (Array.isArray(mbc.brandKeywords) ? mbc.brandKeywords : []).map(str);
  const includeOn = include?.xMarketTalk === true;

  // Market Talk leg (mirrors refreshXMarketTalk's query list).
  const mtQueries = handle && sources.has('x') ? [...new Set([`@${handle}`, ...keywords].filter(Boolean))].slice(0, MARKET_TALK_MAX_QUERIES) : [];
  const marketTalk = {
    calls: mtQueries.length,
    postsPerCall: MARKET_TALK_POSTS_PER_QUERY,
    posts: mtQueries.length * MARKET_TALK_POSTS_PER_QUERY,
    includeOn,
    skipReason: mtQueries.length ? null : !sources.has('x') ? 'X is not one of the client\'s source platforms' : 'no brand X handle is set',
  };

  // Opportunity leg (mirrors refreshOpportunitySignals).
  const cfg = mbc.opportunitySignals && typeof mbc.opportunitySignals === 'object' ? mbc.opportunitySignals : {};
  const platforms = (Array.isArray(cfg.platforms) ? cfg.platforms : []).map((p) => str(p).toLowerCase());
  const maxQueries = Number.isFinite(cfg.maxQueriesPerRun) ? Math.max(1, Math.min(8, cfg.maxQueriesPerRun)) : 4;
  const maxItems = Number.isFinite(cfg.maxItemsPerPlatform) ? Math.max(1, Math.min(30, cfg.maxItemsPerPlatform)) : 10;
  const rows = (Array.isArray(cfg.queries) ? cfg.queries : []).filter((r) => r?.enabled !== false && str(r?.query)).slice(0, maxQueries);
  const postsPerCall = Math.max(10, maxItems);
  const oppSkip = !hasScrapeKey ? 'the ScrapeCreators key is not configured (Opportunity Signals will not run at all)'
    : !cfg.enabled ? 'Opportunity Signals is disabled for this client'
      : !platforms.includes('x') ? 'X is not an enabled Opportunity platform'
        : !rows.length ? 'there are no enabled Opportunity query rows' : null;
  const oppCalls = oppSkip ? 0 : rows.length;
  const opportunity = { calls: oppCalls, postsPerCall, posts: oppCalls * postsPerCall, maxQueriesPerRun: maxQueries, enabledRows: rows.length, hasScrapeKey: Boolean(hasScrapeKey), skipReason: oppSkip };

  const calls = marketTalk.calls + opportunity.calls;
  const posts = marketTalk.posts + opportunity.posts;
  const rate = pricing?.perPostReadUsd;
  const placeholder = rate == null;
  const perPost = placeholder ? X_READ_USD_PER_CALL : rate;
  return { calls, posts, perPostUsd: perPost, placeholder, usd: Math.round(posts * perPost * 10000) / 10000, marketTalk, opportunity };
}

/** The estimate text bound into the preview token. Deterministic for a given plan. */
export function xSearchEstimate(plan) {
  if (!plan.calls) return 'No paid X calls would be made (0 calls, 0 posts, $0).';
  const price = plan.placeholder
    ? `${money(plan.usd)} PLACEHOLDER (no per-post X rate is set in the X usage ledger; using ${money(plan.perPostUsd)} per post, so the real cost is unknown)`
    : `${money(plan.usd)} at ${money(plan.perPostUsd)} per post (ledger rate)`;
  const legs = [];
  if (plan.marketTalk.calls) legs.push(`Market Talk ${plan.marketTalk.calls} search(es) x ${plan.marketTalk.postsPerCall} posts`);
  if (plan.opportunity.calls) legs.push(`Opportunity ${plan.opportunity.calls} call(s) x ${plan.opportunity.postsPerCall} posts`);
  return `Up to ${plan.calls} paid X search call(s) reading up to ${plan.posts} posts: ${legs.join(' + ')}. About ${price}.`;
}

/** Effects shown to the owner (appended to the catalog's static effects). */
export function xSearchEffects(plan) {
  const e = [];
  e.push('Uses the owner/app X credentials (HITLOOP\'s X app); the client needs no X connection of their own. Calls are metered to this client in the X usage ledger, and the X daily/source read budget (assertXBudget) still applies inside each leg and can skip it.');
  e.push(plan.marketTalk.calls
    ? `Market Talk on X: up to ${plan.marketTalk.calls} search(es) x ${plan.marketTalk.postsPerCall} posts (${plan.marketTalk.posts} posts), for THIS client only.${plan.marketTalk.includeOn ? '' : ' Note: the digest "Market Talk on X" toggle is OFF for this client, but this run does not check it, so Market Talk WOULD still run and spend.'}`
    : `Market Talk on X: will not run (${plan.marketTalk.skipReason}).`);
  e.push(plan.opportunity.calls
    ? `Opportunity Signals on X: ${plan.opportunity.calls} call(s) (one per enabled query row, cap ${plan.opportunity.maxQueriesPerRun} per run) x ${plan.opportunity.postsPerCall} posts (${plan.opportunity.posts} posts). Needs the ScrapeCreators key (present).`
    : `Opportunity Signals on X: will not make X calls (${plan.opportunity.skipReason}).`);
  e.push('The same run also searches Reddit/Instagram through ScrapeCreators for Opportunity Signals (not X, but it uses ScrapeCreators credits) when those platforms are enabled.');
  e.push('Creates or marks the digest delivery record (the digest preflight, bookkeeping) and writes dashboard_state (market talk results, opportunity signals pool, platform status).');
  if (plan.placeholder) e.push('Price is a PLACEHOLDER: no per-post X rate is set in the X usage ledger.');
  return e;
}

const part = (name, state, why) => `${name} ${state}${why ? ` (${clip(why, 100)})` : ''}`;

/**
 * Summary of a refreshDigestClient result for an x-search run. The route returns no X call count, so calls/posts are the
 * PLANNED maxima for the legs that ran (labelled as such). `failed` only when the preflight refused it (nothing ran).
 */
export function xSearchOutcome(plan, out) {
  if (!out || (out.skipped && out.ok === false)) return { status: 'failed', detail: clip(`Not run: ${out?.reason || out?.error || 'the refresh was refused before any step ran'}. No X calls were made.`, 300) };
  if (out.skipped) return { status: 'done', detail: `Nothing to run (${clip(out.reason || 'skipped')}). No X calls were made.` };
  const mt = out.platformSignals;
  const op = out.opportunitySignalsRefresh;
  const mtRan = Boolean(mt?.ok) && typeof mt.xMarketTalk === 'number';
  const mtSkipped = Boolean(mt?.ok) && typeof mt.xMarketTalk === 'string';
  // A search was attempted unless the leg was skipped before the X call (no handle, X disabled, budget).
  const mtAttempted = mtRan || (mtSkipped && !/^skip:(no-x-handle|x-disabled|x-budget)/.test(mt.xMarketTalk));
  const opAttempted = Array.isArray(op?.platforms) && op.platforms.includes('x');
  const mtText = mtRan ? `Market Talk ok (${mt.xMarketTalk} kept)` : mtSkipped ? part('Market Talk', 'skipped', mt.xMarketTalk) : mt?.ok === false ? part('Market Talk', 'failed', mt.error || mt.reason) : 'Market Talk not run';
  const opText = op?.ok ? `Opportunity ok (${op.itemCount ?? 0} items; platforms ${(op.platforms || []).join(', ') || 'none'}${(op.warnings || []).length ? `; ${op.warnings.length} warning(s): ${clip(op.warnings[0], 90)}` : ''})` : op?.skipped ? part('Opportunity', 'skipped', op.reason) : part('Opportunity', 'failed', op?.error);
  const calls = (mtAttempted ? plan.marketTalk.calls : 0) + (opAttempted ? plan.opportunity.calls : 0);
  const posts = (mtAttempted ? plan.marketTalk.posts : 0) + (opAttempted ? plan.opportunity.posts : 0);
  return { status: 'done', detail: clip(`x-search ran. X calls up to ${calls}, posts up to ${posts} (planned maxima for the legs that ran; the route returns no exact count). ${mtText}; ${opText}.${calls ? '' : ' No X search was made.'}`, 500) };
}
