import test from 'node:test';
import assert from 'node:assert/strict';
import { exportThemeJson, importThemeJson, buildExportBundle } from '../export.js';
import { resolveBoth } from '../resolve.js';
import { toCss } from '../css.js';
import { hashDefinition, canonicalize, validateDefinition } from '../validate.js';
import { buildReport, reportStatus } from '../report.js';
import { BASELINE_DEFINITION, createBaseline } from '../baseline.js';
import {
  setMasterHue, setIntensity, setNeutral, setRoleCustom, setLocked, setRoleLink, setSceneSource, setSceneCustom,
  setSceneFollow, setModeSettings, setFeatures, setViewerPreference, setOffset, setRoleBase, linkModes, setMeta,
} from '../edit.js';

function sampleThemes() {
  let busy = setMasterHue(BASELINE_DEFINITION, 137.777);
  busy = setIntensity(busy, 1.31);
  busy = setNeutral(busy, { tintStrength: 1.7, hueSource: 'master', hue: 33.333 });
  busy = setOffset(busy, 'support2', -91.234);
  busy = setModeSettings(busy, 'dark', { lightnessShift: 0.037, chromaScale: 0.83 });
  busy = setRoleCustom(busy, 'light', 'accent-text', { l: 0.4123, c: 0.1, h: 17.5, a: 1 });
  busy = setLocked(busy, 'light', 'focus', true);
  busy = setLocked(busy, 'dark', 'success', true);
  busy = setRoleLink(busy, 'dark', 'border-subtle', { to: 'accent', dL: 0.0333, a: 0.2 });
  busy = linkModes(busy, 'light', 'dark', ['comet-1', 'comet-2']);
  busy = setRoleBase(busy, 'dark', 'page', { l: 0.1234567 });
  busy = setSceneSource(busy, 'dark', 'custom');
  busy = setSceneCustom(busy, 'dark', { base: { l: 0.7, c: 0.15, h: 12 }, secondary: { l: 0.7, c: 0.1, h: 200 }, highlightStrength: 0.4 });
  busy = setSceneFollow(busy, 'light', { hueShiftDeg: -45.5, hueSpan: 0.5 });
  busy = setFeatures(busy, { focusRing: true, selection: true });
  busy = setViewerPreference(busy, 'system');
  busy = setMeta(busy, { id: 'busy', name: 'Busy "quoted" theme', description: 'a\nb', updatedAt: '2026-10-14T12:00:00.000Z' });
  return [BASELINE_DEFINITION, busy, setMasterHue(BASELINE_DEFINITION, 0), setIntensity(setMasterHue(BASELINE_DEFINITION, 359.99), 0)];
}

test('export -> import -> export is byte-identical', () => {
  for (const d of sampleThemes()) {
    const a = exportThemeJson(d);
    const imp = importThemeJson(a);
    assert.equal(imp.ok, true, JSON.stringify(imp.errors));
    const b = exportThemeJson(imp.definition);
    assert.equal(b, a);
    assert.ok(a.endsWith('}\n') && !a.endsWith('\n\n'));
    assert.ok(a.startsWith('{\n  "schema": "hitloop.theme",\n  "version": 1,'), '2-space canonical JSON');
  }
});

test('resolve and toCss are identical before and after the round trip', () => {
  for (const d of sampleThemes()) {
    const back = importThemeJson(exportThemeJson(d)).definition;
    assert.deepEqual(resolveBoth(back), resolveBoth(d));
    assert.equal(toCss(back), toCss(d));
    assert.equal(hashDefinition(back), hashDefinition(d));
  }
});

test('canonicalisation is idempotent and import leaves a canonical definition unchanged', () => {
  for (const d of sampleThemes()) {
    const c = canonicalize(d);
    assert.deepEqual(canonicalize(c), c);
    assert.equal(JSON.stringify(canonicalize(c)), JSON.stringify(c));
    assert.deepEqual(validateDefinition(c).definition, c);
  }
});

test('updatedAt survives export but never changes the hash or the CSS', () => {
  const a = setMeta(BASELINE_DEFINITION, { updatedAt: '2026-01-01T00:00:00.000Z' });
  const b = setMeta(BASELINE_DEFINITION, { updatedAt: '2027-02-02T00:00:00.000Z' });
  assert.equal(hashDefinition(a), hashDefinition(b));
  assert.equal(toCss(a), toCss(b));
  assert.ok(exportThemeJson(a).includes('"updatedAt": "2026-01-01T00:00:00.000Z"'));
});

test('export bundle: json + css + guide + report, status draft for the baseline', () => {
  const b = buildExportBundle(BASELINE_DEFINITION);
  assert.deepEqual(Object.keys(b).sort(), ['css', 'guideMarkdown', 'json', 'reportJson', 'status']);
  assert.equal(b.status, 'draft');
  assert.equal(JSON.parse(b.json).meta.status, 'draft');
  assert.ok(b.css.includes('--t-page: #ffffff;'));
  assert.ok(b.guideMarkdown.includes('| `--t-page` |'));
  const report = JSON.parse(b.reportJson);
  assert.equal(report.statement, 'Automated contrast checks only; this is not a WCAG conformance claim.');
  assert.ok(report.summary.failRequired > 0);
  // the bundle JSON itself round-trips
  assert.equal(exportThemeJson(importThemeJson(b.json).definition), b.json);
  assert.equal(b.css, toCss(importThemeJson(b.json).definition));
});

test('a theme that fixes the documented defects exports as validated', () => {
  // one shared on-solid cannot be both white-on-red and dark-on-amber, so the fix darkens the solids
  let d = createBaseline();
  d = setRoleBase(d, 'light', 'overlay', { a: 0.9 });
  d = setRoleBase(d, 'light', 'success-solid', { l: 0.52 });
  d = setRoleBase(d, 'light', 'warning-solid', { l: 0.5 });
  for (const k of ['build', 'mock', 'countdown']) d = setRoleBase(d, 'light', `term-${k}-msg`, { l: 0.5 });
  const report = buildReport(d);
  assert.equal(report.summary.failRequired, 0, JSON.stringify(report.modes.light.results.filter((r) => !r.pass && r.required).map((r) => r.id)));
  assert.equal(reportStatus(report), 'validated');
  assert.ok(report.summary.advisoryFail > 0, 'advisory failures do not block');
  const b = buildExportBundle(d);
  assert.equal(b.status, 'validated');
  assert.equal(JSON.parse(b.json).meta.status, 'validated');
});

test('importing a bundle JSON with errors fails cleanly', () => {
  const broken = exportThemeJson(BASELINE_DEFINITION).replace('"hue": 201', '"hue": "blue"');
  const r = importThemeJson(broken);
  assert.equal(r.ok, false);
  assert.equal(r.definition, null);
  assert.equal(r.errors[0].code, 'NONFINITE');
});
