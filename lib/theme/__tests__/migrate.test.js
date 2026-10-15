import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MIGRATIONS } from '../migrate.js';
import { createBaseline, BASELINE_DEFINITION } from '../baseline.js';
import { SCHEMA_VERSION } from '../constants.js';

test('v1 is the identity migration', () => {
  const r = migrate(createBaseline());
  assert.equal(r.ok, true);
  assert.equal(r.fromVersion, 1);
  assert.equal(r.toVersion, SCHEMA_VERSION);
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.definition, JSON.parse(JSON.stringify(BASELINE_DEFINITION)));
});

test('v2 and above are rejected', () => {
  const d = createBaseline();
  d.version = 2;
  const r = migrate(d);
  assert.equal(r.ok, false);
  assert.equal(r.definition, null);
  assert.equal(r.fromVersion, 2);
  assert.equal(r.errors[0].code, 'UNSUPPORTED_VERSION');
});

test('bad input is reported, never thrown', () => {
  for (const v of [null, [], 'x', 3]) {
    const r = migrate(v);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'NOT_AN_OBJECT');
  }
  for (const version of [undefined, 0, -2, 1.5, '1']) {
    const r = migrate({ ...createBaseline(), version });
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, 'BAD_VERSION');
  }
});

test('structural errors surface through migrate', () => {
  const d = createBaseline();
  d.master.hue = NaN;
  const r = migrate(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'NONFINITE'));
});

test('registry shape: frozen map of integer version -> function (empty while v1 is current)', () => {
  assert.ok(Object.isFrozen(MIGRATIONS));
  for (const [k, fn] of Object.entries(MIGRATIONS)) {
    assert.ok(Number.isInteger(Number(k)));
    assert.equal(typeof fn, 'function');
  }
  assert.equal(Object.keys(MIGRATIONS).length, SCHEMA_VERSION - 1);
});
