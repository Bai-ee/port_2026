import assert from 'node:assert/strict';
import test from 'node:test';

import { mapTwitterError } from '../twitter-errors.js';

test('maps a detailed X 400 without losing the provider payload', () => {
  const source = Object.assign(new Error('Request failed with code 400'), {
    code: 400,
    data: { title: 'Invalid Request', detail: 'Media processing failed.' },
  });

  const mapped = mapTwitterError(source);

  assert.equal(mapped.status, 400);
  assert.equal(mapped.code, 400);
  assert.equal(mapped.message, 'X rejected the request: Media processing failed.');
  assert.match(mapped.hint, /verify the media/i);
  assert.deepEqual(mapped.twitterError.data, source.data);
});

test('maps an opaque X 400 to an actionable generic message', () => {
  const mapped = mapTwitterError(Object.assign(
    new Error('Request failed with code 400'),
    { code: 400 },
  ));

  assert.equal(mapped.status, 400);
  assert.equal(mapped.message, 'X rejected the request as invalid.');
  assert.match(mapped.hint, /Reconnect the account/i);
});

test('classifyPublishError: a dead X login is definite (x-auth), even when its details mention a timeout', async () => {
  const { classifyPublishError } = await import('../twitter-service.js');
  assert.deepEqual(classifyPublishError(Object.assign(new Error('no longer refreshable'), { status: 409, code: 'x-reconnect-required', details: 'connect ETIMEDOUT' })), { retryable: false, errorClass: 'x-auth' });
  assert.deepEqual(classifyPublishError(Object.assign(new Error('no connected X account'), { status: 409, code: 'account-not-connected' })), { retryable: false, errorClass: 'x-auth' });
  assert.equal(classifyPublishError(new Error('socket hang up')).errorClass, 'network-ambiguous');
});
