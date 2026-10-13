import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePushGuard, guardInputForItem } from '../push-guard.js';

test('maps video item to showcase, text to original-text', () => {
  assert.deepEqual(guardInputForItem({ mediaUrl: 'u', mediaType: 'video' }, 'x'), { text: 'x', type: 'original-showcase', media: 'video' });
  assert.deepEqual(guardInputForItem({}, 'x'), { text: 'x', type: 'original-text', media: 'none' });
});

test('hard block returns reason with codes and lane', () => {
  const guard = () => ({ hardBlock: true, lane: 'casino', flags: [{ code: 'casino-term', severity: 'major', issue: 'i' }] });
  const d = decidePushGuard({}, 't', { guard });
  assert.equal(d.action, 'block');
  assert.match(d.reason, /^guard: casino-term \(lane: casino\)$/);
});

test('major flags schedule but flag; minor/none are ok', () => {
  const flagged = decidePushGuard({}, 't', { guard: () => ({ hardBlock: false, lane: 'work', flags: [{ code: 'a', severity: 'major', issue: 'i' }, { code: 'b', severity: 'minor', issue: 'j' }] }) });
  assert.equal(flagged.action, 'flag');
  assert.deepEqual(flagged.guard.flags.map((f) => f.code), ['a']);
  assert.equal(decidePushGuard({}, 't', { guard: () => ({ flags: [{ code: 'b', severity: 'minor' }] }) }).action, 'ok');
});

test('guard throwing never blocks', () => {
  assert.equal(decidePushGuard({}, 't', { guard: () => { throw new Error('x'); } }).action, 'ok');
});

test('real guard: clean design post ok, speculation blocked', () => {
  assert.equal(decidePushGuard({}, 'New portfolio piece: a fresh dashboard UI for a client.').action === 'block', false);
  assert.equal(decidePushGuard({}, 'It took me UNDER 5 minutes to put $10 into the pump app and get rugged lol.').action, 'block');
});
