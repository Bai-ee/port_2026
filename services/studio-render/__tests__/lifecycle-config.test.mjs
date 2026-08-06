// lifecycle-config.test.mjs — Phase 7 item 3. Drift-guard for the bucket
// lifecycle definition: the JSON's prefixes and ages must stay tied to the
// CODE's own constants (a renamed storage prefix or changed retention that
// isn't mirrored here would silently orphan objects forever, or delete the
// wrong ones). Also pins the DELIBERATE absence of a canonical-stills rule
// — see apply-lifecycle.sh's own header for that decision's rationale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const artifacts = require('../vendor/api-lib/proof-render-artifacts.cjs');
const stills = require('../vendor/api-lib/studio-screen-stills.cjs');

const config = JSON.parse(readFileSync(new URL('../lifecycle/proof-storage-lifecycle.json', import.meta.url), 'utf8'));

function ruleFor(prefix) {
  return config.rule.find((r) => (r.condition?.matchesPrefix || []).includes(prefix));
}

test('artifact retention rule matches the code: delete proof-render-artifacts/ at age >= RETENTION_DAYS', () => {
  const rule = ruleFor(`${artifacts.PREFIX}/`);
  assert.ok(rule, `no lifecycle rule covers ${artifacts.PREFIX}/`);
  assert.equal(rule.action.type, 'Delete');
  assert.equal(rule.condition.age, artifacts.RETENTION_DAYS, 'the rule age must equal RETENTION_DAYS — expiresAt and physical deletion must agree');
});

test('temp screen-upload rule matches the code: delete studio-screen-stills-tmp/ at age >= 1', () => {
  const rule = ruleFor(`${stills.TMP_PREFIX}/`);
  assert.ok(rule, `no lifecycle rule covers ${stills.TMP_PREFIX}/`);
  assert.equal(rule.action.type, 'Delete');
  assert.equal(rule.condition.age, 1, 'staged uploads live minutes; one day is the generous backstop');
});

test('canonical pinned stills are DELIBERATELY not lifecycle-deleted — recipes reference them indefinitely and the quota ledger never decrements', () => {
  for (const rule of config.rule) {
    for (const prefix of rule.condition?.matchesPrefix || []) {
      assert.ok(!`${stills.PREFIX}/`.startsWith(prefix), `rule with prefix '${prefix}' would cover canonical stills under ${stills.PREFIX}/ — that deletion would desync the quota ledger`);
    }
  }
});

test('every rule is a prefix-scoped Delete — no rule can ever touch objects outside the two intended prefixes', () => {
  assert.ok(Array.isArray(config.rule) && config.rule.length === 2);
  for (const rule of config.rule) {
    assert.equal(rule.action.type, 'Delete');
    const prefixes = rule.condition?.matchesPrefix || [];
    assert.equal(prefixes.length, 1, 'exactly one prefix per rule — auditable one-to-one with the constants above');
    assert.ok(Number.isInteger(rule.condition.age) && rule.condition.age >= 1);
  }
});
