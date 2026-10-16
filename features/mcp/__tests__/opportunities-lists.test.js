import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaders } from '../readers.js';
import { createFakeDb } from './fake-db.js';

const iso = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

test('readOpportunities merges listSignals, drops dismissed ids, exposes trackId/source', async () => {
  const db = createFakeDb({
    'dashboard_state/c1': {
      marketingBrief: {
        quoteTargets: { generatedAt: iso(1), dismissed: ['l2'], candidates: [{ id: 'h1', url: 'u1', author: 'a', text: 'x', createdAt: iso(1) }] },
        listSignals: { generatedAt: iso(1), byTrack: { design: { posts: [
          { id: 'l1', url: 'u2', text: 'y', createdAt: iso(2), author: { username: 'b' } },
          { id: 'l2', url: 'u3', text: 'z', createdAt: iso(2) },
        ] } } },
      },
    },
  });
  const out = await createReaders(db).strategyExtras.readOpportunities('c1');
  assert.deepEqual(out.targets.map((t) => t.id), ['h1', 'l1']);
  assert.equal(out.targets[0].trackId, undefined);
  assert.equal(out.targets[1].trackId, 'design');
  assert.equal(out.targets[1].source, 'list');
  assert.equal(out.targets[1].handle, 'b');
});
