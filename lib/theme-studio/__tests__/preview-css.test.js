import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline, resolveBoth, setMasterHue, TOKEN_NAMES } from '../../theme/index.js';
import { buildPreviewScopeCss, PREVIEW_STYLE_ID } from '../preview-css.js';

test('preview css is scope-only: no :root, no fallback media, no !important', () => {
  const css = buildPreviewScopeCss(createBaseline(), null);
  assert.match(css, /\[data-theme-scope="light"\] \{/);
  assert.match(css, /\[data-theme-scope="dark"\] \{/);
  assert.doesNotMatch(css, /:root/);
  assert.doesNotMatch(css, /@media/);
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /GENERATED/);
  for (const t of TOKEN_NAMES) assert.ok(css.includes(`${t}:`), t);
  assert.equal(PREVIEW_STYLE_ID, 'theme-studio-preview-css');
});

test('uses the store resolved pair when given, else resolves the draft; empty without either', () => {
  const d = setMasterHue(createBaseline(), 20);
  const viaDraft = buildPreviewScopeCss(d, null);
  const viaResolved = buildPreviewScopeCss(null, resolveBoth(d));
  assert.equal(viaDraft, viaResolved);
  assert.equal(buildPreviewScopeCss(null, null), '');
  assert.notEqual(viaDraft, buildPreviewScopeCss(createBaseline(), null));
});
