import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeContentSources, mergeSourceRows, viewSourceRow, stripViewFields, usableBy, MAX_CONTENT_SOURCES,
} from '../content-sources.js';

test('normalizeContentSources: entries cleaned; legacy strings read-only; never self; first wins; capped', () => {
  assert.deepEqual(normalizeContentSources(null), []);
  assert.deepEqual(normalizeContentSources([
    ' ue-client ', { clientId: 'ue-client', bucketId: 'ue' }, { clientId: 'self-id' }, 'a/b', 7,
    { clientId: 'disc-client', bucketId: 'record' }, { clientId: 'x-client', bucketId: 'Bad Bucket!', access: 'weird' },
  ], 'self-id'), [
    { clientId: 'ue-client', bucketId: null, access: 'read' },
    { clientId: 'disc-client', bucketId: 'record', access: 'full' },
    { clientId: 'x-client', bucketId: null, access: 'full' },
  ]);
  const many = Array.from({ length: MAX_CONTENT_SOURCES + 5 }, (_, i) => ({ clientId: `client-${i}` }));
  assert.equal(normalizeContentSources(many).length, MAX_CONTENT_SOURCES);
});

test('viewSourceRow / stripViewFields: the viewer bucket is a view only; the owner bucket comes back on write', () => {
  const entry = { clientId: 'ue', bucketId: 'ue-mixes', access: 'full' };
  const v = viewSourceRow({ id: 'rv-1', clientId: 'ue', bucketId: 'ue' }, entry, 'me');
  assert.deepEqual([v.bucketId, v.ownerBucketId, v.sharedFrom, v.sharedWith, v.readOnly], ['ue-mixes', 'ue', 'ue', 'me', undefined]);
  assert.equal(viewSourceRow({ id: 'x', clientId: 'ue' }, { ...entry, access: 'read' }, 'me').readOnly, true);

  const back = stripViewFields({ ...v, title: 'edited' }, { bucketId: 'ue' });
  assert.deepEqual([back.bucketId, back.title, 'sharedWith' in back, 'ownerBucketId' in back], ['ue', 'edited', false, false]);
  // Owner row had no bucket: the viewer bucket is not written onto it.
  const noBucket = stripViewFields(viewSourceRow({ id: 'd-1', clientId: 'disc' }, { clientId: 'disc', bucketId: 'record', access: 'full' }, 'me'), {});
  assert.equal('bucketId' in noBucket, false);
  // An own row passes through untouched.
  assert.deepEqual(stripViewFields({ id: 'mine', bucketId: 'nas' }, { bucketId: 'nas' }), { id: 'mine', bucketId: 'nas' });
});

test('mergeSourceRows: own row wins an id clash; source rows viewed; usableBy accepts own + shared-with rows only', () => {
  const merged = mergeSourceRows(
    [{ id: 'same', clientId: 'me' }, { id: 'mine', clientId: 'me' }],
    [
      { entry: { clientId: 'ue', bucketId: 'ue', access: 'full' }, rows: [{ id: 'same', clientId: 'ue' }, { id: 'ue-1', clientId: 'ue' }] },
      { entry: { clientId: 'disc', bucketId: 'record', access: 'full' }, rows: [{ id: 'ue-1', clientId: 'disc' }, { id: 'd-1', clientId: 'disc' }] },
    ],
    'me',
  );
  assert.deepEqual(merged.map((r) => [r.id, r.clientId, r.bucketId ?? null]), [
    ['same', 'me', null], ['mine', 'me', null], ['ue-1', 'ue', 'ue'], ['d-1', 'disc', 'record'],
  ]);
  assert.ok(merged.every((r) => usableBy(r, 'me')));
  assert.equal(usableBy({ id: 'z', clientId: 'ue' }, 'me'), false);
  assert.equal(usableBy(null, 'me'), false);
});
