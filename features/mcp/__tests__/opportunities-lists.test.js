import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaders } from '../readers.js';
import { createFakeDb } from './fake-db.js';

const iso = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

test('readOpportunities reads hot picks only (drops dismissed + closed windows), never the legacy watchlist scan', async () => {
  const scannedAt = iso(2);
  const db = createFakeDb({
    'dashboard_state/c1': {
      marketingBrief: {
        hotQuotes: {
          scannedAt, quotesLeftToday: 3, dismissed: ['d2'],
          picks: {
            design: [
              { id: 'd1', url: 'https://x.com/a/status/d1', author: 'a', text: 'x', createdAt: iso(5), lane: 'design', momentum: 'climbing', fit: 0.7, rank: 2 },
              { id: 'd2', url: 'https://x.com/a/status/d2', author: 'a', text: 'y', createdAt: iso(5), lane: 'design', rank: 1 },
              { id: 'd3', url: 'https://x.com/a/status/d3', author: 'a', text: 'z', createdAt: iso(50), lane: 'design', windowHours: 36, rank: 3 },
            ],
            music: [{ id: 'm1', url: 'https://x.com/b/status/m1', author: 'b', text: 'm', createdAt: iso(10), lane: 'music', windowHours: 72, momentum: 'new', fit: 0.66, rank: 1 }],
          },
        },
        quoteTargets: { generatedAt: iso(14), candidates: [{ id: 'legacy', url: 'u1', author: 'a', text: 'x', createdAt: iso(1) }] },
      },
    },
  });
  const out = await createReaders(db).strategyExtras.readOpportunities('c1');
  assert.equal(out.source, 'marketingBrief.hotQuotes');
  assert.equal(out.generatedAt, scannedAt);
  assert.equal(out.stale, false);
  assert.equal(out.quotesLeftToday, 3);
  assert.deepEqual(out.targets.map((t) => t.id), ['d1', 'm1']);
  assert.deepEqual([out.targets[0].lane, out.targets[0].momentum, out.targets[0].fit, out.targets[0].windowOpen], ['design', 'climbing', 0.7, true]);
  assert.equal(out.targets[1].handle, 'b');
});

test('readOpportunities with no hot scan: null as-of, no targets (the legacy scan is not a fallback)', async () => {
  const db = createFakeDb({ 'dashboard_state/c1': { marketingBrief: { quoteTargets: { generatedAt: iso(1), candidates: [{ id: 'legacy', createdAt: iso(1) }] } } } });
  const out = await createReaders(db).strategyExtras.readOpportunities('c1');
  assert.deepEqual([out.generatedAt, out.stale, out.targets], [null, null, []]);
});
