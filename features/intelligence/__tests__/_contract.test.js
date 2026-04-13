'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { validateSourceRecord, SourceRecordValidationError } = require('../_contract');

function validRecord(overrides) {
  return {
    id:              'pagespeed-insights',
    provider:        'google-pagespeed-v5',
    version:         '1.0.0',
    status:          'live',
    enabled:         true,
    fetchedAt:       '2026-04-12T21:59:10Z',
    durationMs:      34200,
    cost: {
      usd:          0,
      quotaUnits:   1,
      model:        null,
      inputTokens:  null,
      outputTokens: null,
    },
    summary:         'Mobile performance is poor while SEO is strong.',
    signals:         ['Performance score 44/100', 'SEO baseline strong'],
    facts:           { strategy: 'mobile' },
    nextRefreshHint: 'manual',
    error:           null,
    ...overrides,
  };
}

test('valid record passes', () => {
  const rec = validRecord();
  assert.strictEqual(validateSourceRecord(rec), rec);
});

test('pass-through returns same reference', () => {
  const rec = validRecord();
  assert.strictEqual(validateSourceRecord(rec), rec);
});

test('missing id throws on id field', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ id: '' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'id',
  );
});

test('missing provider throws on provider field', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ provider: undefined })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'provider',
  );
});

test('invalid status throws on status field', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ status: 'unknown' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'status',
  );
});

test('all valid statuses are accepted', () => {
  for (const status of ['live', 'queued', 'error', 'off']) {
    assert.doesNotThrow(() => validateSourceRecord(validRecord({ status })));
  }
});

test('non-boolean enabled throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ enabled: 'yes' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'enabled',
  );
});

test('fetchedAt null is valid', () => {
  assert.doesNotThrow(() => validateSourceRecord(validRecord({ fetchedAt: null })));
});

test('fetchedAt empty string throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ fetchedAt: '' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'fetchedAt',
  );
});

test('cost.usd non-finite throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ cost: { usd: Infinity, quotaUnits: 0, model: null, inputTokens: null, outputTokens: null } })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'cost.usd',
  );
});

test('cost.quotaUnits missing throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ cost: { usd: 0, quotaUnits: undefined, model: null, inputTokens: null, outputTokens: null } })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'cost.quotaUnits',
  );
});

test('empty summary throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ summary: '   ' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'summary',
  );
});

test('signals must be an array', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ signals: 'bad' })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'signals',
  );
});

test('signals with non-string entry throws on indexed field', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ signals: ['ok', 42] })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'signals[1]',
  );
});

test('empty signals array is valid', () => {
  assert.doesNotThrow(() => validateSourceRecord(validRecord({ signals: [] })));
});

test('facts must be an object', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ facts: null })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'facts',
  );
});

test('facts as array throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ facts: [] })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'facts',
  );
});

test('null root throws on root field', () => {
  assert.throws(
    () => validateSourceRecord(null),
    (err) => err instanceof SourceRecordValidationError && err.field === 'root',
  );
});

test('error field: null is valid', () => {
  assert.doesNotThrow(() => validateSourceRecord(validRecord({ error: null })));
});

test('error field: non-null non-string throws', () => {
  assert.throws(
    () => validateSourceRecord(validRecord({ error: 42 })),
    (err) => err instanceof SourceRecordValidationError && err.field === 'error',
  );
});
