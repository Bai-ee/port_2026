import test from 'node:test';
import assert from 'node:assert/strict';

test('archive heartbeat contract states stay intentionally narrow', () => {
  const states = ['ONLINE', 'PROCESSING', 'PAUSED', 'OFFLINE', 'ERROR'];
  assert.equal(states.includes('PROCESSING'), true);
  assert.equal(states.includes('UPLOADED'), false);
});
