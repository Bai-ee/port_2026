'use strict';

// _contract.js — SourceRecord validation
// Every intelligence source module must return a record that passes this validator.
// No source-specific assumptions (no PSI fields, no provider checks).

const VALID_STATUSES       = new Set(['live', 'queued', 'error', 'off']);

class SourceRecordValidationError extends Error {
  constructor(field, message) {
    super(`[SourceRecord] ${field}: ${message}`);
    this.name  = 'SourceRecordValidationError';
    this.field = field;
  }
}

function fail(field, message) {
  throw new SourceRecordValidationError(field, message);
}

function requireString(field, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `must be a non-empty string, got ${JSON.stringify(value)}`);
  }
}

function requireStringOrNull(field, value) {
  if (value !== null && typeof value !== 'string') {
    fail(field, `must be a string or null, got ${JSON.stringify(value)}`);
  }
}

function requireBoolean(field, value) {
  if (typeof value !== 'boolean') {
    fail(field, `must be a boolean, got ${JSON.stringify(value)}`);
  }
}

function requireFiniteNumberOrNull(field, value) {
  if (value !== null && (typeof value !== 'number' || !isFinite(value))) {
    fail(field, `must be a finite number or null, got ${JSON.stringify(value)}`);
  }
}

/**
 * Validate a SourceRecord.
 * Throws SourceRecordValidationError with a field-level message on failure.
 * @param {object} record
 * @returns {object} the same record (pass-through for chaining)
 */
function validateSourceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('root', 'must be a non-null object');
  }

  requireString('id',       record.id);
  requireString('provider', record.provider);
  requireString('version',  record.version);

  if (!VALID_STATUSES.has(record.status)) {
    fail('status', `must be one of ${[...VALID_STATUSES].join(' | ')}, got ${JSON.stringify(record.status)}`);
  }

  requireBoolean('enabled', record.enabled);

  if (record.fetchedAt !== null && (typeof record.fetchedAt !== 'string' || !record.fetchedAt.trim())) {
    fail('fetchedAt', `must be an ISO date string or null, got ${JSON.stringify(record.fetchedAt)}`);
  }

  requireFiniteNumberOrNull('durationMs', record.durationMs);

  // cost sub-object
  if (!record.cost || typeof record.cost !== 'object' || Array.isArray(record.cost)) {
    fail('cost', 'must be a non-null object');
  }
  if (typeof record.cost.usd !== 'number' || !isFinite(record.cost.usd)) {
    fail('cost.usd', `must be a finite number, got ${JSON.stringify(record.cost.usd)}`);
  }
  if (typeof record.cost.quotaUnits !== 'number' || !isFinite(record.cost.quotaUnits)) {
    fail('cost.quotaUnits', `must be a finite number, got ${JSON.stringify(record.cost.quotaUnits)}`);
  }
  requireStringOrNull('cost.model',        record.cost.model);
  requireFiniteNumberOrNull('cost.inputTokens',  record.cost.inputTokens);
  requireFiniteNumberOrNull('cost.outputTokens', record.cost.outputTokens);

  requireString('summary', record.summary);

  if (!Array.isArray(record.signals)) {
    fail('signals', `must be an array, got ${JSON.stringify(record.signals)}`);
  }
  record.signals.forEach((s, i) => {
    if (typeof s !== 'string') {
      fail(`signals[${i}]`, `must be a string, got ${JSON.stringify(s)}`);
    }
  });

  if (!record.facts || typeof record.facts !== 'object' || Array.isArray(record.facts)) {
    fail('facts', 'must be a non-null object');
  }

  requireString('nextRefreshHint', record.nextRefreshHint);
  requireStringOrNull('error', record.error);

  return record;
}

module.exports = { validateSourceRecord, SourceRecordValidationError };
