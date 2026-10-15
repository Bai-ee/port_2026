import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { setNeutral, setMasterHue } from '../edit.js';
import { ROLE_DEFS } from '../roles.js';

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const isGrey = (hex) => /^#([0-9a-f]{2})\1\1$/.test(hex);

test('tintStrength 0: neutral-family chroma is 0, hue is preserved, colours are pure greys', () => {
  const d = setNeutral(BASELINE_DEFINITION, { tintStrength: 0 });
  for (const mode of ['light', 'dark']) {
    const t = resolveTheme(d, mode);
    for (const rd of ROLE_DEFS.filter((x) => x.scale === 'tint')) {
      const r = t.roles[rd.id];
      near(r.oklch.c, 0, 1e-12, `${mode}.${rd.id}`);
      near(r.oklch.h, (56 + rd.hue.value) % 360, 1e-6, `${mode}.${rd.id} hue preserved`);
      assert.ok(isGrey(r.hex), `${mode}.${rd.id} ${r.hex}`);
    }
    // accent family unaffected
    assert.ok(t.roles.accent.oklch.c > 0.1);
  }
});

test('tintStrength 2 doubles neutral chroma; tintStrength 1 is the baseline', () => {
  const one = resolveTheme(BASELINE_DEFINITION, 'light');
  const two = resolveTheme(setNeutral(BASELINE_DEFINITION, { tintStrength: 2 }), 'light');
  for (const id of ['text', 'text-eyebrow', 'chrome', 'glass-border', 'term-dim']) {
    near(two.roles[id].oklch.c, one.roles[id].oklch.c * 2, 1e-4, id);
    near(two.roles[id].oklch.h, one.roles[id].oklch.h, 1e-9, id);
  }
  assert.deepEqual(resolveTheme(setNeutral(BASELINE_DEFINITION, { tintStrength: 1 }), 'light'), one);
});

test("hueSource 'master' follows master (neutral.hue is an offset); 'fixed' does not", () => {
  const fixed = setNeutral(BASELINE_DEFINITION, { hueSource: 'fixed', hue: 56 });
  const master = setNeutral(BASELINE_DEFINITION, { hueSource: 'master', hue: 0 });
  const a = resolveTheme(setMasterHue(fixed, 10), 'light').roles.text.oklch.h;
  const b = resolveTheme(setMasterHue(fixed, 250), 'light').roles.text.oklch.h;
  near(a, b, 1e-9, 'fixed ignores master');
  near(resolveTheme(setMasterHue(master, 10), 'light').roles.text.oklch.h, 10);
  near(resolveTheme(setMasterHue(master, 250), 'light').roles.text.oklch.h, 250);
  near(resolveTheme(setMasterHue(setNeutral(master, { hue: 40 }), 350), 'light').roles.text.oklch.h, 30, 1e-9, '350 + 40 wraps to 30');
});

test('dashboard neutrals are not tinted by tintStrength', () => {
  const t = resolveTheme(setNeutral(BASELINE_DEFINITION, { tintStrength: 2 }), 'light');
  assert.equal(t.roles['dash-page'].hex, '#f5f5f5');
  assert.equal(t.roles['dash-text-primary'].hex, '#222222');
});
