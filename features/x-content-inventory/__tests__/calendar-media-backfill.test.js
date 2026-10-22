import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillCalendarMedia, lendSameReleaseMedia, BACKFILL_MAX_STAGES } from '../calendar-media-backfill.js';

const SHA = (n) => String(n).repeat(64).slice(0, 64);
const nasItem = (id, { staged = false, rights = 'owned' } = {}) => ({
  id, clientId: 'c1', bucketId: 'nas', mediaState: 'still', rights,
  nas: { sha256: SHA(id.slice(-1)), relativePath: `flyers/${id}.jpg`, sourceId: 'src' },
  assetRefs: staged ? [`publish-staging/nas/${id}/flyer.jpg`] : [],
});
const discogs = (id, release, { video = true } = {}) => ({
  id, clientId: 'c1', title: `Artist – ${release}`, source: { kind: 'discogs', externalId: release },
  assetRefs: video ? [`publish-staging/discogs/${release}/video-1x1.mp4`] : [],
});
const post = (id, packageId, o = {}) => ({ id, status: 'draft', reviewOn: '2026-10-23', packageId, mediaUrl: '', ...o });

function fakeDeps({ drafts, packages, stageResult = { status: 'staging' } }) {
  const applied = [];
  const staged = [];
  const upserts = [];
  const deps = {
    readDrafts: async () => drafts,
    readPackages: async () => packages,
    pickMedia: async (_c, pkg) => {
      const ref = (pkg.assetRefs || []).find((r) => /\.(mp4|jpe?g)$/.test(r));
      return ref ? { mediaUrl: `https://m/${ref}`, mediaType: /mp4$/.test(ref) ? 'video' : 'image', mediaStoragePath: ref } : null;
    },
    applyPostMedia: async (_c, postId, patch) => { applied.push([postId, patch]); return true; },
    upsertPackage: async (_c, pkg) => { upserts.push(pkg.id); },
    stageNas: async (_c, { postId, packageId }) => { staged.push([postId, packageId]); return stageResult; },
  };
  return { deps, applied, staged, upserts };
}

test('lendSameReleaseMedia: only the exact same-release item lends; word overlap does not', () => {
  const bday = { id: 'birthday-x', clientId: 'c1', title: 'Derrick Carter birthday', source: { kind: 'discogs', externalId: '24527' }, assetRefs: [] };
  const packages = [bday, discogs('discogs-24527', '24527'), { id: 'other', clientId: 'c1', title: 'Derrick Carter – Mo Pschidt', assetRefs: ['publish-staging/x/video.mp4'] }];
  const lent = lendSameReleaseMedia(bday, packages);
  assert.equal(lent.mediaFrom.id, 'discogs-24527');
  assert.equal(lent.assetRefs[0], 'publish-staging/discogs/24527/video-1x1.mp4');
  const noRelease = { id: 'birthday-y', clientId: 'c1', title: 'Derrick Carter birthday', assetRefs: [] };
  assert.equal(lendSameReleaseMedia(noRelease, packages), null);
});

test('backfill: staged item media is attached (with nasSha for NAS files); drafts with media, past days and non-drafts are left alone', async () => {
  const packages = [nasItem('nas-1', { staged: true }), discogs('discogs-1', '1')];
  const drafts = [
    post('p-nas', 'nas-1'),
    post('p-rec', 'discogs-1'),
    post('p-has', 'discogs-1', { mediaUrl: 'https://m/x.mp4' }),
    post('p-old', 'discogs-1', { reviewOn: '2026-10-21' }),
    post('p-sched', 'discogs-1', { status: 'scheduled', scheduledAt: '2026-10-24T13:00:00.000Z' }),
    post('p-bare', null),
  ];
  const { deps, applied, staged } = fakeDeps({ drafts, packages });
  const r = await backfillCalendarMedia(deps, { clientId: 'c1', from: '2026-10-22', days: 7 });
  assert.deepEqual(r.window, { from: '2026-10-22', to: '2026-10-28' });
  assert.deepEqual(r.attached.sort(), ['p-nas', 'p-rec']);
  assert.equal(staged.length, 0);
  const nas = applied.find(([id]) => id === 'p-nas')[1];
  assert.equal(nas.nasSha, SHA('1'));
  assert.equal(nas.mediaType, 'image');
  assert.equal(applied.find(([id]) => id === 'p-rec')[1].nasSha, undefined);
  assert.ok(!applied.some(([id]) => ['p-has', 'p-old', 'p-sched', 'p-bare'].includes(id)));
});

