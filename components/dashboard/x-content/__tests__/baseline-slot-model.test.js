import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineSlotStates, repliesReminder, minutesOf, SLOT_MATCH_MIN } from '../baseline-slot-model.js';

const slot = (time, trackId = null) => ({ time, minutes: minutesOf(time), track: 'T', trackId, note: 'n' });
const BASE = { slots: [slot('07:00', 'design'), slot('09:00'), slot('16:00', 'music')], replies: { min: 5, note: '5+ replies' }, notes: [] };
const states = (rows, base = BASE) => baselineSlotStates(base, rows).map((s) => [s.time, s.state, s.matchedId]);

test('no rows -> every slot open; missing baseline -> no slots', () => {
  assert.deepEqual(states([]), [['07:00', 'open', null], ['09:00', 'open', null], ['16:00', 'open', null]]);
  assert.deepEqual(baselineSlotStates(null, [{ id: 'a', time: '07:00' }]), []);
});

test('a row within ±60 min fills the slot; outside the window it does not', () => {
  assert.equal(SLOT_MATCH_MIN, 60);
  assert.deepEqual(states([{ id: 'a', time: '08:00' }, { id: 'b', time: '17:01' }]), [['07:00', 'filled', 'a'], ['09:00', 'open', null], ['16:00', 'open', null]]);
});

test('each row fills one slot; suggestions count, requotes and untimed rows do not', () => {
  const rows = [{ id: 'a', time: '08:00' }, { id: 'r', time: '09:00', kind: 'requote' }, { id: 'u' }, { id: 's', time: '16:30', kind: 'suggestion' }];
  assert.deepEqual(states(rows), [['07:00', 'filled', 'a'], ['09:00', 'open', null], ['16:00', 'filled', 's']]);
});

test('same track preferred; a different known track never fills a tracked slot', () => {
  // The nearer music row cannot fill the design slot; the untracked 09:00 slot takes a row of any track.
  const rows = [{ id: 'near-music', time: '07:10', trackId: 'music' }, { id: 'far-design', time: '07:50', trackId: 'design' }, { id: 'music-2', time: '08:30', trackId: 'music' }];
  assert.deepEqual(states(rows), [['07:00', 'filled', 'far-design'], ['09:00', 'filled', 'music-2'], ['16:00', 'open', null]]);
  assert.deepEqual(states([{ id: 'm', time: '07:00', trackId: 'music' }], { slots: [slot('07:00', 'design')] }), [['07:00', 'open', null]]);
});

test('repliesReminder', () => {
  assert.equal(repliesReminder(BASE), '5+ replies today');
  assert.equal(repliesReminder({ slots: [], replies: null }), null);
  assert.equal(repliesReminder(undefined), null);
});
