// Unified Refresh — group catalog + per-viewer "last refreshed" memory.
// Pure data/helpers (no React). See docs/plans/MARKETING-DIRECTOR-UNIFICATION-MASTER-PLAN.md section 5.

export const REFRESH_GROUPS = [
  { id: 'market-signals', n: 1, label: 'Market signals', updates: 'Scout brief, watchlist timelines, analysis skills (no X search)', cost: 'Scout ≈$0.10 + ScrapeCreators credits + model calls', paid: true, defaultOn: false },
  { id: 'x-search', n: 2, label: 'X search', updates: 'Opportunity Signals on X (and Market Talk on X if enabled in the digest)', cost: 'Paid X API — about 1 call per enabled Opportunity query row; if Market Talk is on in the digest it also runs Scout + ScrapeCreators searches', paid: true, defaultOn: false },
  { id: 'analysis', n: 3, label: 'Analysis', updates: 'Reddit / Instagram / opportunity analyzers, strategy and reply targets, brief summaries, hosted brief', cost: 'Model calls', paid: true, defaultOn: false },
  { id: 'strategy-accounts', n: 4, label: 'Strategy accounts', updates: 'Posts for you and every benchmark account', cost: 'Free — Mac worker via bird', paid: false, defaultOn: false },
  { id: 'today-queue', n: 5, label: 'Today and queue', updates: "Today's suggestions, month calendar, post results", cost: 'Free (model copy is paid, optional)', paid: false, defaultOn: false },
  { id: 'x-monitor', n: 6, label: 'X Monitor', updates: 'Profile counters, posts, follower roster for the connected account', cost: 'Paid X API — about 2 metered calls plus 1 per 1,000 followers', paid: true, defaultOn: false },
  { id: 'renders', n: 7, label: 'Renders', updates: 'Creative and video modules', cost: 'Render cost (studio/video)', paid: true, defaultOn: false },
];

// selection = { ids: string[], todayWithModel: boolean } -> [{ id, label, cost }] for the paid groups selected.
// Group 5 counts as paid only when its "with model copy" option is on.
export function paidGroupsFor(selection) {
  const ids = Array.isArray(selection?.ids) ? selection.ids : [];
  const withModel = !!selection?.todayWithModel;
  return REFRESH_GROUPS
    .filter((g) => ids.includes(g.id))
    .filter((g) => g.paid || (g.id === 'today-queue' && withModel))
    .map((g) => ({
      id: g.id,
      label: g.label,
      cost: g.id === 'today-queue' ? 'Model calls for draft copy' : g.cost,
    }));
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
