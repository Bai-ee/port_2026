import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendUnlistedToIndex,
  buildIndexMarkdown,
  buildManifest,
  classifyBrainPath,
  groupBrainItems,
  isJunkPath,
  legacyBrainFields,
  parseSourceRegister,
  stripCommonRoot,
  versionPathFor,
} from '../brain-layout.js';
import { rankBrainChunks } from '../retrieval.js';
import { buildZip, crc32 } from '../zip.js';

// File list of the reference brain (Critters Quest, 2026-11-19), as a folder
// pick reports it: every path starts with the picked folder "brain/".
const CQ_FOLDER_PICK = [
  'brain/2026-11-19-announcements-reviewed.md',
  'brain/2026-11-19-discord-sentiment.json',
  'brain/2026-11-19-discord-sentiment.md',
  'brain/2026-11-20--12-03-x-calendar.json',
  'brain/INDEX.md',
  'brain/MASTER_BRAIN.md',
  'brain/STRATEGY_WORKING_BRIEF.md',
  'brain/manifest.json',
  'brain/sources/2026-11-19-discord-raw.txt',
  'brain/sources/2026-11-19-source-register.md',
  'brain/versions/2026-11-19-before-announcements/INDEX.md',
  'brain/versions/2026-11-19-before-announcements/sources/2026-11-19-source-register.md',
];

test('stripCommonRoot drops the picked folder but keeps brain folders', () => {
  const paths = stripCommonRoot(CQ_FOLDER_PICK);
  assert.equal(paths[0], '2026-11-19-announcements-reviewed.md');
  assert.equal(paths[8], 'sources/2026-11-19-discord-raw.txt');
  assert.deepEqual(stripCommonRoot(['sources/a.txt', 'sources/b.txt']), ['sources/a.txt', 'sources/b.txt']);
  assert.deepEqual(stripCommonRoot(['INDEX.md', 'sources/a.txt']), ['INDEX.md', 'sources/a.txt']);
});

test('classifyBrainPath files the reference brain in its own layout', () => {
  const roles = Object.fromEntries(stripCommonRoot(CQ_FOLDER_PICK).map((path) => [path, classifyBrainPath(path, { today: '2026-11-20' })]));
  assert.equal(roles['MASTER_BRAIN.md'].brainRole, 'master');
  assert.equal(roles['INDEX.md'].brainRole, 'index');
  assert.equal(roles['manifest.json'].brainRole, 'manifest');
  assert.equal(roles['STRATEGY_WORKING_BRIEF.md'].brainRole, 'brief');
  assert.deepEqual(
    { role: roles['2026-11-19-discord-sentiment.json'].brainRole, date: roles['2026-11-19-discord-sentiment.json'].brainDate },
    { role: 'analysis', date: '2026-11-19' }
  );
  assert.equal(roles['2026-11-20--12-03-x-calendar.json'].brainRole, 'analysis');
  assert.equal(roles['sources/2026-11-19-discord-raw.txt'].brainRole, 'source');
  assert.equal(roles['sources/2026-11-19-discord-raw.txt'].brainPath, 'sources/2026-11-19-discord-raw.txt');
  const snapshot = roles['versions/2026-11-19-before-announcements/sources/2026-11-19-source-register.md'];
  assert.equal(snapshot.brainRole, 'version');
  assert.equal(snapshot.versionLabel, '2026-11-19-before-announcements');
  // Every path is kept exactly as it was in the reference brain.
  for (const [path, result] of Object.entries(roles)) assert.equal(result.brainPath, path);
});

test('loose files are filed as dated raw sources', () => {
  assert.deepEqual(classifyBrainPath('Q3 Pitch Deck.pdf', { today: '2026-11-20' }), {
    brainPath: 'sources/2026-11-20-q3-pitch-deck.pdf',
    brainRole: 'source',
    brainDate: '2026-11-20',
    versionLabel: null,
  });
  assert.equal(classifyBrainPath('2026-10-01-call-notes.txt', { today: '2026-11-20' }).brainPath, 'sources/2026-10-01-call-notes.txt');
  assert.equal(classifyBrainPath('2026-10-01-review.md', { today: '2026-11-20' }).brainRole, 'analysis');
  assert.equal(classifyBrainPath('interviews/jane.md', { today: '2026-11-20' }).brainPath, 'sources/interviews/2026-11-20-jane.md');
  assert.equal(classifyBrainPath('../../etc/passwd', { today: '2026-11-20' }).brainPath, 'sources/etc/2026-11-20-passwd');
});

test('junk files from folder picks are recognised', () => {
  assert.equal(isJunkPath('brain/.DS_Store'), true);
  assert.equal(isJunkPath('__MACOSX/brain/INDEX.md'), true);
  assert.equal(isJunkPath('brain/INDEX.md'), false);
});

test('a replaced file moves under versions/<date>-before-<name>/', () => {
  assert.deepEqual(versionPathFor('MASTER_BRAIN.md', { today: '2026-11-20' }), {
    brainPath: 'versions/2026-11-20-before-master-brain/MASTER_BRAIN.md',
    versionLabel: '2026-11-20-before-master-brain',
  });
  const moved = classifyBrainPath(versionPathFor('sources/a.txt', { today: '2026-11-20' }).brainPath);
  assert.equal(moved.brainRole, 'version');
});

test('legacy items without a brain path show as sources', () => {
  const legacy = legacyBrainFields({ title: 'Founder notes', type: 'text', createdAt: '2026-03-04T10:00:00.000Z' });
  assert.equal(legacy.brainPath, 'sources/2026-03-04-founder-notes.md');
  assert.equal(legacy.legacy, true);
});

