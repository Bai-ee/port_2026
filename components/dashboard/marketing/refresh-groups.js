// Unified Refresh — group catalog + per-viewer "last refreshed" memory.
// Pure data/helpers (no React). See docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md section 5.
import { estimateCorporaPull, estimateQuoteScan } from '../../../features/x-strategy/x-api-estimate.js';

export const REFRESH_GROUPS = [
  { id: 'market-signals', n: 1, label: 'Market signals', updates: 'Scout brief, watchlist timelines, analysis skills (no X search)', cost: 'Scout ≈$0.10 + ScrapeCreators credits + model calls', paid: true, defaultOn: false },
  { id: 'x-search', n: 2, label: 'X search', updates: 'Opportunity Signals on X (and Market Talk on X if enabled in the digest)', cost: 'Paid X API — about 1 call per enabled Opportunity query row; if Market Talk is on in the digest it also runs Scout + ScrapeCreators searches', paid: true, defaultOn: false },
  { id: 'analysis', n: 3, label: 'Analysis', updates: 'Reddit / Instagram / opportunity analyzers, strategy and reply targets, brief summaries, hosted brief', cost: 'Model calls', paid: true, defaultOn: false },
  { id: 'strategy-accounts', n: 4, label: 'Strategy accounts', updates: 'Posts for you and every benchmark account', cost: 'Free — Mac worker via bird (or paid X API when that source is selected)', paid: false, defaultOn: false },
  { id: 'today-queue', n: 5, label: 'Today and queue', updates: "Today's suggestions, month calendar, post results", cost: 'Free (model copy is paid, optional)', paid: false, defaultOn: false },
  { id: 'x-monitor', n: 6, label: 'X Monitor', updates: 'Profile counters, posts, follower roster for the connected account', cost: 'Paid X API — about 2 metered calls plus 1 per 1,000 followers', paid: true, defaultOn: false },
  { id: 'renders', n: 7, label: 'Renders', updates: 'Creative and video modules', cost: 'Render cost (studio/video)', paid: true, defaultOn: false },
  { id: 'quote-targets', n: 8, label: 'Quote targets', updates: 'Posts worth quote-reacting to, from the watchlist (last 36h)', cost: 'Free — scanned on the Mac (launchd) via bird; paid X API when that source is selected', paid: false, defaultOn: false },
];

// Per-client data source of the two X data groups (client_configs xGrowth.dataSources): 'mac' (free, bird) | 'x-api' (paid).
// The group is paid only when its source is 'x-api'. dataSources comes from ctx.dataSources / selection.dataSources.
export const SOURCE_KEY_OF_GROUP = Object.freeze({ 'strategy-accounts': 'strategyAccounts', 'quote-targets': 'quoteTargets' });
export function isXApiSource(groupId, dataSources) {
  const key = SOURCE_KEY_OF_GROUP[groupId];
  return !!key && dataSources?.[key] === 'x-api';
}

// selection = { ids: string[], todayWithModel: boolean } -> [{ id, label, cost }] for the paid groups selected.
// Group 5 counts as paid only when its "with model copy" option is on.
// Optional ctx attaches `estimate` (see estimateFor) to each row; without it the output is unchanged.
export function paidGroupsFor(selection, ctx) {
  const ids = Array.isArray(selection?.ids) ? selection.ids : [];
  const withModel = !!selection?.todayWithModel;
  return REFRESH_GROUPS
    .filter((g) => ids.includes(g.id))
    .filter((g) => g.paid || (g.id === 'today-queue' && withModel) || isXApiSource(g.id, selection?.dataSources ?? ctx?.dataSources))
    .map((g) => ({
      id: g.id,
      label: g.label,
      cost: g.id === 'today-queue' ? 'Model calls for draft copy' : SOURCE_KEY_OF_GROUP[g.id] ? sourceCostText(g.id, selection?.dataSources ?? ctx?.dataSources) : g.cost,
      ...(ctx ? { estimate: estimateFor(g.id, { ...ctx, dataSources: selection?.dataSources ?? ctx?.dataSources, todayWithModel: withModel }) } : {}),
    }));
}

