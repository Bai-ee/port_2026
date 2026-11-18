// module-toggle.mjs - the one writer for a module card's on/off switch (used by POST /api/dashboard/modules/config and by
// the MCP settings tool modules.<cardId>.enabled). Pure: the db and the timestamp value are injected.
//
// BUG FIXED (2026-11): the route used set({ 'moduleConfig.<id>.enabled': v }, { merge: true }). set() treats a dotted
// key as a LITERAL top-level field name (only update() parses dot paths), so the nested value that modules/run, the
// daily refresh and the dashboard bootstrap read (moduleConfig[id].enabled) never changed. The write below uses the nested form.
//
// No read fallback for the old literal keys on purpose: no reader ever honoured them, so they never took effect; honouring
// them now would silently switch on cards the owner toggled long ago (and daily refreshes spend on enabled cards).
// Old literal keys are left in place and ignored (no migration).
// getDefaultModuleConfig / inferModuleStateFromDashboard are the real registry functions (inferModuleStateFromDashboard moved
// from client-provisioning.cjs into module-registry.js so there is one implementation).

import { createRequire } from 'node:module';

const { getDefaultModuleConfig, inferModuleStateFromDashboard } = createRequire(import.meta.url)('./module-registry.js'); // pure CJS, the real functions

/**
 * Effective view exactly as getDashboardBootstrap builds it (client-provisioning.cjs): registry defaults under the stored
 * map, module state = stored or inferred, and a SUCCEEDED card with no explicit stored entry counts as enabled.
 */
function effectiveConfig(clientConfigData, dashboardState) {
  const stored = clientConfigData?.moduleConfig && typeof clientConfigData.moduleConfig === 'object' ? clientConfigData.moduleConfig : null;
  const moduleConfig = { ...getDefaultModuleConfig(), ...(stored || {}) };
  const moduleState = dashboardState?.modules || inferModuleStateFromDashboard(dashboardState || null);
  for (const [cardId, st] of Object.entries(moduleState)) {
    if (st?.status === 'succeeded' && !(stored && Object.prototype.hasOwnProperty.call(stored, cardId))) moduleConfig[cardId] = { ...(moduleConfig[cardId] || {}), enabled: true };
  }
  return { moduleConfig, moduleState };
}

/**
 * Pure: the two Firestore writes for one toggle. The FIRST write must not create partial maps: a missing moduleConfig is
 * seeded with what bootstrap already shows (registry defaults + succeeded inference), and a missing dashboard_state.modules
 * is seeded from inferModuleStateFromDashboard, then the toggled card is merged on top.
 */
export function buildModuleToggleWrites({ cardId, enabled, clientConfigData = null, dashboardState = null, now }) {
  const eff = effectiveConfig(clientConfigData, dashboardState);
  const hadConfig = Boolean(clientConfigData?.moduleConfig);
  const hadModules = Boolean(dashboardState?.modules);
  const currentStatus = eff.moduleState?.[cardId]?.status ?? 'disabled';
  const state = { enabled };
  if (enabled && currentStatus === 'disabled') state.status = 'idle'; // enabling a disabled card makes the Run button appear
  if (!enabled && currentStatus !== 'succeeded') state.status = 'disabled'; // disabling keeps a succeeded result visible
  return {
    clientConfig: { moduleConfig: { ...(hadConfig ? {} : eff.moduleConfig), [cardId]: { enabled } }, updatedAt: now },
    dashboardState: { modules: { ...(hadModules ? {} : eff.moduleState), [cardId]: { ...(hadModules ? {} : eff.moduleState[cardId] || {}), ...state } }, updatedAt: now },
  };
}

/** Same as the route always intended, with nested objects (set + merge deep-merges nested maps). */
export async function applyModuleToggle(db, clientId, cardId, enabled, { now }) {
  const configRef = db.collection('client_configs').doc(clientId);
  const stateRef = db.collection('dashboard_state').doc(clientId);
  const [cfgSnap, stateSnap] = await Promise.all([configRef.get(), stateRef.get()]);
  const w = buildModuleToggleWrites({ cardId, enabled, clientConfigData: cfgSnap.exists ? cfgSnap.data() : null, dashboardState: stateSnap.exists ? stateSnap.data() : null, now });
  await Promise.all([configRef.set(w.clientConfig, { merge: true }), stateRef.set(w.dashboardState, { merge: true })]);
  return w;
}

/** { cardId: boolean } as the dashboard bootstrap shows it (defaults + stored + succeeded inference). Nested keys only. */
export function readModuleEnabledMap(clientConfigData, ids, dashboardState = null) {
  const { moduleConfig } = effectiveConfig(clientConfigData, dashboardState);
  return Object.fromEntries(ids.map((id) => [id, moduleConfig[id]?.enabled === true]));
}
