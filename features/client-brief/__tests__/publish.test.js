import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_BRIEF_SLUG_RE, allowsFuzzyResolve, buildClientBrief, isClientBriefData, newClientBriefSlug, selectBriefsForViewer,
} from '../publish.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('slug: date + 16 hex, random per call, deterministic with injected rng', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  assert.equal(newClientBriefSlug({ now, randomHex: () => 'abcdef0123456789' }), 'client-brief-20261118-abcdef0123456789');
  const a = newClientBriefSlug({ now });
  const b = newClientBriefSlug({ now });
  assert.match(a, CLIENT_BRIEF_SLUG_RE);
  assert.notEqual(a, b);
});

test('fuzzy resolution is blocked only for client briefs', () => {
  assert.equal(allowsFuzzyResolve({ kind: 'client-brief' }), false);
  assert.equal(allowsFuzzyResolve({ kind: 'brief' }), true);
  assert.equal(allowsFuzzyResolve({ kind: 'invoice' }), true);
  assert.equal(allowsFuzzyResolve({}), true);
  assert.equal(isClientBriefData(null), false);
});

test('selectBriefsForViewer: visibility by role and filter', () => {
  const rows = [
    { id: 'a', kind: 'brief', public: true },
    { id: 'b', kind: 'brief', public: false },
    { id: 'c', kind: 'invoice', public: true },
    { id: 'd', kind: 'client-brief', public: true },
    { id: 'e', kind: 'client-brief', public: false },
  ];
  const ids = (list) => list.map((r) => r.id);
  assert.deepEqual(ids(selectBriefsForViewer(rows, { isAdmin: false })), ['a', 'c']);
  assert.deepEqual(ids(selectBriefsForViewer(rows, { isAdmin: false, kindFilter: 'client-brief' })), []);
  assert.deepEqual(ids(selectBriefsForViewer(rows, { isAdmin: true })), ['a', 'c']);
  assert.deepEqual(ids(selectBriefsForViewer(rows, { isAdmin: true, kindFilter: 'invoice' })), ['c']);
  assert.deepEqual(ids(selectBriefsForViewer(rows, { isAdmin: true, kindFilter: 'client-brief' })), ['d', 'e']);
});

test('buildClientBrief: parses + renders from body only; asOf defaults to today, bad asOf ignored', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const { model, html } = buildClientBrief({ body: { text: '## A\nK: v', title: 'T', asOf: 'garbage' }, clientName: 'Co', pdfPath: '/p/pdf', now });
  assert.equal(model.asOf, '2026-11-18');
  assert.equal(model.clientName, 'Co');
  assert.match(html, /Download PDF/);
  assert.throws(() => buildClientBrief({ body: { text: '' }, clientName: 'Co', now }), { code: 'empty' });
  // html in the body is never used
  const evil = buildClientBrief({ body: { text: '## A\nx', html: '<script>1</script>' }, clientName: 'Co', now });
  assert.ok(!evil.html.includes('<script>1'));
});

test('digest link: newest public brief ignores client briefs', async () => {
  const docs = [
    { id: 'client-brief-20261118-aaaaaaaaaaaaaaaa', data: { kind: 'client-brief', public: true, publicClientSlug: 'cc', publicBriefSlug: 'client-brief-20261118-aaaaaaaaaaaaaaaa', updatedAt: '2026-11-18T10:00:00Z' } },
    { id: 'daily', data: { kind: 'brief', public: true, publicClientSlug: 'cc', publicBriefSlug: 'daily', updatedAt: '2026-11-01T10:00:00Z' } },
  ];
  const db = {
    collection: () => ({ doc: () => ({ collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({
      empty: false, docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    }) }) }) }) }) }),
  };
  // digest link: stub firebase-admin before the CJS module loads
  const fbPath = path.join(ROOT, 'api/_lib/firebase-admin.cjs');
  const linkPath = path.join(ROOT, 'features/intelligence/_digest-brief-link.js');
  const prevFb = require.cache[fbPath];
  delete require.cache[linkPath];
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { adminDb: db } };
  try {
    const { getLatestPublishedBrief } = require(linkPath);
    assert.equal((await getLatestPublishedBrief('c1')).path, '/briefs/cc/daily');
    docs.splice(1, 1); // only the client brief left -> nothing to link
    assert.equal(await getLatestPublishedBrief('c1'), null);
  } finally {
    delete require.cache[linkPath];
    if (prevFb) require.cache[fbPath] = prevFb; else delete require.cache[fbPath];
  }
});