test('backfill: an unstaged NAS item gets its nasSha link and a queued stage; the per-run stage cap holds', async () => {
  const packages = Array.from({ length: BACKFILL_MAX_STAGES + 2 }, (_, i) => nasItem(`nas-${i}`));
  const drafts = packages.map((p, i) => post(`p-${i}`, p.id, { reviewOn: '2026-10-23', nasSha: i === 0 ? SHA('0') : undefined }));
  const { deps, applied, staged } = fakeDeps({ drafts, packages });
  const r = await backfillCalendarMedia(deps, { clientId: 'c1', from: '2026-10-22' });
  assert.equal(r.staging.length, BACKFILL_MAX_STAGES);
  assert.equal(staged.length, BACKFILL_MAX_STAGES);
  assert.equal(r.bare.length, 2);
  assert.equal(r.bare[0].reason, 'stage limit this run');
  // The link is written for every NAS draft that lacked it, even past the stage cap; p-0 already had it.
  assert.ok(!applied.some(([id]) => id === 'p-0'));
  assert.equal(applied.filter(([, patch]) => patch.nasSha && !patch.mediaUrl).length, packages.length - 1);
  // A copy already sitting in the Mac queue (a re-run) does not use up the cap, so the next new one still queues.
  const again = fakeDeps({ drafts, packages, stageResult: { status: 'staging', alreadyQueued: true } });
  const r2 = await backfillCalendarMedia(again.deps, { clientId: 'c1', from: '2026-10-22' });
  assert.equal(r2.staging.length, packages.length);
  assert.equal(r2.bare.length, 0);
});

test('backfill: a same-release lender puts its video on a media-less item (link persisted); no stage deps => reported bare', async () => {
  const bday = { id: 'birthday-dc', clientId: 'c1', title: 'Derrick Carter birthday', source: { kind: 'discogs', externalId: '24527' }, assetRefs: [] };
  const packages = [bday, discogs('discogs-24527', '24527'), nasItem('nas-9'), { id: 'text-only', clientId: 'c1', title: 'x', assetRefs: [] }, nasItem('nas-np', { rights: 'never-public' })];
  const drafts = [post('p-b', 'birthday-dc'), post('p-n', 'nas-9'), post('p-t', 'text-only'), post('p-np', 'nas-np'), post('p-missing', 'nope')];
  const { deps, applied, upserts } = fakeDeps({ drafts, packages });
  delete deps.stageNas;
  const r = await backfillCalendarMedia(deps, { clientId: 'c1', from: '2026-10-22' });
  assert.deepEqual(r.attached, ['p-b']);
  assert.deepEqual(r.lent, ['p-b']);
  assert.deepEqual(upserts, ['birthday-dc']);
  assert.equal(applied.find(([id]) => id === 'p-b')[1].mediaType, 'video');
  assert.deepEqual(r.bare.map((b) => [b.postId, b.reason]), [['p-n', 'not staged'], ['p-t', 'item has no media'], ['p-np', 'never-public'], ['p-missing', 'item not found']]);
  assert.equal(applied.find(([id]) => id === 'p-n')[1].nasSha, SHA('9')); // the link still lands
});

test('backfill: a failing write is reported per post and never stops the pass; bad input => ok:false', async () => {
  const packages = [discogs('discogs-1', '1'), discogs('discogs-2', '2')];
  const drafts = [post('p-1', 'discogs-1'), post('p-2', 'discogs-2')];
  const { deps } = fakeDeps({ drafts, packages });
  deps.applyPostMedia = async (_c, postId) => { if (postId === 'p-1') throw new Error('boom'); return true; };
  const r = await backfillCalendarMedia(deps, { clientId: 'c1', from: '2026-10-22' });
  assert.deepEqual(r.failed, [{ postId: 'p-1', error: 'boom' }]);
  assert.deepEqual(r.attached, ['p-2']);
  assert.equal((await backfillCalendarMedia(deps, { clientId: 'c1', from: 'soon' })).ok, false);
});