// ---------------------------------------------------------------------------
// Live cost estimate per group. Pure; DISPLAY ONLY (never gates or triggers a spend).
// ctx (every field optional) = { marketingBriefConfig, analysisRecipes, xMonitorState, todayWithModel, todaySlots }.
// Returns { text, usd: number|null, calls?: number }.
//
// Dollar rule: usd is set ONLY from documented unit costs. If a group has any cost component
// with no documented dollar figure, usd is the partial known figure and the text is prefixed
// "≥~$" (a floor, never a guess); if nothing is documented usd is null and no dollars are shown.
//   - Scout run ~ $0.10 flat per run (MARKET-SIGNALS-AND-SCOUT-PROJECTION.md section 1b).
//   - NOT documented (count only, no dollars): ScrapeCreators credits, per-skill model calls
//     (only one validated recipe run ~ $0.019 is recorded, not a per-skill rate), X API per-call
//     price (X-API-AND-PROFILE-OPERATIONS.md / X-MONITOR-CARD.md give call counts only), Claude
//     per-slot copy cost, render cost.
// ---------------------------------------------------------------------------
const SCOUT_RUN_USD = 0.1;

function sourceCostText(groupId, dataSources) {
  if (isXApiSource(groupId, dataSources)) return 'Paid X API — calls and posts counted in the estimate';
  return groupId === 'quote-targets' ? 'Free — scanned on the Mac (launchd) via bird' : 'Free — Mac worker via bird';
}
const money = (n) => `$${n.toFixed(2)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function listOf(v) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
  return arr.map((x) => String(x || '').replace(/^@/, '').trim()).filter(Boolean);
}

function countSkills(ctx) {
  const list = Array.isArray(ctx?.analysisRecipes) ? ctx.analysisRecipes : ctx?.marketingBriefConfig?.analysisRecipes;
  return Array.isArray(list) ? list.filter(Boolean).length : null;
}

export function estimateFor(groupId, ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const cfg = c.marketingBriefConfig && typeof c.marketingBriefConfig === 'object' ? c.marketingBriefConfig : null;
  const group = REFRESH_GROUPS.find((g) => g.id === groupId);
  const fallback = { text: group?.cost || '', usd: null };

  switch (groupId) {
    case 'market-signals': {
      if (!cfg) return fallback;
      // Group 1 runs no paid X search, so the X platform is not counted as a source here.
      const sources = Array.isArray(cfg.sourcePlatforms) ? cfg.sourcePlatforms.filter((p) => p && p !== 'x').length : null;
      const parked = new Set(listOf(cfg.kolsOff).map((h) => h.toLowerCase()));
      const handles = listOf(cfg.kols).filter((h) => !parked.has(h.toLowerCase())).length;
      const skills = countSkills(c);
      const parts = [];
      if (sources !== null) parts.push(plural(sources, 'source', 'sources'));
      parts.push(plural(handles, 'handle', 'handles'));
      if (skills !== null) parts.push(plural(skills, 'skill', 'skills'));
      // Scout $0.10 is documented; ScrapeCreators credits and skill model calls are not -> floor.
      parts.push(`≥~${money(SCOUT_RUN_USD)}`);
      return { text: parts.join(' · '), usd: SCOUT_RUN_USD };
    }
    case 'x-search': {
      const os = cfg?.opportunitySignals;
      if (!os || !Array.isArray(os.queries)) return fallback;
      const enabled = os.queries.filter((q) => q && q.enabled !== false && q.query).length;
      const cap = Number(os.maxQueriesPerRun) > 0 ? Number(os.maxQueriesPerRun) : 4;
      const calls = Math.min(enabled, cap);
      return { text: `about ${plural(calls, 'paid X call', 'paid X calls')}`, usd: null, calls };
    }
    case 'analysis': {
      const skills = countSkills(c);
      if (skills === null) return fallback;
      return { text: `Model calls · ${plural(skills, 'skill', 'skills')} on`, usd: null };
    }
    case 'strategy-accounts': {
      if (!isXApiSource('strategy-accounts', c.dataSources)) return { text: 'free', usd: 0 };
      const x = cfg?.xGrowth;
      const handles = [x?.ownHandle, ...(Array.isArray(x?.benchmarkHandles) ? x.benchmarkHandles : [])].filter(Boolean).length;
      const e = estimateCorporaPull({ handles });
      return { text: `paid X API · up to ${plural(e.calls, 'call', 'calls')} · ${e.maxPosts.toLocaleString('en-US')} posts max`, usd: null, calls: e.calls, maxPosts: e.maxPosts };
    }
    case 'quote-targets': {
      if (!isXApiSource('quote-targets', c.dataSources)) return { text: 'free', usd: 0 };
      const accounts = Array.isArray(cfg?.xGrowth?.watchlist) ? cfg.xGrowth.watchlist.length : 0;
      const e = estimateQuoteScan({ accounts });
      return { text: `paid X API · up to ${plural(e.calls, 'call', 'calls')} · ${e.maxPosts.toLocaleString('en-US')} posts max`, usd: null, calls: e.calls, maxPosts: e.maxPosts };
    }
    case 'today-queue': {
      if (!c.todayWithModel) return { text: 'free', usd: 0 };
      const n = Number(c.todaySlots);
      return {
        text: Number.isFinite(n) && n >= 0 ? `1 Claude call per slot · ${plural(n, 'slot', 'slots')}` : '1 Claude call per slot',
        usd: null,
        ...(Number.isFinite(n) && n >= 0 ? { calls: n } : {}),
      };
    }
    case 'x-monitor': {
      // sync-all = profile (1) + posts (1) + audience (1 per 1,000 followers, min 1) per X-MONITOR-CARD.md.
      const st = c.xMonitorState;
      const followers = Number(st?.profile?.followers ?? st?.followers ?? st?.account?.profile?.followers);
      const pages = Math.max(1, Math.ceil((Number.isFinite(followers) ? followers : 0) / 1000));
      const calls = 2 + pages;
      return { text: `${calls} metered X calls`, usd: null, calls };
    }
    default:
      return fallback;
  }
}

const LAST_KEY = 'marketing-refresh-last-v1';

export function readLastRefreshed() {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function markGroupRefreshed(id) {
  try {
    const next = { ...readLastRefreshed(), [id]: new Date().toISOString() };
    window.localStorage.setItem(LAST_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — last-refreshed simply isn't remembered */
  }
}

// ---------------------------------------------------------------------------
// Freshness per group. Pure. Server asOf (when provided) wins over the per-viewer
// "last refreshed" memory only if it is newer; with neither, asOf is null.
// -> { asOf: ISO|null, ageHours: number|null, stale: boolean, source: 'server'|'local'|null }
// A group with no known asOf is stale. Default threshold is 24h.
// ---------------------------------------------------------------------------
export const DEFAULT_STALE_HOURS = 24;

export function groupFreshness(groupId, { lastRefreshed, serverAsOf, now, staleAfterHours } = {}) {
  const ts = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const local = ts(lastRefreshed?.[groupId]);
  const server = ts(serverAsOf?.[groupId]);
  const nowMs = Number.isFinite(now) ? now : ts(now) ?? Date.now();
  let best = null; let source = null;
  if (server !== null) { best = server; source = 'server'; }
  if (local !== null && (best === null || local > best)) { best = local; source = 'local'; }
  if (best === null) return { asOf: null, ageHours: null, stale: true, source: null };
  const ageHours = Math.max(0, (nowMs - best) / 3600000);
  const limit = Number(staleAfterHours) > 0 ? Number(staleAfterHours) : DEFAULT_STALE_HOURS;
  return { asOf: new Date(best).toISOString(), ageHours, stale: ageHours > limit, source };
}
