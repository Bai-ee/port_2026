import test from 'node:test';
import assert from 'node:assert/strict';
import { REFRESH_GROUPS, paidGroupsFor, estimateFor, isXApiSource } from '../refresh-groups.js';
import { GROUP_RUNNERS } from '../refresh-runners.js';

const cfg = { xGrowth: { ownHandle: 'me', benchmarkHandles: ['a', 'b'], watchlist: [{ handle: 'w' }, { handle: 'x' }] } };

test('quote-targets group exists; both X data groups are free on the Mac and paid on the X API', () => {
  assert.ok(REFRESH_GROUPS.some((g) => g.id === 'quote-targets'));
  assert.deepEqual(paidGroupsFor({ ids: ['strategy-accounts', 'quote-targets'] }), []);
  const paid = paidGroupsFor({ ids: ['strategy-accounts', 'quote-targets'], dataSources: { strategyAccounts: 'x-api', quoteTargets: 'x-api' } }, { marketingBriefConfig: cfg });
  assert.deepEqual(paid.map((p) => p.id), ['strategy-accounts', 'quote-targets']);
  assert.equal(paid[0].estimate.calls, 3 + 3 * 3);
  assert.equal(paid[1].estimate.calls, 2 + 2);
  assert.match(paid[0].cost, /Paid X API/);
  assert.equal(isXApiSource('market-signals', { strategyAccounts: 'x-api' }), false);
});

test('estimateFor stays free for the Mac source', () => {
  assert.deepEqual(estimateFor('strategy-accounts', { marketingBriefConfig: cfg }), { text: 'free', usd: 0 });
  assert.deepEqual(estimateFor('quote-targets', {}), { text: 'free', usd: 0 });
});

test('runners: an x-api run needs xApiConfirmed; with it the call carries confirmPaid; mac source never sends it', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  let source = 'x-api';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const json = body.action === 'x-data-sources-get' ? { ok: true, dataSources: { strategyAccounts: source, quoteTargets: source } } : { ok: true, handles: {}, calls: 2, posts: 5 };
    return { ok: true, json: async () => json };
  };
  try {
    const ctx = { clientId: 'c1', options: {} };
    await assert.rejects(() => GROUP_RUNNERS['strategy-accounts'](ctx), /confirm its estimate/);
    assert.ok(!sent.some((b) => b.confirmPaid));
    await GROUP_RUNNERS['strategy-accounts']({ ...ctx, options: { xApiConfirmed: true } });
    assert.equal(sent.at(-1).confirmPaid, true);
    source = 'mac';
    sent.length = 0;
    await GROUP_RUNNERS['strategy-accounts'](ctx);
    assert.ok(!sent.some((b) => b.confirmPaid));
  } finally { globalThis.fetch = realFetch; }
});
