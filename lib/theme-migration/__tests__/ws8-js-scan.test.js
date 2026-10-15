// WS8 literal scan: every colour literal left in an owned file must be a mode-agnostic black
// shadow (X6) or listed in lib/theme-migration/allowlists/ws8.json with a reason and exception id.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, WS8_FILES, loadWs8Allowlist, scanFile, lineOf,
} from './ws8-helpers.js';

const allowlist = loadWs8Allowlist();

test('every WS8 file exists', () => {
  for (const file of WS8_FILES) assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is missing`);
});

for (const file of WS8_FILES) {
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
    assert.ok(WS8_FILES.includes(e.file), `${e.file} is allowlisted but is not a WS8 file`);
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

test('the scan helper catches a regression', () => {
  const probe = 'const x = { color: "#123456", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" };';
  const tmp = path.join(REPO_ROOT, 'lib/theme-migration/__tests__/.ws8-probe.tmp.js');
  fs.writeFileSync(tmp, probe);
  try {
    const { unallowed } = scanFile('lib/theme-migration/__tests__/.ws8-probe.tmp.js', { entries: [] });
    assert.deepEqual(unallowed.map((f) => f.literal), ['#123456']);
  } finally {
    fs.unlinkSync(tmp);
  }
});
