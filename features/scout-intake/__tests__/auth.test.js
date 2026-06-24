'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hasValidWorkerSecret } = require('../../../api/_lib/auth.cjs');

describe('worker secret auth', () => {
  const originalSecret = process.env.WORKER_SECRET;

  test('accepts only the exact x-worker-secret value', () => {
    process.env.WORKER_SECRET = 'worker-secret-123';

    assert.equal(
      hasValidWorkerSecret({ headers: { 'x-worker-secret': 'worker-secret-123' } }),
      true
    );
    assert.equal(
      hasValidWorkerSecret({ headers: { 'x-worker-secret': 'wrong' } }),
      false
    );
  });

  test('fails closed when WORKER_SECRET is missing', () => {
    delete process.env.WORKER_SECRET;
    assert.equal(
      hasValidWorkerSecret({ headers: { 'x-worker-secret': 'worker-secret-123' } }),
      false
    );
  });

  test('restores environment', () => {
    if (originalSecret === undefined) {
      delete process.env.WORKER_SECRET;
    } else {
      process.env.WORKER_SECRET = originalSecret;
    }
    assert.ok(true);
  });
});
