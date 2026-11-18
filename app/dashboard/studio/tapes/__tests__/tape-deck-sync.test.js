import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampTime, deckForKey, deepLinkHash, diagChips, formatClock, formatPublished, labelTitle, minutesRemoved, packRadii, planSwitch, readDeepLink,
} from '../tape-deck-sync.js';

test('clock and clamp', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(61.9), '1:01');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(clampTime(75, 60), 60);
  assert.equal(clampTime(-3, 60), 0);
  assert.equal(clampTime(NaN, 60), 0);
});

test('switch while playing in parallel: in-sync target is not seeked, source is muted not paused', () => {
  const p = planSwitch({ from: 'A', to: 'B', fromTime: 10, toTime: 10.01, playing: true, parallel: true });
  assert.deepEqual(p, { noop: false, seek: null, unmuteTarget: true, muteSource: true, pauseSource: false, playTarget: false });
});

test('switch while playing in parallel: drifted target is re-synced once', () => {
  const p = planSwitch({ from: 'A', to: 'B', fromTime: 10, toTime: 10.2, playing: true, parallel: true });
  assert.equal(p.seek, 10);
  assert.equal(p.pauseSource, false);
});

test('switch in fallback mode (iOS): pause source, seek, play target', () => {
  const p = planSwitch({ from: 'A', to: 'B', fromTime: 12, toTime: 0, playing: true, parallel: false });
  assert.deepEqual(p, { noop: false, seek: 12, unmuteTarget: true, muteSource: true, pauseSource: true, playTarget: true });
});

test('switch while paused: seek so the next play starts at the same moment, no playback started', () => {
  const p = planSwitch({ from: 'B', to: 'A', fromTime: 5, toTime: 0, playing: false, parallel: true });
  assert.equal(p.seek, 5);
  assert.equal(p.playTarget, false);
});

test('switching to the same deck is a no-op', () => {
  assert.equal(planSwitch({ from: 'A', to: 'A', fromTime: 1, toTime: 1, playing: true, parallel: true }).noop, true);
});

test('keys: 1/2 and a/b map to decks', () => {
  assert.equal(deckForKey('1'), 'A'); assert.equal(deckForKey('a'), 'A'); assert.equal(deckForKey('A'), 'A');
  assert.equal(deckForKey('2'), 'B'); assert.equal(deckForKey('B'), 'B');
  assert.equal(deckForKey('3'), null); assert.equal(deckForKey(undefined), null);
});

test('deep link: only safe ids round-trip', () => {
  assert.equal(readDeepLink('#side-a-1234abcd'), 'side-a-1234abcd');
  assert.equal(readDeepLink('#<script>'), '');
  assert.equal(readDeepLink(''), '');
  assert.equal(deepLinkHash('x1'), '#x1');
  assert.equal(deepLinkHash(''), '');
});

test('labels, minutes, chips, dates, reel packs', () => {
  assert.equal(labelTitle('x'.repeat(40)).length, 26);
  assert.equal(labelTitle(''), 'Untitled tape');
  assert.equal(minutesRemoved({ cuts: { removedS: 125 } }), 2);
  assert.equal(minutesRemoved({}), null);
  assert.deepEqual(diagChips({ balanceDb: -1.24, humHz: [50, 100], rolloffHz: 11200, lufs: -15.9 }), ['L/R −1.2 dB', 'hum 50/100 Hz', 'rolloff 11.2 kHz', '−15.9 LUFS']);
  assert.deepEqual(diagChips({ balanceDb: 0.2, humHz: [], rolloffHz: null, lufs: null }), []);
  assert.equal(formatPublished('2026-11-18T10:00:00Z'), '18 Nov 2026');
  assert.equal(formatPublished('bad'), '');
  const start = packRadii(0); const end = packRadii(1);
  assert.ok(start.supply > start.takeUp && end.takeUp > end.supply);
  assert.equal(packRadii(5).supply, packRadii(1).supply);
});
