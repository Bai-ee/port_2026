import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildModuleToggleWrites, applyModuleToggle, readModuleEnabledMap } from '../../scout-intake/module-toggle.mjs';

const { getDefaultModuleConfig, inferModuleStateFromDashboard } = createRequire(import.meta.url)('../../scout-intake/module-registry.js');
import { makeWorld, OWNER } from './ops-world.js';

// Firestore set(data, {merge:true}) semantics: nested maps deep-merge; a dotted key is a LITERAL field name.
function mergeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const deep = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deep(out[k], v) : v; return out; };
  const ref = (path) => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (d, o) => { docs.set(path, o?.merge ? deep(docs.get(path) || {}, d) : d); } });
  return { docs, collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }) };
}
// What modules/run reads (route.js): configData.moduleConfig[cardId]?.enabled === true
const runRouteSeesEnabled = (db, clientId, cardId) => db.docs.get(`client_configs/${clientId}`)?.moduleConfig?.[cardId]?.enabled === true;

test('bug reproduced: the OLD dotted-key set() writes a literal field the run route never reads', async () => {
  const db = mergeDb({ [`client_configs/${OWNER}`]: { moduleConfig: { 'social-preview': { enabled: false } } } });
  await db.collection('client_configs').doc(OWNER).set({ 'moduleConfig.social-preview.enabled': true }, { merge: true });
  assert.equal(db.docs.get(`client_configs/${OWNER}`)['moduleConfig.social-preview.enabled'], true, 'literal top-level key');
  assert.equal(runRouteSeesEnabled(db, OWNER, 'social-preview'), false, 'the nested value the run route reads did not change');
});

test('fix: applyModuleToggle writes NESTED values that the run route reads, and keeps sibling modules', async () => {
  const db = mergeDb({ [`client_configs/${OWNER}`]: { moduleConfig: { 'style-guide': { enabled: true }, 'social-preview': { enabled: false } } }, [`dashboard_state/${OWNER}`]: { modules: { 'style-guide': { status: 'idle', enabled: true } } } });
  await applyModuleToggle(db, OWNER, 'social-preview', true, { now: 'TS' });
  assert.equal(runRouteSeesEnabled(db, OWNER, 'social-preview'), true);
  assert.equal(runRouteSeesEnabled(db, OWNER, 'style-guide'), true, 'siblings untouched');
  assert.ok(!Object.keys(db.docs.get(`client_configs/${OWNER}`)).some((k) => k.includes('.')), 'no literal dotted keys');
  assert.equal(db.docs.get(`dashboard_state/${OWNER}`).modules['social-preview'].enabled, true);
  assert.equal(db.docs.get(`dashboard_state/${OWNER}`).modules['social-preview'].status, 'idle', 'enabling a disabled card shows Run');
  assert.equal(db.docs.get(`dashboard_state/${OWNER}`).modules['style-guide'].status, 'idle', 'sibling state untouched');
  await applyModuleToggle(db, OWNER, 'social-preview', false, { now: 'TS' });
  assert.equal(runRouteSeesEnabled(db, OWNER, 'social-preview'), false);
  assert.equal(db.docs.get(`dashboard_state/${OWNER}`).modules['social-preview'].status, 'disabled');
});

test('FIRST write, no moduleConfig stored: seeds the REAL registry defaults (plus succeeded inference) instead of a partial map', async () => {
  const db = mergeDb({ [`client_configs/${OWNER}`]: { websiteUrl: 'https://x.test' }, [`dashboard_state/${OWNER}`]: { siteMeta: { title: 't' } } });
  await applyModuleToggle(db, OWNER, 'style-guide', false, { now: 'TS' });
  const mc = db.docs.get(`client_configs/${OWNER}`).moduleConfig;
  assert.deepEqual(Object.keys(mc).sort(), Object.keys(getDefaultModuleConfig()).sort(), 'every registry module present');
  assert.equal(mc['style-guide'].enabled, false, 'the toggled card');
  assert.equal(mc['social-preview'].enabled, true, 'defaults / succeeded inference preserved');
  assert.equal(db.docs.get(`client_configs/${OWNER}`).websiteUrl, 'https://x.test', 'other fields kept');
});

