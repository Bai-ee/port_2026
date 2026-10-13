// One server-side content context for the daily runner AND the strategy chat.
// Wraps loadDailyLoopInputs (the runner's loader, unchanged) and adds: the plan doc read ONCE,
// a per-input status list (source / asOf / usable / caveats), and a versions hash so two callers
// can prove they resolved the same inputs. Read-only; I/O only through injected deps.

import { createHash } from 'node:crypto';
import { loadDailyLoopInputs } from '../x-content-inventory/daily-loop/inputs.js';
import { resolvePlanInputs } from '../x-strategy/plan-inputs.js';
import { mergeEngineConfig } from '../x-content-inventory/engine-quota.js';

// Same thresholds the Strategy tab already uses for "stale" (contracts.js: 7 days) and the scan banner.
export const CORPUS_STALE_DAYS = 7;
export const SCAN_STALE_HOURS = 48;
const TIER_1_LIMIT = 7;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const iso = (v) => {
  if (!v) return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const entry = (id, label, { source, asOf = null, usable, caveats = [], version = null, scope = 'client' }) => (
  { id, label, source, asOf: iso(asOf), usable: !!usable, caveats: caveats.filter(Boolean), version, scope }
);

/** Pure: turn the loader output into the status list. Exported for tests. */
export function describeContentInputs({ raw, planDoc, planInputs, brainError = null, now, strategyDoc }) {
  const out = [];

  // Strategy document: listed only when the caller wires readStrategyDoc (undefined = not wired, unchanged hash).
  if (strategyDoc !== undefined) {
    const confirmed = !!strategyDoc?.confirmed;
    out.push(entry('strategy-doc', 'Strategy document', {
      source: 'x_strategy_docs',
      asOf: strategyDoc?.updatedAt || null,
      usable: confirmed,
      version: strategyDoc?.version ?? null,
      caveats: [
        !strategyDoc ? 'No strategy document saved: drafts follow the measured rules only.' : '',
        strategyDoc && !confirmed ? 'Strategy document is a draft: not used until the owner confirms it.' : '',
      ],
    }));
  }

  // Executable plan
  const planCaveats = [];
  if (planInputs.source === 'default') planCaveats.push('No saved plan: legacy defaults decide cadence.');
  if (Number(planInputs.authoredPerDay) > TIER_1_LIMIT) {
    planCaveats.push(`Plan asks for ${planInputs.authoredPerDay} posts/day; the daily runner caps at ${TIER_1_LIMIT}.`);
  }
  out.push(entry('plan', 'Executable plan', {
    source: planInputs.source === 'plan-doc' ? 'x_strategy_plans' : 'defaults',
    asOf: planDoc?.updatedAt || null,
    usable: true,
    version: planInputs.planVersion,
    caveats: planCaveats,
  }));

  // Brain
  const b = raw.brain || {};
  const brainApproved = b.status === 'approved';
  const brainCaveats = [];
  if (!brainApproved) brainCaveats.push(`Brain is ${b.status || 'missing'}: not used. Voice is plain/demo fallback, not approved brand output.`);
  if (b.note) brainCaveats.push(b.note);
  if (brainApproved && brainError) brainCaveats.push(`Approved Brain context failed to load (${brainError}); treated as unusable.`);
  else if (brainApproved && !b.context) brainCaveats.push('Approved Brain returned no context for social posts.');
  out.push(entry('brain', 'Client Brain', {
    source: 'clients/{id}/client_brain/current',
    asOf: b.updatedAt,
    usable: brainApproved && !!b.context && !brainError,
    version: b.version ?? null,
    caveats: brainCaveats,
  }));

  // Strategy Builder (campaign intent only)
  const sp = raw.strategyPlan;
  const sbCaveats = [];
  if (sp?.excluded) sbCaveats.push(`Excluded: ${sp.excluded}.`);
  const perDay = Number(sp?.postsPerDay);
  if (sp && !sp.excluded && Number.isFinite(perDay) && Number.isFinite(Number(planInputs.authoredPerDay)) && perDay !== Number(planInputs.authoredPerDay)) {
    sbCaveats.push(`Campaign asks ${perDay} posts/day but the saved plan says ${planInputs.authoredPerDay}. The plan wins; adjust one of them.`);
  }
  out.push(entry('strategy-builder', 'Campaign (Strategy Builder)', {
    source: 'dashboard_state.strategyBuilder.lastPlan',
    asOf: sp?.generatedAt || null,
    usable: !!sp && !sp.excluded,
    caveats: sp ? sbCaveats : ['No campaign plan saved.'],
  }));

  // Scan
  const scan = raw.scan;
  const scanAgeRaw = scan?.generatedAt ? (now - Date.parse(scan.generatedAt)) / HOUR_MS : null;
  const scanAge = Number.isFinite(scanAgeRaw) ? scanAgeRaw : null;
  const scanUnknown = !!scan && scanAge == null;
  const scanStale = scanAge != null && scanAge > SCAN_STALE_HOURS;
  out.push(entry('scan', 'Quote/reply scan', {
    source: 'dashboard_state.marketingBrief.quoteTargets',
    asOf: scan?.generatedAt,
    usable: !!scan && !scanStale && !scanUnknown,
    caveats: [!scan && 'No scan stored.', scanUnknown && 'Scan has no readable timestamp: age unknown.', scanStale && `Scan is ${Math.round(scanAge)}h old (stale after ${SCAN_STALE_HOURS}h).`],
  }));

  // Corpora
  const ownTo = raw.ownSummary?.range?.to || null;
  const ownAgeRaw = ownTo ? (now - Date.parse(ownTo)) / DAY_MS : null;
  const ownAge = Number.isFinite(ownAgeRaw) ? ownAgeRaw : null;
  const ownStale = ownAge != null && ownAge > CORPUS_STALE_DAYS;
  out.push(entry('corpora', 'Own + benchmark corpora', {
    source: raw.ownSummary?.source || 'none',
    asOf: ownTo,
    usable: !!raw.ownSummary,
    scope: 'handle',
    caveats: [
      !raw.ownSummary && 'No own corpus.',
      ownTo && ownAge == null && 'Own corpus has no readable end date: age unknown.',
      'Corpora follow the configured X handles (defaults to the owner account), not necessarily this client.',
      ownStale && `Own corpus ends ${Math.round(ownAge)}d ago (stale after ${CORPUS_STALE_DAYS}d).`,
      raw.ownSummary && !raw.benchmark && 'No benchmark corpus: comparison unavailable.',
      'Lift is likes-based.',
    ],
  }));

  // Posting queue (what is already scheduled/posted): without it recommendations can conflict with the schedule.
  if (raw.queueChecked) {
    out.push(entry('queue', 'Posting queue', {
      source: 'social_posts',
      usable: !raw.recentPostsError,
      caveats: [raw.recentPostsError && `The queue could not be read (${raw.recentPostsError}): recommendations are paused until it can.`],
    }));
  }

  // Inventory
  out.push(entry('inventory', 'Content inventory', {
    source: 'x_content_packages',
    usable: (raw.packages || []).length > 0,
    scope: 'global',
    caveats: [`${raw.libraryNote}; inventory is shared across clients (not client-scoped).`],
  }));

  return out;
}

/** Stable digest of the versions that decide a run; equal for two callers that saw the same inputs. */
export function contentVersions({ inputs, now }) {
  const parts = Object.fromEntries(inputs.map((i) => [i.id, `${i.version ?? ''}|${i.asOf ?? ''}|${i.usable ? 1 : 0}`]));
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
  return { ...parts, hash, asOf: iso(now) };
}

/**
 * deps: loadDailyLoopInputs deps ({db, loadBrainContext, buildDayPlan?, readPlanDoc?}).
 * opts: { clientId, now?, packageIds?, corpora? } as loadDailyLoopInputs.
 * Returns { clientId, now, raw, plan, inputs, versions }. `raw` is exactly the runner's legacy input shape.
 */
export async function loadContentContext(deps, { clientId, now = Date.now(), packageIds = null, corpora = {} } = {}) {
  if (!clientId) throw new Error('loadContentContext requires clientId');
  // The plan doc is read once and shared by the runner input and the status list.
  const planDoc = deps.readPlanDoc ? await deps.readPlanDoc(clientId) : null;
  // Strategy document (x_strategy_docs): undefined when not wired, so older callers see no change.
  const strategyDoc = deps.readStrategyDoc ? (await deps.readStrategyDoc(clientId)) ?? null : undefined;
  let brainError = null;
  const raw = await loadDailyLoopInputs({
    ...deps,
    readPlanDoc: async () => planDoc,
    loadBrainContext: deps.loadBrainContext
      ? async (id) => {
        try { return await deps.loadBrainContext(id); } catch (err) { brainError = err?.message || 'load failed'; return ''; }
      }
      : undefined,
  }, { clientId, now, packageIds, corpora });
  if (strategyDoc !== undefined) raw.strategyDoc = strategyDoc;
  const planInputs = resolvePlanInputs(planDoc);
  const inputs = describeContentInputs({ raw, planDoc, planInputs, brainError, now, strategyDoc });
  return {
    clientId,
    now,
    raw,
    plan: { doc: planDoc, inputs: planInputs, version: planInputs.planVersion, source: planInputs.source },
    inputs,
    versions: contentVersions({ inputs, now }),
  };
}

/** Compact, model/UI-safe view: no packages or rows. */
export function summarizeContentContext(ctx) {
  return {
    clientId: ctx.clientId,
    asOf: ctx.versions.asOf,
    versions: ctx.versions,
    plan: { source: ctx.plan.source, version: ctx.plan.version, authoredPerDay: ctx.plan.inputs.authoredPerDay, typeFloors: ctx.plan.inputs.typeFloors, typeCaps: ctx.plan.inputs.typeCaps },
    inputs: ctx.inputs,
  };
}

/**
 * Week calendar engine config: the saved plan's engine targets win when a plan doc exists;
 * otherwise the legacy global `content_system_config/x` override applies unchanged.
 */
export function resolveCalendarEngineConfig({ planDoc, legacyOverrides }) {
  const planInputs = resolvePlanInputs(planDoc);
  if (planInputs.source === 'plan-doc' && planInputs.engineConfig) return planInputs.engineConfig;
  return mergeEngineConfig(legacyOverrides);
}
