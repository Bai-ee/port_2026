// Scheduled (cron) daily loop: runs the loop for every pilot client with NO model drafter, so a scheduled run
// is fallback copy only and spends nothing. Reads the latest saved scan; never calls bird or the X API.
// Decides which clients run and what the cron reports; auth, Firestore and input loading are injected by the route.

import { createRequire } from 'node:module';
import { runDailyLoop } from './run.js';

const { safeSecretEquals } = createRequire(import.meta.url)('../../../api/_lib/auth.cjs');

const isProduction = (env) => (env.VERCEL_ENV && env.VERCEL_ENV !== 'development') || env.NODE_ENV === 'production';

/**
 * Cron auth: Bearer CRON_SECRET when set; production (incl. Vercel previews) without a secret fails closed;
 * local dev accepts Vercel's cron header only. Returns true when the caller may run the loop.
 */
export function cronAuthorized({ authorization = '', vercelCron = '' } = {}, env = process.env) {
  if (env.CRON_SECRET) return safeSecretEquals(authorization, `Bearer ${env.CRON_SECRET}`);
  if (isProduction(env)) return false;
  return vercelCron === '1';
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/** PILOT_CLIENT_IDS as a list. Unset/empty => fail closed (503): the cron never guesses a client. */
export function pilotClientIds(env = process.env) {
  const ids = list(env.PILOT_CLIENT_IDS);
  if (!ids.length) throw Object.assign(new Error('PILOT_CLIENT_IDS is not set; the scheduled daily loop is disabled.'), { status: 503, code: 'pilot-not-configured' });
  return ids;
}

/**
 * deps: { store, readInputsFor(clientId) -> inputs, now?(), runLoop?(deps, opts) }
 * No `draft` is ever passed to the loop; the model path does not exist here.
 */
export async function runScheduledDailyLoop(deps, { clientIds }) {
  const runLoop = deps.runLoop || runDailyLoop;
  const results = [];
  for (const clientId of clientIds) {
    try {
      const res = await runLoop(
        { now: deps.now || (() => Date.now()), store: deps.store, readInputs: () => deps.readInputsFor(clientId) },
        { clientId, inputSource: 'live' },
      );
      results.push({
        clientId, ok: true, skipped: !!res.skipped, reason: res.reason || null,
        suggestions: res.run?.suggestions?.length ?? 0, modelCalls: res.run?.usage?.modelCalls ?? 0, copySource: res.run?.copySource || null,
      });
    } catch (err) {
      results.push({ clientId, ok: false, error: String(err?.message || err).slice(0, 200), status: err?.status || 500 });
    }
  }
  return results;
}
