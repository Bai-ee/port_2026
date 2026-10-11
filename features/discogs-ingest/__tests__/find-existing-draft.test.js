// PHASE 2: findExistingDraft is client-scoped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { findExistingDraft, discogsClientId } = await import('../service.js');

async function withDb(rows, fn) {
  const db = makeFakeContext().adminDb;
  for (const r of rows) await db.collection('social_posts').doc(r.id).set(r);
  const prev = fb.adminDb;
  Object.defineProperty(fb, 'adminDb', { value: db, configurable: true, writable: true });
  try { return await fn(); } finally { Object.defineProperty(fb, 'adminDb', { value: prev, configurable: true, writable: true }); }
}
const row = (id, clientId) => ({ id, clientId, source: 'discogs-ingest', sourceRef: { releaseId: 42 } });

test('ignores another client\'s row for the same release', async () => {
  const { DISCOGS_SOURCE } = await import('../draft-builder.js');
  const other = { ...row('o1', 'someone-else'), source: DISCOGS_SOURCE };
  await withDb([other], async () => {
    assert.equal(await findExistingDraft(42), null);
  });
});

test('matches the ingest client\'s row even when another client\'s row for the same release exists', async () => {
  const { DISCOGS_SOURCE } = await import('../draft-builder.js');
  const mine = { ...row('m1', discogsClientId()), source: DISCOGS_SOURCE };
  const other = { ...row('o1', 'someone-else'), source: DISCOGS_SOURCE };
  await withDb([other, mine], async () => {
    assert.equal((await findExistingDraft(42))?.id, 'm1');
    assert.equal((await findExistingDraft(42, 'someone-else'))?.id, 'o1');
  });
});
