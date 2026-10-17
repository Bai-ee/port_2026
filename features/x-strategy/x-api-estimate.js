// Cost estimators for the X API data sources. Pure and client-safe (no imports): the Refresh panel and the agent read
// them to show "N calls · up to M posts" BEFORE anything runs. No network, no pricing guess (dollars come from the ledger rate).

export const PAGE_SIZE = 100;
export const DEFAULT_MAX_PER_HANDLE = 300;   // strategy accounts: 3 timeline pages per handle
export const HARD_MAX_PER_HANDLE = 1000;
export const DEFAULT_MAX_ACCOUNTS = 15;      // quote scan accounts per run
export const DEFAULT_PER_HANDLE = 12;        // quote scan posts per account (X minimum per call is 5)

export const clampMaxPerHandle = (n) => Math.max(5, Math.min(HARD_MAX_PER_HANDLE, Math.floor(Number(n) || DEFAULT_MAX_PER_HANDLE)));
export const clampPerHandle = (n) => Math.max(5, Math.min(PAGE_SIZE, Math.floor(Number(n) || DEFAULT_PER_HANDLE)));

const count = (v) => (Array.isArray(v) ? v.length : Math.max(0, Number(v) || 0));
const cachedOf = (n, c) => Math.max(0, Math.min(n, Number(c) || 0));

/**
 * Strategy accounts pull. Per handle: 1 users/by/username lookup (0 when its id is cached) + ceil(maxPerHandle/100) timeline pages.
 * @returns {{handles:number, lookups:number, timelineCalls:number, calls:number, maxPosts:number}}
 */
export function estimateCorporaPull({ handles = 0, maxPerHandle = DEFAULT_MAX_PER_HANDLE, cachedIds = 0 } = {}) {
  const n = count(handles);
  const pages = Math.ceil(clampMaxPerHandle(maxPerHandle) / PAGE_SIZE);
  const lookups = n - cachedOf(n, cachedIds);
  const timelineCalls = n * pages;
  return { handles: n, lookups, timelineCalls, calls: lookups + timelineCalls, maxPosts: n * pages * PAGE_SIZE };
}

/**
 * Quote-target scan. Per account: 1 lookup (0 when cached) + 1 timeline call of perHandle posts (start_time = the 36h window).
 * Accounts per run are capped by maxAccounts (0 = no cap).
 * @returns {{accounts:number, lookups:number, timelineCalls:number, calls:number, maxPosts:number}}
 */
export function estimateQuoteScan({ accounts = 0, perHandle = DEFAULT_PER_HANDLE, cachedIds = 0, maxAccounts = DEFAULT_MAX_ACCOUNTS } = {}) {
  const total = count(accounts);
  const n = maxAccounts ? Math.min(total, maxAccounts) : total;
  const lookups = n - cachedOf(n, cachedIds);
  return { accounts: n, lookups, timelineCalls: n, calls: lookups + n, maxPosts: n * clampPerHandle(perHandle) };
}
