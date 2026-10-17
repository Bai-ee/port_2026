// context.js — who is making the X call? AsyncLocalStorage tag so every v2 call inside
// withXUsage({clientId, source}, fn) is attributed without threading args through callers.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

export const USAGE_SOURCES = Object.freeze([
  'strategy-accounts', 'quote-targets', 'x-monitor', 'opportunity-signals', 'market-talk', 'posting', 'other',
]);

/** Run fn with a usage tag. Nested tags inherit the outer clientId/source unless overridden. */
export function withXUsage(tag, fn) {
  const outer = als.getStore() || {};
  const next = { ...outer };
  if (tag?.clientId) next.clientId = String(tag.clientId);
  if (tag?.source) next.source = String(tag.source);
  return als.run(next, fn);
}

export function getXUsageContext() {
  return als.getStore() || {};
}
