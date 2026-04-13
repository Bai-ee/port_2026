'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { computeLedger } = require('../_ledger');

function makeEvent(overrides) {
  return {
    at:          new Date().toISOString(), // now = within 30d
    provider:    'google-pagespeed-v5',
    kind:        'fetch',
    usd:         0,
    quotaUnits:  1,
    durationMs:  null,
    note:        null,
    runId:       null,
    ...overrides,
  };
}

function oldTimestamp() {
  // 31 days ago
  return new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
}

test('empty events produces zero totals', () => {
  const { totals, byProvider } = computeLedger([]);
  assert.strictEqual(totals.usd30d,        0);
  assert.strictEqual(totals.quotaUnits30d, 0);
  assert.strictEqual(totals.auditsCount30d, 0);
  assert.deepStrictEqual(byProvider, {});
});

test('non-array input is treated as empty', () => {
  const { totals } = computeLedger(null);
  assert.strictEqual(totals.auditsCount30d, 0);
});

test('single event within 30d is counted', () => {
  const { totals } = computeLedger([makeEvent({ usd: 0.01, quotaUnits: 2 })]);
  assert.strictEqual(totals.auditsCount30d, 1);
  assert.strictEqual(totals.usd30d,        0.01);
  assert.strictEqual(totals.quotaUnits30d, 2);
});

test('events older than 30 days are excluded', () => {
  const { totals } = computeLedger([makeEvent({ at: oldTimestamp(), usd: 10 })]);
  assert.strictEqual(totals.auditsCount30d, 0);
  assert.strictEqual(totals.usd30d,        0);
});

test('mix of old and recent: only recent counted', () => {
  const events = [
    makeEvent({ usd: 1 }),
    makeEvent({ at: oldTimestamp(), usd: 100 }),
  ];
  const { totals } = computeLedger(events);
  assert.strictEqual(totals.auditsCount30d, 1);
  assert.strictEqual(totals.usd30d, 1);
});

test('byProvider aggregates usd and quotaUnits per provider', () => {
  const events = [
    makeEvent({ provider: 'google-pagespeed-v5', usd: 0,    quotaUnits: 1 }),
    makeEvent({ provider: 'google-pagespeed-v5', usd: 0,    quotaUnits: 1 }),
    makeEvent({ provider: 'openai-gpt4',         usd: 0.05, quotaUnits: 0 }),
  ];
  const { totals, byProvider } = computeLedger(events);
  assert.strictEqual(totals.auditsCount30d, 3);
  assert.strictEqual(byProvider['google-pagespeed-v5'].auditsCount30d, 2);
  assert.strictEqual(byProvider['google-pagespeed-v5'].quotaUnits30d, 2);
  assert.strictEqual(byProvider['openai-gpt4'].auditsCount30d, 1);
  assert.strictEqual(byProvider['openai-gpt4'].usd30d, 0.05);
});

test('lastFetchedAt per provider is the most recent event timestamp', () => {
  const earlier = new Date(Date.now() - 60_000).toISOString();
  const later   = new Date().toISOString();
  const events  = [
    makeEvent({ provider: 'p', at: earlier }),
    makeEvent({ provider: 'p', at: later }),
  ];
  const { byProvider } = computeLedger(events);
  assert.strictEqual(byProvider['p'].lastFetchedAt, later);
});

test('missing provider defaults to "unknown"', () => {
  const { byProvider } = computeLedger([makeEvent({ provider: undefined })]);
  assert.ok('unknown' in byProvider);
});

test('non-finite usd is treated as 0', () => {
  const { totals } = computeLedger([makeEvent({ usd: NaN, quotaUnits: 1 })]);
  assert.strictEqual(totals.usd30d, 0);
  assert.strictEqual(totals.quotaUnits30d, 1);
});

test('floating-point totals are rounded to 6 decimal places', () => {
  // 3 × 0.1 = 0.30000000000000004 without rounding
  const events = [makeEvent({ usd: 0.1 }), makeEvent({ usd: 0.1 }), makeEvent({ usd: 0.1 })];
  const { totals } = computeLedger(events);
  // Should not have more than 6 decimal places of float noise
  const str = totals.usd30d.toString();
  const decimals = str.includes('.') ? str.split('.')[1].length : 0;
  assert.ok(decimals <= 6, `Expected ≤6 decimal places, got ${decimals} (${totals.usd30d})`);
});

test('event with missing at field is excluded', () => {
  const { totals } = computeLedger([{ provider: 'p', usd: 99, quotaUnits: 1 }]);
  assert.strictEqual(totals.auditsCount30d, 0);
});
