// Rendered-feed ownership: RENDERED_VIDEOS_CLIENT_ID wins, else NAS_INVENTORY_CLIENT_ID; other clients are a no-op.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mediaOwnerClientId, syncRenderedVideosForClient } from '../firestore-sync.js';

const saved = { r: process.env.RENDERED_VIDEOS_CLIENT_ID, n: process.env.NAS_INVENTORY_CLIENT_ID };
const restore = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
afterEach(() => { restore('RENDERED_VIDEOS_CLIENT_ID', saved.r); restore('NAS_INVENTORY_CLIENT_ID', saved.n); });

test('RENDERED_VIDEOS_CLIENT_ID unset => the NAS owner owns the feed', () => {
  delete process.env.RENDERED_VIDEOS_CLIENT_ID;
  process.env.NAS_INVENTORY_CLIENT_ID = 'nas-owner';
  assert.equal(mediaOwnerClientId(), 'nas-owner');
});

test('RENDERED_VIDEOS_CLIENT_ID set => it owns the feed; neither set => null', () => {
  process.env.NAS_INVENTORY_CLIENT_ID = 'nas-owner';
  process.env.RENDERED_VIDEOS_CLIENT_ID = 'ue-owner';
  assert.equal(mediaOwnerClientId(), 'ue-owner');
  delete process.env.RENDERED_VIDEOS_CLIENT_ID;
  delete process.env.NAS_INVENTORY_CLIENT_ID;
  assert.equal(mediaOwnerClientId(), null);
});

test('a client that does not own the feed is skipped not-owner (NAS owner too once the feed is moved)', async () => {
  process.env.NAS_INVENTORY_CLIENT_ID = 'nas-owner';
  process.env.RENDERED_VIDEOS_CLIENT_ID = 'ue-owner';
  for (const clientId of ['nas-owner', 'someone-else', '']) {
    const r = await syncRenderedVideosForClient({ db: null, bridge: null, upsert: null, clientId });
    assert.equal(r.skipped, 'not-owner');
  }
});
