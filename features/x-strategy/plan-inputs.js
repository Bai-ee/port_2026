// plan-inputs.js - the ONE place a Strategy plan doc (x_strategy_plans/{clientId}) becomes planner inputs.
// Every consumer (Plan tab route, refresh-analysis, the daily loop, the Strategy tab preview) calls this, so
// "what is the plan" has a single answer. Pure and client-safe: no I/O.
//
// null (no plan doc) -> EXACTLY today's behaviour: posts undefined (the engine default), engineConfig
// undefined, the S6 quote-react floor, no caps. That equivalence is pinned by the t5-golden tests.

import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';
import { DEFAULT_TYPE_FLOORS } from '../x-content-inventory/daily-loop/slots.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 1;

/**
 * @param {{version?:number, plan?:object}|null|undefined} planDoc  a x_strategy_plans doc, or null when none exists
 * @returns {{
 *   posts: number|undefined, engineConfig: object|undefined, typeFloors: object, typeCaps: object,
 *   benchmarkPrimary: string|null, source: 'plan-doc'|'default', planVersion: number|null, authoredPerDay: number|null
 * }}
 */
export function resolvePlanInputs(planDoc) {
  const plan = planDoc && isPlain(planDoc.plan) ? planDoc.plan : null;
  if (!plan) {
    return {
      posts: undefined, engineConfig: undefined, typeFloors: { ...DEFAULT_TYPE_FLOORS }, typeCaps: {},
      benchmarkPrimary: null, source: 'default', planVersion: null, authoredPerDay: null,
    };
  }
  const authored = isCount(plan.authoredPerDay) ? plan.authoredPerDay : undefined;
  const targets = isPlain(plan.engineTargets) && Object.keys(plan.engineTargets).length ? plan.engineTargets : null;
  return {
    posts: authored,
    // Only a non-empty override is merged: an empty map must leave buildDayPlan's own default config untouched.
    engineConfig: targets ? mergeEngineConfig(targets) : undefined,
    // An explicit {} floors map means "no floors" and is honoured; only a MISSING map falls back to the default.
    typeFloors: isPlain(plan.typeFloors) ? { ...plan.typeFloors } : { ...DEFAULT_TYPE_FLOORS },
    typeCaps: isPlain(plan.typeCaps) ? { ...plan.typeCaps } : {},
    benchmarkPrimary: typeof plan.benchmarkPrimary === 'string' && plan.benchmarkPrimary ? plan.benchmarkPrimary : null,
    source: 'plan-doc',
    planVersion: Number.isInteger(planDoc.version) ? planDoc.version : null,
    authoredPerDay: authored ?? null,
  };
}
