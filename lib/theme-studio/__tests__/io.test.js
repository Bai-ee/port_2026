import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBaseline, buildExportBundle, buildReport, importThemeJson, exportThemeJson, setRoleCustom, toColorGuide,
} from '../../theme/index.js';
import {
  exportBanner, bundleFiles, describeImport, slugify, filterGuideRows,
} from '../io.js';

test('the baseline is labelled Draft and never claims conformance', () => {
  const rep = buildReport(createBaseline());
  const b = exportBanner(rep);
  assert.equal(b.status, 'draft');
  assert.equal(b.title, 'Draft');
  assert.match(b.detail, /required checks? fail/);
  assert.match(b.detail, /not a WCAG conformance claim/);
  assert.doesNotMatch(`${b.title} ${b.detail}`, /WCAG[- ]compliant|accessible theme|passes WCAG/i);
});

test('validated wording only when no required check fails', () => {
  const fake = { structure: { errors: [] }, summary: { failRequired: 0, advisoryFail: 2 } };
  const b = exportBanner(fake);
  assert.equal(b.status, 'validated');
  assert.equal(b.title, 'Validated against the in-app checks');
  assert.match(b.detail, /2 advisory findings remain/);
  assert.doesNotMatch(b.detail, /WCAG[- ]compliant/i);
  const bad = exportBanner({ structure: { errors: [{}] }, summary: { failRequired: 0, advisoryFail: 0 } });
  assert.equal(bad.status, 'draft');
  assert.match(bad.detail, /1 structure error\b/);
  assert.equal(exportBanner(null).status, 'draft');
});

test('export filenames carry the draft / validated status', () => {
  const bundle = buildExportBundle(createBaseline());
  const files = bundleFiles(bundle, { id: 'My Theme!' });
  assert.deepEqual(files.map((f) => f.key), ['json', 'css', 'guide', 'report']);
  for (const f of files) assert.match(f.filename, /^my-theme\.draft\./);
  assert.ok(files.every((f) => f.content && f.mime));
  const v = bundleFiles({ ...bundle, status: 'validated' }, { id: 'x' });
  assert.match(v[0].filename, /^x\.validated\./);
  assert.equal(slugify('  '), 'theme');
});

test('import description: valid, warnings, hard errors, no throw', () => {
  const text = exportThemeJson(createBaseline());
  const ok = describeImport(importThemeJson(text));
  assert.equal(ok.ok, true);
  assert.equal(ok.canLoad, true);
  assert.equal(ok.headline, 'Valid theme file.');
  const broken = describeImport(importThemeJson('{ nope'));
  assert.equal(broken.ok, false);
  assert.equal(broken.canLoad, false);
  assert.ok(broken.errors.length >= 1);
  assert.equal(broken.errors[0].code, 'JSON_PARSE');
  assert.match(broken.headline, /^Cannot import: \d+ error/);
  const future = describeImport(importThemeJson(JSON.stringify({ schema: 'hitloop.theme', version: 2 })));
  assert.equal(future.ok, false);
  assert.ok(future.errors.some((e) => e.code === 'UNSUPPORTED_VERSION'));
  const warn = JSON.parse(text);
  warn.surprise = 1;
  const w = describeImport(importThemeJson(JSON.stringify(warn)));
  assert.equal(w.ok, true);
  assert.match(w.headline, /warning/);
  assert.equal(describeImport(null), null);
});

test('guide filter matches token, usage, group and hex', () => {
  const g = toColorGuide(setRoleCustom(createBaseline(), 'light', 'accent', { l: 0.7, c: 0.1, h: 100, a: 1 }));
  assert.equal(filterGuideRows(g.rows, '').length, g.rows.length);
  assert.ok(filterGuideRows(g.rows, '--t-accent').length >= 5);
  assert.ok(filterGuideRows(g.rows, 'placeholders').every((r) => /placeholders/i.test(r.usage)));
  assert.equal(filterGuideRows(g.rows, 'zzzzzz').length, 0);
  const hex = g.rows.find((r) => r.roleId === 'accent').light.hex;
  assert.ok(filterGuideRows(g.rows, hex.toUpperCase()).some((r) => r.roleId === 'accent'));
});
