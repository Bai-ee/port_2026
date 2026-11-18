// Client Brief — route + public-resolver behavior against in-memory fakes.
// Stubs (via require.cache, installed BEFORE the route is imported): firebase
// admin (tiny in-memory Firestore + Storage), auth, dashboard bootstrap,
// Browserless PDF persistence, Vercel brief deletion. Nothing touches the
// network; the Vercel stub fails the test if it is ever called.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire, register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertFirestoreSafe } from '../../../../../features/client-brief/__tests__/firestore-safe.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const stub = (rel, exports) => {
  const file = path.join(ROOT, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// ---- fake Firestore / Storage ----
const DELETE = { __delete: true };
const TS = { __ts: true };
const store = new Map(); // path -> data
const writes = [];
const storageDeletes = [];
const storagePrefixDeletes = [];
const order = [];

function applyMerge(prev, incoming) {
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === DELETE) delete out[k];
    else out[k] = v;
  }
  return out;
}
function docRef(p) {
  return {
    id: p.split('/').pop(),
    path: p,
    get: async () => ({ exists: store.has(p), id: p.split('/').pop(), ref: docRef(p), data: () => (store.has(p) ? { ...store.get(p) } : undefined) }),
    set: async (data, opts) => { assertFirestoreSafe(data, p); if (state.failDocSet && p.includes('/custom_briefs/')) throw new Error('firestore down'); order.push(`set:${p.split('/').pop()}`); writes.push(p); store.set(p, opts?.merge ? applyMerge(store.get(p), data) : applyMerge({}, data)); },
    delete: async () => { writes.push(p); store.delete(p); },
    collection: (name) => colRef(`${p}/${name}`),
  };
}
function snapshotOf(entries) {
  const docs = entries.map(([p]) => ({ id: p.split('/').pop(), exists: true, ref: docRef(p), data: () => ({ ...store.get(p) }) }));
  return { empty: docs.length === 0, docs };
}
function colRef(p, filters = [], max = Infinity) {
  const list = () => [...store.entries()].filter(([k]) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/'))
    .filter(([, d]) => filters.every(([f, v]) => d[f] === v)).slice(0, max);
  return {
    doc: (id) => docRef(`${p}/${id}`),
    where: (f, _op, v) => colRef(p, [...filters, [f, v]], max),
    limit: (n) => colRef(p, filters, n),
    get: async () => snapshotOf(list()),
  };
}
const fakeFb = {
  FieldValue: { serverTimestamp: () => TS, delete: () => DELETE },
  adminDb: { collection: (name) => colRef(name) },
  adminStorage: {
    bucket: () => ({
      file: (storagePath) => ({ delete: async () => { if (state.failStorageDelete) throw new Error('storage down'); storageDeletes.push(storagePath); } }),
      getFiles: async ({ prefix }) => { storagePrefixDeletes.push(prefix); return [[]]; },
    }),
  },
};

// ---- other stubs ----
const state = { failDocSet: false, failStorageDelete: false, pdfThrows: false, adminEmail: 'owner@example.com', admins: new Set(['owner@example.com']), pdfCalls: [], vercelCalls: 0 };
const CLIENT = { companyName: "Rosita's Tacos", publicClientSlug: 'rositas' };
stub('api/_lib/firebase-admin.cjs', fakeFb);
const authFn = async (req) => {
  const token = req.headers.authorization || '';
  if (!token) throw new Error('Unauthorized: missing token.');
  const email = token.replace('Bearer ', '');
  return { uid: `uid-${email}`, email };
};
stub('api/_lib/auth.cjs', {
  verifyRequestUser: authFn,
  isAdminEmail: async (email) => state.admins.has(String(email).toLowerCase()),
  verifyAdminRequest: async (req) => {
    const decoded = await authFn(req);
    if (!state.admins.has(String(decoded.email).toLowerCase())) throw new Error('Forbidden: admin access required.');
    return decoded;
  },
});
stub('api/_lib/client-provisioning.cjs', {
  getDashboardBootstrap: async () => ({ effectiveClientId: 'client-1', client: CLIENT }),
});
stub('api/_lib/browserless.cjs', {
  persistBriefPdfArtifact: async (args) => {
    order.push('pdf');
    state.pdfCalls.push(args);
    if (state.pdfThrows) throw new Error('browserless down');
    return { ok: true, artifactRef: { storagePath: `clients/rositas/brief-runs/${args.storageBriefKey}/x.pdf`, bucket: 'b', downloadUrl: 'https://dl/x', fileName: args.fileName } };
  },
});
stub('api/_lib/vercel-briefs.cjs', {
  deleteCustomBriefFromVercel: async () => { state.vercelCalls += 1; return { ok: true, skipped: true }; },
});

register('./next-server-stub-hooks.mjs', import.meta.url);
const route = await import('../route.js');
const resolver = await import('../../../../briefs/_lib/custom-briefs.js');

function req(method, body, { email = 'owner@example.com', query = '' } = {}) {
  const url = new URL(`https://hitloop.test/api/dashboard/custom-briefs${query}`);
  return {
    method,
    headers: { get: (k) => (k.toLowerCase() === 'authorization' ? (email ? `Bearer ${email}` : null) : null) },
    nextUrl: url,
    json: async () => body,
  };
}
const BREAKDOWN = '# NTR Daily Update\n\nFirst paragraph here.\n\n## Snapshot\n**Revenue**: $1,284\n- Reel worked\n';
function reset() {
  store.clear(); writes.length = 0; storageDeletes.length = 0; storagePrefixDeletes.length = 0;
  state.pdfCalls.length = 0; state.vercelCalls = 0; order.length = 0;
  state.failDocSet = false; state.failStorageDelete = false; state.pdfThrows = false;
}
const briefDocs = () => [...store.entries()].filter(([k]) => k.includes('/custom_briefs/'));

test('publish: random-token slug (not from title), kind stored, text+model stored, brain forced off', async () => {
  reset();
  const res = await route.POST(req('POST', {
    kind: 'client-brief', text: BREAKDOWN, title: 'Secret Launch Plan', public: true,
    clientId: 'attacker-client', addToClientBrain: true, publicBriefSlug: 'chosen',
  }));
  assert.equal(res.status, 200);
  const json = await res.json();
  const docs = briefDocs();
  assert.equal(docs.length, 1);
  const [docPath, data] = docs[0];
  assert.ok(docPath.startsWith('clients/client-1/custom_briefs/'), 'client comes from bootstrap, not the body');
  const slug = docPath.split('/').pop();
  assert.match(slug, /^client-brief-\d{8}-[0-9a-f]{16}$/);
  assert.equal(data.briefSlug, slug);
  assert.equal(data.publicBriefSlug, slug);
  assert.ok(!/secret|launch|plan|chosen/i.test(slug));
  assert.equal(data.kind, 'client-brief');
  assert.equal(json.brief.kind, 'client-brief');
  assert.equal(data.sourceText, BREAKDOWN);
  assert.equal(data.title, 'Secret Launch Plan');
  assert.equal(data.layoutVersion, 3);
  assert.ok(Array.isArray(data.blocks) && data.blocks[0].type === 'heading');
  assert.match(data.html, /Rosita&#39;s Tacos/);
  assert.equal(data.public, true);
  assert.equal(data.addToClientBrain, false);
  assert.equal(data.knowledgeBaseStatus, 'skipped');
  assert.ok(!writes.some((p) => p.startsWith('knowledge_base')), 'no Client Brain writes');
  assert.equal(state.vercelCalls, 0);
  assert.match(data.html, /noindex,nofollow/);
  assert.ok(data.html.includes(`/briefs/rositas/${slug}/pdf`));
  assert.equal(state.pdfCalls.length, 1);
  assert.equal(state.pdfCalls[0].pdfMode, 'default', 'v3 client briefs print through the plain default mode');
  assert.equal(data.pdfArtifact.bucket, 'b');
  assert.equal(json.brief.publicPath, `/briefs/rositas/${slug}`);
});

test('two publishes of the same title get different slugs', async () => {
  reset();
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Same', public: true }));
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Same', public: true }));
  assert.equal(new Set(briefDocs().map(([k]) => k)).size, 2);
});

test('stale dashboard tab: client-brief preview:true is a 400, never a real publish', async () => {
  reset();
  const res = await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, preview: true, public: true }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Preview moved to Studio/);
  assert.equal(briefDocs().length, 0);
  assert.equal(writes.length, 0);
  assert.equal(state.pdfCalls.length, 0);
});

