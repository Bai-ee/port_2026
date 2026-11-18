// og-preview route: client-brief branch (admin-only, writes nothing, no invoice
// needed, same renderer + meta as the public /og-image) and the invoice branch
// unchanged. Fakes: auth + firebase (any use of Firestore/Storage fails the test).

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire, register } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const stub = (rel, exports) => {
  const file = path.join(ROOT, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const touched = [];
const trap = new Proxy({}, { get: (_t, prop) => { touched.push(String(prop)); throw new Error(`og-preview must not touch ${String(prop)}`); } });
stub('api/_lib/firebase-admin.cjs', trap);
const admins = new Set(['owner@example.com']);
stub('api/_lib/auth.cjs', {
  verifyAdminRequest: async (req) => {
    const token = req.headers.authorization || '';
    const email = token.replace('Bearer ', '');
    if (!token) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
    if (!admins.has(email)) { const e = new Error('Forbidden: admin access required.'); e.status = 403; throw e; }
    return { email };
  },
});
register('./next-server-stub-hooks.mjs', import.meta.url);
const route = await import('../og-preview/route.js');
const metaLib = await import('../../../../briefs/_lib/custom-briefs.js');

const req = (body, email = 'owner@example.com') => ({
  headers: { get: (k) => (k.toLowerCase() === 'authorization' ? (email ? `Bearer ${email}` : null) : null) },
  json: async () => body,
});
const CB = {
  kind: 'client-brief', title: 'Weekly Plan', clientName: 'Rosita', description: 'First paragraph.',
  ogLabel: 'NTR', ogSubhead: 'Sub', hideOgSubhead: false, ogTitleLines: ['A', 'B', 'C', 'D'], ogLines: ['x', 'y', 'z'],
};

test('client-brief: renders a JPEG with no invoice, writes nothing', async () => {
  const res = await route.POST(req(CB));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  assert.deepEqual(touched, [], 'no Firestore / Storage access');
});

test('client-brief: admin only (401 signed out, 403 non-admin)', async () => {
  assert.equal((await route.POST(req(CB, ''))).status, 401);
  assert.equal((await route.POST(req(CB, 'user@example.com'))).status, 403);
});

test('client-brief preview meta == the stored-brief meta used by the public og-image', () => {
  const preview = metaLib.buildClientBriefOgPreviewMeta({
    title: 'Weekly Plan', clientName: 'Rosita', description: 'First paragraph.', ogLabel: 'NTR', ogSubhead: 'Sub',
    hideOgSubhead: false, ogTitleLines: ['A', 'B', 'C'], ogLines: ['x', 'y'],
  });
  const stored = metaLib.buildBriefOpenGraphMeta({
    origin: 'https://h.test', clientId: 'c', client: { companyName: 'Rosita' }, snapshotId: 's',
    brief: { kind: 'client-brief', title: 'Weekly Plan', description: 'First paragraph.', ogLabel: 'NTR', ogSubhead: 'Sub', ogTitleLines: ['A', 'B', 'C'], ogLines: ['x', 'y'], publicBriefSlug: 's', publicClientSlug: 'c' },
  });
  for (const key of ['title', 'description', 'ogVariant', 'ogLabel', 'ogSubhead', 'hideOgSubhead', 'ogTitleLines', 'ogLines', 'ogTiles']) {
    assert.deepEqual(preview[key], stored[key], key);
  }
  assert.equal(preview.ogVariant, 'invoice');
});

test('client-brief meta: subhead falls back to the description; limit of 3 title lines', () => {
  const meta = metaLib.buildClientBriefOgPreviewMeta({ title: 'T', description: 'Para', ogTitleLines: ['1', '2', '3', '4'], ogLines: [] });
  assert.equal(meta.ogSubhead, 'Para');
  assert.equal(meta.description, 'Para');
  assert.deepEqual(meta.ogTitleLines, ['1', '2', '3']);
});

test('invoice branch unchanged: still requires `invoice`, still renders with one', async () => {
  const missing = await route.POST(req({ title: 'x' }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'invoice is required.' });
  const ok = await route.POST(req({ title: 'Invoice 1', invoice: { invoiceNumber: '1', billTo: { name: 'Acme' }, totals: { total: 100 }, currency: 'USD' }, ogLines: ['a'] }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
});
