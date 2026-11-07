import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUploadUrls, handleResults, handleMonths, handleMonth, handleItem, mapLimit } from '../http.js';
import { sha } from './_fixtures.js';

const post = (body, tok) => ({ headers: new Headers(tok ? { authorization: `Bearer ${tok}` } : {}), json: async () => body });
const get = (url, tok) => ({ url, headers: new Headers(tok ? { authorization: `Bearer ${tok}` } : {}) });
const workerAuthStatus = (r) => {
  if (process.env.__NOTOKEN) return 503;
  return r.headers.get('authorization') === 'Bearer w' ? 200 : 401;
};
const ownerDeps = {
  env: { LIFE_OWNER_UIDS: 'owner' },
  verifyRequestUser: async (r) => { if (r.headers.authorization === 'Bearer o') return { uid: 'owner' }; throw new Error('x'); },
};
const id = sha('a').slice(0, 16);
const deps = {
  workerAuthStatus, ownerDeps,
  signUpload: async ({ storagePath }) => `u:${storagePath}`,
  signRead: async (p) => `r:${p}`,
  listMonths: async () => [{ ym: '2010-06', count: 2 }, { ym: '2010-05', count: 1 }, { ym: 'unknown', count: 4 }],
  readMonth: async (ym) => (ym === '2010-05' ? { items: [{ id, t: 'x', k: 'i', w: 1, h: 1, m: false, d: null }] } : null),
  getItem: async (i) => (i === id ? { id, canonicalPath: 'HITLOOP-ARCHIVE/timeline/x', thumbs: { s: 'S', m: 'M' } } : null),
};

test('worker routes: 503/401/400/200', async () => {
  process.env.__NOTOKEN = '1';
  assert.equal((await handleUploadUrls(post({}, 'w'), deps)).status, 503);
  assert.equal((await handleResults(post({}, 'w'), deps)).status, 503);
  delete process.env.__NOTOKEN;
  assert.equal((await handleUploadUrls(post({}, 'bad'), deps)).status, 401);
  assert.equal((await handleResults(post({}, null), deps)).status, 401);
  assert.equal((await handleUploadUrls(post({ items: [] }, 'w'), deps)).status, 400);
  const ok = await handleUploadUrls(post({ items: [{ sha256: sha('a'), variant: 's', contentType: 'image/jpeg', sizeBytes: 9 }] }, 'w'), deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.equal((await handleResults(post({ source: {}, items: [] }, 'w'), deps)).status, 400);
});
test('owner routes gate', async () => {
  assert.equal((await handleMonths(get('http://x/api/life/months'), deps)).status, 401);
  assert.equal((await handleMonths(get('http://x/api/life/months'), { ...deps, ownerDeps: { ...ownerDeps, env: {} } })).status, 503);
});
test('months', async () => {
  const r = await handleMonths(get('http://x/api/life/months', 'o'), deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.months.map((m) => m.ym), ['2010-05', '2010-06']);
  assert.equal(r.body.unknownCount, 4);
  assert.equal(r.body.total, 7);
});
test('month', async () => {
  assert.equal((await handleMonth(get('http://x/m?ym=2010-13', 'o'), deps)).status, 400);
  const r = await handleMonth(get('http://x/m?ym=2010-05', 'o'), deps);
  assert.equal(r.body.items[0].thumbUrl, `r:life-thumbs/${id}_s.jpg`);
  assert.ok(r.body.expiresAt);
  assert.equal((await handleMonth(get('http://x/m?ym=unknown', 'o'), deps)).status, 200);
});
test('item', async () => {
  assert.equal((await handleItem(get('http://x/i?id=zz', 'o'), deps)).status, 400);
  assert.equal((await handleItem(get(`http://x/i?id=${'0'.repeat(16)}`, 'o'), deps)).status, 404);
  const r = await handleItem(get(`http://x/i?id=${id}`, 'o'), deps);
  assert.equal(r.body.item.canonicalPath, undefined);
  assert.equal(r.body.previewUrl, 'r:M');
  assert.equal(r.body.thumbUrl, 'r:S');
});
test('mapLimit respects concurrency', async () => {
  let cur = 0; let peak = 0;
  await mapLimit(Array.from({ length: 50 }, (_, i) => i), 16, async () => { cur += 1; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 1)); cur -= 1; });
  assert.ok(peak <= 16);
});
