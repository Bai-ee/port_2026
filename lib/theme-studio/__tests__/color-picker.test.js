// Studio v2 / P2: ColorPicker conversions and the edit semantics behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../../theme-runtime/draft-store.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeSceneBridge,
} from '../../theme-runtime/__tests__/helpers.js';
import { createEditSession } from '../edit-session.js';
import { createStudioStore } from '../store-adapter.js';
import {
  createBaseline, resolveTheme, hexToOklch, oklchToHex, setLocked,
} from '../../theme/index.js';
import {
  oklchToRgb, rgbToOklch, oklchToHsl, hslToOklch, parseRgbText, parseHslText, parseColorPaste, colorGamutInfo,
  advisoryIssues, padToLc, lcToPad, sliderBounds, HARD_BOUNDS, pickerEditOklch, pickerEditHex, padRowGradients,
} from '../color-fields.js';
import { roleKind, applyRoleAction } from '../role-state.js';

const SAMPLES = ['#000000', '#ffffff', '#336699', '#ff0000', '#00ff7f', '#808080', '#123456', '#fedcba', '#0b5cd5', '#17692e', '#f4efe6'];

test('hex <-> oklch <-> rgb <-> hsl round-trips stay within 1/255', () => {
  for (const hex of SAMPLES) {
    const o = hexToOklch(hex, 0);
    assert.equal(oklchToHex(o), hex, `oklch ${hex}`);
    const rgb = oklchToRgb(o);
    const back = rgbToOklch(rgb, o.h);
    assert.equal(oklchToHex(back), hex, `rgb ${hex}`);
    const hsl = oklchToHsl(o);
    const viaHsl = oklchToRgb(hslToOklch(hsl, o.h));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(viaHsl[i] - rgb[i]) <= 1, `hsl ${hex} ch${i}: ${viaHsl[i]} vs ${rgb[i]}`);
  }
});

test('a dense rgb sweep survives rgb -> oklch -> rgb and rgb -> hsl -> rgb within 1/255', () => {
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    const o = rgbToOklch([r, g, b], 0);
    const rgb = oklchToRgb(o);
    assert.deepEqual(rgb.map((v, i) => Math.abs(v - [r, g, b][i]) <= 1), [true, true, true], `${r},${g},${b}`);
    const hsl = oklchToHsl(o);
    const rgb2 = oklchToRgb(hslToOklch(hsl, o.h));
    assert.deepEqual(rgb2.map((v, i) => Math.abs(v - [r, g, b][i]) <= 1), [true, true, true], `hsl ${r},${g},${b}`);
  }
});

test('typed rgb / hsl / pasted colours parse, bad text does not', () => {
  assert.deepEqual(parseRgbText('rgb(51, 102, 153)'), [51, 102, 153]);
  assert.deepEqual(parseRgbText('51 102 153'), [51, 102, 153]);
  assert.equal(parseRgbText('rgb(300, 0, 0)'), null);
  assert.equal(parseRgbText('nope'), null);
  assert.deepEqual(parseHslText('hsl(210, 50%, 40%)'), { h: 210, s: 50, l: 40 });
  assert.equal(parseHslText('hsl(210, 150%, 40%)'), null);
  assert.equal(parseColorPaste('#369'), '#336699');
  assert.equal(parseColorPaste('rgb(51,102,153)'), '#336699');
  assert.equal(oklchToHex(hexToOklch(parseColorPaste('hsl(210, 50%, 40%)'))), parseColorPaste('hsl(210, 50%, 40%)'));
  assert.equal(parseColorPaste('hello'), null);
  assert.equal(parseColorPaste(''), null);
});

test('gamut tag: in-gamut colours are not tagged, strongly out-of-gamut ones are', () => {
  assert.equal(colorGamutInfo({ l: 0.6, c: 0.08, h: 250 }).mapped, false);
  const wild = colorGamutInfo({ l: 0.6, c: 0.4, h: 150 });
  assert.equal(wild.mapped, true);
  assert.ok(wild.deltaE > 0.02);
});

test('pad maps lightness x chroma both ways inside the hard bounds', () => {
  assert.deepEqual(padToLc({ x: 0, y: 0 }), { c: 0, l: 1 });
  const p = padToLc({ x: 1, y: 1 });
  assert.equal(p.c, 0.4);
  assert.equal(p.l, 0);
  const clamped = padToLc({ x: 5, y: -3 });
  assert.equal(clamped.c, 0.4);
  assert.equal(clamped.l, 1);
  const rt = lcToPad(padToLc({ x: 0.25, y: 0.75 }));
  assert.ok(Math.abs(rt.x - 0.25) < 1e-9 && Math.abs(rt.y - 0.75) < 1e-9);
  assert.equal(padRowGradients(200, 6, 3).length, 6);
});

test('full range keeps the hard bounds and only drops advisory warnings', () => {
  for (const fr of [true, false]) {
    const b = sliderBounds(fr);
    assert.deepEqual([b.l, b.c, b.h], [HARD_BOUNDS.l, HARD_BOUNDS.c, HARD_BOUNDS.h]);
  }
  assert.equal(sliderBounds(true).warn, false);
  assert.equal(sliderBounds(false).warn, true);
  // 'page' wants a light, low-chroma colour; a dark chromatic value is advisory-out-of-range.
  assert.ok(advisoryIssues('page', 'light', { l: 0.3, c: 0.2, h: 50 }).length >= 1);
  assert.deepEqual(advisoryIssues('page', 'light', { l: 0.97, c: 0.01, h: 50 }), []);
});

