import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildReport } from '../report.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { CONTRAST_STATEMENT } from '../constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const stored = JSON.parse(fs.readFileSync(path.join(here, '../production/baseline.report.json'), 'utf8'));
const report = buildReport(BASELINE_DEFINITION);

test('buildReport(BASELINE) equals the stored baseline.report.json (no silent drift)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(report)), stored);
});

const find = (mode, id) => {
  const r = report.modes[mode].results.find((x) => x.id === id);
  assert.ok(r, `${mode} ${id} missing`);
  return r;
};
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('known baseline accessibility defects (contract 12.4 #1-#5) are reported, not hidden', () => {
  // 1. control-border 1.56:1 vs white surface
  const cb = find('light', 'control-border@surface');
  near(cb.ratio, 1.56);
  assert.equal(cb.pass, false);
  assert.equal(cb.required, false);
  // control-border-strong meets 3:1 at 3.57
  const cbs = find('light', 'control-border-strong@surface');
  near(cbs.ratio, 3.57);
  assert.equal(cbs.pass, true);
  // 2. muted 3.30 and faint 2.26
  near(find('light', 'text-muted@surface').ratio, 3.3);
  near(find('light', 'text-faint@surface').ratio, 2.26);
  assert.equal(find('light', 'text-muted@surface').pass, false);
  assert.equal(find('light', 'text-faint@surface').pass, false);
  // 3. accent #00adb5 on white 2.75
  const ac = find('light', 'accent@surface');
  near(ac.ratio, 2.75);
  assert.equal(ac.pass, false);
  // 4. text on the blocked-tile overlay over white 2.56
  const ov = find('light', 'on-overlay@overlay');
  near(ov.ratio, 2.56);
  assert.equal(ov.pass, false);
  assert.equal(ov.required, true);
  // 5. white on success/warning solids 3.31 / 2.21
  near(find('light', 'on-solid@success-solid').ratio, 3.31);
  near(find('light', 'on-solid@warning-solid').ratio, 2.21);
  assert.equal(find('light', 'on-solid@success-solid').pass, false);
  assert.equal(find('light', 'on-solid@warning-solid').pass, false);
});

test('every defect carries a suggestion and nothing was auto-applied', () => {
  for (const id of ['text-muted@surface', 'control-border@surface', 'on-solid@warning-solid', 'on-overlay@overlay']) {
    const r = find('light', id);
    assert.ok(r.suggestion, id);
    assert.ok(r.suggestion.resultingRatio >= r.min + 0.05 - 0.005, id);
  }
  assert.equal(BASELINE_DEFINITION.modes.light.roles['text-muted'].link.a, 0.52);
});

test('the dark baseline has no failing REQUIRED pair', () => {
  const dark = report.modes.dark.results.filter((r) => !r.pass && r.required);
  assert.deepEqual(dark.map((r) => r.id), []);
});

test('report envelope', () => {
  assert.equal(report.statement, CONTRAST_STATEMENT);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.definitionId, 'baseline');
  assert.deepEqual(report.structure, { errors: [], warnings: [] });
  assert.deepEqual(report.ranges, [], 'baseline sits inside every authoring range');
  const s = report.summary;
  assert.equal(s.fail, s.failRequired + s.advisoryFail);
  assert.ok(s.failRequired > 0, 'the baseline is a Draft (documented defects)');
  assert.ok(s.pass > 150);
});
