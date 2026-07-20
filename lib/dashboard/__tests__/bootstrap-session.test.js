import test from 'node:test';
import assert from 'node:assert/strict';
import { withImpersonation } from '../bootstrap-session.js';

test('withImpersonation: no clientId returns the path untouched', () => {
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', null), '/api/dashboard/bootstrap');
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', undefined), '/api/dashboard/bootstrap');
});

test('withImpersonation: appends "?as=" when the path has no existing query string', () => {
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', 'client-123'), '/api/dashboard/bootstrap?as=client-123');
});

test('withImpersonation: appends "&as=" when the path already has a query string', () => {
  assert.strictEqual(withImpersonation('/dashboard?tab=brief', 'client-123'), '/dashboard?tab=brief&as=client-123');
});

test('withImpersonation: preserves a trailing hash fragment after the query param', () => {
  assert.strictEqual(withImpersonation('/dashboard#section', 'client-123'), '/dashboard?as=client-123#section');
});

test('withImpersonation: URL-encodes the clientId', () => {
  assert.strictEqual(withImpersonation('/dashboard', 'client id/with spaces'), '/dashboard?as=client%20id%2Fwith%20spaces');
});
