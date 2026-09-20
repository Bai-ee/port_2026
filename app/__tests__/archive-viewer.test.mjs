import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerDir = path.join(__dirname, '..', '..', 'public', 'archive-viewer');
const html = fs.readFileSync(path.join(viewerDir, 'index.html'), 'utf8');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(viewerDir, 'fixtures', name), 'utf8'));
}

// Extract the pure, DOM-free logic block from the viewer's single <script> so it can be
// exercised directly in Node without a browser. This block is delimited with explicit
// markers in index.html (ARCHIVE_VIEWER_PURE_START/END); everything outside those markers
// touches `document`/`fetch`/`navigator` and is intentionally left to manual/browser checks.
function loadPureViewerLib() {
  const startMarker = '/* ARCHIVE_VIEWER_PURE_START */';
  const endMarker = '/* ARCHIVE_VIEWER_PURE_END */';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  assert.ok(start !== -1 && end !== -1 && end > start, 'pure-function markers must exist in index.html');
  const body = html.slice(start + startMarker.length, end);
  const factory = new Function(
    body +
      '\nreturn {formatBytes,truncateHash,normalizeManifest,normalizeManifestAsset,filterAssets,collectPillarValues,isPillarDecision,totalBytes,normalizeRecord};'
  );
  return factory();
}

const lib = loadPureViewerLib();

test('required stable DOM ids exist in the viewer markup', () => {
  for (const id of [
    'viewer-collection-header',
    'viewer-asset-list',
    'viewer-record-drawer',
    'viewer-filter-row',
    'viewer-search-input',
    'viewer-pillar-chip-row',
    'viewer-has-corrections-toggle',
    'viewer-record-drawer-body',
    'viewer-previous-manifest-link'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing id="${id}"`);
  }
});

test('viewer keeps the documented integrity label and never claims browser re-hashing', () => {
  assert.ok(html.includes('SHA-256 VERIFIED'));
  assert.ok(!/re-?hash/i.test(html), 'viewer must not claim it re-hashes assets in the browser');
});

test('viewer has no external dependencies besides arweave.net', () => {
  const urls = html.match(/https?:\/\/[^\s"'`)]+/g) || [];
  assert.ok(urls.length > 0, 'expected at least the arweave.net base URL to appear');
  for (const url of urls) {
    assert.ok(url.startsWith('https://arweave.net'), `unexpected external URL: ${url}`);
  }
  assert.ok(!/<script[^>]+src=/i.test(html), 'must not load external scripts');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'must not load external stylesheets/fonts');
});

test('viewer file stays at or under the 40 KB budget', () => {
  const bytes = Buffer.byteLength(html, 'utf8');
  assert.ok(bytes <= 40 * 1024, `index.html is ${bytes} bytes, over the 40KB budget`);
});

test('normalizeManifest parses a v1.1 collection manifest', () => {
  const fixture = readFixture('manifest-v1.1.json');
  const m = lib.normalizeManifest(fixture);
  assert.equal(m.schemaVersion, '1.1');
  assert.equal(m.legacy, false);
  assert.equal(m.version, 2);
  assert.equal(m.previousManifestTransactionId, 'prevManifestTx00000000000000000000000000');
  assert.equal(m.assets.length, 2);
  const [a1] = m.assets;
  assert.equal(a1.originalTransactionId, 'origTx000111111111111111111111111111111');
  assert.equal(a1.originalUrl, 'https://arweave.net/origTx000111111111111111111111111111111');
  assert.equal(a1.recordTransactionId, 'recTx0001222222222222222222222222222222');
  assert.equal(a1.recordVersion, 2);
  assert.equal(a1.decisions.length, 2);
});

