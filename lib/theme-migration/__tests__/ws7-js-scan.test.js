// WS7 (public JSX) literal scan: every colour literal left in an owned, themed
// file must be a mode-agnostic black shadow (X6) or listed in
// lib/theme-migration/allowlists/ws7.json with a reason and an exception id.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, PINNED_FILES, PINNED_DIRS, allThemedFiles, loadAllowlist, scanFile, lineOf,
} from './ws7-helpers.js';

const allowlist = loadAllowlist();
const FILES = allThemedFiles();

test('every owned themed file exists', () => {
  for (const file of FILES) assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is missing`);
});

for (const file of FILES) {
  test(`no unlisted colour literals in ${file}`, () => {
    const { src, unallowed } = scanFile(file, allowlist);
    const detail = unallowed.map((f) => `${file}:${lineOf(src, f.index)} ${f.literal} [${f.prop}]`).join('\n');
    assert.equal(unallowed.length, 0, `unlisted colour literals (tokenise or allowlist):\n${detail}`);
  });
}

test('allowlist entries are well formed and not stale', () => {
  assert.ok(allowlist.legend && typeof allowlist.legend === 'object', 'legend missing');
  assert.ok(Array.isArray(allowlist.entries) && allowlist.entries.length > 0);
  for (const e of allowlist.entries) {
    assert.ok(FILES.includes(e.file), `${e.file} is allowlisted but is not an owned themed file`);
    assert.ok(typeof e.reason === 'string' && e.reason.length > 10, `${e.file} ${e.literal}: reason required`);
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

test('pinned routes are listed with a reason and are not literal-scanned', () => {
  const listed = (allowlist.pinnedFiles || []).map((p) => p.file).sort();
  assert.deepEqual(listed, [...PINNED_FILES].sort());
  for (const p of allowlist.pinnedFiles) {
    assert.equal(p.exceptionId, 'X8');
    assert.ok(p.reason.length > 10);
    assert.ok(PINNED_DIRS.some((d) => p.file === d || p.file.startsWith(`${d}/`)), `${p.file} is outside the pinned directories`);
  }
  for (const file of FILES) {
    assert.ok(!PINNED_DIRS.some((d) => file.startsWith(`${d}/`)), `${file} is pinned, it must not be in the themed list`);
  }
});

test('the scan helper catches a regression', () => {
  // Guards the guard: a literal that is neither shadow nor allowlisted must be reported.
  const probe = 'const x = { color: "#123456", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" };';
  const tmp = path.join(REPO_ROOT, 'lib/theme-migration/__tests__/.ws7-probe.tmp.js');
  fs.writeFileSync(tmp, probe);
  try {
    const { unallowed } = scanFile('lib/theme-migration/__tests__/.ws7-probe.tmp.js', { entries: [] });
    assert.deepEqual(unallowed.map((f) => f.literal), ['#123456']);
  } finally {
    fs.unlinkSync(tmp);
  }
});