test('theme: built-in id validated + stored; unknown/forged themes collapse to default; html carries the theme marker', async () => {
  reset();
  const ok = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: false, theme: 'ledger' }))).json();
  const okDoc = store.get(`clients/client-1/custom_briefs/${ok.brief.briefSlug}`);
  assert.equal(okDoc.theme, 'ledger');
  assert.equal(okDoc.layoutVersion, 3);
  assert.match(okDoc.html, /data-invoice-theme="ledger"/);
  assert.equal(ok.brief.theme, 'ledger');
  const forged = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: false, theme: { id: 'evil', colors: { paper: 'red;}</style><script>1</script>' } } }))).json();
  const forgedDoc = store.get(`clients/client-1/custom_briefs/${forged.brief.briefSlug}`);
  assert.equal(forgedDoc.theme, null);
  assert.ok(!forgedDoc.html.includes('<script>1'));
  assert.ok(!forgedDoc.html.includes('data-invoice-theme'));
  const none = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: false }))).json();
  assert.equal(store.get(`clients/client-1/custom_briefs/${none.brief.briefSlug}`).theme, null);
});

test('update in place keeps slug and stored theme unless theme is passed; published doc carries the brand mark but no contact info', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true, theme: 'editorial' }))).json();
  const slug = created.brief.briefSlug;
  const docPath = `clients/client-1/custom_briefs/${slug}`;
  const kept = await (await route.POST(req('POST', { kind: 'client-brief', text: `${BREAKDOWN}\nMore.`, public: true, briefSlug: slug }))).json();
  assert.equal(kept.brief.briefSlug, slug);
  assert.equal(store.get(docPath).theme, 'editorial', 'omitted theme keeps the stored one');
  assert.match(store.get(docPath).html, /client-brief-brand-logo/);
  assert.ok(!/@gmail|venmo|tax id/i.test(store.get(docPath).html));
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true, briefSlug: slug, theme: null }));
  assert.equal(store.get(docPath).theme, null, 'explicit null resets to default');
  assert.equal(store.get(docPath).layoutVersion, 3);
});