test('normalizeManifest parses a legacy v1.0 manifest and labels it legacy', () => {
  const fixture = readFixture('manifest-v1.0-legacy.json');
  const m = lib.normalizeManifest(fixture);
  assert.equal(m.schemaVersion, '1.0');
  assert.equal(m.legacy, true);
  assert.equal(m.assets.length, 1);
  const [a] = m.assets;
  // legacy field names (transactionId/arweaveUrl) must fall back correctly
  assert.equal(a.originalTransactionId, 'legacyTx00055555555555555555555555555555');
  assert.equal(a.originalUrl, 'https://arweave.net/legacyTx00055555555555555555555555555555');
  assert.equal(a.recordTransactionId, null);
  // legacy decisions carry `selectedValue`, not `value`
  assert.equal(a.decisions[0].value, 'X');
});

test('normalizeManifest rejects an empty/invalid manifest', () => {
  assert.throws(() => lib.normalizeManifest(null));
  assert.throws(() => lib.normalizeManifest(undefined));
});

test('formatBytes renders human-readable sizes', () => {
  assert.equal(lib.formatBytes(0), '0 B');
  assert.equal(lib.formatBytes(512), '512 B');
  assert.equal(lib.formatBytes(1536), '1.5 KB');
  assert.equal(lib.formatBytes(15831022), '15 MB');
});

test('truncateHash truncates long hashes and leaves short ones intact', () => {
  const full = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';
  const truncated = lib.truncateHash(full);
  assert.ok(truncated.length < full.length);
  assert.ok(truncated.includes('…'));
  assert.equal(lib.truncateHash('short'), 'short');
});

test('filterAssets: text search matches archiveName and decision values', () => {
  const m = lib.normalizeManifest(readFixture('manifest-v1.1.json'));
  const byName = lib.filterAssets(m.assets, { query: 'hero-banner' });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, 'asset-002');

  const byDecision = lib.filterAssets(m.assets, { query: 'instagram' });
  assert.equal(byDecision.length, 1);
  assert.equal(byDecision[0].id, 'asset-002');
});

test('filterAssets: pillar value filter restricts to matching assets', () => {
  const m = lib.normalizeManifest(readFixture('manifest-v1.1.json'));
  const filtered = lib.filterAssets(m.assets, { pillarValue: 'Brand' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'asset-002');
});

test('filterAssets: hasCorrectionsOnly keeps only assets with recordVersion > 1', () => {
  const m = lib.normalizeManifest(readFixture('manifest-v1.1.json'));
  const filtered = lib.filterAssets(m.assets, { hasCorrectionsOnly: true });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'asset-001');
});

test('collectPillarValues only surfaces decisions tagged as a content pillar', () => {
  const m = lib.normalizeManifest(readFixture('manifest-v1.1.json'));
  const pillars = lib.collectPillarValues(m.assets);
  const values = pillars.map((p) => p.value).sort();
  assert.deepEqual(values, ['Brand', 'Product Launch']);
  // "platform" decisions (X, Instagram) must not leak in as pillar chips
  assert.ok(!values.includes('X'));
  assert.ok(!values.includes('Instagram'));
});

test('totalBytes sums asset sizes', () => {
  const m = lib.normalizeManifest(readFixture('manifest-v1.1.json'));
  assert.equal(lib.totalBytes(m.assets), 15831022 + 4521099);
});

test('normalizeRecord parses a v1.1 archive record with jev/human/corrections', () => {
  const r = lib.normalizeRecord(readFixture('record-v1.1.json'));
  assert.equal(r.schemaVersion, '1.1');
  assert.equal(r.legacy, false);
  assert.equal(r.version, 2);
  assert.equal(r.previousRecordTransactionId, 'recTx0001111111111111111111111111111111');
  assert.equal(r.decisions.length, 2);
  const [pillarDecision] = r.decisions;
  assert.equal(pillarDecision.jev.value, 'Announcement');
  assert.equal(pillarDecision.human.value, 'Product Launch');
  assert.equal(r.corrections.length, 1);
  assert.equal(r.corrections[0].decisionId, 'contentPillar');
});

test('normalizeRecord chains to a previous version fixture (no further previous)', () => {
  const r = lib.normalizeRecord(readFixture('record-v1.1-previous.json'));
  assert.equal(r.version, 1);
  assert.equal(r.previousRecordTransactionId, null);
  assert.equal(r.corrections.length, 0);
});
