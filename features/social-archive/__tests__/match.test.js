import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEntries } from '../match.js';

const e = (id, ...rels) => ({ id, media: rels.map((relPath) => ({ type: 'image', relPath })) });
const pkgs = [
  { id: 'nas-1', nas: { relativePath: 'FB/arch/photos_and_videos/Album/a.jpg', sha256: 'x' } },
  { id: 'nas-2', nas: { relativePath: 'FB/arch/photos_and_videos/Album/B.JPG' } },
  { id: 'nas-3', nas: { relativePath: 'FB/arch/photos_and_videos/My Album/c.jpg' } },
];
const opts = { archiveRootRel: 'FB/arch' };

test('exact match', () => {
  const r = matchEntries([e('e1', 'photos_and_videos/Album/a.jpg')], pkgs, opts);
  assert.deepEqual(r.links, [{ entryId: 'e1', packageId: 'nas-1', relPath: 'photos_and_videos/Album/a.jpg' }]);
  assert.deepEqual(r.stats, { media: 1, matched: 1, unmatched: 0, entriesWithMatch: 1 });
});

test('case-insensitive and URL-decoded fallback', () => {
  const r = matchEntries([e('e1', 'photos_and_videos/album/b.jpg', 'photos_and_videos/My%20Album/c.jpg')], pkgs, opts);
  assert.deepEqual(r.links.map((l) => l.packageId), ['nas-2', 'nas-3']);
});

test('never matches by filename alone', () => {
  const r = matchEntries([e('e1', 'photos_and_videos/Other/a.jpg', 'a.jpg')], pkgs, opts);
  assert.equal(r.links.length, 0);
  assert.equal(r.unmatched.length, 2);
  assert.deepEqual(r.stats, { media: 2, matched: 0, unmatched: 2, entriesWithMatch: 0 });
});

test('archiveRootRel is required for the path to line up; trailing slashes tolerated', () => {
  assert.equal(matchEntries([e('e1', 'photos_and_videos/Album/a.jpg')], pkgs, { archiveRootRel: 'FB/arch/' }).links.length, 1);
  assert.equal(matchEntries([e('e1', 'photos_and_videos/Album/a.jpg')], pkgs, { archiveRootRel: 'Elsewhere' }).links.length, 0);
});

test('ambiguous folded matches are not guessed; exact still wins', () => {
  const dup = [
    { id: 'p1', nas: { relativePath: 'R/Album/x.jpg' } },
    { id: 'p2', nas: { relativePath: 'R/album/X.jpg' } },
  ];
  const r = matchEntries([e('e1', 'ALBUM/x.JPG'), e('e2', 'Album/x.jpg')], dup, { archiveRootRel: 'R' });
  assert.deepEqual(r.links, [{ entryId: 'e2', packageId: 'p1', relPath: 'Album/x.jpg' }]);
  assert.equal(r.unmatched.length, 1);
});

test('entriesWithMatch counts entries once; packages without nas path ignored', () => {
  const r = matchEntries([e('e1', 'photos_and_videos/Album/a.jpg', 'photos_and_videos/Album/B.JPG')], [...pkgs, { id: 'bad' }], opts);
  assert.equal(r.stats.matched, 2);
  assert.equal(r.stats.entriesWithMatch, 1);
});