test('v2 docs are untouched by v3: stored html kept, lazy /pdf still prints through default mode', async () => {
  reset();
  const v2Slug = 'client-brief-20260101-eeeeeeeeeeeeeeee';
  const v2Path = `clients/client-1/custom_briefs/${v2Slug}`;
  store.set(v2Path, { kind: 'client-brief', layoutVersion: 2, public: true, html: '<html>v2 stored</html>', title: 'old', publicBriefSlug: v2Slug, sourceText: '# old' });
  store.set('clients/client-1', { publicClientSlug: 'rositas' });
  const list = (await (await route.GET(req('GET', null, { query: '?kind=client-brief' }))).json()).briefs;
  assert.equal(list.find((b) => b.briefSlug === v2Slug)?.layoutVersion, 2);
  assert.equal(store.get(v2Path).html, '<html>v2 stored</html>');
  const pdfRoute = await import('../../../../briefs/[clientId]/[briefSlug]/pdf/route.js');
  state.pdfCalls.length = 0;
  await pdfRoute.GET({}, { params: { clientId: 'rositas', briefSlug: v2Slug } });
  assert.equal(state.pdfCalls[0]?.pdfMode, 'default');
});

test('bad text is a 4xx and writes nothing; non-admin POST is 403', async () => {
  reset();
  assert.equal((await route.POST(req('POST', { kind: 'client-brief', text: '   ', public: true }))).status, 400);
  assert.equal((await route.POST(req('POST', { kind: 'client-brief', text: 'x'.repeat(50001), public: true }))).status, 413);
  state.admins.delete('user@example.com');
  assert.equal((await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }, { email: 'user@example.com' }))).status, 403);
  assert.equal(writes.length, 0);
});

