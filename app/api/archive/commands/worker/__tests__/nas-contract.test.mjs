import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../../__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require(path.resolve(process.cwd(), 'api/_lib/__tests__/fake-firestore.cjs'));
const firebaseAdminPath = path.resolve(process.cwd(), 'api/_lib/firebase-admin.cjs');
let n = 0;

async function load(rel) {
  const fake = makeFakeContext();
  require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: fake };
  process.env.HITLOOP_ARCHIVE_WORKER_TOKEN = 'tok';
  n += 1;
  const mod = await import(`${pathToFileURL(path.resolve(process.cwd(), rel)).href}?b=${n}`);
  return { fake, mod };
}
const req = (body) => ({
  headers: { get: (k) => (k.toLowerCase() === 'authorization' ? 'Bearer tok' : null) },
  json: async () => body,
});

test('heartbeat persists capabilities + localThumbBase', async () => {
  const { fake, mod } = await load('app/api/archive/worker/heartbeat/route.js');
  const r = await mod.POST(req({ workerId: 'mac-analyzer', sourceId: 's1', state: 'ONLINE', at: new Date().toISOString(), capabilities: ['ANALYZE_FACETS', 'STAGE_FOR_PUBLISH'], localThumbBase: '/x/thumbs' }));
  assert.equal(r.status, 200);
  const w = fake.adminDb._raw('archive_workers', 'mac-analyzer');
  assert.deepEqual(w.capabilities, ['ANALYZE_FACETS', 'STAGE_FOR_PUBLISH']);
  assert.equal(w.localThumbBase, '/x/thumbs');
});

test('PATCH stores ANALYZE_FACETS progress/estimate result with no side effects', async () => {
  const { fake, mod } = await load('app/api/archive/commands/worker/route.js');
  await fake.adminDb.collection('archive_commands').doc('c1').set({ type: 'ANALYZE_FACETS', workerId: 'mac-analyzer', state: 'QUEUED' });
  const result = { progress: { done: 1, total: 4 }, estimate: { items: 4, usd: 0.02 }, spentUsd: 0.004 };
  const r = await mod.PATCH(req({ commandId: 'c1', state: 'RUNNING', result }));
  assert.equal(r.status, 200);
  assert.deepEqual(fake.adminDb._raw('archive_commands', 'c1').result, result);
  const r2 = await mod.PATCH(req({ commandId: 'c1', state: 'COMPLETE', result }));
  assert.equal(r2.status, 200);
  assert.equal(fake.adminDb._raw('archive_commands', 'c1').state, 'COMPLETE');
});