test('FIRST write, no dashboard_state.modules: seeded from the REAL inferModuleStateFromDashboard, then the card is merged', async () => {
  const db = mergeDb({ [`dashboard_state/${OWNER}`]: { siteMeta: { title: 't' }, seoAudit: { status: 'ok' } } });
  await applyModuleToggle(db, OWNER, 'agent-readiness', true, { now: 'TS' });
  const m = db.docs.get(`dashboard_state/${OWNER}`).modules;
  const inferred = inferModuleStateFromDashboard({ siteMeta: {}, seoAudit: { status: 'ok' } });
  assert.deepEqual(Object.keys(m).sort(), Object.keys(inferred).sort(), 'all modules seeded, not just the toggled one');
  assert.equal(m['social-preview'].status, 'succeeded'); assert.equal(m['seo-performance'].status, 'succeeded');
  assert.equal(m['agent-readiness'].enabled, true);
  assert.equal(db.docs.get(`dashboard_state/${OWNER}`).siteMeta.title, 't', 'other state kept');
  // and when neither doc exists at all
  const empty = mergeDb();
  await applyModuleToggle(empty, OWNER, 'style-guide', false, { now: 'TS' });
  assert.equal(Object.keys(empty.docs.get(`dashboard_state/${OWNER}`).modules).length, Object.keys(getDefaultModuleConfig()).length);
  assert.equal(Object.keys(empty.docs.get(`client_configs/${OWNER}`).moduleConfig).length, Object.keys(getDefaultModuleConfig()).length);
});

test('status rules are preserved: succeeded stays succeeded on disable; running/failed stay on enable', () => {
  const st = (status) => ({ modules: { a: { status } } });
  assert.deepEqual(buildModuleToggleWrites({ cardId: 'a', enabled: false, dashboardState: st('succeeded'), now: 'T' }).dashboardState.modules.a, { enabled: false });
  assert.deepEqual(buildModuleToggleWrites({ cardId: 'a', enabled: true, dashboardState: st('failed'), now: 'T' }).dashboardState.modules.a, { enabled: true });
  assert.deepEqual(buildModuleToggleWrites({ cardId: 'a', enabled: true, dashboardState: st('disabled'), now: 'T' }).dashboardState.modules.a, { enabled: true, status: 'idle' });
});

test('read map: registry defaults under the stored map and succeeded inference (as bootstrap), literal legacy keys ignored', () => {
  const ids = Object.keys(getDefaultModuleConfig());
  assert.ok(Object.values(readModuleEnabledMap(null, ids)).every(Boolean), 'defaults are foundational/enabled');
  const stored = { 'moduleConfig.social-preview.enabled': false, moduleConfig: { 'style-guide': { enabled: false } } }; // literal key ignored; nested honoured
  const m = readModuleEnabledMap(stored, ids);
  assert.equal(m['style-guide'], false); assert.equal(m['social-preview'], true);
  // succeeded + no explicit stored entry => enabled (bootstrap rule); an explicit stored false wins
  const explicitOff = { moduleConfig: { 'seo-performance': { enabled: false } } };
  assert.equal(readModuleEnabledMap(explicitOff, ids, { modules: { 'seo-performance': { status: 'succeeded' } } })['seo-performance'], false);
  const unconfigured = { moduleConfig: { 'style-guide': { enabled: false } } };
  assert.equal(readModuleEnabledMap(unconfigured, ids, { modules: { 'style-guide': { status: 'succeeded' } } })['style-guide'], false, 'explicit entry present');
  const partial = { moduleConfig: {} };
  assert.equal(readModuleEnabledMap(partial, ['a-custom'], { modules: { 'a-custom': { status: 'succeeded' } } })['a-custom'], true, 'inference fills a gap');
});

test('settings: modules.<cardId>.enabled OFF is free, ON needs confirm (recurring spend wording), unknown ids refused, undo works', async () => {
  const w = makeWorld();
  const off = w.json(await w.call('set_setting', { key: 'modules.social-preview.enabled', value: false }));
  assert.equal(off.applied, true); assert.equal(off.before, true); assert.equal(off.undoNeedsConfirm, true);
  assert.deepEqual(w.settings.writes.modules, [{ clientId: OWNER, cardId: 'social-preview', enabled: false }]);
  const ask = w.json(await w.call('set_setting', { key: 'modules.social-preview.enabled', value: true }));
  assert.equal(ask.needsConfirm, true); assert.match(ask.message, /daily refresh/); assert.match(ask.message, /RECURRING model spend/);
  assert.equal(w.json(await w.call('set_setting', { key: 'modules.social-preview.enabled', value: true, confirm: true })).applied, true);
  const bad = await w.call('set_setting', { key: 'modules.not-a-card.enabled', value: true, confirm: true });
  assert.equal(bad.isError, true);
  const off2 = w.json(await w.call('set_setting', { key: 'modules.style-guide.enabled', value: false }));
  const undo = w.json(await w.call('undo_setting', { changeId: off2.changeId, confirm: true }));
  assert.equal(undo.undone, true); assert.equal(w.settings.moduleDocs.get(OWNER).moduleConfig['style-guide'].enabled, true);
});
