import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../../../api/_lib/__tests__/fake-firestore.cjs');
const { getForm, saveForm } = require('../_handlers.cjs');
const store = require('../../../../../../features/client-brain/store.cjs');

let ctx;
let original;

beforeEach(() => {
  ctx = makeFakeContext();
  original = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
});

afterEach(() => {
  Object.defineProperty(fb, 'adminDb', original);
});

test('GET with no Brain returns empty fields and null status', async () => {
  const out = await getForm('c1');
  assert.equal(out.ok, true);
  assert.equal(out.clientId, 'c1');
  assert.equal(out.status, null);
  assert.equal(out.markdownSource, '');
  assert.deepEqual(out.fields['identity.offers'], []);
  assert.equal(out.fields['identity.name'], '');
  assert.equal(out.filled.filled, 0);
  assert.ok(out.filled.total > 50);
});

test('POST then GET returns what was saved and records a form version', async () => {
  const posted = await saveForm('c1', {
    'identity.name': 'Harbor Row Coffee',
    'identity.offers': ['Wholesale beans'],
    'content.examplePosts': [{ type: '', label: '', post: 'roasted tuesday. shipped wednesday.' }],
  }, { byUid: 'u1', clientName: 'Harbor Row Coffee' });
  assert.equal(posted.status, 'draft');
  assert.equal(posted.fields['identity.name'], 'Harbor Row Coffee');
  assert.match(posted.markdownSource, /clientId: c1/);

  const got = await getForm('c1');
  assert.deepEqual(got.fields, posted.fields);
  assert.equal(got.filled.filled, 3);

  // second save is an edit of an existing Brain and records the prior markdown
  await saveForm('c1', { 'identity.name': 'Harbor Row Roasters' }, { byUid: 'u1' });
  const versions = await store.listBrainVersions('c1');
  assert.ok(versions.some((v) => v.reason === 'form'));
  assert.equal((await getForm('c1')).fields['identity.offers'][0], 'Wholesale beans');
});

test('saving never changes an approved status', async () => {
  await saveForm('c1', { 'identity.name': 'Harbor Row Coffee' }, { byUid: 'u1' });
  await store.markClientBrainStatus('c1', 'approved');
  // markdown frontmatter still says draft: the form must carry the stored status
  const out = await saveForm('c1', { 'identity.positioning': 'A small-batch roaster.' }, { byUid: 'u1' });
  assert.equal(out.status, 'approved');
  assert.match(out.markdownSource, /status: approved/);
  const doc = await store.readClientBrainDoc('c1');
  assert.equal(doc.status, 'approved');
  assert.ok(doc.approvedAt);
});

test('bad keys and bad rows are 400s and nothing is saved', async () => {
  await assert.rejects(() => saveForm('c1', { 'nope.key': 'x' }), (e) => e.status === 400 && e.name === 'FormValidationError');
  await assert.rejects(() => saveForm('c1', { 'content.formattingRules': [{ key: 'wobble', value: 'x' }] }), (e) => e.status === 400);
  await assert.rejects(() => saveForm('c1', 'not-an-object'), (e) => e.status === 400);
  assert.equal((await getForm('c1')).status, null);
});
