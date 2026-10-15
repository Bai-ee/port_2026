import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, evaluateContrast, suggestFix, reportStatus } from '../report.js';
import { CONTRAST_PAIRS, EXCLUDED_ROLES, THRESHOLDS } from '../contrast-pairs.js';
import { resolveTheme } from '../resolve.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { ROLE_IDS, ROLE_DEFS } from '../roles.js';
import { setRoleBase, setRoleLink, setLocked, setIntensity, setRoleCustom } from '../edit.js';

const light = (d = BASELINE_DEFINITION) => resolveTheme(d, 'light');
const find = (rep, id) => rep.results.find((r) => r.id === id);

test('pairs reference only known roles; ids are unique; thresholds are 4.5 / 3', () => {
  const ids = new Set();
  for (const p of CONTRAST_PAIRS) {
    assert.ok(!ids.has(p.id), p.id);
    ids.add(p.id);
    assert.ok(ROLE_IDS.includes(p.fg), p.fg);
    for (const b of p.bg) assert.ok(b === 'scene-peak' || ROLE_IDS.includes(b), b);
    assert.equal(p.min, p.kind === 'nontext' ? 3 : 4.5);
    assert.ok(['text', 'nontext', 'large'].includes(p.kind));
  }
  assert.deepEqual({ ...THRESHOLDS }, { text: 4.5, large: 3, nontext: 3 });
});

test('required pair set matches contract 7.3', () => {
  const has = (fg, bg) => CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg.join('+') === bg);
  for (const fg of ['text-default', 'text-strong', 'text-body', 'text']) {
    for (const bg of ['page', 'surface', 'raised', 'inset', 'glass-strong']) assert.ok(has(fg, bg), `${fg}@${bg}`);
  }
  assert.ok(has('text-secondary', 'surface') && has('text-muted', 'glass-strong') && has('text-faint', 'surface'));
  assert.ok(has('text-eyebrow', 'surface'));
  assert.ok(has('on-accent', 'accent') && has('on-accent', 'accent-hover') && has('on-accent', 'accent-pressed'));
  assert.ok(has('accent-text', 'page') && has('accent-text', 'surface') && has('accent-text', 'surface+accent-soft'));
  for (const s of ['success', 'warning', 'danger', 'info']) {
    assert.ok(has('on-solid', `${s}-solid`) && has(s, 'surface') && has(s, `surface+${s}-bg`) && has(`${s}-solid`, 'surface'));
  }
  assert.ok(has('selection-fg', 'selection-bg'));
  assert.ok(has('term-fg', 'term-bg-top') && has('term-build-msg', 'term-bg-bottom') && has('term-ok-pfx', 'term-bg-top'));
  assert.ok(has('dash-text-primary', 'dash-surface') && has('dash-text-secondary', 'dash-page'));
  assert.ok(has('text', 'page+scrim+scene-peak'));
  assert.ok(has('focus', 'page') && has('focus', 'surface') && has('control-border', 'surface') && has('control-border-strong', 'surface') && has('accent', 'surface'));
});

test('excluded roles are listed with reasons and never appear as a foreground', () => {
  const rep = evaluateContrast(light());
  assert.deepEqual(rep.excluded.map((e) => e.roleId), ROLE_DEFS.filter((d) => d.id in EXCLUDED_ROLES).map((d) => d.id));
  for (const e of rep.excluded) {
    assert.ok(e.reason.length > 3);
    assert.equal(CONTRAST_PAIRS.some((p) => p.fg === e.roleId), false, e.roleId);
  }
  for (const id of ['border-faint', 'border-subtle', 'glass-border', 'text-disabled', 'disabled-bg', 'shadow']) assert.ok(id in EXCLUDED_ROLES);
  assert.ok(Object.keys(EXCLUDED_ROLES).every((id) => ROLE_IDS.includes(id)));
});

test('alpha foregrounds and backgrounds are composited before measuring', () => {
  const rep = evaluateContrast(light());
  const muted = find(rep, 'text-muted@surface');
  assert.equal(muted.fgHex, '#908d8b', 'rgba(42,36,32,.52) over white');
  assert.equal(muted.bgHex, '#ffffff');
  // text on glass-strong over page: white glass over white page is white
  assert.equal(find(rep, 'text@glass-strong').bgHex, '#ffffff');
  // the overlay pair composites the scrim over the page
  assert.equal(find(rep, 'on-overlay@overlay').bgHex, '#9d9c9b');
  assert.deepEqual(find(rep, 'accent-text@surface+accent-soft').bg, ['surface', 'accent-soft']);
  assert.ok(find(rep, 'text@page+scrim+scene-peak'));
});

test('results carry the documented fields', () => {
  const r = find(evaluateContrast(light()), 'text@page');
  assert.deepEqual(Object.keys(r).sort(), ['bg', 'bgHex', 'bgLocked', 'fg', 'fgHex', 'fgLocked', 'id', 'kind', 'label', 'min', 'pass', 'ratio', 'required'].sort());
  assert.equal(r.kind, 'text');
  assert.equal(r.min, 4.5);
  assert.equal(r.pass, true);
  assert.equal(r.fgLocked, false);
  assert.ok(Number.isFinite(r.ratio) && r.ratio === Math.round(r.ratio * 100) / 100);
});

