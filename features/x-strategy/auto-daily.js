// Daily-loop cron step: refresh the X data sets that the owner switched to the paid X API AND turned "Auto daily" on for
// (client_configs xGrowth.dataSources.autoDaily). Everything else is skipped, so a default client (all 'mac') costs nothing.
// Guarded and non-fatal: every client/data set reports its own outcome and an error never throws. The pullers themselves
// call assertXBudget (the daily cap) before each request, so the cron can never run past the cap.
// Pure orchestration: the readers/pullers are injected (app/api/worker/daily-loop/route.js wires the real ones).
import { normalizeDataSources } from './data-sources.js';

const brief = (r) => ({
  ok: r?.ok === true, calls: r?.calls ?? 0, posts: r?.posts ?? 0, ...(r?.stopped ? { stopped: r.stopped } : {}), ...(r?.error ? { error: String(r.error).slice(0, 160) } : {}),
  ...(r?.wrote !== undefined ? { wrote: r.wrote } : {}),
});

/**
 * @param {string[]} clientIds
 * @param {{readDataSources:(id:string)=>Promise<object|null>, pullCorpora:(id:string)=>Promise<object>, scanQuotes:(id:string)=>Promise<object>}} deps
 * @returns {Promise<{clientId:string, strategyAccounts:object, quoteTargets:object}[]>}  array; `.budgetStopped` is set when the cap ended the step
 */
export async function runAutoDailyXApi(clientIds, { readDataSources, pullCorpora, scanQuotes } = {}) {
  const out = [];
  for (const clientId of Array.isArray(clientIds) ? clientIds : []) {
    const row = { clientId, strategyAccounts: { skipped: 'off' }, quoteTargets: { skipped: 'off' } };
    out.push(row);
    let ds;
    try { ds = normalizeDataSources(await readDataSources(clientId)); } catch (err) {
      row.strategyAccounts = row.quoteTargets = { ok: false, error: `could not read data sources: ${String(err?.message || err).slice(0, 120)}` };
      continue;
    }
    for (const [key, run] of [['strategyAccounts', pullCorpora], ['quoteTargets', scanQuotes]]) {
      if (ds[key] !== 'x-api' || ds.autoDaily[key] !== true) continue;
      try { row[key] = brief(await run(clientId)); } catch (err) { row[key] = { ok: false, error: String(err?.message || err).slice(0, 160) }; }
      // A budget stop ends the whole step: no later client or data set may spend past the cap.
      if (row[key].stopped === 'x-budget') return Object.assign(out, { budgetStopped: true });
    }
  }
  return out;
}
