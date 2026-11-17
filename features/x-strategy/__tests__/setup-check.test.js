import test from 'node:test';
import assert from 'node:assert/strict';
import { strategySetupStatus, setupStatusText } from '../setup-check.js';
import { usesDefaultBuckets, mergeBuckets, DEFAULT_BUCKETS } from '../../x-content-inventory/buckets.js';
import { buildSystemPrompt } from '../agent/prompt.js';

const codes = (s) => s.blockers.map((b) => b.code);

test('Critters Quest today: handle set, no posts pulled, no tracks -> two blockers; no X connection is only a note', () => {
  const s = strategySetupStatus({ handle: 'crittersquest', ownRows: 0, buckets: [], benchmarkHandles: [], xConnected: false });
  assert.equal(s.ready, false);
  assert.deepEqual(codes(s), ['no-own-posts', 'no-tracks']);
  assert.ok(s.notes.some((n) => n.includes('only needed to auto-post')));
  const text = setupStatusText(s);
  assert.ok(text.startsWith('SETUP BLOCKERS (hard)'));
  assert.ok(text.includes('@crittersquest') && text.includes('Strategy accounts'));
});

test('ready when the handle has posts and at least one active track; no handle is its own blocker', () => {
  const ok = strategySetupStatus({ handle: 'a', ownRows: 40, buckets: [{ id: 'live-play' }], benchmarkHandles: ['b'], xConnected: true });
  assert.deepEqual([ok.ready, ok.blockers, ok.notes], [true, [], []]);
  assert.equal(setupStatusText(ok), '');
  assert.deepEqual(codes(strategySetupStatus({ handle: null, ownRows: 0, buckets: [{ id: 'x', active: false }] })), ['no-handle', 'no-tracks']);
});

test('the blocker block rides in the system prompt only when there is one', () => {
  const s = strategySetupStatus({ handle: 'crittersquest', ownRows: 0, buckets: [] });
  assert.ok(buildSystemPrompt({ setupStatus: setupStatusText(s) }).includes('SETUP BLOCKERS'));
  assert.equal(buildSystemPrompt({}).includes('SETUP BLOCKERS'), false);
});

test('seed buckets only for clients built on them; a new client or own-track client gets its own only', () => {
  assert.equal(usesDefaultBuckets([], { itemBucketIds: [] }), false); // new client (Critters Quest)
  assert.equal(usesDefaultBuckets([], { itemBucketIds: [null] }), true); // legacy client with items (UE, Discogs)
  assert.equal(usesDefaultBuckets([{ id: 'record' }, { id: 'xyz' }]), true); // home: stores seed ids
  assert.equal(usesDefaultBuckets([{ id: 'live-play' }], { itemBucketIds: ['live-play'] }), false); // own tracks only
  assert.equal(usesDefaultBuckets([{ id: 'custom' }], { itemBucketIds: ['custom', null] }), true); // legacy items keep their seeds
  assert.deepEqual(mergeBuckets([], { withDefaults: false }), []);
  assert.deepEqual(mergeBuckets([{ id: 'live-play', name: 'Live play', order: 0 }], { withDefaults: false }).map((b) => b.id), ['live-play']);
  assert.equal(mergeBuckets([]).length, DEFAULT_BUCKETS.length); // default behaviour unchanged
});