test('GET: non-admin never receives client briefs; admin gets them (incl. unpublished) with ?kind=client-brief', async () => {
  reset();
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Pub', public: true }));
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Draft', public: false }));
  store.set('clients/client-1/custom_briefs/plain-brief', { kind: 'brief', title: 'Normal', public: true, html: '<html></html>' });

  const asUser = (await (await route.GET(req('GET', null, { email: 'user@example.com' }))).json()).briefs;
  assert.deepEqual(asUser.map((b) => b.title), ['Normal']);
  const asUserFiltered = (await (await route.GET(req('GET', null, { email: 'user@example.com', query: '?kind=client-brief' }))).json()).briefs;
  assert.deepEqual(asUserFiltered, []);

  const adminDefault = (await (await route.GET(req('GET', null))).json()).briefs;
  assert.deepEqual(adminDefault.map((b) => b.title), ['Normal'], 'default list keeps its old shape');
  const adminCb = (await (await route.GET(req('GET', null, { query: '?kind=client-brief' }))).json()).briefs;
  assert.deepEqual(adminCb.map((b) => b.title).sort(), ['Draft', 'Pub']);
  assert.deepEqual(adminCb.map((b) => b.public).sort(), [false, true]);
});

test('PATCH unpublish deletes the PDF object and clears pdf fields; republish flips back', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }))).json();
  const slug = created.brief.briefSlug;
  const docPath = `clients/client-1/custom_briefs/${slug}`;
  assert.ok(store.get(docPath).pdfArtifact);

  const off = await route.PATCH(req('PATCH', { briefSlug: slug, public: false }));
  assert.equal(off.status, 200);
  const after = store.get(docPath);
  assert.equal(after.public, false);
  assert.equal(after.pdfArtifact, undefined);
  assert.equal(after.pdfUrl, undefined);
  assert.ok(storageDeletes.some((p) => p.includes(`brief-runs/${slug}/x.pdf`)), 'storage object deleted');
  assert.ok(storagePrefixDeletes.length > 0, 'brief-runs prefixes swept');
  assert.equal(await resolver.resolvePublicBrief('rositas', slug), null, 'unpublished link stops resolving');

  const on = await route.PATCH(req('PATCH', { briefSlug: slug, public: true }));
  assert.equal(on.status, 200);
  assert.equal(store.get(docPath).public, true);
  assert.equal(store.get(docPath).pdfArtifact, undefined, 'PDF re-renders lazily on next /pdf');
});

test('PATCH: admin only, exact client-brief id only, boolean required', async () => {
  reset();
  store.set('clients/client-1/custom_briefs/plain-brief', { kind: 'brief', public: true });
  assert.equal((await route.PATCH(req('PATCH', { briefSlug: 'plain-brief', public: false }))).status, 404);
  assert.equal(store.get('clients/client-1/custom_briefs/plain-brief').public, true);
  assert.equal((await route.PATCH(req('PATCH', { briefSlug: 'x', public: 'no' }))).status, 400);
  state.admins.delete('user@example.com');
  assert.equal((await route.PATCH(req('PATCH', { briefSlug: 'x', public: false }, { email: 'user@example.com' }))).status, 403);
});

test('DELETE still removes a client brief', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }))).json();
  const res = await route.DELETE(req('DELETE', { briefSlug: created.brief.briefSlug }));
  assert.equal(res.status, 200);
  assert.equal(briefDocs().length, 0);
  assert.equal(state.vercelCalls, 0);
});

test('public resolver: exact slug resolves; hyphen-variant and compacted-title fallbacks do not', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Weekly Plan', public: true }))).json();
  const slug = created.brief.briefSlug;
  const exact = await resolver.resolvePublicBrief('rositas', slug);
  assert.equal(exact?.snapshot.id, slug);
  // compacted slug (hyphens stripped) must not reach it
  assert.equal(await resolver.resolvePublicBrief('rositas', slug.replace(/-/g, '')), null);
  // compacted title must not reach it
  assert.equal(await resolver.resolvePublicBrief('rositas', 'weeklyplan'), null);
  // hyphen-variant fallback: 'clientBrief' hyphenates to the id 'client-brief'
  store.set('clients/client-1/custom_briefs/client-brief', { kind: 'client-brief', title: 'x', public: true, html: '<html></html>' });
  assert.equal(await resolver.resolvePublicBrief('rositas', 'clientBrief'), null);
  store.set('clients/client-1/custom_briefs/plain-hy', { kind: 'brief', title: 'x', public: true, html: '<html></html>' });
  assert.equal((await resolver.resolvePublicBrief('rositas', 'plainHy'))?.snapshot.id, 'plain-hy', 'ordinary briefs keep the hyphen fallback');
  // ...but the exact id still resolves
  assert.equal((await resolver.resolvePublicBrief('rositas', 'client-brief'))?.snapshot.id, 'client-brief');
  assert.equal(resolver.briefPrivacyHeaders(exact.brief)['cache-control'], 'no-store, max-age=0');
  assert.equal(resolver.briefPrivacyHeaders(exact.brief)['x-robots-tag'], 'noindex, nofollow');
  assert.equal(resolver.briefPrivacyHeaders({ kind: 'brief' }), null);
});

