'use strict';

// Covers Phase 3 of docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md:
// buildCreationFailureProjection, the read-side allow-list that decides what
// (if anything) of dashboard_state.errorState reaches a client via bootstrap.
// Pure function — no Firestore/network involved, so no fake context needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildCreationFailureProjection } = require('../client-provisioning.cjs');

const OPEN_ERROR_STATE = {
  kind: 'dashboard_creation_failed',
  status: 'open',
  incidentId: 'client-a-signup',
  runId: 'client-a-signup',
  failedAt: '2026-08-26T00:00:00.000Z',
  publicCode: 'HIT-ABC123',
  publicStage: 'website_access',
  publicMessage: 'We could not reach the website to build your dashboard.',
  message: 'We could not reach the website to build your dashboard.',
  notification: { attemptedAt: '2026-08-26T00:00:05.000Z', status: 'sent' },
  resolvedAt: null,
  resolvedBy: null,
};

test('buildCreationFailureProjection: returns null when impersonating, regardless of the incident', () => {
  const result = buildCreationFailureProjection({ errorState: OPEN_ERROR_STATE }, true);
  assert.equal(result, null);
});

test('buildCreationFailureProjection: returns null with no dashboardState', () => {
  assert.equal(buildCreationFailureProjection(null, false), null);
  assert.equal(buildCreationFailureProjection(undefined, false), null);
});

test('buildCreationFailureProjection: returns null with no errorState', () => {
  assert.equal(buildCreationFailureProjection({}, false), null);
});

test('buildCreationFailureProjection: returns null when errorState.kind is not dashboard_creation_failed', () => {
  const result = buildCreationFailureProjection({ errorState: { kind: 'something-else', status: 'open' } }, false);
  assert.equal(result, null);
});

test('buildCreationFailureProjection: returns null once the incident is resolved', () => {
  const result = buildCreationFailureProjection({ errorState: { ...OPEN_ERROR_STATE, status: 'resolved' } }, false);
  assert.equal(result, null);
});

test('buildCreationFailureProjection: returns the allow-listed shape for a genuine open incident', () => {
  const result = buildCreationFailureProjection({ errorState: OPEN_ERROR_STATE }, false);
  assert.deepEqual(result, {
    status: 'open',
    incidentId: 'client-a-signup',
    runId: 'client-a-signup',
    failedAt: '2026-08-26T00:00:00.000Z',
    publicCode: 'HIT-ABC123',
    publicStage: 'website_access',
    publicMessage: 'We could not reach the website to build your dashboard.',
    notification: { status: 'sent' },
  });
});

test('buildCreationFailureProjection: never forwards a field outside the allow-list, even a suspiciously-named one on errorState', () => {
  const result = buildCreationFailureProjection({
    errorState: {
      ...OPEN_ERROR_STATE,
      rawInternalError: 'ENOTFOUND rositas.com at provider X with key sk-ant-secret',
      resolvedBy: 'admin@hitloop.agency',
    },
  }, false);
  const keys = Object.keys(result);
  assert.deepEqual(keys.sort(), ['failedAt', 'incidentId', 'notification', 'publicCode', 'publicMessage', 'publicStage', 'runId', 'status'].sort());
  assert.ok(!JSON.stringify(result).includes('sk-ant-secret'));
  assert.ok(!JSON.stringify(result).includes('admin@hitloop.agency'));
});

test('buildCreationFailureProjection: notification defaults to not_configured when absent', () => {
  const { notification, ...rest } = OPEN_ERROR_STATE;
  const result = buildCreationFailureProjection({ errorState: rest }, false);
  assert.deepEqual(result.notification, { status: 'not_configured' });
});
