import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeContentSources, mergeSourceRows, viewSourceRow, stripViewFields, usableBy, MAX_CONTENT_SOURCES, USAGE_FIELDS,
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

  const back = stripViewFields({ ...v, title: 'edited' }, { bucketId: 'ue' }, 'me');
  assert.deepEqual([back.bucketId, back.title, 'sharedWith' in back, 'ownerBucketId' in back], ['ue', 'edited', false, false]);
  // Owner row had no bucket: the viewer bucket is not written onto it.
  const noBucket = stripViewFields(viewSourceRow({ id: 'd-1', clientId: 'disc' }, { clientId: 'disc', bucketId: 'record', access: 'full' }, 'me'), {}, 'me');
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

test('usage is per client: the view shows the viewer usage (fresh idea by default); owner retire still applies', () => {
  const entry = { clientId: 'ue', bucketId: 'ue', access: 'full' };
  const ownerRow = { id: 'rv-1', clientId: 'ue', status: 'posted', lastPostedAt: 500, postCount: 3, lastTwitterId: 'ue-tw',
    usage: { me: { status: 'posted', lastPostedAt: 900, postCount: 1, lastTwitterId: 'me-tw' }, other: { postCount: 9 } } };
  const v = viewSourceRow(ownerRow, entry, 'me');
  assert.deepEqual([v.status, v.lastPostedAt, v.postCount, v.lastTwitterId, 'usage' in v], ['posted', 900, 1, 'me-tw', false]);
  const fresh = viewSourceRow({ ...ownerRow, usage: undefined }, entry, 'me');
  assert.deepEqual([fresh.status, fresh.lastPostedAt, fresh.postCount, 'lastTwitterId' in fresh], ['idea', null, 0, false]);
  assert.equal(viewSourceRow({ ...ownerRow, status: 'retired' }, entry, 'me').status, 'retired');
});

test('stripViewFields: a viewer write moves its lifecycle to usage.{viewer}; owner fields stay; raw rows and owners never write usage', () => {
  const existing = { id: 'rv-1', clientId: 'ue', bucketId: 'ue', status: 'idea', lastPostedAt: null, postCount: 0 };
  const view = viewSourceRow(existing, { clientId: 'ue', bucketId: 'mixes', access: 'full' }, 'me');
  const w = stripViewFields({ ...view, status: 'posted', lastPostedAt: 1000, postCount: 1, lastTwitterId: 't1' }, existing, 'me');
  assert.deepEqual([w.status, w.lastPostedAt, w.postCount, 'lastTwitterId' in w, w.bucketId], ['idea', null, 0, false, 'ue']);
  assert.deepEqual(w.usage, { me: { status: 'posted', lastPostedAt: 1000, postCount: 1, lastTwitterId: 't1' } });
  // A raw owner row sent by the viewer (e.g. a media-link patch) copies nothing into the viewer usage.
  const raw = stripViewFields({ ...existing, status: 'posted', mediaFrom: { kind: 'video' } }, existing, 'me');
  assert.deepEqual([raw.status, 'usage' in raw, raw.mediaFrom.kind], ['idea', false, 'video']);
  // The owner saving a row it read (with others' usage) never replays that usage.
  assert.equal('usage' in stripViewFields({ ...existing, usage: { me: { postCount: 1 } } }, existing), false);
  assert.ok(USAGE_FIELDS.includes('status'));
});
