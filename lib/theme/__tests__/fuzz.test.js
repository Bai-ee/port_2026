// Seeded random edit sequences: whatever the Studio can do, the result stays canonical,
// valid, resolvable (finite, well-formed colours) and drift-free through export/import.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../edit.js';
import { BASELINE_DEFINITION } from '../baseline.js';
import { resolveBoth } from '../resolve.js';
import { validateDefinition, normalizeDefinition, hashDefinition } from '../validate.js';
import { exportThemeJson, importThemeJson } from '../export.js';
import { toCss } from '../css.js';
import { ROLE_IDS } from '../roles.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TOKEN_RE = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0\.\d{1,3})\))$/;

function step(d, r) {
  const mode = r() < 0.5 ? 'light' : 'dark';
  const other = mode === 'light' ? 'dark' : 'light';
  const id = ROLE_IDS[Math.floor(r() * ROLE_IDS.length)];
  const id2 = ROLE_IDS[Math.floor(r() * ROLE_IDS.length)];
  const x = () => r() * 4 - 1; // deliberately exceeds ranges
  switch (Math.floor(r() * 22)) {
    case 0: return E.setMasterHue(d, r() * 900 - 270);
    case 1: return E.setIntensity(d, x());
    case 2: return E.setOffset(d, ['accentBright', 'support1', 'support2'][Math.floor(r() * 3)], r() * 500 - 250);
    case 3: return E.setNeutral(d, { tintStrength: x(), hue: r() * 720, hueSource: r() < 0.5 ? 'fixed' : 'master' });
    case 4: return E.setModeSettings(d, mode, { lightnessShift: r() * 0.5 - 0.25, chromaScale: x() });
    case 5: return E.setRoleBase(d, mode, id, { l: x(), c: r(), a: x() });
    case 6: return E.setRoleCustom(d, mode, id, { l: r(), c: r() * 0.4, h: r() * 1000 - 300, a: r() });
    case 7: return E.setRoleLink(d, mode, id, { to: id2, mode: r() < 0.3 ? other : undefined, dL: r() - 0.5, dC: r() * 0.2 - 0.1, dH: r() * 90 - 45, a: r() });
    case 8: return E.setRoleLink(d, mode, id, r() < 0.5 ? 'auto' : 'custom');
    case 9: return E.setLocked(d, mode, id, r() < 0.6);
    case 10: return E.resetRole(d, mode, id);
    case 11: return E.resetMode(d, mode);
    case 12: return E.copyMode(d, mode, other, r() < 0.5 ? { roleIds: [id, id2] } : {});
    case 13: return E.linkModes(d, mode, other, [id, id2]);
    case 14: return E.setSceneSource(d, mode, r() < 0.5 ? 'follow' : 'custom');
    case 15: return E.setSceneFollow(d, mode, { hueShiftDeg: r() * 500 - 250, saturationMul: x(), lightnessDelta: r() - 0.5, opacityMul: x() * 2, hueSpan: r() * 2 });
    case 16: return E.setSceneCustom(d, mode, { base: { l: r(), c: r() * 0.4, h: r() * 400 }, secondary: r() < 0.3 ? null : { l: r(), c: r() * 0.3, h: r() * 400 }, highlight: { h: r() * 360 }, highlightStrength: r() * 1.5 });
    case 17: return E.setFeatures(d, { focusRing: r() < 0.5, selection: r() < 0.5 });
    case 18: return E.setViewerPreference(d, ['light', 'dark', 'system'][Math.floor(r() * 3)]);
    case 19: return E.resetScene(d, mode);
    case 20: return E.setRoleLink(d, mode, id, { to: id });
    default: return E.setMeta(d, { name: `t${Math.floor(r() * 1000)}`, updatedAt: '2026-10-14T00:00:00.000Z' });
  }
}

test('random edit sequences stay canonical, valid, resolvable and drift-free', () => {
  for (const seed of [1, 7, 42, 2026, 99991]) {
    const r = rng(seed);
    let d = BASELINE_DEFINITION;
    for (let i = 0; i < 160; i++) {
      d = step(d, r);
      const label = `seed ${seed} step ${i}`;
      assert.deepEqual(normalizeDefinition(d), d, `${label}: not canonical`);
      const v = validateDefinition(d);
      assert.equal(v.ok, true, `${label}: ${JSON.stringify(v.errors)}`);
      assert.deepEqual(v.warnings, [], `${label}: ${JSON.stringify(v.warnings)}`);
      if (i % 8 === 0) {
        const pair = resolveBoth(d);
        for (const mode of ['light', 'dark']) {
          for (const [name, value] of Object.entries(pair[mode].tokens)) {
            assert.equal(typeof value, 'string', `${label} ${mode} ${name}`);
            assert.ok(!/NaN|undefined|Infinity|null/.test(value), `${label} ${mode} ${name}: ${value}`);
          }
          for (const id of ROLE_IDS) assert.match(pair[mode].tokens[`--t-${id}`], TOKEN_RE, `${label} ${mode} ${id}`);
          const s = pair[mode].scene;
          for (const k of ['hueShift', 'saturationMul', 'lightnessDelta', 'opacityMul', 'hueSpan']) assert.ok(Number.isFinite(s[k]), `${label} scene.${k}`);
          assert.ok(s.hueShift > -0.5 && s.hueShift <= 0.5);
        }
        const text = exportThemeJson(d);
        const back = importThemeJson(text);
        assert.equal(back.ok, true, label);
        assert.equal(exportThemeJson(back.definition), text, `${label}: export drift`);
        assert.equal(toCss(back.definition), toCss(d), `${label}: css drift`);
        assert.equal(hashDefinition(back.definition), hashDefinition(d));
      }
    }
  }
});

test('locked roles never change under bulk operations or master moves, whatever the sequence', () => {
  const r = rng(555);
  let d = E.setLocked(E.setLocked(BASELINE_DEFINITION, 'light', 'accent', true), 'dark', 'info-solid', true);
  const keep = [JSON.stringify(d.modes.light.roles.accent), JSON.stringify(d.modes.dark.roles['info-solid'])];
  for (let i = 0; i < 200; i++) {
    const mode = r() < 0.5 ? 'light' : 'dark';
    const other = mode === 'light' ? 'dark' : 'light';
    const pick = Math.floor(r() * 7);
    if (pick === 0) d = E.setMasterHue(d, r() * 360);
    else if (pick === 1) d = E.setIntensity(d, r() * 1.5);
    else if (pick === 2) d = E.setModeSettings(d, mode, { lightnessShift: r() * 0.3 - 0.15 });
    else if (pick === 3) d = E.copyMode(d, mode, other);
    else if (pick === 4) d = E.resetMode(d, mode);
    else if (pick === 5) d = E.linkModes(d, mode, other);
    else d = E.setNeutral(d, { tintStrength: r() * 2 });
    assert.equal(JSON.stringify(d.modes.light.roles.accent), keep[0], `step ${i}`);
    assert.equal(JSON.stringify(d.modes.dark.roles['info-solid']), keep[1], `step ${i}`);
  }
});
