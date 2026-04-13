'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const {
  normalizeSourceSetting,
} = require('../../../api/_lib/intelligence-bootstrap-utils.cjs');

// ── needsPersistence logic (mirrors route.js guard) ──────────────────────────

function needsPersistence(raw) {
  return raw == null || (typeof raw === 'object' && Object.keys(raw).length === 0);
}

test('null setting needs persistence', () => {
  assert.strictEqual(needsPersistence(null), true);
});

test('undefined setting needs persistence', () => {
  assert.strictEqual(needsPersistence(undefined), true);
});

test('empty object needs persistence', () => {
  assert.strictEqual(needsPersistence({}), true);
});

test('setting with enabled=false does NOT need persistence', () => {
  assert.strictEqual(needsPersistence({ enabled: false }), false);
});

test('setting with only refreshPolicy does NOT need persistence', () => {
  assert.strictEqual(needsPersistence({ refreshPolicy: 'daily' }), false);
});

test('full setting does NOT need persistence', () => {
  assert.strictEqual(needsPersistence({ enabled: true, refreshPolicy: 'manual' }), false);
});

// ── source action validation ──────────────────────────────────────────────────

const VALID_ACTIONS = ['enable', 'disable', 'rerun'];

test('enable is a valid action', () => {
  assert.ok(VALID_ACTIONS.includes('enable'));
});

test('disable is a valid action', () => {
  assert.ok(VALID_ACTIONS.includes('disable'));
});

test('rerun is a valid action', () => {
  assert.ok(VALID_ACTIONS.includes('rerun'));
});

test('unknown action is rejected', () => {
  assert.ok(!VALID_ACTIONS.includes('delete'));
  assert.ok(!VALID_ACTIONS.includes('purge'));
});

// ── normalization after persistence decision ──────────────────────────────────

test('normalizing null produces default settings', () => {
  const s = normalizeSourceSetting(null);
  assert.deepStrictEqual(s, { enabled: true, refreshPolicy: 'manual' });
});

test('normalizing {} produces default settings', () => {
  const s = normalizeSourceSetting({});
  assert.deepStrictEqual(s, { enabled: true, refreshPolicy: 'manual' });
});

test('normalizing partial { enabled: false } preserves enabled', () => {
  const s = normalizeSourceSetting({ enabled: false });
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.refreshPolicy, 'manual');
});

test('normalizing full setting is idempotent', () => {
  const input = { enabled: true, refreshPolicy: 'daily' };
  const s = normalizeSourceSetting(input);
  assert.deepStrictEqual(s, input);
});

// ── settings normalization pass logic ────────────────────────────────────────

function identifyNeedsPersistence(sources, rawSettings) {
  return sources
    .filter((src) => needsPersistence(rawSettings[src.id]))
    .map((src) => src.id);
}

test('all sources with missing settings are flagged for persistence', () => {
  const sources = [
    { id: 'pagespeed-insights' },
    { id: 'another-source' },
  ];
  const rawSettings = {};
  const ids = identifyNeedsPersistence(sources, rawSettings);
  assert.deepStrictEqual(ids, ['pagespeed-insights', 'another-source']);
});

test('sources with existing non-empty settings are not flagged', () => {
  const sources = [
    { id: 'pagespeed-insights' },
    { id: 'another-source' },
  ];
  const rawSettings = {
    'pagespeed-insights': { enabled: false, refreshPolicy: 'manual' },
    'another-source':     { enabled: true },
  };
  const ids = identifyNeedsPersistence(sources, rawSettings);
  assert.deepStrictEqual(ids, []);
});

test('only empty settings are flagged when mix of empty and populated', () => {
  const sources = [
    { id: 'pagespeed-insights' },
    { id: 'another-source' },
  ];
  const rawSettings = {
    'pagespeed-insights': {},                                   // needs persistence
    'another-source':     { enabled: false, refreshPolicy: 'daily' }, // fine
  };
  const ids = identifyNeedsPersistence(sources, rawSettings);
  assert.deepStrictEqual(ids, ['pagespeed-insights']);
});

// ── deepSerialize logic (mirrors route.js helper) ─────────────────────────────

function deepSerialize(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000).toISOString();
  }
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepSerialize(val);
    return out;
  }
  return v;
}

test('null passes through deepSerialize', () => {
  assert.strictEqual(deepSerialize(null), null);
});

test('string passes through deepSerialize', () => {
  assert.strictEqual(deepSerialize('hello'), 'hello');
});

test('number passes through deepSerialize', () => {
  assert.strictEqual(deepSerialize(42), 42);
});

test('object with toDate() is serialized via toDate()', () => {
  const ts = { toDate() { return new Date(1000000000); } };
  assert.strictEqual(deepSerialize(ts), new Date(1000000000).toISOString());
});

test('plain _seconds object is serialized', () => {
  const ts = { _seconds: 1000, _nanoseconds: 0 };
  assert.strictEqual(deepSerialize(ts), new Date(1000 * 1000).toISOString());
});

test('nested object with Timestamp is serialized recursively', () => {
  const ts  = { toDate() { return new Date(5000); } };
  const obj = { meta: { updatedAt: ts, name: 'test' } };
  const out = deepSerialize(obj);
  assert.strictEqual(out.meta.updatedAt, new Date(5000).toISOString());
  assert.strictEqual(out.meta.name, 'test');
});

test('array is serialized recursively', () => {
  const result = deepSerialize([1, 'two', null]);
  assert.deepStrictEqual(result, [1, 'two', null]);
});

// ── toggle injection payload ──────────────────────────────────────────────────

test('enabled=true coerces to Boolean true', () => {
  assert.strictEqual(Boolean(true), true);
});

test('enabled=false coerces to Boolean false', () => {
  assert.strictEqual(Boolean(false), false);
});

test('missing clientId or enabled triggers validation failure', () => {
  const body = { clientId: undefined, enabled: true };
  assert.strictEqual(!body.clientId || body.enabled === undefined, true);
});

test('present clientId and enabled passes validation', () => {
  const body = { clientId: 'test-client', enabled: false };
  assert.strictEqual(!body.clientId || body.enabled === undefined, false);
});