test('suggestions raise the ratio to >= min + 0.05 when applied (solid foreground)', () => {
  const rep = evaluateContrast(light());
  const f = find(rep, 'on-solid@warning-solid');
  assert.equal(f.pass, false);
  assert.equal(f.suggestion.role, 'on-solid');
  assert.ok('l' in f.suggestion.set);
  const fixed = setRoleBase(BASELINE_DEFINITION, 'light', f.suggestion.role, f.suggestion.set);
  const after = find(evaluateContrast(light(fixed)), 'on-solid@warning-solid');
  assert.ok(after.pass);
  assert.ok(after.ratio >= f.min + 0.05 - 0.006, `${after.ratio}`);
  assert.ok(f.suggestion.resultingRatio >= f.min + 0.05 - 0.006);
});

test('alpha foregrounds get an alpha suggestion', () => {
  const rep = evaluateContrast(light());
  const f = find(rep, 'text-muted@surface');
  assert.deepEqual(Object.keys(f.suggestion.set), ['a']);
  assert.ok(f.suggestion.set.a > 0.52 && f.suggestion.set.a <= 1);
  const d = setRoleLink(BASELINE_DEFINITION, 'light', 'text-muted', { to: 'text', a: f.suggestion.set.a });
  const after = find(evaluateContrast(light(d)), 'text-muted@surface');
  assert.ok(after.pass);
  assert.ok(after.ratio >= 4.55 - 0.006);
  // a non-text alpha pair too
  const cb = find(rep, 'control-border@surface');
  assert.deepEqual(Object.keys(cb.suggestion.set), ['a']);
});

test('locked roles are never suggested for change; all-locked pairs are informational (blockedByLock)', () => {
  // fg locked -> the suggestion moves a background role instead
  let d = setLocked(BASELINE_DEFINITION, 'light', 'on-solid', true);
  const rep = evaluateContrast(light(d));
  const f = find(rep, 'on-solid@warning-solid');
  assert.equal(f.fgLocked, true);
  assert.equal(f.suggestion.role, 'warning-solid');
  assert.equal(f.suggestion.blockedByLock, undefined);
  // fg and bg locked -> informational only
  d = setLocked(d, 'light', 'warning-solid', true);
  const g = find(evaluateContrast(light(d)), 'on-solid@warning-solid');
  assert.equal(g.fgLocked && g.bgLocked, true);
  assert.equal(g.suggestion.blockedByLock, true);
  assert.equal(g.suggestion.role, 'on-solid');
  // suggestFix does not mutate anything
  const resolved = light(d);
  const snapshot = JSON.stringify(resolved);
  suggestFix(resolved, CONTRAST_PAIRS.find((p) => p.id === 'on-solid@warning-solid'));
  assert.equal(JSON.stringify(resolved), snapshot);
});

test('passing pairs carry no suggestion; unfixable pairs yield null', () => {
  const rep = evaluateContrast(light());
  assert.equal(find(rep, 'text@page').suggestion, undefined);
  const resolved = light(setRoleCustom(BASELINE_DEFINITION, 'light', 'text', { l: 1, c: 0, h: 0, a: 1 }));
  // white text on a white page: fg adjustable -> a suggestion exists
  const p = CONTRAST_PAIRS.find((x) => x.id === 'text@page');
  const s = suggestFix(resolved, p);
  assert.ok(s && s.set.l < 1);
});

test('buildReport envelope, gamut list and authoring-range warnings', () => {
  const rep = buildReport(setIntensity(BASELINE_DEFINITION, 1.5));
  assert.ok(rep.gamut.length > 0);
  assert.ok(rep.gamut.every((g) => g.mapped === true && Number.isFinite(g.deltaE)));
  const r = rep.ranges.find((x) => x.roleId === 'support-1' && x.mode === 'light' && x.field === 'c');
  assert.ok(r, 'chroma above the authoring range is reported');
  assert.ok(r.value > r.max);
  assert.equal(rep.modes.light.mode, 'light');
  assert.equal(rep.modes.dark.mode, 'dark');
  assert.equal(rep.summary.pass + rep.summary.fail, rep.modes.light.results.length + rep.modes.dark.results.length);
  assert.equal(rep.summary.excluded, rep.modes.light.excluded.length + rep.modes.dark.excluded.length);
  assert.equal(reportStatus(buildReport(BASELINE_DEFINITION)), 'draft');
});

test('structure errors from an invalid definition appear in the report and force Draft', () => {
  const bad = JSON.parse(JSON.stringify(BASELINE_DEFINITION));
  bad.modes.light.roles['text-muted'].link = { to: 'nope' };
  const rep = buildReport(bad);
  assert.ok(rep.structure.errors.some((e) => e.code === 'LINK_TARGET_MISSING'));
  assert.equal(reportStatus(rep), 'draft');
});
