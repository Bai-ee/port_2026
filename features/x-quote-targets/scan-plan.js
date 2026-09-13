// Decide which accounts to fetch when several clients are being scanned.
//
// The single-client scan fetches its watchlist top-down. With N clients that
// becomes N independent sweeps, and the measured ceiling is brutal: a 39-account
// sweep returned 429 on 32 of them. Two clients who both benchmark against the
// same account would also fetch the same timelines twice for no reason.
//
// So the budget is shared, not per-client: one fetch per unique account, ranked
// by how much it is worth across every client that wants it, capped, and the
// result fanned back out to each client afterwards.
//
// Pure: no fs, no network, no clock.

/** How many accounts one sweep may fetch. The default matches the single-client
 * scanner's own cap, which exists because X rate-limits past roughly this. */
export const DEFAULT_BUDGET = 15;

function cleanHandle(v) {
  return String(v ?? '').trim().replace(/^@+/, '');
}

/**
 * Build a fetch plan for a set of clients.
 *
 * @param {object[]} clients - [{ clientId, accounts: [{handle, vein, weight, unproven}] }]
 * @param {object} [opts]
 * @param {number} [opts.budget=DEFAULT_BUDGET] - max unique accounts to fetch
 * @param {number} [opts.offset=0] - rotate the cut, so accounts below the line
 *   on one run are above it on the next rather than never being scanned
 * @returns {{fetch: object[], skipped: object[], byClient: Record<string,string[]>, meta: object}}
 */
export function buildScanPlan(clients, opts = {}) {
  const list = (Array.isArray(clients) ? clients : []).filter((c) => c && c.clientId);
  const budget = Number.isFinite(opts.budget) ? Math.max(1, Math.trunc(opts.budget)) : DEFAULT_BUDGET;
  const offset = Number.isFinite(opts.offset) ? Math.trunc(opts.offset) : 0;

  /** @type {Map<string, {handle:string, vein:string|null, clients:Set<string>, weight:number, unproven:boolean}>} */
  const accounts = new Map();
  const byClient = {};

  for (const client of list) {
    const wanted = [];
    for (const account of Array.isArray(client.accounts) ? client.accounts : []) {
      const handle = cleanHandle(account?.handle);
      if (!handle) continue;
      const key = handle.toLowerCase();
      wanted.push(handle);
      const cur = accounts.get(key) ?? {
        handle, vein: account?.vein ?? null, clients: new Set(), weight: 0, unproven: true,
      };
      cur.clients.add(client.clientId);
      // Weight sums across clients: an account two clients want is worth more
      // of the shared budget than one only a single client wants, even if that
      // one client rates it slightly higher.
      cur.weight += Number.isFinite(account?.weight) ? account.weight : 0;
      // Proven for anyone is proven for the sweep — the flag marks accounts
      // with no measured evidence behind them at all.
      if (account?.unproven !== true) cur.unproven = false;
      if (!cur.vein && account?.vein) cur.vein = account.vein;
      accounts.set(key, cur);
    }
    byClient[client.clientId] = wanted;
  }

  const ranked = [...accounts.values()]
    .map((a) => ({ ...a, clients: [...a.clients] }))
    .sort((a, b) => (
      // Shared accounts first, then measured value, then proven before
      // unproven, then alphabetical so the order never depends on Map
      // insertion.
      b.clients.length - a.clients.length
      || b.weight - a.weight
      || Number(a.unproven) - Number(b.unproven)
      || a.handle.localeCompare(b.handle)
    ));

  let ordered = ranked;
  if (offset && ranked.length > budget) {
    // Rotate only the part of the list that does not fit anyway, so a rotation
    // never pushes a shared, high-value account out of a sweep.
    const head = ranked.slice(0, Math.min(budget, ranked.length) - 1);
    const tail = ranked.slice(head.length);
    const start = ((offset % tail.length) + tail.length) % tail.length;
    ordered = [...head, ...tail.slice(start), ...tail.slice(0, start)];
  }

  const fetch = ordered.slice(0, budget);
  const skipped = ordered.slice(budget);
  const fetchKeys = new Set(fetch.map((a) => a.handle.toLowerCase()));

  return {
    fetch,
    skipped,
    byClient,
    meta: {
      clients: list.length,
      uniqueAccounts: accounts.size,
      // The whole point of sharing: how many fetches N per-client sweeps would
      // have cost against what this plan actually spends.
      naiveFetches: list.reduce((sum, c) => sum + (Array.isArray(c.accounts) ? c.accounts.length : 0), 0),
      plannedFetches: fetch.length,
      budget,
      offset,
      // A client whose every account fell below the cut gets nothing this run
      // and must be told, rather than silently receiving an empty scan.
      starvedClients: list
        .map((c) => c.clientId)
        .filter((id) => !fetch.some((a) => a.clients.includes(id))),
    },
  };
}

/**
 * Split one pooled set of posts back out per client.
 *
 * @param {object[]} posts - everything fetched this sweep
 * @param {object} plan - buildScanPlan() output
 * @returns {Record<string, object[]>} clientId -> the posts that client asked for
 */
export function partitionPool(posts, plan) {
  const out = {};
  const wantedBy = new Map();
  for (const account of plan?.fetch ?? []) {
    wantedBy.set(account.handle.toLowerCase(), account.clients);
  }
  for (const clientId of Object.keys(plan?.byClient ?? {})) out[clientId] = [];

  for (const post of Array.isArray(posts) ? posts : []) {
    const author = cleanHandle(post?.author?.username).toLowerCase();
    const clients = wantedBy.get(author);
    if (!clients) continue;
    for (const clientId of clients) {
      if (!out[clientId]) out[clientId] = [];
      out[clientId].push(post);
    }
  }
  return out;
}
