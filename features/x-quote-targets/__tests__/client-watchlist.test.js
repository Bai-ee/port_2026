import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWatchlist, watchlistFromXGrowth, readClientWatchlist, resolveScanClients, selectScanTargets } from '../client-watchlist.js';
import { HOME_SEED_WATCHLIST } from '../watchlist.js';

const fakeDb = (configs) => {
  const reads = [];
  return {
    reads,
    collection: (name) => ({
      doc: (id) => ({
        get: async () => { reads.push(`${name}/${id}`); return { exists: !!configs[id], data: () => configs[id] }; },
      }),
    }),
  };
};

test('normalizeWatchlist keeps well-formed entries only, de-duplicated, @ stripped', () => {
  const out = normalizeWatchlist([
    { handle: '@rare_jpg', vein: 'japanese-asian-design', note: 'n' },
    { handle: 'RARE_JPG', vein: 'x' },
    { handle: 'bad handle!', vein: 'v' },
    { handle: 'novein' },
    null, 'str',
    { handle: 'maker', vein: 'craft-tools', unproven: 1 },
  ]);
  assert.deepEqual(out, [
    { handle: 'rare_jpg', vein: 'japanese-asian-design', note: 'n' },
    { handle: 'maker', vein: 'craft-tools', unproven: true },
  ]);
  assert.deepEqual(normalizeWatchlist(undefined), []);
  assert.deepEqual(watchlistFromXGrowth(null), []);
});

test('readClientWatchlist: the client\'s own stored list; absent => [] (never the home seed)', async () => {
  const db = fakeDb({
    home: { marketingBriefConfig: { xGrowth: { watchlist: HOME_SEED_WATCHLIST } } },
    b: { marketingBriefConfig: { xGrowth: { watchlist: [{ handle: 'b_target', vein: 'craft-tools' }] } } },
    c: { marketingBriefConfig: { xGrowth: { ownHandle: 'c_acct' } } },
  });
  assert.equal((await readClientWatchlist(db, 'home')).length, HOME_SEED_WATCHLIST.length);
  assert.deepEqual(await readClientWatchlist(db, 'b'), [{ handle: 'b_target', vein: 'craft-tools' }]);
  assert.deepEqual(await readClientWatchlist(db, 'c'), []);
  assert.deepEqual(await readClientWatchlist(db, 'missing'), []);
  assert.deepEqual(await readClientWatchlist(db, ''), []);
  assert.deepEqual(await readClientWatchlist(db, 'a/b'), []);
  assert.deepEqual(db.reads, ['client_configs/home', 'client_configs/b', 'client_configs/c', 'client_configs/missing']);
});

test('resolveScanClients: --client / --clients / --pilot, ordered + de-duplicated; nothing => error (no default client)', () => {
  assert.deepEqual(resolveScanClients({ client: 'a' }), { clientIds: ['a'] });
  assert.deepEqual(resolveScanClients({ clients: 'a, b,,c,a' }), { clientIds: ['a', 'b', 'c'] });
  assert.deepEqual(resolveScanClients({ pilot: true }, { PILOT_CLIENT_IDS: ' x , y ' }), { clientIds: ['x', 'y'] });
  assert.deepEqual(resolveScanClients({ client: 'a', pilot: true }, { PILOT_CLIENT_IDS: 'a,z' }), { clientIds: ['a', 'z'] });
  assert.match(resolveScanClients({}).error, /client is required/);
  assert.match(resolveScanClients({ pilot: true }, {}).error, /PILOT_CLIENT_IDS/);
  assert.match(resolveScanClients({ clients: 'ok,../evil' }).error, /invalid client id/);
});

test('selectScanTargets: proven first, rotation, --only within the client list; empty list => []', () => {
  const list = [
    { handle: 'u1', vein: 'v', unproven: true },
    { handle: 'p1', vein: 'v' },
    { handle: 'p2', vein: 'v' },
    { handle: 'u2', vein: 'v', unproven: true },
  ];
  assert.deepEqual(selectScanTargets(list).map((a) => a.handle), ['p1', 'p2', 'u1', 'u2']);
  assert.deepEqual(selectScanTargets(list, { maxAccounts: 2 }).map((a) => a.handle), ['p1', 'p2']);
  assert.deepEqual(selectScanTargets(list, { maxAccounts: 2, offset: 3 }).map((a) => a.handle), ['u2', 'p1']);
  assert.deepEqual(selectScanTargets(list, { only: '@P2' }).map((a) => a.handle), ['p2']);
  assert.deepEqual(selectScanTargets(list, { only: 'rare_jpg' }), [], 'a seed handle not on this client list is not scanned');
  assert.deepEqual(selectScanTargets([], { maxAccounts: 15 }), []);
  assert.deepEqual(selectScanTargets(undefined), []);
});
