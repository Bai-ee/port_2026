import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createFakeDb } from './fake-db.js';

const CLIENT = 'paradice-dbBQCHUX';
const ORIGIN = 'https://hitloop.test';

const ITEMS = [
  { id: 'i1', brainPath: 'MASTER_BRAIN.md', brainRole: 'master', title: 'MASTER_BRAIN.md', sha256: 'aaa', status: 'ready' },
  { id: 'i2', brainPath: 'sources/2026-11-19-discord-raw.txt', brainRole: 'source', title: 'raw', sha256: 'bbb', status: 'ready', sourceIds: ['D1'] },
  { id: 'i3', brainPath: 'versions/2026-11-19-before-announcements/INDEX.md', brainRole: 'version', versionLabel: '2026-11-19-before-announcements', title: 'INDEX.md', sha256: 'ccc', status: 'ready' },
];

function setup({ respondClientId = CLIENT, uploadResult = null, fileText = 'x'.repeat(45000), auth = 'Bearer tok' } = {}) {
  const calls = [];
  const respond = (json, status = 200) => new Response(JSON.stringify(json), { status });
  const services = {
    ownerAuthorization: async () => auth,
    sourceLibraryItemsRoute: async () => ({
      GET: async (req) => { calls.push({ route: 'items', url: new URL(req.url), authorization: req.headers.get('authorization') }); return respond({ ok: true, clientId: respondClientId, items: ITEMS, limits: { maxItems: 500, remaining: 497 } }); },
    }),
    sourceLibraryBrainRoute: async () => ({
      GET: async (req) => {
        const url = new URL(req.url);
        calls.push({ route: 'brain', url });
        if (url.searchParams.get('path') === 'missing.md') return respond({ error: 'No file at missing.md.', clientId: respondClientId }, 404);
        return respond({ ok: true, clientId: respondClientId, file: { path: url.searchParams.get('path'), sha256: 'aaa' }, text: fileText });
      },
    }),
    sourceLibraryUploadRoute: async () => ({
      POST: async (req) => {
        const form = await req.formData();
        const file = form.get('file');
        calls.push({ route: 'upload', url: new URL(req.url), relativePath: form.get('relativePath'), today: form.get('today'), title: form.get('title'), fileName: file.name, type: file.type, text: await file.text() });
        return respond(uploadResult || { ok: true, clientId: respondClientId, item: { brainPath: form.get('relativePath'), brainRole: 'master', sha256: 'new', status: 'processing' }, chunkCount: 3, replaced: null }, 202);
      },
    }),
  };
  const ctx = { db: createFakeDb({ [`clients/${CLIENT}`]: { name: 'Critters Quest' } }), email: 'bryanballi@gmail.com', origin: ORIGIN, now: () => Date.parse('2026-11-20T12:00:00Z'), services };
  const call = async (name, args) => (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' })).body.result;
  return { call, calls };
}
const out = (r) => JSON.parse(r.content[0].text);

test('registry has the three Source Library tools; only save writes', () => {
  const byName = Object.fromEntries(registry.map((t) => [t.name, t]));
  assert.equal(byName.source_library_list.annotations.readOnlyHint, true);
  assert.equal(byName.source_library_read.annotations.readOnlyHint, true);
  assert.equal(byName.source_library_save.annotations.readOnlyHint, false);
});

test('list: owner auth + as=clientId, versions hidden unless asked, root docs first', async () => {
  const s = setup();
  const r = out(await s.call('source_library_list', { clientId: CLIENT }));
  assert.equal(s.calls[0].authorization, 'Bearer tok');
  assert.equal(s.calls[0].url.searchParams.get('as'), CLIENT);
  assert.deepEqual(r.files.map((f) => f.path), ['MASTER_BRAIN.md', 'sources/2026-11-19-discord-raw.txt']);
  assert.equal(r.versionCount, 1);
  assert.deepEqual(r.files[1].sourceIds, ['D1']);
  const all = out(await s.call('source_library_list', { clientId: CLIENT, includeVersions: true }));
  assert.equal(all.files.length, 3);
});

test('read: pages long files with nextOffset', async () => {
  const s = setup();
  const first = out(await s.call('source_library_read', { clientId: CLIENT, path: 'MASTER_BRAIN.md' }));
  assert.equal(s.calls[0].url.searchParams.get('format'), 'file');
  assert.equal(s.calls[0].url.searchParams.get('path'), 'MASTER_BRAIN.md');
  assert.equal(first.text.length, 30000);
  assert.equal(first.nextOffset, 30000);
  const second = out(await s.call('source_library_read', { clientId: CLIENT, path: 'MASTER_BRAIN.md', offset: 30000 }));
  assert.equal(second.text.length, 15000);
  assert.equal(second.nextOffset, undefined);
  const missing = await s.call('source_library_read', { clientId: CLIENT, path: 'missing.md' });
  assert.equal(missing.isError, true);
});

test('save: new file is filed like a dashboard drop', async () => {
  const s = setup();
  const r = out(await s.call('source_library_save', { clientId: CLIENT, path: 'Call notes.md', content: '# Call\nNotes' }));
  const up = s.calls.find((c) => c.route === 'upload');
  assert.equal(up.url.searchParams.get('as'), CLIENT);
  assert.equal(up.relativePath, 'sources/2026-11-20-call-notes.md');
  assert.equal(up.today, '2026-11-20');
  assert.equal(up.fileName, '2026-11-20-call-notes.md');
  assert.equal(up.type, 'text/markdown');
  assert.equal(up.text, '# Call\nNotes');
  assert.equal(r.created, true);
});

test('save: edit with expectedSha256 checks the current hash, reports the kept version', async () => {
  const s = setup({ uploadResult: { ok: true, clientId: CLIENT, item: { brainPath: 'MASTER_BRAIN.md', brainRole: 'master', sha256: 'new' }, replaced: { brainPath: 'versions/2026-11-20-before-master-brain/MASTER_BRAIN.md' }, chunkCount: 4 } });
  const r = out(await s.call('source_library_save', { clientId: CLIENT, path: 'MASTER_BRAIN.md', content: '# Master v2', expectedSha256: 'AAA' }));
  assert.equal(r.replaced, true);
  assert.equal(r.previousVersionPath, 'versions/2026-11-20-before-master-brain/MASTER_BRAIN.md');

  const stale = await s.call('source_library_save', { clientId: CLIENT, path: 'MASTER_BRAIN.md', content: '# Master v3', expectedSha256: 'zzz' });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /changed since it was read/);
  assert.equal(s.calls.filter((c) => c.route === 'upload').length, 1, 'a stale edit never reaches the upload route');
});

