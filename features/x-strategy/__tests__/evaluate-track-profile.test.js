import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../evaluate.js';
import { trackEvalLines } from '../insights.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86400000;
const mk = (n, startMs, over = {}) => Array.from({ length: n }, (_, i) => {
  const ms = startMs + i * 6 * 3600000;
  return { id: `${over.p || 'r'}${i}`, utc: new Date(ms).toISOString(), dateLocal: new Date(ms).toISOString().slice(0, 10), hourLocal: 10, type: i % 2 ? 'original-text' : 'original-showcase', media: i % 2 ? 'none' : 'video', topics: [], chars: 80, likes: 3, reposts: 0, replies: 0, views: 200, ...over };
});
const plan = { authoredPerDay: 3, engineTargets: { engines: { client: { targetPerDay: 1.5 }, identity: { targetPerDay: 0.5 } } }, contentTracks: [] }; // [] normalizes to the default two tracks

test('byTrack carries benchmarkProfile, target and 14-day actual per track without blending', () => {
  const v = evaluate({
    ownHandle: 'me', ownRows: [...mk(28, NOW - 14 * DAY + 3600000, { p: 'o' }), ...mk(10, NOW - 60 * DAY, { p: 'old' })], ownMeta: null,
    benchmarks: [{ handle: 'seb__design', rows: mk(40, NOW - 20 * DAY, { p: 's' }), meta: null }], plan, now: NOW,
  });
  const [design, music] = v.byTrack;
  assert.deepEqual(design.benchmarkProfile.handles, ['seb__design']);
  assert.equal(design.benchmarkProfile.rows, 40);
  assert.equal(music.benchmarkProfile, null);
  assert.equal(design.actual.windowDays, 14);
  assert.equal(design.actual.rows, 28);
  assert.equal(design.actual.postsPerDay, 2);
  assert.equal(design.target.source, 'plan-engine-targets');
  assert.equal(design.target.brainShares, null);
  assert.ok(design.target.postsPerDay > 0);
  assert.equal(music.benchmarkProfile, null);
});

test('Brain shares pass through by track label; trackEvalLines formats three lines', () => {
  const v = evaluate({
    ownHandle: 'me', ownRows: mk(5, NOW - 3 * DAY), ownMeta: null, benchmarks: [{ handle: 'seb__design', rows: mk(40, NOW - 20 * DAY), meta: null }],
    plan, now: NOW, brainTrackTargets: [{ track: 'design & client work', postsPerDay: 2, reply: 30, video: 40 }],
  });
  assert.deepEqual(v.byTrack[0].target.brainShares, { reply: 30, video: 40 });
  const lines = trackEvalLines(v.byTrack[0]);
  assert.match(lines.benchmark, /@seb__design/);
  assert.match(lines.target, /reply 30%/);
  assert.match(lines.actual, /last 14 days/);
  assert.equal(trackEvalLines({}), null);
});
