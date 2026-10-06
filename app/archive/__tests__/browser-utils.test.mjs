import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, entriesFromResult, segmentsFor, joinPath, slugifyCollectionId, commonParent, flattenVisible, summarizeSelection } from '../browser-utils.js';

test('formatBytes: zero and falsy', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(null), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('formatBytes: whole bytes have no decimal', () => {
  assert.equal(formatBytes(512), '512 B');
});

test('formatBytes: scales units and keeps one decimal above B', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(144556032), '137.9 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), '2.5 GB');
});

test('entriesFromResult: null/undefined result', () => {
  assert.deepEqual(entriesFromResult(null), []);
  assert.deepEqual(entriesFromResult(undefined), []);
});

test('entriesFromResult: passes through new-worker entries unchanged', () => {
  const entries = [
    { name: 'a', kind: 'folder' },
    { name: 'b.mov', kind: 'file', sizeBytes: 100, ext: 'mov', movable: true },
  ];
  assert.equal(entriesFromResult({ entries, folders: ['a'] }), entries);
});

test('entriesFromResult: synthesizes folder-only entries from an old-worker result', () => {
  const result = { relativePath: '.', folders: ['Housepit', 'San Francisco'] };
  assert.deepEqual(entriesFromResult(result), [
    { name: 'Housepit', kind: 'folder' },
    { name: 'San Francisco', kind: 'folder' },
  ]);
});

test('entriesFromResult: missing folders too -> empty array', () => {
  assert.deepEqual(entriesFromResult({ relativePath: '.' }), []);
});

test('segmentsFor: root path', () => {
  assert.deepEqual(segmentsFor('.'), [{ name: 'ROOT', path: '.' }]);
  assert.deepEqual(segmentsFor(''), [{ name: 'ROOT', path: '.' }]);
  assert.deepEqual(segmentsFor(undefined), [{ name: 'ROOT', path: '.' }]);
});

test('segmentsFor: nested path builds cumulative segments', () => {
  assert.deepEqual(segmentsFor('Housepit/San Francisco/2008'), [
    { name: 'ROOT', path: '.' },
    { name: 'Housepit', path: 'Housepit' },
    { name: 'San Francisco', path: 'Housepit/San Francisco' },
    { name: '2008', path: 'Housepit/San Francisco/2008' },
  ]);
});

test('segmentsFor: tolerates leading/trailing/double slashes', () => {
  assert.deepEqual(segmentsFor('/Housepit//2008/'), [
    { name: 'ROOT', path: '.' },
    { name: 'Housepit', path: 'Housepit' },
    { name: '2008', path: 'Housepit/2008' },
  ]);
});

test('joinPath: from root', () => {
  assert.equal(joinPath('.', 'Housepit'), 'Housepit');
  assert.equal(joinPath('', 'Housepit'), 'Housepit');
  assert.equal(joinPath(null, 'Housepit'), 'Housepit');
});

test('joinPath: nested', () => {
  assert.equal(joinPath('Housepit', 'San Francisco'), 'Housepit/San Francisco');
  assert.equal(joinPath('Housepit/San Francisco', '2008'), 'Housepit/San Francisco/2008');
});

test('slugifyCollectionId: root sentinel', () => {
  assert.equal(slugifyCollectionId('.'), 'root');
  assert.equal(slugifyCollectionId(''), 'root');
  assert.equal(slugifyCollectionId(null), 'root');
  assert.equal(slugifyCollectionId(undefined), 'root');
});

test('slugifyCollectionId: lowercases and replaces non-alphanumerics', () => {
  assert.equal(slugifyCollectionId('Housepit/San Francisco'), 'housepit-san-francisco');
});

test('slugifyCollectionId: collapses runs and trims edges', () => {
  assert.equal(slugifyCollectionId('  Housepit -- 2008!! '), 'housepit-2008');
});