test('parseSourceRegister maps register IDs to source files', () => {
  const register = [
    '| ID | Source | Date | Use |',
    '|---|---|---|---|',
    '| D2 | [Exact file](2026-11-19-discord-announcements-raw.txt), plus [records](2026-11-19-discord-announcements.json). | x | y |',
    '| X1–X11 | Archived posts, per [saved records](2026-11-19-official-posts-stored.json). | x | y |',
    '| O1 | [Official roadmap](https://critters.quest/roadmap). | x | y |',
    'See [manifest](../manifest.json).',
  ].join('\n');
  const ids = parseSourceRegister(register, { registerPath: 'sources/2026-11-19-source-register.md' });
  assert.deepEqual(ids['sources/2026-11-19-discord-announcements-raw.txt'], ['D2']);
  assert.deepEqual(ids['sources/2026-11-19-official-posts-stored.json'], ['X1–X11']);
  assert.equal(Object.keys(ids).some((key) => key.includes('critters.quest')), false);
});

const ITEMS = [
  { id: '1', brainPath: 'MASTER_BRAIN.md', brainRole: 'master', title: 'MASTER_BRAIN.md', sizeBytes: 10, sha256: 'a' },
  { id: '2', brainPath: 'INDEX.md', brainRole: 'index', title: 'INDEX.md', sizeBytes: 5, sha256: 'b' },
  { id: '3', brainPath: '2026-11-19-discord-sentiment.md', brainRole: 'analysis', brainDate: '2026-11-19', title: '2026-11-19-discord-sentiment.md', sizeBytes: 7, sha256: 'c' },
  { id: '4', brainPath: 'sources/2026-11-19-discord-raw.txt', brainRole: 'source', title: '2026-11-19-discord-raw.txt', sizeBytes: 3, sha256: 'd', sourceIds: ['D1'] },
  { id: '5', brainPath: 'versions/2026-11-19-before-announcements/INDEX.md', brainRole: 'version', versionLabel: '2026-11-19-before-announcements', title: 'INDEX.md', sizeBytes: 2, sha256: 'e' },
];

test('groupBrainItems gives root, analysis, sources, then snapshots', () => {
  const groups = groupBrainItems(ITEMS);
  assert.deepEqual(groups.map((group) => group.label), ['Root', 'Analysis', 'sources/', 'versions/2026-11-19-before-announcements/']);
  assert.deepEqual(groups[0].items.map((item) => item.brainPath), ['MASTER_BRAIN.md', 'INDEX.md']);
});

test('buildManifest matches the reference shape, snapshots included', () => {
  const manifest = buildManifest({ project: 'Critters Quest', items: ITEMS, generatedAt: '2026-11-20T00:00:00.000Z' });
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.project, 'Critters Quest');
  assert.deepEqual(manifest.files.map((file) => file.path), [
    '2026-11-19-discord-sentiment.md',
    'INDEX.md',
    'MASTER_BRAIN.md',
    'sources/2026-11-19-discord-raw.txt',
    'versions/2026-11-19-before-announcements/INDEX.md',
  ]);
  assert.deepEqual(manifest.files[2], { path: 'MASTER_BRAIN.md', bytes: 10, sha256: 'a' });
});

test('INDEX.md: generated when missing, appended to when uploaded', () => {
  const generated = buildIndexMarkdown({ project: 'Critters Quest', items: ITEMS, today: '2026-11-20' });
  assert.match(generated, /^# Critters Quest brain — index/);
  assert.match(generated, /\[2026-11-19-discord-raw\.txt\]\(sources\/2026-11-19-discord-raw\.txt\) \(D1\)/);

  const uploaded = '# Index\n- [Master](MASTER_BRAIN.md)\n- [Raw](sources/2026-11-19-discord-raw.txt)\n';
  const appended = appendUnlistedToIndex(uploaded, ITEMS, { today: '2026-11-20' });
  assert.match(appended, /## Added in HITLOOP \(listed 2026-11-20\)\n- \[2026-11-19-discord-sentiment\.md\]/);
  assert.equal(appended.includes('versions/'), false);
  assert.equal(appendUnlistedToIndex(uploaded, ITEMS.slice(0, 2)), uploaded);
});

test('rankBrainChunks prefers consolidated docs and pushes snapshots last', () => {
  const ranked = rankBrainChunks([
    { id: 'raw', distance: 0.30, brainRole: 'source' },
    { id: 'old', distance: 0.20, brainRole: 'version' },
    { id: 'master', distance: 0.32, brainRole: 'master' },
    { id: 'legacy', distance: 0.31 },
  ], 3);
  assert.deepEqual(ranked.map((chunk) => chunk.id), ['master', 'raw', 'legacy']);
  assert.deepEqual(rankBrainChunks([{ id: 'old', distance: 0.2, brainRole: 'version' }], 3).map((c) => c.id), ['old']);
});

test('buildZip writes a zip that unzip reads back byte-for-byte', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const files = [
    { path: 'cq-brain/INDEX.md', data: Buffer.from('# Index — ünïcode\n') },
    { path: 'cq-brain/sources/raw.txt', data: Buffer.from('line one\\\nline two\n') },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'kb-zip-'));
  writeFileSync(join(dir, 'brain.zip'), buildZip(files));
  let unzipAvailable = true;
  try {
    execFileSync('unzip', ['-q', join(dir, 'brain.zip'), '-d', join(dir, 'out')]);
  } catch (err) {
    if (err.code === 'ENOENT') unzipAvailable = false;
    else throw err;
  }
  if (!unzipAvailable) return;
  for (const file of files) {
    assert.deepEqual(readFileSync(join(dir, 'out', file.path)), file.data);
  }
});