test('fuzzy fallbacks still work for ordinary briefs (behavior unchanged)', async () => {
  reset();
  store.set('clients/client-1/custom_briefs/my-brief', { kind: 'brief', title: 'My Brief', publicBriefSlug: 'my-brief', public: true, html: '<html></html>' });
  store.set('clients/client-1', { publicClientSlug: 'rositas' });
  assert.equal((await resolver.resolvePublicBrief('rositas', 'my-brief'))?.snapshot.id, 'my-brief');
  assert.equal((await resolver.resolvePublicBrief('rositas', 'mybrief'))?.snapshot.id, 'my-brief');
});

test('stored doc is Firestore-safe (table, nested list, ordered list start kept)', async () => {
  reset(); // the fake store's set() runs assertFirestoreSafe on every write
  const text = 'Intro.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n3. n1\n   - sub\n4. n2\n';
  const res = await route.POST(req('POST', { kind: 'client-brief', text, public: true }));
  assert.equal(res.status, 200);
  const [, data] = briefDocs()[0];
  assert.equal(data.blocks[1].type, 'table');
  assert.equal(data.blocks[2].start, 3);
  assert.match(data.html, /<ol class="cb-list" start="3">/);
});

test('publish writes the doc BEFORE the PDF, then links the PDF onto the doc', async () => {
  reset();
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }));
  const firstDocSet = order.findIndex((o) => o.startsWith('set:client-brief-'));
  const pdfAt = order.indexOf('pdf');
  assert.ok(firstDocSet >= 0 && pdfAt > firstDocSet, order.join(','));
  assert.ok(order.slice(pdfAt + 1).some((o) => o.startsWith('set:client-brief-')), 'doc updated with pdfArtifact after the PDF');
});

test('failed doc write: no PDF is rendered (no orphan); failed PDF: doc stays with a warning', async () => {
  reset();
  state.failDocSet = true;
  const res = await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }));
  assert.equal(res.status, 500);
  assert.equal(state.pdfCalls.length, 0);
  assert.equal(briefDocs().length, 0);

  reset();
  state.pdfThrows = true;
  const ok = await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }));
  assert.equal(ok.status, 200);
  const json = await ok.json();
  assert.equal(json.pdf.ok, false);
  const [, data] = briefDocs()[0];
  assert.equal(data.public, true);
  assert.equal(data.pdfArtifact, undefined);
  assert.equal(data.warnings[0].code, 'client_brief_pdf_failed');
});

test('PATCH unpublish: if the PDF object cannot be deleted, keep pdf pointers, still unpublish, warn', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }))).json();
  const docPath = `clients/client-1/custom_briefs/${created.brief.briefSlug}`;
  state.failStorageDelete = true;
  const res = await route.PATCH(req('PATCH', { briefSlug: created.brief.briefSlug, public: false }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.warning.code, 'client_brief_pdf_delete_failed');
  const after = store.get(docPath);
  assert.equal(after.public, false);
  assert.ok(after.pdfArtifact?.storagePath, 'pdfArtifact kept');
  assert.ok(after.pdfUrl, 'pdfUrl kept');
  assert.equal(await resolver.resolvePublicBrief('rositas', created.brief.briefSlug), null);
});

test('DELETE: exact id deletes; a fuzzy key (compacted title) never matches a client brief', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Weekly Plan', public: true }))).json();
  const slug = created.brief.briefSlug;
  assert.equal((await route.DELETE(req('DELETE', { briefSlug: 'weeklyplan' }))).status, 404);
  assert.equal((await route.DELETE(req('DELETE', { briefSlug: slug.replace(/-/g, '') }))).status, 404);
  assert.equal(briefDocs().length, 1);
  assert.equal((await route.DELETE(req('DELETE', { briefSlug: slug }))).status, 200);
  assert.equal(briefDocs().length, 0);
});

// ---- v2: OG fields, update in place, guards ----
const OG = { ogLabel: 'NTR', ogSubhead: 'Weekly plan', hideOgSubhead: true, ogTitleLines: ['A', 'B', 'C', 'D'], ogLines: ['one', 'two', 'three'] };

