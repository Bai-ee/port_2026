import test from 'node:test';
import assert from 'node:assert/strict';
import { toColorGuide, toColorGuideMarkdown, describeLink } from '../guide.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { ROLE_IDS, GROUPS } from '../roles.js';
import { COMPOSITE_TOKENS } from '../tokens.js';
import { setRoleCustom, setRoleLink, setMasterHue } from '../edit.js';

test('one row per role with token, usage, light/dark values and link description', () => {
  const g = toColorGuide(BASELINE_DEFINITION);
  assert.deepEqual(g.rows.map((r) => r.roleId), [...ROLE_IDS]);
  const text = g.rows.find((r) => r.roleId === 'text');
  assert.equal(text.token, '--t-text');
  assert.equal(text.light.hex, '#2a2420');
  assert.equal(text.light.value, '#2a2420');
  assert.match(text.dark.hex, /^#[0-9a-f]{6}$/);
  assert.deepEqual(Object.keys(text.light.oklch).sort(), ['a', 'c', 'h', 'l']);
  assert.equal(text.linked, 'follows neutral tint hue');
  const muted = g.rows.find((r) => r.roleId === 'text-muted');
  assert.equal(muted.light.value, 'rgba(42, 36, 32, 0.52)');
  assert.equal(muted.linked, 'linked to text alpha 0.52 (light); linked to text alpha 0.58 (dark)');
  assert.match(muted.linked, /linked to text/);
  assert.deepEqual(g.composites.map((c) => c.token), [...COMPOSITE_TOKENS]);
});

test('describeLink wording', () => {
  assert.equal(describeLink(BASELINE_DEFINITION, 'light', 'support-1'), 'follows master hue +86°');
  assert.equal(describeLink(BASELINE_DEFINITION, 'light', 'success'), 'fixed hue 152.7° (never follows master)');
  assert.equal(describeLink(BASELINE_DEFINITION, 'light', 'accent-hover'), 'linked to accent −0.05 L');
  assert.equal(describeLink(BASELINE_DEFINITION, 'dark', 'accent-hover'), 'linked to accent +0.05 L');
  assert.equal(describeLink(BASELINE_DEFINITION, 'light', 'comet-1'), 'follows master hue +4°');
  const custom = setRoleCustom(BASELINE_DEFINITION, 'light', 'accent', { l: 0.5, c: 0.1, h: 3, a: 1 });
  assert.equal(describeLink(custom, 'light', 'accent'), null);
  const cross = setRoleLink(BASELINE_DEFINITION, 'dark', 'text', { to: 'text', mode: 'light' });
  assert.equal(describeLink(cross, 'dark', 'text'), 'linked to light:text');
  const g = toColorGuide(custom).rows.find((r) => r.roleId === 'accent');
  assert.equal(g.linked, 'custom (light); follows master hue (dark)');
});

test('markdown is deterministic, grouped, and escapes pipes', () => {
  const a = toColorGuideMarkdown(BASELINE_DEFINITION);
  assert.equal(toColorGuideMarkdown(BASELINE_DEFINITION), a);
  for (const grp of GROUPS) assert.ok(a.includes(`## ${grp.label}`), grp.label);
  assert.ok(a.includes('| Token | Light | Dark | Usage | Linked |'));
  assert.ok(a.includes('| `--t-page` | `#ffffff` |'));
  assert.ok(a.includes('## Composite tokens'));
  assert.notEqual(toColorGuideMarkdown(setMasterHue(BASELINE_DEFINITION, 10)), a);
  assert.ok(!a.includes('undefined'));
});