test('picker edit of a LINKED role makes it custom and follows the edit', () => {
  const d0 = createBaseline();
  const id = 'accent';
  assert.notEqual(roleKind(d0.modes.light.roles[id]), 'custom');
  const cur = resolveTheme(d0, 'light').roles[id].oklch;
  const d1 = pickerEditOklch(d0, 'light', id, { l: 0.5, c: 0.3 }, cur);
  assert.equal(roleKind(d1.modes.light.roles[id]), 'custom');
  const r = resolveTheme(d1, 'light').roles[id].oklch;
  assert.ok(Math.abs(r.l - 0.5) < 1e-3 && Math.abs(r.c - 0.3) < 1e-3);
  assert.ok(Math.abs(r.h - cur.h) < 1e-3, 'hue untouched when only l/c change');
  const d2 = pickerEditHex(d0, 'light', id, '#336699', cur);
  assert.equal(resolveTheme(d2, 'light').roles[id].hex, '#336699');
  assert.equal(roleKind(d2.modes.light.roles[id]), 'custom');
});

test('picker never edits a LOCKED role; unlock then edit works; reset returns to linked', () => {
  const d0 = createBaseline();
  const id = 'accent';
  const cur = resolveTheme(d0, 'light').roles[id].oklch;
  const locked = setLocked(pickerEditOklch(d0, 'light', id, { l: 0.4 }, cur), 'light', id, true);
  assert.equal(roleKind(locked.modes.light.roles[id]), 'locked');
  assert.equal(pickerEditOklch(locked, 'light', id, { l: 0.9 }, cur), locked);
  assert.equal(pickerEditHex(locked, 'light', id, '#ffffff', cur), locked);
  const unlocked = applyRoleAction(locked, 'light', id, 'unlock');
  const edited = pickerEditOklch(unlocked, 'light', id, { l: 0.9 }, cur);
  assert.notEqual(edited, unlocked);
  assert.equal(roleKind(applyRoleAction(edited, 'light', id, 'reset').modes.light.roles[id]), 'linked');
});

test('status roles keep their meaning-bearing hue through the picker', () => {
  const d0 = createBaseline();
  const id = 'danger';
  const cur = resolveTheme(d0, 'light').roles[id]?.oklch;
  if (!cur) return;
  const d1 = pickerEditOklch(d0, 'light', id, { h: (cur.h + 90) % 360, l: 0.5 }, cur);
  const r = resolveTheme(d1, 'light').roles[id].oklch;
  assert.ok(Math.abs(r.h - cur.h) < 1e-3);
});

test('chroma above the sRGB gamut is accepted by the engine (up to the hard bound)', () => {
  const d0 = createBaseline();
  const cur = resolveTheme(d0, 'light').roles.accent.oklch;
  const d1 = pickerEditOklch(d0, 'light', 'accent', { l: 0.6, c: 0.4, h: 150 }, cur);
  const r = resolveTheme(d1, 'light').roles.accent;
  assert.ok(Math.abs(r.oklch.c - 0.4) < 1e-3, 'authored chroma kept');
  assert.equal(r.gamut.mapped, true);
});

function makeStore() {
  const scheduler = createManualScheduler();
  const raw = createDraftStore({
    document: createFakeDocument(),
    storage: createFakeStorage(),
    scheduler,
    win: null,
    ChannelCtor: null,
    getSceneBridge: () => createFakeSceneBridge(),
    prefStore: { setPreviewOverride() {} },
  });
  const store = createStudioStore(raw);
  store.startDraft();
  return { store, session: createEditSession(store) };
}

test('a pad drag on a linked role is ONE undo entry that undoes both the value and the link switch', () => {
  const { store, session } = makeStore();
  const id = 'accent';
  const before = store.getSnapshot().draft;
  const cur = resolveTheme(before, 'light').roles[id].oklch;
  assert.notEqual(roleKind(before.modes.light.roles[id]), 'custom');
  for (let i = 1; i <= 15; i++) {
    session.apply((d) => pickerEditOklch(d, 'light', id, { l: 0.3 + i * 0.01, c: 0.05 + i * 0.01 }, cur), { kind: 'drag', label: `${id} color` });
  }
  session.end();
  const after = store.getSnapshot().draft;
  assert.equal(roleKind(after.modes.light.roles[id]), 'custom');
  assert.equal(store.getSnapshot().canUndo, true);
  store.undo();
  const undone = store.getSnapshot().draft;
  assert.deepEqual(undone.modes.light.roles[id], before.modes.light.roles[id]);
  assert.equal(store.getSnapshot().canUndo, false, 'exactly one entry');
  store.redo();
  assert.equal(roleKind(store.getSnapshot().draft.modes.light.roles[id]), 'custom');
});

test('a typed hex on a linked role is one discrete undo entry', () => {
  const { store, session } = makeStore();
  const id = 'accent';
  const cur = resolveTheme(store.getSnapshot().draft, 'light').roles[id].oklch;
  session.apply((d) => pickerEditHex(d, 'light', id, '#336699', cur), { kind: 'set', label: `${id} hex` });
  assert.equal(store.getSnapshot().canUndo, true);
  store.undo();
  assert.equal(store.getSnapshot().canUndo, false);
  assert.notEqual(roleKind(store.getSnapshot().draft.modes.light.roles[id]), 'custom');
});
