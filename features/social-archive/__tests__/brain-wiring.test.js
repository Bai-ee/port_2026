import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { loadClientBrainContext } = require('../../client-brain/store.cjs');

// Minimal Firestore-like stub: clients/{id}/client_brain/current + timeline_entries.
function stubDb({ brain, entries = [], throwOnTimeline = false }) {
  const query = (rows) => ({
    where(f, _op, v) { return query(rows.filter((r) => r[f] === v)); },
    limit() { return query(rows); },
    async get() { return { docs: rows.map((r) => ({ id: r.id, data: () => r })), empty: !rows.length, forEach(fn) { this.docs.forEach(fn); } }; },
  });
  return {
    collection(name) {
      if (name === 'clients') {
        return { doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: !!brain, data: () => brain }) }) }) }) };
      }
      if (throwOnTimeline) throw new Error('timeline down');
      const q = query(name === 'timeline_entries' ? entries : []);
      return { ...q, doc: () => ({ get: async () => ({ exists: false, data: () => null }) }) };
    },
  };
}

function withDb(db, fn) {
  const orig = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  Object.defineProperty(fb, 'adminDb', { get: () => db, configurable: true });
  return Promise.resolve(fn()).finally(() => Object.defineProperty(fb, 'adminDb', orig));
}

const approved = { status: 'approved', aiContextPack: { shortContext: 'Be plain.' } };
const mk = (i) => ({
  id: `e${i}`, clientId: 'c1', platform: 'instagram', account: 'a', kind: 'post', audience: 'public',
  ts: `2019-05-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`, day: `2019-05-${String(10 + i).padStart(2, '0')}`,
  text: `late night session number ${i} #housepit`, hashtags: ['housepit'], mentions: [],
});

test('no opts: output identical to base context', async () => {
  await withDb(stubDb({ brain: approved, entries: [mk(1)] }), async () => {
    assert.equal(await loadClientBrainContext('c1'), 'Be plain.');
    assert.equal(await loadClientBrainContext('c1', { platform: '  ', topic: '' }), 'Be plain.');
  });
});

test('unapproved brain + opts: still empty', async () => {
  await withDb(stubDb({ brain: { ...approved, status: 'draft' }, entries: [mk(1)] }), async () => {
    assert.equal(await loadClientBrainContext('c1', { platform: 'instagram' }), '');
  });
});

test('approved brain + platform: timeline block appended', async () => {
  await withDb(stubDb({ brain: approved, entries: [mk(1), mk(2), mk(3)] }), async () => {
    const out = await loadClientBrainContext('c1', { platform: 'instagram' });
    assert.ok(out.startsWith('Be plain.\n\nPLATFORM VOICE (instagram'), out);
    assert.ok(out.includes('EXAMPLES:'));
  });
});

test('timeline error: original context returned', async () => {
  await withDb(stubDb({ brain: approved, throwOnTimeline: true }), async () => {
    assert.equal(await loadClientBrainContext('c1', { platform: 'instagram' }), 'Be plain.');
  });
});