test('save: unchanged content reports unchanged', async () => {
  const s = setup({ uploadResult: { ok: true, clientId: CLIENT, skipped: true, reason: 'unchanged', item: { sha256: 'aaa' } } });
  const r = out(await s.call('source_library_save', { clientId: CLIENT, path: 'MASTER_BRAIN.md', content: '# same' }));
  assert.equal(r.unchanged, true);
});

test('save: binary via base64 keeps bytes', async () => {
  const s = setup();
  await s.call('source_library_save', { clientId: CLIENT, path: 'sources/2026-11-20-deck.pdf', contentBase64: Buffer.from('%PDF-1.4 test').toString('base64') });
  const up = s.calls.find((c) => c.route === 'upload');
  assert.equal(up.type, 'application/pdf');
  assert.equal(up.text, '%PDF-1.4 test');
});

test('save: refuses bad input before any route call', async () => {
  const s = setup();
  const cases = [
    { path: 'versions/x/MASTER_BRAIN.md', content: 'x' },
    { path: 'MASTER_BRAIN.md' },
    { path: 'MASTER_BRAIN.md', content: 'x', contentBase64: 'eA==' },
    { path: 'MASTER_BRAIN.md', content: '   ' },
    { path: 'photo.png', content: 'x' },
    { path: '', content: 'x' },
  ];
  for (const args of cases) {
    const r = await s.call('source_library_save', { clientId: CLIENT, ...args });
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  assert.equal(s.calls.length, 0);
});

test('every tool refuses an answer for a different client', async () => {
  const s = setup({ respondClientId: 'someone-else' });
  for (const [name, args] of [['source_library_list', {}], ['source_library_read', { path: 'MASTER_BRAIN.md' }], ['source_library_save', { path: 'MASTER_BRAIN.md', content: 'x' }]]) {
    const r = await s.call(name, { clientId: CLIENT, ...args });
    assert.equal(r.isError, true, name);
    assert.match(r.content[0].text, /Refused/);
  }
});

test('no owner session: clear error, nothing written', async () => {
  const s = setup({ auth: null });
  const r = await s.call('source_library_save', { clientId: CLIENT, path: 'MASTER_BRAIN.md', content: 'x' });
  assert.equal(r.isError, true);
  assert.equal(s.calls.length, 0);
});