test('slugifyCollectionId: caps at 64 characters', () => {
  const long = 'a'.repeat(70);
  const slug = slugifyCollectionId(long);
  assert.equal(slug.length, 64);
  assert.equal(slug, 'a'.repeat(64));
});

test('slugifyCollectionId: trims a trailing dash introduced by truncation', () => {
  const long = `${'a'.repeat(63)} b b b`;
  const slug = slugifyCollectionId(long);
  assert.ok(slug.length <= 64);
  assert.ok(!slug.endsWith('-'));
});

test('commonParent: empty list is root', () => {
  assert.equal(commonParent([]), '.');
  assert.equal(commonParent(undefined), '.');
});

test('commonParent: a single file returns its containing folder', () => {
  assert.equal(commonParent(['Housepit/2008/clip.mp4']), 'Housepit/2008');
});

test('commonParent: a single top-level file returns root', () => {
  assert.equal(commonParent(['notes.txt']), '.');
});

test('commonParent: siblings share their parent folder', () => {
  assert.equal(commonParent(['Housepit/2008/clip.mp4', 'Housepit/2008/photo.jpg']), 'Housepit/2008');
});

test('commonParent: divergent branches fall back to the shared ancestor', () => {
  assert.equal(commonParent(['Housepit/2008/clip.mp4', 'Housepit/2009/photo.jpg']), 'Housepit');
});

test('commonParent: no shared ancestor beyond root', () => {
  assert.equal(commonParent(['Housepit/clip.mp4', 'SanFrancisco/photo.jpg']), '.');
});

test('flattenVisible: flat list when nothing is expanded', () => {
  const tree = { path: '.', entries: [
    { name: 'Housepit', kind: 'folder' },
    { name: 'notes.txt', kind: 'file' },
  ] };
  const rows = flattenVisible(tree, new Set());
  assert.deepEqual(rows.map((r) => [r.path, r.depth]), [['Housepit', 0], ['notes.txt', 0]]);
});

test('flattenVisible: expands nested children in depth-first, on-screen order', () => {
  const tree = {
    path: '.',
    entries: [
      { name: 'Housepit', kind: 'folder' },
      { name: 'notes.txt', kind: 'file' },
    ],
    children: {
      Housepit: { entries: [
        { name: '2008', kind: 'folder' },
        { name: 'clip.mp4', kind: 'file' },
      ] },
      'Housepit/2008': { entries: [
        { name: 'photo.jpg', kind: 'file' },
      ] },
    },
  };
  const rows = flattenVisible(tree, new Set(['Housepit', 'Housepit/2008']));
  assert.deepEqual(rows.map((r) => r.path), [
    'Housepit', 'Housepit/2008', 'Housepit/2008/photo.jpg', 'Housepit/clip.mp4', 'notes.txt',
  ]);
});

test('flattenVisible: an expanded folder with no loaded children renders no descendants', () => {
  const tree = { path: '.', entries: [{ name: 'Housepit', kind: 'folder' }] };
  const rows = flattenVisible(tree, new Set(['Housepit']));
  assert.deepEqual(rows.map((r) => r.path), ['Housepit']);
});

test('summarizeSelection: empty selection', () => {
  assert.deepEqual(summarizeSelection(new Map()), { total: 0, folders: 0, files: 0, bytes: 0 });
});

test('summarizeSelection: counts folders and files, sums file bytes only', () => {
  const selected = new Map([
    ['Housepit/2008', { kind: 'folder' }],
    ['Housepit/clip.mp4', { kind: 'file', sizeBytes: 1000 }],
    ['Housepit/photo.jpg', { kind: 'file', sizeBytes: 500 }],
  ]);
  assert.deepEqual(summarizeSelection(selected), { total: 3, folders: 1, files: 2, bytes: 1500 });
});

test('summarizeSelection: a file with no sizeBytes counts as 0 bytes', () => {
  const selected = new Map([['a.txt', { kind: 'file' }]]);
  assert.deepEqual(summarizeSelection(selected), { total: 1, folders: 0, files: 1, bytes: 0 });
});