test('OG fields are stored (invoice limits: 3 title lines, 2 extra lines) and served in the public meta', async () => {
  reset();
  const res = await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true, ...OG }));
  const json = await res.json();
  const [, data] = briefDocs()[0];
  assert.equal(data.ogLabel, 'NTR');
  assert.equal(data.ogSubhead, 'Weekly plan');
  assert.equal(data.hideOgSubhead, true);
  assert.deepEqual(data.ogTitleLines, ['A', 'B', 'C']);
  assert.deepEqual(data.ogLines, ['one', 'two']);
  assert.equal(data.description, 'Weekly plan');
  assert.equal(json.brief.ogImageUrl, `https://hitloop.test/briefs/rositas/${json.brief.briefSlug}/og-image`);
  const resolved = await resolver.resolvePublicBrief('rositas', json.brief.briefSlug);
  const meta = resolver.buildBriefOpenGraphMeta({ origin: 'https://hitloop.test', clientId: 'client-1', client: CLIENT, brief: resolved.brief, snapshotId: resolved.snapshot.id });
  assert.equal(meta.ogVariant, 'invoice', 'client briefs reuse the invoice OG look so the fields render');
  assert.deepEqual(meta.ogTitleLines, ['A', 'B', 'C']);
  assert.deepEqual(meta.ogLines, ['one', 'two']);
  assert.equal(meta.ogSubhead, 'Weekly plan');
  assert.equal(meta.hideOgSubhead, true);
  assert.equal(meta.imageUrl, `https://hitloop.test/briefs/rositas/${json.brief.briefSlug}/og-image`);
});

test('description defaults to the first paragraph when no subhead is given', async () => {
  reset();
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }));
  const [, data] = briefDocs()[0];
  assert.equal(data.description, 'First paragraph here.');
  assert.equal(data.ogLabel, 'HITLOOP');
});

test('update in place: same slug and URL, createdAt kept, PDF replaced, omitted public keeps value', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'One', public: true }))).json();
  const slug = created.brief.briefSlug;
  const docPath = `clients/client-1/custom_briefs/${slug}`;
  const createdAt = store.get(docPath).createdAt;
  store.get(docPath).createdAt = 'ORIGINAL';
  const oldPdf = store.get(docPath).pdfArtifact.storagePath;
  state.pdfCalls.length = 0;
  const res = await route.POST(req('POST', { kind: 'client-brief', briefSlug: slug, text: '# Changed\n\nNew body.', title: 'Two', ...OG }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.updated, true);
  assert.equal(json.brief.briefSlug, slug);
  assert.equal(json.brief.publicPath, created.brief.publicPath);
  assert.equal(briefDocs().length, 1, 'no second doc');
  const data = store.get(docPath);
  assert.equal(data.createdAt, 'ORIGINAL');
  assert.equal(data.title, 'Two');
  assert.match(data.html, /New body/);
  assert.equal(data.sourceText, '# Changed\n\nNew body.');
  assert.equal(data.public, true, 'omitted public keeps the existing value');
  assert.equal(data.ogSubhead, 'Weekly plan');
  assert.ok(storageDeletes.includes(oldPdf), 'old PDF object deleted before the re-render');
  assert.equal(state.pdfCalls.length, 1);
  assert.equal(state.pdfCalls[0].pdfMode, 'default');
  assert.ok(data.pdfArtifact, 'new PDF linked');
  assert.ok(createdAt !== undefined);
  // explicit public:false updates and keeps it private (no PDF render)
  state.pdfCalls.length = 0;
  await route.POST(req('POST', { kind: 'client-brief', briefSlug: slug, text: BREAKDOWN, public: false }));
  assert.equal(store.get(docPath).public, false);
  assert.equal(store.get(docPath).pdfArtifact, undefined);
  assert.equal(state.pdfCalls.length, 0);
  // omitted public on a private brief stays private
  await route.POST(req('POST', { kind: 'client-brief', briefSlug: slug, text: BREAKDOWN }));
  assert.equal(store.get(docPath).public, false);
});

