// WS6 (dashboard / admin JSX) literal scan: every colour literal left in an owned, themed
// file must be a mode-agnostic black shadow (X6) or listed in
// lib/theme-migration/allowlists/ws6.json with a reason, an exception id and the exact
// occurrence count (so a new, un-reviewed literal of an already-listed colour still fails).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, PINNED_PATHS, themedFiles, loadAllowlist, scanFile, lineOf, read,
} from './ws6-helpers.js';

const allowlist = loadAllowlist();
const FILES = themedFiles();

test('owned themed file set is non-trivial and every file exists', () => {
  assert.ok(FILES.length > 60, `expected the WS6 file set, got ${FILES.length}`);
  for (const must of ['DashboardPage.jsx', 'OpsOverviewPage.jsx', 'components/AdminCostView.jsx', 'components/AdminEmailModals.jsx', 'components/dashboard/content-ui/ContentUiStyles.jsx', 'components/brain-builder/BrainBuilder.jsx']) {
    assert.ok(FILES.includes(must), `${must} missing from the themed set`);
  }
  for (const file of FILES) assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is missing`);
});

test('pinned paths are never part of the themed set', () => {
  for (const file of FILES) {
    assert.ok(!PINNED_PATHS.some((p) => file === p || file.startsWith(`${p}/`)), `${file} is pinned but scanned`);
  }
});

for (const file of FILES) {
  test(`no unlisted colour literals in ${file}`, () => {
    const { src, unallowed } = scanFile(file, allowlist);
    const detail = unallowed.map((f) => `${file}:${lineOf(src, f.index)} ${f.literal}`).join('\n');
    assert.equal(unallowed.length, 0, `unlisted colour literals (tokenise or allowlist with a reason):\n${detail}`);
  });
}

test('allowlist entries are well formed, justified and not stale', () => {
  assert.equal(allowlist.workstream, 'WS6');
  assert.ok(allowlist.legend && typeof allowlist.legend === 'object', 'legend missing');
  assert.ok(Array.isArray(allowlist.entries) && allowlist.entries.length > 0);
  for (const e of allowlist.entries) {
    assert.ok(FILES.includes(e.file), `${e.file} is allowlisted but is not an owned, themed file`);
    assert.ok(typeof e.reason === 'string' && e.reason.length > 20, `${e.file} ${e.literal}: a reason is required`);
    assert.ok(e.exceptionId in allowlist.legend, `${e.file} ${e.literal}: unknown exception id ${e.exceptionId}`);
    assert.ok(Number.isInteger(e.count) && e.count > 0, `${e.file} ${e.literal}: count must be a positive integer`);
  }
  for (const file of new Set(allowlist.entries.map((e) => e.file))) {
    const { slots } = scanFile(file, allowlist);
    for (const [lit, slot] of slots) {
      assert.equal(slot.used, slot.allowed, `${file}: allowlist says ${slot.allowed} x ${slot.entry.literal}, source has ${slot.used} (${lit})`);
    }
  }
});

test('pinned paths are listed with a reason and an exception id, and exist', () => {
  const listed = (allowlist.pinnedPaths || []).map((p) => p.file).sort();
  assert.deepEqual(listed, [...PINNED_PATHS].sort());
  for (const p of allowlist.pinnedPaths) {
    assert.ok(['X7', 'X8'].includes(p.exceptionId), `${p.file}: unexpected exception id ${p.exceptionId}`);
    assert.ok(p.reason.length > 20, `${p.file}: reason required`);
    assert.ok(p.exceptionId in allowlist.legend);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, p.file)), `${p.file} does not exist`);
  }
});

test('the migration actually happened: the dominant legacy literals are gone from the busiest files', () => {
  // Guards against an allowlist that simply swallows everything.
  const total = allowlist.entries.reduce((n, e) => n + e.count, 0);
  assert.ok(total < 600, `allowlist covers ${total} literals; the migrated set should stay well below that`);
  for (const [file, literal] of [
    ['components/dashboard/content-ui/ContentUiStyles.jsx', '#1f1d1b'],
    ['components/dashboard/CopywriterCard.jsx', '#2a2420'],
    ['components/dashboard/XMonitorCard.jsx', '#2a2420'],
    ['components/dashboard/SiteRecreateCard.jsx', '#2a2420'],
    ['components/AdminDashboardFailuresView.jsx', '#2a2420'],
  ]) {
    assert.equal(read(file).toLowerCase().includes(literal), false, `${file} still contains ${literal}`);
  }
});

test('the scan helper catches a regression', () => {
  // Guards the guard: a literal that is neither a black shadow nor allowlisted must be reported.
  const probe = 'const x = { color: "#123456", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" };';
  const { unallowed } = scanFile('probe.js', { entries: [] }, probe);
  assert.deepEqual(unallowed.map((f) => f.literal), ['#123456']);
  const probe2 = 'const css = `.a { box-shadow: 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.4); }`;';
  const r2 = scanFile('probe.js', { entries: [] }, probe2);
  assert.deepEqual(r2.unallowed.map((f) => f.literal), ['rgba(255,255,255,0.4)']);
});
