import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { setMasterHue, setIntensity, setNeutral } from '../edit.js';
import { validateDefinition } from '../validate.js';
import { ROLE_DEFS } from '../roles.js';

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('hue 0, 359.999, 360, -1, 721 give consistent offsets', () => {
  // [input hue, canonical master hue after wrap + 2dp rounding]
  const cases = [[0, 0], [359.999, 0], [360, 0], [-1, 359], [721, 1], [270, 270]];
  for (const [input, canon] of cases) {
    const d = setMasterHue(BASELINE_DEFINITION, input);
    assert.equal(d.master.hue, canon, `master ${input}`);
    const t = resolveTheme(d, 'light');
    near(t.roles.accent.oklch.h, canon % 360);
    near(t.roles['support-1'].oklch.h, (canon + 86) % 360, 1e-6, `support-1 @${input}`);
    near(t.roles['support-2'].oklch.h, (canon + 142) % 360, 1e-6, `support-2 @${input}`);
    near(t.roles['deco-1'].oklch.h, (((canon - 153) % 360) + 360) % 360, 1e-6, `deco-1 @${input}`);
  }
  // spec example: support-2 at master 270 -> 52
  near(resolveTheme(setMasterHue(BASELINE_DEFINITION, 270), 'light').roles['support-2'].oklch.h, 52);
});

test('an unwrapped hue in raw JSON is wrapped silently by validation (no warning, no error)', () => {
  for (const h of [-1, 360, 721, 359.999]) {
    const raw = JSON.parse(JSON.stringify(BASELINE_DEFINITION));
    raw.master.hue = h;
    const v = validateDefinition(raw);
    assert.equal(v.ok, true, `hue ${h}`);
    assert.ok(!v.warnings.some((w) => w.path === 'master.hue'), `no warning for hue ${h}`);
    assert.ok(v.definition.master.hue >= 0 && v.definition.master.hue < 360);
  }
});

test('status and semantic hues never follow master', () => {
  const fixed = ROLE_DEFS.filter((d) => d.hue.src === 'fixed' && d.id !== 'shadow');
  assert.ok(fixed.length > 30);
  for (const hue of [0, 37.5, 90, 150, 201, 250, 300, 359.99]) {
    const t = resolveTheme(setMasterHue(BASELINE_DEFINITION, hue), 'light');
    const d = resolveTheme(setMasterHue(BASELINE_DEFINITION, hue), 'dark');
    for (const rd of fixed) {
      if (rd.id === 'dash-accent') continue; // custom, covered separately
      near(t.roles[rd.id].oklch.h, rd.hue.value, 1e-9, `${rd.id} light @${hue}`);
      near(d.roles[rd.id].oklch.h, rd.hue.value, 1e-9, `${rd.id} dark @${hue}`);
    }
    near(t.roles['dash-accent'].oklch.h, 26.79, 1e-9);
  }
});

test('linked status backgrounds inherit the status hue, not the master hue', () => {
  const t = resolveTheme(setMasterHue(BASELINE_DEFINITION, 123), 'light');
  near(t.roles['success-bg'].oklch.h, 152.7);
  near(t.roles['danger-border'].oklch.h, 29);
});

test('neutrals keep their tint hue at chroma 0 for every master hue', () => {
  for (const hue of [0, 123, 359.99]) {
    const t = resolveTheme(setIntensity(setMasterHue(BASELINE_DEFINITION, hue), 0), 'light');
    near(t.roles.accent.oklch.c, 0);
    near(t.roles.accent.oklch.h, hue % 360, 1e-6, 'zero-chroma accent keeps its master hue');
    assert.match(t.roles.accent.hex, /^#([0-9a-f]{2})\1\1$/, 'achromatic accent is a pure grey');
  }
});

test('support offsets wrap around the circle', () => {
  const t = resolveTheme(setMasterHue(BASELINE_DEFINITION, 359), 'light');
  near(t.roles['support-2'].oklch.h, (359 + 142) % 360);
  assert.ok(t.roles['support-2'].oklch.h >= 0 && t.roles['support-2'].oklch.h < 360);
});

test('neutral.hue wraps like any hue; fixed vs master source', () => {
  const d = setNeutral(BASELINE_DEFINITION, { hue: 721 });
  assert.equal(d.neutral.hue, 1);
  const t = resolveTheme(setNeutral(setMasterHue(BASELINE_DEFINITION, 300), { hueSource: 'master', hue: 100 }), 'light');
  near(t.roles.text.oklch.h, (300 + 100 + 0) % 360);
});
