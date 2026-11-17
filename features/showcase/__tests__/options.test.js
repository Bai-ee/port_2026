import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOptions, normalizeShuffle } from '../options.js';
import focusFile from '../focus.hitloop.json' with { type: 'json' };

const gen = (extra = {}) => generateOptions({ focusFile, videoClient: 'hitloop', date: '2026-11-17', ...extra });

test('same seed gives the same options', () => {
  assert.deepEqual(gen(), gen());
});

test('three unique picks, numbered 1-3, with kinds', () => {
  const opts = gen();
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.map((o) => o.n), [1, 2, 3]);
  assert.equal(new Set(opts.map((o) => o.focusId)).size, 3);
  for (const o of opts) assert.ok(o.kinds.length > 0 && o.title && o.caption);
});

test('format is one of the focus formats', () => {
  for (const date of ['2026-01-01', '2026-02-02', '2026-03-03', '2026-04-04']) {
    for (const o of gen({ date })) {
      assert.ok(focusFile.focuses.find((f) => f.id === o.focusId).formats.includes(o.format));
    }
  }
});

test('shuffle changes the seed; out-of-range shuffle is ignored', () => {
  assert.notDeepEqual(gen({ shuffle: 1 }).map((o) => o.focusId + o.format), gen({ shuffle: 2 }).map((o) => o.focusId + o.format));
  assert.deepEqual(gen({ shuffle: 0 }), gen());
  assert.deepEqual(gen({ shuffle: 21 }), gen());
  assert.deepEqual(gen({ shuffle: 'x' }), gen());
  assert.equal(normalizeShuffle(20), 20);
  assert.equal(normalizeShuffle(1.5), 0);
});

test('recently rendered focuses are excluded', () => {
  const recent = gen().map((o) => o.focusId);
  const next = gen({ recentFocusIds: recent }).map((o) => o.focusId);
  for (const id of recent) assert.ok(!next.includes(id));
  assert.equal(next.length, 3);
});

test('when too few remain, the oldest excluded focus is re-admitted first', () => {
  const all = focusFile.focuses.map((f) => f.id).sort();
  // 6 focuses, 3 recent -> 3 eligible: no re-admit needed; use a 4-focus file so only 1 is eligible.
  const small = { focuses: focusFile.focuses.slice(0, 4) };
  const ids = small.focuses.map((f) => f.id);
  const recentNewestFirst = [ids[0], ids[1], ids[2]];
  const opts = generateOptions({ focusFile: small, videoClient: 'hitloop', date: '2026-11-17', recentFocusIds: recentNewestFirst });
  const picked = opts.map((o) => o.focusId);
  assert.equal(picked.length, 3);
  assert.ok(picked.includes(ids[3]));
  assert.ok(picked.includes(ids[2]), 'oldest excluded (last in newest-first list) comes back first');
  assert.ok(picked.includes(ids[1]));
  assert.ok(!picked.includes(ids[0]), 'newest recent stays excluded');
  assert.ok(all.length >= 4);
});
