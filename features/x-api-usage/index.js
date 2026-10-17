// STUB — replaced by LEDGER at merge (feat/x-src-ledger owns features/x-api-usage/index.js).
// Exact exports SOURCES codes against: withXUsage, assertXBudget, XBudgetError.
export class XBudgetError extends Error {
  constructor(message = 'X API budget exceeded.') {
    super(message);
    this.name = 'XBudgetError';
    this.code = 'x-budget';
  }
}
/** Run fn inside a usage tag ({clientId, source}). Stub: no tagging. */
export function withXUsage(_tag, fn) { return fn(); }
/** Throws XBudgetError when today's posts + estimatePosts would pass the cap. Stub: never throws. */
export async function assertXBudget(_opts) { return { ok: true }; }