test('update rejects non-client-brief docs, other clients, bad ids; never falls through to create', async () => {
  reset();
  store.set('clients/client-1/custom_briefs/client-brief-20261118-aaaaaaaaaaaaaaaa', { kind: 'brief', title: 'Plain', public: true });
  store.set('clients/other-client/custom_briefs/client-brief-20261118-bbbbbbbbbbbbbbbb', { kind: 'client-brief', title: 'Theirs', public: true, html: 'x' });
  const post = (briefSlug) => route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true, briefSlug }));
  assert.equal((await post('client-brief-20261118-aaaaaaaaaaaaaaaa')).status, 404, 'other kind');
  assert.equal((await post('client-brief-20261118-bbbbbbbbbbbbbbbb')).status, 404, 'other client (bootstrap client is client-1)');
  assert.equal((await post('client-brief-20261118-cccccccccccccccc')).status, 404, 'missing');
  assert.equal((await post('plain-brief')).status, 400, 'not a client-brief id');
  assert.equal((await post('../x')).status, 400);
  assert.equal(store.get('clients/client-1/custom_briefs/client-brief-20261118-aaaaaaaaaaaaaaaa').kind, 'brief');
  assert.equal(store.get('clients/other-client/custom_briefs/client-brief-20261118-bbbbbbbbbbbbbbbb').title, 'Theirs');
  assert.equal(briefDocs().length, 2, 'nothing created');
  assert.equal(state.pdfCalls.length, 0);
});

test('update: if the old PDF cannot be deleted nothing is written', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Keep', public: true }))).json();
  const docPath = `clients/client-1/custom_briefs/${created.brief.briefSlug}`;
  state.failStorageDelete = true;
  state.pdfCalls.length = 0;
  const res = await route.POST(req('POST', { kind: 'client-brief', briefSlug: created.brief.briefSlug, text: '# X', title: 'Lost' }));
  assert.equal(res.status, 502);
  assert.equal(store.get(docPath).title, 'Keep');
  assert.equal(state.pdfCalls.length, 0);
});

test('invoice/brief POST can not overwrite a client brief that owns the doc id', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, title: 'Mine', public: true }))).json();
  const slug = created.brief.briefSlug;
  const before = { ...store.get(`clients/client-1/custom_briefs/${slug}`) };
  const html = '<!doctype html><html><body>evil</body></html>';
  const res = await route.POST(req('POST', { html, title: 'x', briefSlug: slug, public: true }));
  assert.equal(res.status, 409);
  const after = store.get(`clients/client-1/custom_briefs/${slug}`);
  assert.equal(after.kind, 'client-brief');
  assert.equal(after.html, before.html);
});

test('lazy /pdf: v3 client briefs use pdfMode default; v1 docs (no layoutVersion) keep edge-to-edge', async () => {
  reset();
  const created = await (await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: true }))).json();
  const v2Path = `clients/client-1/custom_briefs/${created.brief.briefSlug}`;
  store.set('clients/client-1', { publicClientSlug: 'rositas' });
  delete store.get(v2Path).pdfArtifact; delete store.get(v2Path).pdfUrl; // force lazy render
  const pdfRoute = await import('../../../../briefs/[clientId]/[briefSlug]/pdf/route.js');
  state.pdfCalls.length = 0;
  await pdfRoute.GET({}, { params: { clientId: 'rositas', briefSlug: created.brief.briefSlug } });
  assert.equal(state.pdfCalls[0]?.pdfMode, 'default');
  store.set('clients/client-1/custom_briefs/client-brief-20260101-dddddddddddddddd', { kind: 'client-brief', public: true, html: '<html></html>', title: 'v1', publicBriefSlug: 'client-brief-20260101-dddddddddddddddd' });
  state.pdfCalls.length = 0;
  await pdfRoute.GET({}, { params: { clientId: 'rositas', briefSlug: 'client-brief-20260101-dddddddddddddddd' } });
  assert.equal(state.pdfCalls[0]?.pdfMode, 'edge-to-edge');
});

test('GET list serializes sourceText + OG fields for client briefs (card edit/load)', async () => {
  reset();
  await route.POST(req('POST', { kind: 'client-brief', text: BREAKDOWN, public: false, ...OG }));
  const [b] = (await (await route.GET(req('GET', null, { query: '?kind=client-brief' }))).json()).briefs;
  assert.equal(b.sourceText, BREAKDOWN);
  assert.equal(b.ogSubhead, 'Weekly plan');
  assert.deepEqual(b.ogTitleLines, ['A', 'B', 'C']);
});
