import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEXT_LAYERS, TEXT_ALIGNS, GOOGLE_FONT_CATALOG, DEFAULT_TEXT_LAYER,
  createTextLayer, sanitizeTextLayer, sanitizeTextLayers, fontById, googleFontCssUrl,
  resolveFrameRect, TEXT_CANVAS_SCALE, buildTextCanvasSpec, layoutTextPlane,
  TEXT_BACKDROPS, HERO_LAYOUT_PRESETS,
} from '../text-layers.js';

// ── GOOGLE_FONT_CATALOG — shape + the exact curated list the handoff plan
// requires (Inter through Work Sans, 16 entries). ───────────────────────────

test('GOOGLE_FONT_CATALOG has exactly the 17 required curated fonts, each with a valid shape', () => {
  assert.equal(GOOGLE_FONT_CATALOG.length, 17);
  const required = [
    'Inter', 'Space Grotesk', 'Space Mono', 'Bebas Neue', 'Anton', 'Archivo Black',
    'Playfair Display', 'Fraunces', 'DM Serif Display', 'Syne', 'Unbounded',
    'IBM Plex Mono', 'JetBrains Mono', 'Libre Caslon Text', 'Oswald', 'Work Sans',
    // Comic Neue — the Comic Sans equivalent (owner request, 2026-08-01).
    'Comic Neue',
  ];
  const families = GOOGLE_FONT_CATALOG.map((f) => f.family);
  required.forEach((fam) => assert.ok(families.includes(fam), `missing required font: ${fam}`));

  const ids = new Set();
  GOOGLE_FONT_CATALOG.forEach((f) => {
    assert.equal(typeof f.id, 'string');
    assert.ok(!ids.has(f.id), `duplicate catalog id: ${f.id}`);
    ids.add(f.id);
    assert.equal(typeof f.label, 'string');
    assert.equal(typeof f.family, 'string');
    assert.ok(Array.isArray(f.weights) && f.weights.length > 0, `${f.id} must have >=1 weight`);
    f.weights.forEach((w) => assert.equal(typeof w, 'number'));
    assert.ok(['sans', 'serif', 'display', 'mono'].includes(f.category), `${f.id} bad category`);
    // A fallback is either a CSS generic or a quoted-family chain ENDING in
    // a generic (Comic Neue falls back through the real "Comic Sans MS").
    assert.ok(/(sans-serif|serif|monospace|cursive)$/.test(f.fallback), `${f.id} bad fallback`);
  });
});

test('fontById returns the matching entry, or the first catalog entry for an unknown id', () => {
  assert.equal(fontById('anton').family, 'Anton');
  assert.equal(fontById('does-not-exist'), GOOGLE_FONT_CATALOG[0]);
  assert.equal(fontById(undefined), GOOGLE_FONT_CATALOG[0]);
});

test('DEFAULT_TEXT_LAYER.fontId names a real catalog entry that actually offers DEFAULT_TEXT_LAYER.weight', () => {
  const font = fontById(DEFAULT_TEXT_LAYER.fontId);
  assert.notEqual(font, undefined);
  assert.ok(font.weights.includes(DEFAULT_TEXT_LAYER.weight), 'default weight must be a real weight of the default font');
});

// ── googleFontCssUrl — exact URL format. ────────────────────────────────────

test('googleFontCssUrl: multi-word family name is +-joined, weight interpolated', () => {
  const url = googleFontCssUrl({ family: 'Space Grotesk' }, 700);
  assert.equal(url, 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap');
});

test('googleFontCssUrl: single-word family name needs no + joining', () => {
  const url = googleFontCssUrl({ family: 'Anton' }, 400);
  assert.equal(url, 'https://fonts.googleapis.com/css2?family=Anton:wght@400&display=swap');
});

// ── sanitizeTextLayer — bounds/fallback/clamping for every field. ──────────

test('sanitizeTextLayer: sizePct clamps to [1,60], invalid falls back', () => {
  assert.equal(sanitizeTextLayer({ sizePct: 999 }).sizePct, 60);
  assert.equal(sanitizeTextLayer({ sizePct: -5 }).sizePct, 1);
  assert.equal(sanitizeTextLayer({ sizePct: 'nope' }).sizePct, DEFAULT_TEXT_LAYER.sizePct);
  assert.equal(sanitizeTextLayer({ sizePct: null }).sizePct, DEFAULT_TEXT_LAYER.sizePct);
  assert.equal(sanitizeTextLayer({ sizePct: 30 }).sizePct, 30);
});

test('sanitizeTextLayer: leading clamps to [0.7,2.5]', () => {
  assert.equal(sanitizeTextLayer({ leading: 0.1 }).leading, 0.7);
  assert.equal(sanitizeTextLayer({ leading: 9 }).leading, 2.5);
  assert.equal(sanitizeTextLayer({ leading: 1.2 }).leading, 1.2);
});

test('sanitizeTextLayer: tracking (em) clamps to [-0.1,0.5]', () => {
  assert.equal(sanitizeTextLayer({ tracking: -5 }).tracking, -0.1);
  assert.equal(sanitizeTextLayer({ tracking: 5 }).tracking, 0.5);
  assert.equal(sanitizeTextLayer({ tracking: 0.05 }).tracking, 0.05);
});

test('sanitizeTextLayer: anchorX/anchorY clamp to [0,1]', () => {
  const s = sanitizeTextLayer({ anchorX: -1, anchorY: 2 });
  assert.equal(s.anchorX, 0);
  assert.equal(s.anchorY, 1);
});

test('sanitizeTextLayer: maxWidthPct clamps to [10,100]', () => {
  assert.equal(sanitizeTextLayer({ maxWidthPct: 1 }).maxWidthPct, 10);
  assert.equal(sanitizeTextLayer({ maxWidthPct: 500 }).maxWidthPct, 100);
});

test('sanitizeTextLayer: rotX/rotY clamp to +-80, rotZ clamps to +-180', () => {
  const s = sanitizeTextLayer({ rotX: -999, rotY: 999, rotZ: -999 });
  assert.equal(s.rotX, -80);
  assert.equal(s.rotY, 80);
  assert.equal(s.rotZ, -180);
  const s2 = sanitizeTextLayer({ rotZ: 999 });
  assert.equal(s2.rotZ, 180);
});

test('sanitizeTextLayer: opacity clamps to [0,1]', () => {
  assert.equal(sanitizeTextLayer({ opacity: -3 }).opacity, 0);
  assert.equal(sanitizeTextLayer({ opacity: 3 }).opacity, 1);
});

test('sanitizeTextLayer: color must be #rrggbb; anything else falls back', () => {
  assert.equal(sanitizeTextLayer({ color: '#12ab56' }).color, '#12ab56');
  assert.equal(sanitizeTextLayer({ color: '#fff' }).color, DEFAULT_TEXT_LAYER.color, '3-digit hex is not accepted');
  assert.equal(sanitizeTextLayer({ color: 'red' }).color, DEFAULT_TEXT_LAYER.color, 'named colors are not accepted');
  assert.equal(sanitizeTextLayer({ color: 'rgb(1,2,3)' }).color, DEFAULT_TEXT_LAYER.color);
  assert.equal(sanitizeTextLayer({ color: '#zzzzzz' }).color, DEFAULT_TEXT_LAYER.color);
});

test('sanitizeTextLayer: color falls back to the FALLBACK layer color when raw is invalid, not always the hardcoded default', () => {
  const fb = { ...DEFAULT_TEXT_LAYER, color: '#111111' };
  assert.equal(sanitizeTextLayer({ color: 'garbage' }, fb).color, '#111111');
});

test('sanitizeTextLayer: align must be in TEXT_ALIGNS, falls back to fallback.align, then to center', () => {
  assert.equal(sanitizeTextLayer({ align: 'left' }).align, 'left');
  assert.equal(sanitizeTextLayer({ align: 'diagonal' }, { ...DEFAULT_TEXT_LAYER, align: 'right' }).align, 'right');
  assert.equal(sanitizeTextLayer({ align: 'diagonal' }, { ...DEFAULT_TEXT_LAYER, align: 'nonsense' }).align, 'center');
});

test('sanitizeTextLayer: text is coerced to a string and truncated at 400 chars', () => {
  const long = 'x'.repeat(500);
  const s = sanitizeTextLayer({ text: long });
  assert.equal(s.text.length, 400);
  assert.equal(s.text, long.slice(0, 400));
  assert.equal(sanitizeTextLayer({ text: 42 }).text, '42');
  assert.equal(sanitizeTextLayer({ text: '' }).text, '', 'explicit empty string is honored, not treated as missing');
  assert.equal(sanitizeTextLayer({}).text, DEFAULT_TEXT_LAYER.text, 'missing text falls back');
});

test('sanitizeTextLayer: on/uppercase are Boolean-coerced, falling back only when absent', () => {
  assert.equal(sanitizeTextLayer({ on: 0 }).on, false);
  assert.equal(sanitizeTextLayer({ on: 1 }).on, true);
  assert.equal(sanitizeTextLayer({}).on, DEFAULT_TEXT_LAYER.on);
  assert.equal(sanitizeTextLayer({ uppercase: 1 }).uppercase, true);
  assert.equal(sanitizeTextLayer({ uppercase: 0 }).uppercase, false);
  assert.equal(sanitizeTextLayer({}).uppercase, DEFAULT_TEXT_LAYER.uppercase);
});

test('sanitizeTextLayer: unknown fontId falls back to fallback.fontId, else the first catalog entry', () => {
  assert.equal(sanitizeTextLayer({ fontId: 'not-a-real-font' }).fontId, DEFAULT_TEXT_LAYER.fontId);
  assert.equal(sanitizeTextLayer({ fontId: 'not-a-real-font' }, { fontId: 'also-not-real' }).fontId, GOOGLE_FONT_CATALOG[0].id);
  assert.equal(sanitizeTextLayer({ fontId: 'anton' }).fontId, 'anton');
});

test('sanitizeTextLayer: weight snaps to the resolved font\'s nearest available weight when the requested weight does not exist', () => {
  // Anton only ships weight 400 — asking for 700 must snap to 400, not
  // silently pass through a weight the family never published.
  assert.equal(sanitizeTextLayer({ fontId: 'anton', weight: 700 }).weight, 400);
  // Unbounded ships [200..900 step 100]; 530 is unambiguously nearer to 500.
  assert.equal(sanitizeTextLayer({ fontId: 'unbounded', weight: 530 }).weight, 500);
  // A weight that IS valid for the font passes through untouched.
  assert.equal(sanitizeTextLayer({ fontId: 'playfair-display', weight: 900 }).weight, 900);
});

test('sanitizeTextLayer: weight falls back to the fallback layer\'s weight when raw omits it, snapped to the NEW font if needed', () => {
  const fb = { ...DEFAULT_TEXT_LAYER, weight: 700 };
  // fallback weight 700 is valid for playfair-display -> used as-is.
  assert.equal(sanitizeTextLayer({ fontId: 'playfair-display' }, fb).weight, 700);
  // fallback weight 700 is NOT valid for anton ([400]) -> snaps to 400.
  assert.equal(sanitizeTextLayer({ fontId: 'anton' }, fb).weight, 400);
});

test('sanitizeTextLayer: a null/non-object raw input falls back to the fallback layer entirely', () => {
  const fb = { ...DEFAULT_TEXT_LAYER, text: 'FALLBACK TEXT', color: '#123123' };
  const s = sanitizeTextLayer(null, fb);
  assert.equal(s.text, 'FALLBACK TEXT');
  assert.equal(s.color, '#123123');
});

// ── createTextLayer ──────────────────────────────────────────────────────

test('createTextLayer: attaches the given id and fills unspecified fields from DEFAULT_TEXT_LAYER', () => {
  const layer = createTextLayer('txt-9', { text: 'HERO' });
  assert.equal(layer.id, 'txt-9');
  assert.equal(layer.text, 'HERO');
  assert.equal(layer.align, DEFAULT_TEXT_LAYER.align);
  assert.equal(layer.fontId, DEFAULT_TEXT_LAYER.fontId);
  assert.equal(layer.weight, DEFAULT_TEXT_LAYER.weight);
});

test('createTextLayer: out-of-bounds overrides are sanitized, not passed through raw', () => {
  const layer = createTextLayer('txt-1', { sizePct: 999, opacity: -5 });
  assert.equal(layer.sizePct, 60);
  assert.equal(layer.opacity, 0);
});

// ── sanitizeTextLayers — MAX_TEXT_LAYERS enforcement, id reassignment,
// non-array fallback. ───────────────────────────────────────────────────────

test('sanitizeTextLayers: caps at MAX_TEXT_LAYERS and reassigns ids positionally as txt-1..txt-N', () => {
  assert.equal(MAX_TEXT_LAYERS, 3);
  const raw = [
    { text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }, { text: 'E' },
  ];
  const result = sanitizeTextLayers(raw);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((l) => l.id), ['txt-1', 'txt-2', 'txt-3']);
  assert.deepEqual(result.map((l) => l.text), ['A', 'B', 'C']);
});

test('sanitizeTextLayers: duplicate/missing ids in the input are reassigned deterministically, never left duplicated', () => {
  const raw = [
    { id: 'txt-2', text: 'first' },
    { id: 'txt-2', text: 'second' },
    { text: 'no id at all' },
  ];
  const result = sanitizeTextLayers(raw);
  assert.deepEqual(result.map((l) => l.id), ['txt-1', 'txt-2', 'txt-3']);
  assert.deepEqual(result.map((l) => l.text), ['first', 'second', 'no id at all']);
});

test('sanitizeTextLayers: non-array input returns a deep copy of fallbackLayers, not the same reference', () => {
  const fallback = [createTextLayer('txt-1', { text: 'KEEP ME' })];
  const result = sanitizeTextLayers(null, fallback);
  assert.deepEqual(result, fallback);
  assert.notEqual(result, fallback, 'must not be the same array reference');
  result[0].text = 'MUTATED';
  assert.equal(fallback[0].text, 'KEEP ME', 'mutating the result must not mutate the original fallback (deep copy)');
});

test('sanitizeTextLayers: non-array input with no fallback returns an empty array', () => {
  assert.deepEqual(sanitizeTextLayers(undefined), []);
  assert.deepEqual(sanitizeTextLayers('not-an-array'), []);
  assert.deepEqual(sanitizeTextLayers({}), []);
});

test('sanitizeTextLayers: each entry is independently sanitized (bounds enforced per layer)', () => {
  const result = sanitizeTextLayers([{ sizePct: 999 }, { opacity: -5 }]);
  assert.equal(result[0].sizePct, 60);
  assert.equal(result[1].opacity, 0);
});

// ── resolveFrameRect — mirrors ClothStudio.jsx computeFrameRect exactly. ───
// Hand-derived via the SAME margin/aspect formula (w=cw*0.92, h=w/aspect,
// re-fit to h=ch*0.92 if that overflows) so the expected values are computed
// independently in this test rather than round-tripped through the module.

test('resolveFrameRect: off frame (frameW/frameH absent) is the centered 0.92 safe area', () => {
  const rect = resolveFrameRect({ canvasW: 1000, canvasH: 800 });
  assert.equal(rect.w, 920);
  assert.equal(rect.h, 736);
  assert.equal(rect.x, 40);
  assert.equal(rect.y, 32);
});

test('resolveFrameRect: off frame also triggers for explicit null/undefined frameW/frameH', () => {
  const a = resolveFrameRect({ canvasW: 1000, canvasH: 800, frameW: null, frameH: null });
  const b = resolveFrameRect({ canvasW: 1000, canvasH: 800, frameW: undefined, frameH: undefined });
  assert.deepEqual(a, { x: 40, y: 32, w: 920, h: 736 });
  assert.deepEqual(b, a);
});

test('resolveFrameRect: width-constrained branch (canvas narrower than the target aspect) fits on width, no height re-fit', () => {
  // square target (aspect 1), canvas 800x1000 -> canvas aspect 0.8 <= 1.
  const cw = 800, ch = 1000;
  const w1 = cw * 0.92; // 736
  const h1 = w1 / 1; // 736, <= ch*0.92 (920) -> no branch
  const rect = resolveFrameRect({ canvasW: cw, canvasH: ch, frameW: 1080, frameH: 1080 });
  assert.equal(rect.w, w1);
  assert.equal(rect.h, h1);
  assert.equal(rect.x, (cw - w1) / 2);
  assert.equal(rect.y, (ch - h1) / 2);
});

test('resolveFrameRect: height-constrained branch (canvas wider than the target aspect) re-fits on height', () => {
  // square target (aspect 1), canvas 1600x1000 -> canvas aspect 1.6 > 1.
  const cw = 1600, ch = 1000;
  const hCap = ch * 0.92; // 920
  const wFit = hCap * 1; // 920, aspect=1
  const rect = resolveFrameRect({ canvasW: cw, canvasH: ch, frameW: 1080, frameH: 1080 });
  assert.equal(rect.h, hCap);
  assert.equal(rect.w, wFit);
  assert.equal(rect.x, (cw - wFit) / 2);
  assert.equal(rect.y, (ch - hCap) / 2);
});

test('resolveFrameRect: all 4 fixed FRAME_PRESETS aspects at a shared canvas size, hand-computed', () => {
  const cw = 1200, ch = 900;
  const marginW = cw * 0.92; // 1104
  const marginH = ch * 0.92; // 828

  const cases = [
    { name: 'square', frameW: 1080, frameH: 1080 },
    { name: 'portrait', frameW: 1080, frameH: 1350 },
    { name: 'vertical', frameW: 1080, frameH: 1920 },
    { name: 'landscape', frameW: 1920, frameH: 1080 },
  ];

  cases.forEach(({ name, frameW, frameH }) => {
    const aspect = frameW / frameH;
    let w = marginW;
    let h = w / aspect;
    if (h > marginH) {
      h = marginH;
      w = h * aspect;
    }
    const expected = { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
    const rect = resolveFrameRect({ canvasW: cw, canvasH: ch, frameW, frameH });
    assert.equal(rect.w, expected.w, `${name} w`);
    assert.equal(rect.h, expected.h, `${name} h`);
    assert.equal(rect.x, expected.x, `${name} x`);
    assert.equal(rect.y, expected.y, `${name} y`);
  });

  // Sanity: this canvas shape puts landscape on the width-constrained
  // branch (no re-fit) and square/portrait/vertical on the height-
  // constrained branch — proving the loop above actually exercised both.
  const landscapeH = marginW / (1920 / 1080);
  assert.ok(landscapeH <= marginH, 'expected landscape to take the width-constrained (no-branch) path in this fixture');
  const squareH = marginW / 1;
  assert.ok(squareH > marginH, 'expected square to take the height-constrained (branch) path in this fixture');
});

// ── buildTextCanvasSpec — wrap determinism, uppercase, multi-line, align,
// TEXT_CANVAS_SCALE application. Fake measure: width = chars * fontPx * 0.6,
// matching the handoff's specified test double exactly. ────────────────────

const fakeMeasure = (text, fontString) => {
  const fontPx = Number(String(fontString).match(/\s([\d.]+)px/)[1]);
  return text.length * fontPx * 0.6;
};

test('buildTextCanvasSpec: word-wrap is deterministic under the injected fake measure', () => {
  // frameNativeH=1000, sizePct=10 -> fontPx=100. frameNativeW=1000,
  // maxWidthPct=50 -> maxWidthPx=500. 'HI THERE' = 8 chars * 60 = 480 <= 500
  // (fits); adding ' WORLD' (14 chars * 60 = 840) would overflow.
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'HI THERE WORLD', sizePct: 10, maxWidthPct: 50, tracking: 0, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['HI THERE', 'WORLD']);
});

test('buildTextCanvasSpec: every word alone on its line when no two-word combination fits', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'ALPHA BETA GAMMA DELTA', sizePct: 10, maxWidthPct: 50, tracking: 0, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['ALPHA', 'BETA', 'GAMMA', 'DELTA']);
});

test('buildTextCanvasSpec: a generous maxWidthPct keeps everything on one line', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'ONE LINE OF TEXT', sizePct: 5, maxWidthPct: 100, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 4000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['ONE LINE OF TEXT']);
});

test('buildTextCanvasSpec: uppercase transform is applied before wrapping', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'hello world', sizePct: 5, maxWidthPct: 100, uppercase: true };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 4000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['HELLO WORLD']);
});

test('buildTextCanvasSpec: explicit \\n always breaks a line, even when the combined text would otherwise fit', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'HI\nTHERE', sizePct: 5, maxWidthPct: 100, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 4000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['HI', 'THERE']);
});

test('buildTextCanvasSpec: a blank line from a double \\n is preserved', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'A\n\nB', sizePct: 5, maxWidthPct: 100, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 4000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.lines.map((l) => l.text), ['A', '', 'B']);
});

test('buildTextCanvasSpec: align left/center/right produce distinct, correctly ordered x positions for the same text', () => {
  const base = { ...DEFAULT_TEXT_LAYER, text: 'HERO', sizePct: 10, maxWidthPct: 80, uppercase: false };
  const left = buildTextCanvasSpec({ layer: { ...base, align: 'left' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const center = buildTextCanvasSpec({ layer: { ...base, align: 'center' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const right = buildTextCanvasSpec({ layer: { ...base, align: 'right' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });

  // align never changes the canvas's own pixel dimensions, only where the
  // line is drawn within it.
  assert.equal(left.canvasW, center.canvasW);
  assert.equal(center.canvasW, right.canvasW);

  assert.equal(center.lines[0].x, center.canvasW / 2, 'center align draws at exactly half the canvas width');
  assert.ok(left.lines[0].x < center.lines[0].x, 'left x must sit before center x');
  assert.ok(center.lines[0].x < right.lines[0].x, 'center x must sit before right x');
  assert.ok(left.lines[0].x > 0, 'left x must still be inset by some padding, not flush at 0');
  assert.ok(right.lines[0].x < right.canvasW, 'right x must still be inset from the canvas edge, not flush at canvasW');
});

test('buildTextCanvasSpec: TEXT_CANVAS_SCALE is applied to fontPx, letterSpacingPx, and the vertical gap between lines', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'A\nB', sizePct: 10, tracking: 0.05, leading: 1.2, maxWidthPct: 100, uppercase: false };
  const frameNativeH = 800;
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 2000, frameNativeH, measure: fakeMeasure });

  assert.equal(spec.scale, TEXT_CANVAS_SCALE);
  const fontPx1x = (layer.sizePct / 100) * frameNativeH;
  assert.equal(spec.fontPx, fontPx1x * TEXT_CANVAS_SCALE);
  assert.equal(spec.letterSpacingPx, layer.tracking * fontPx1x * TEXT_CANVAS_SCALE);
  assert.equal(spec.lineHeightPx, layer.leading * fontPx1x * TEXT_CANVAS_SCALE);

  // The gap between two consecutive lines' draw-y must equal exactly one
  // scaled line-height — the direct, implementation-detail-agnostic proof
  // that vertical spacing is genuinely drawn at 2x, not 1x.
  assert.equal(spec.lines.length, 2);
  assert.equal(spec.lines[1].y - spec.lines[0].y, spec.lineHeightPx);

  // canvas pixel dimensions are integers (real canvas.width/height values).
  assert.ok(Number.isInteger(spec.canvasW));
  assert.ok(Number.isInteger(spec.canvasH));
});

test('buildTextCanvasSpec: fontString stays the UNSCALED (1x) CSS font string, matching what was passed to measure()', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'X', fontId: 'space-grotesk', weight: 700, sizePct: 10, maxWidthPct: 100 };
  const frameNativeH = 1080;
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 1920, frameNativeH, measure: fakeMeasure });
  const fontPx1x = (layer.sizePct / 100) * frameNativeH;
  assert.equal(spec.fontString, `700 ${fontPx1x}px "Space Grotesk", sans-serif`);
});

// ── layoutTextPlane — center-origin conversion math. ───────────────────────

test('layoutTextPlane: converts a known frameRect + spec into center-origin stage coordinates', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  const spec = { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE };

  const pxScale = frameRect.h / frameNativeH; // 450/1080 = 5/12
  const expectedPlaneW = (spec.canvasW / spec.scale) * pxScale; // 200 * 5/12
  const expectedPlaneH = (spec.canvasH / spec.scale) * pxScale; // 50 * 5/12

  const result = layoutTextPlane({
    spec, layer: { anchorX: 0.5, anchorY: 0.4 }, frameRect, frameNativeH, stageW, stageH,
  });
  assert.ok(Math.abs(result.planeW - expectedPlaneW) < 1e-9);
  assert.ok(Math.abs(result.planeH - expectedPlaneH) < 1e-9);
});

test('layoutTextPlane: anchorX 0 / 0.5 / 1 sweep from the frame\'s left edge to its right edge, centered on the stage', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const common = { spec: { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE }, frameRect, frameNativeH: 1080, stageW: 1000, stageH: 600 };

  const atLeft = layoutTextPlane({ ...common, layer: { anchorX: 0, anchorY: 0.5 } });
  const atCenter = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0.5 } });
  const atRight = layoutTextPlane({ ...common, layer: { anchorX: 1, anchorY: 0.5 } });

  assert.equal(atLeft.centerX, (frameRect.x + 0) - common.stageW / 2); // -400
  assert.equal(atCenter.centerX, (frameRect.x + 0.5 * frameRect.w) - common.stageW / 2); // 0
  assert.equal(atRight.centerX, (frameRect.x + frameRect.w) - common.stageW / 2); // 400
  assert.equal(atLeft.centerX, -400);
  assert.equal(atCenter.centerX, 0);
  assert.equal(atRight.centerX, 400);
});

test('layoutTextPlane: anchorY 0 / 0.5 / 1 sweep from the frame\'s top edge to its bottom edge, with +y UP in stage space', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const common = { spec: { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE }, frameRect, frameNativeH: 1080, stageW: 1000, stageH: 600 };

  const atTop = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0 } });
  const atMid = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0.5 } });
  const atBottom = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 1 } });

  assert.equal(atTop.centerY, 250);
  assert.equal(atMid.centerY, 25);
  assert.equal(atBottom.centerY, -200);
  // anchorY 0 (DOM-style "top") must resolve to the LARGER world-space Y
  // (higher up, since world space is +y-up) than anchorY 1 ("bottom").
  assert.ok(atTop.centerY > atMid.centerY);
  assert.ok(atMid.centerY > atBottom.centerY);
});

// ── layoutTextPlane — Phase 2 bug fix: align-aware horizontal anchor.
// anchorX names the EDGE of the text block align grows from ('left'/
// 'right'), not always the block's center — see the function's own header
// comment for the full convention and why Phase 1's centered-only preset
// masked this until Phase 2's left-aligned presets (hero-left,
// lower-third) exposed it live. ───────────────────────────────────────────

test('layoutTextPlane: align \'left\' — anchorX is the block\'s LEFT edge (centerX = anchor + planeW/2)', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  const spec = { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE };
  const pxScale = frameRect.h / frameNativeH;
  const planeW = (spec.canvasW / spec.scale) * pxScale;

  const result = layoutTextPlane({ spec, layer: { anchorX: 0.08, anchorY: 0.5, align: 'left' }, frameRect, frameNativeH, stageW, stageH });
  const anchorPxX = frameRect.x + 0.08 * frameRect.w;
  const expectedCenterX = (anchorPxX + planeW / 2) - stageW / 2;
  assert.ok(Math.abs(result.centerX - expectedCenterX) < 1e-9);

  // Converting the returned centerX back to stage top-left-origin px, the
  // block's LEFT edge must land EXACTLY at the frame-relative anchor.
  const blockLeftEdgeStagePx = (result.centerX + stageW / 2) - result.planeW / 2;
  assert.ok(Math.abs(blockLeftEdgeStagePx - anchorPxX) < 1e-9);
});

test('layoutTextPlane: align \'right\' — anchorX is the block\'s RIGHT edge (centerX = anchor - planeW/2)', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  const spec = { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE };
  const pxScale = frameRect.h / frameNativeH;
  const planeW = (spec.canvasW / spec.scale) * pxScale;

  const result = layoutTextPlane({ spec, layer: { anchorX: 0.92, anchorY: 0.5, align: 'right' }, frameRect, frameNativeH, stageW, stageH });
  const anchorPxX = frameRect.x + 0.92 * frameRect.w;
  const expectedCenterX = (anchorPxX - planeW / 2) - stageW / 2;
  assert.ok(Math.abs(result.centerX - expectedCenterX) < 1e-9);

  const blockRightEdgeStagePx = (result.centerX + stageW / 2) + result.planeW / 2;
  assert.ok(Math.abs(blockRightEdgeStagePx - anchorPxX) < 1e-9);
});

test('layoutTextPlane: align \'center\' (explicit) is unchanged from the pre-fix formula — anchorX names the block\'s CENTER', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  const spec = { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE };

  const result = layoutTextPlane({ spec, layer: { anchorX: 0.5, anchorY: 0.4, align: 'center' }, frameRect, frameNativeH, stageW, stageH });
  assert.equal(result.centerX, (frameRect.x + 0.5 * frameRect.w) - stageW / 2);
});

test('layoutTextPlane: an unrecognized/absent align falls through to the same center-anchor formula as \'center\' (never throws, never guesses left/right)', () => {
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  const spec = { canvasW: 400, canvasH: 100, scale: TEXT_CANVAS_SCALE };
  const common = { spec, frameRect, frameNativeH, stageW, stageH };

  const noAlign = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0.4 } });
  const bogusAlign = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0.4, align: 'justified' } });
  const centerAlign = layoutTextPlane({ ...common, layer: { anchorX: 0.5, anchorY: 0.4, align: 'center' } });
  assert.equal(noAlign.centerX, centerAlign.centerX);
  assert.equal(bogusAlign.centerX, centerAlign.centerX);
});

test('layoutTextPlane: the actual reported bug — a wide left-aligned block at a small anchorX no longer hangs off the frame\'s own left edge', () => {
  // hero-left/lower-third's real shape: anchorX 0.08, align 'left', a WIDE
  // headline plane. Before this fix, half the plane (planeW/2) extended
  // LEFT of the anchor — for a wide-enough canvas that put the block's own
  // left edge well past the frame's left edge (frameRect.x) entirely.
  const frameRect = { x: 100, y: 50, w: 800, h: 450 };
  const frameNativeH = 1080;
  const stageW = 1000, stageH = 600;
  // Deliberately wide: at 1080p-native scale this is a headline-sized
  // canvas whose planeW is far larger than the anchor's own 64px distance
  // from frameRect.x (100 + 0.08*800 = 164) — exactly the shape that broke
  // pre-fix.
  const spec = { canvasW: 1600, canvasH: 100, scale: TEXT_CANVAS_SCALE };

  const result = layoutTextPlane({ spec, layer: { anchorX: 0.08, anchorY: 0.5, align: 'left' }, frameRect, frameNativeH, stageW, stageH });
  const anchorPxX = frameRect.x + 0.08 * frameRect.w;
  const blockLeftEdgeStagePx = (result.centerX + stageW / 2) - result.planeW / 2;
  assert.ok(Math.abs(blockLeftEdgeStagePx - anchorPxX) < 1e-9, 'left edge must sit exactly at the anchor, independent of planeW');
  assert.ok(blockLeftEdgeStagePx >= frameRect.x - 1e-9, 'a left-aligned block must never hang off the frame\'s own left edge when anchorX is inside the frame');
});

// ── sanitizeTextLayer — Phase 2 backdrop bar/pill fields. ───────────────────

test('TEXT_BACKDROPS is exactly [\'none\', \'bar\', \'pill\']', () => {
  assert.deepEqual(TEXT_BACKDROPS, ['none', 'bar', 'pill']);
});

test('sanitizeTextLayer: backdrop defaults to \'none\' and only accepts a real TEXT_BACKDROPS value', () => {
  assert.equal(sanitizeTextLayer({}).backdrop, 'none');
  assert.equal(sanitizeTextLayer({ backdrop: 'bar' }).backdrop, 'bar');
  assert.equal(sanitizeTextLayer({ backdrop: 'pill' }).backdrop, 'pill');
  assert.equal(sanitizeTextLayer({ backdrop: 'not-real' }).backdrop, DEFAULT_TEXT_LAYER.backdrop);
  assert.equal(sanitizeTextLayer({ backdrop: 42 }).backdrop, DEFAULT_TEXT_LAYER.backdrop);
});

test('sanitizeTextLayer: an old layer with none of the backdrop fields at all resolves to the full default backdrop shape (backward compat)', () => {
  const oldLayer = { text: 'HERO', fontId: 'inter', sizePct: 10 }; // no backdrop* keys whatsoever
  const sanitized = sanitizeTextLayer(oldLayer);
  assert.equal(sanitized.backdrop, 'none');
  assert.equal(sanitized.backdropColor, DEFAULT_TEXT_LAYER.backdropColor);
  assert.equal(sanitized.backdropOpacity, DEFAULT_TEXT_LAYER.backdropOpacity);
  assert.equal(sanitized.backdropPadPct, DEFAULT_TEXT_LAYER.backdropPadPct);
});

test('sanitizeTextLayer: backdropColor must be a real #rrggbb hex, else falls back', () => {
  assert.equal(sanitizeTextLayer({ backdropColor: '#ff00aa' }).backdropColor, '#ff00aa');
  assert.equal(sanitizeTextLayer({ backdropColor: 'red' }).backdropColor, DEFAULT_TEXT_LAYER.backdropColor);
  assert.equal(sanitizeTextLayer({ backdropColor: null }).backdropColor, DEFAULT_TEXT_LAYER.backdropColor);
});

test('sanitizeTextLayer: backdropOpacity clamps to [0,1]', () => {
  assert.equal(sanitizeTextLayer({ backdropOpacity: -5 }).backdropOpacity, 0);
  assert.equal(sanitizeTextLayer({ backdropOpacity: 5 }).backdropOpacity, 1);
  assert.equal(sanitizeTextLayer({ backdropOpacity: 0.3 }).backdropOpacity, 0.3);
  assert.equal(sanitizeTextLayer({ backdropOpacity: 'nope' }).backdropOpacity, DEFAULT_TEXT_LAYER.backdropOpacity);
});

test('sanitizeTextLayer: backdropPadPct clamps to [0,30]', () => {
  assert.equal(sanitizeTextLayer({ backdropPadPct: -5 }).backdropPadPct, 0);
  assert.equal(sanitizeTextLayer({ backdropPadPct: 999 }).backdropPadPct, 30);
  assert.equal(sanitizeTextLayer({ backdropPadPct: 12 }).backdropPadPct, 12);
});

// ── buildTextCanvasSpec — Phase 2 backdropRects. ─────────────────────────────

test('buildTextCanvasSpec: backdrop \'none\' emits an empty backdropRects array', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'HERO', sizePct: 10, maxWidthPct: 80, backdrop: 'none' };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.deepEqual(spec.backdropRects, []);
});

test('buildTextCanvasSpec: backdrop \'bar\'/\'pill\' emit one well-formed rect per line', () => {
  const layer = { ...DEFAULT_TEXT_LAYER, text: 'A\nB', sizePct: 10, maxWidthPct: 100, backdrop: 'bar', backdropPadPct: 10, uppercase: false };
  const spec = buildTextCanvasSpec({ layer, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.equal(spec.lines.length, 2);
  assert.equal(spec.backdropRects.length, 2);
  spec.backdropRects.forEach((rect) => {
    assert.equal(typeof rect.x, 'number');
    assert.equal(typeof rect.y, 'number');
    assert.ok(rect.w > 0);
    assert.ok(rect.h > 0);
    assert.ok(rect.radius >= 0);
  });
});

test('buildTextCanvasSpec: \'pill\' radius is exactly half the box height; \'bar\' radius is a small fixed corner, never a full pill', () => {
  const base = { ...DEFAULT_TEXT_LAYER, text: 'HERO', sizePct: 10, maxWidthPct: 80, backdropPadPct: 10, uppercase: false };
  const pill = buildTextCanvasSpec({ layer: { ...base, backdrop: 'pill' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const bar = buildTextCanvasSpec({ layer: { ...base, backdrop: 'bar' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.equal(pill.backdropRects[0].radius, pill.backdropRects[0].h / 2);
  assert.ok(bar.backdropRects[0].radius < bar.backdropRects[0].h / 2, 'bar radius must be a small fixed corner, not a capsule');
});

test('buildTextCanvasSpec: backdropRects honor align — left keeps the text\'s inset edge fixed, right mirrors it, center is symmetric (single-line fixture: exact formula check)', () => {
  const base = { ...DEFAULT_TEXT_LAYER, text: 'HERO', sizePct: 10, maxWidthPct: 80, backdrop: 'bar', backdropPadPct: 10, uppercase: false };
  const left = buildTextCanvasSpec({ layer: { ...base, align: 'left' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const center = buildTextCanvasSpec({ layer: { ...base, align: 'center' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const right = buildTextCanvasSpec({ layer: { ...base, align: 'right' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });

  // left align: box LEFT edge sits `backdropPad` before the text's own draw x.
  const leftPadScaled = (base.backdropPadPct / 100) * left.fontPx; // fontPx is already TEXT_CANVAS_SCALE'd
  assert.ok(Math.abs(left.backdropRects[0].x - (left.lines[0].x - leftPadScaled)) < 1e-6);

  // right align: box RIGHT edge (x+w) sits `backdropPad` after the text's own draw x.
  const rightPadScaled = (base.backdropPadPct / 100) * right.fontPx;
  const rightBox = right.backdropRects[0];
  assert.ok(Math.abs((rightBox.x + rightBox.w) - (right.lines[0].x + rightPadScaled)) < 1e-6);

  // center align: box is centered exactly on the text's own draw x (canvasW/2).
  const centerBox = center.backdropRects[0];
  assert.ok(Math.abs((centerBox.x + centerBox.w / 2) - center.lines[0].x) < 1e-6);

  // NOTE: with a single line, this line IS the one canvasW was sized around,
  // so its box lands centered in the canvas for EVERY alignment (an
  // unavoidable structural consequence of the formulas above, not a
  // separate thing to prove) — the genuine "align actually reflows a box"
  // proof needs a line that ISN'T the widest one; see the two-line test
  // below for that.
  assert.equal(left.backdropRects[0].x, center.backdropRects[0].x);
  assert.equal(center.backdropRects[0].x, right.backdropRects[0].x);
});

test('buildTextCanvasSpec: backdropRects honor align — a shorter line (not the one sizing the canvas) genuinely shifts position across alignments', () => {
  // Two explicit lines of different widths ('HERO' wider than 'HI') so
  // canvasW is sized around 'HERO' while 'HI' is free to actually MOVE
  // as align changes — the single-line fixture above can't show this
  // (its one line always ends up centered in its own snug canvas
  // regardless of align).
  const base = { ...DEFAULT_TEXT_LAYER, text: 'HERO\nHI', sizePct: 10, maxWidthPct: 100, backdrop: 'bar', backdropPadPct: 10, uppercase: false };
  const left = buildTextCanvasSpec({ layer: { ...base, align: 'left' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const center = buildTextCanvasSpec({ layer: { ...base, align: 'center' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const right = buildTextCanvasSpec({ layer: { ...base, align: 'right' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });

  assert.deepEqual(left.lines.map((l) => l.text), ['HERO', 'HI']);
  assert.equal(left.canvasW, center.canvasW, 'align never changes canvas size, only placement within it');
  assert.equal(center.canvasW, right.canvasW);

  // 'HI' (line index 1) follows lines[1].x exactly, same relationship the
  // single-line test above proved for the only line it had.
  const leftPadScaled = (base.backdropPadPct / 100) * left.fontPx;
  assert.ok(Math.abs(left.backdropRects[1].x - (left.lines[1].x - leftPadScaled)) < 1e-6);
  const rightPadScaled = (base.backdropPadPct / 100) * right.fontPx;
  const rightBox = right.backdropRects[1];
  assert.ok(Math.abs((rightBox.x + rightBox.w) - (right.lines[1].x + rightPadScaled)) < 1e-6);
  const centerBox = center.backdropRects[1];
  assert.ok(Math.abs((centerBox.x + centerBox.w / 2) - center.lines[1].x) < 1e-6);

  // The actual proof: three genuinely distinct box positions for the SAME
  // line, one per alignment.
  assert.notEqual(left.backdropRects[1].x, center.backdropRects[1].x);
  assert.notEqual(center.backdropRects[1].x, right.backdropRects[1].x);
  assert.notEqual(left.backdropRects[1].x, right.backdropRects[1].x);
});

test('buildTextCanvasSpec: an active backdrop expands canvasW/canvasH beyond the no-backdrop size', () => {
  const base = { ...DEFAULT_TEXT_LAYER, text: 'HERO', sizePct: 10, maxWidthPct: 80, uppercase: false };
  const off = buildTextCanvasSpec({ layer: { ...base, backdrop: 'none' }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  const on = buildTextCanvasSpec({ layer: { ...base, backdrop: 'pill', backdropPadPct: 20 }, frameNativeW: 1000, frameNativeH: 1000, measure: fakeMeasure });
  assert.ok(on.canvasW > off.canvasW);
  assert.ok(on.canvasH > off.canvasH);
});

// ── HERO_LAYOUT_PRESETS — Phase 2 authored layout presets. ──────────────────

test('HERO_LAYOUT_PRESETS: exactly the 4 required presets, each within MAX_TEXT_LAYERS and carrying no id field', () => {
  assert.equal(HERO_LAYOUT_PRESETS.length, 4);
  assert.deepEqual(HERO_LAYOUT_PRESETS.map((p) => p.id), ['hero-left', 'centered', 'lower-third', 'poster-stack']);
  HERO_LAYOUT_PRESETS.forEach((preset) => {
    assert.equal(typeof preset.label, 'string');
    assert.ok(Array.isArray(preset.layers) && preset.layers.length > 0);
    assert.ok(preset.layers.length <= MAX_TEXT_LAYERS, `${preset.id} exceeds MAX_TEXT_LAYERS`);
    preset.layers.forEach((layer) => assert.equal('id' in layer, false, `${preset.id} layer must not carry an id`));
  });
});

test('HERO_LAYOUT_PRESETS: every authored layer sanitizes to itself unchanged — no field needed clamping', () => {
  HERO_LAYOUT_PRESETS.forEach((preset) => {
    preset.layers.forEach((fields) => {
      const built = createTextLayer('probe-id', fields);
      const { id, ...rest } = built;
      const resanitized = sanitizeTextLayer(rest, DEFAULT_TEXT_LAYER);
      assert.deepEqual(resanitized, rest, `${preset.id} layer required clamping: ${JSON.stringify(fields)}`);
    });
  });
});

test('HERO_LAYOUT_PRESETS: applying a preset via sanitizeTextLayers (the ClothStudio apply path) reassigns positional txt-N ids', () => {
  HERO_LAYOUT_PRESETS.forEach((preset) => {
    const applied = sanitizeTextLayers(preset.layers, []);
    assert.equal(applied.length, preset.layers.length);
    applied.forEach((layer, i) => assert.equal(layer.id, `txt-${i + 1}`));
  });
});

test('HERO_LAYOUT_PRESETS: every referenced fontId is a real catalog entry that actually offers the requested weight', () => {
  HERO_LAYOUT_PRESETS.forEach((preset) => {
    preset.layers.forEach((fields) => {
      if (fields.fontId === undefined) return;
      const font = fontById(fields.fontId);
      assert.notEqual(font, undefined, `${preset.id}: unknown fontId ${fields.fontId}`);
      if (fields.weight !== undefined) {
        assert.ok(font.weights.includes(fields.weight), `${preset.id}: font ${fields.fontId} does not publish weight ${fields.weight}`);
      }
    });
  });
});

test('placement + posZ: sanitize defaults/clamps; layoutTextPlaneWorld maps anchors onto the fixed world stage', async () => {
  const { sanitizeTextLayer, layoutTextPlaneWorld, TEXT_WORLD_STAGE, DEFAULT_TEXT_LAYER } = await import('../text-layers.js');
  const s = sanitizeTextLayer({ placement: 'scene', posZ: 9 });
  assert.equal(s.placement, 'scene');
  assert.equal(s.posZ, 1.5, 'posZ clamps to +-1.5');
  assert.equal(sanitizeTextLayer({ placement: 'hologram' }).placement, 'overlay', 'unknown placement falls back to overlay');
  assert.equal(sanitizeTextLayer({}).placement, 'overlay', 'old layers (no field) stay overlay');
  assert.equal(DEFAULT_TEXT_LAYER.placement, 'overlay');

  const spec = { canvasW: 800, canvasH: 200, scale: 2 };
  const layer = { anchorX: 0.5, anchorY: 0.5, align: 'center', posZ: 0.4 };
  const placed = layoutTextPlaneWorld({ spec, layer, frameNativeH: 1080 });
  assert.ok(Math.abs(placed.centerX) < 1e-9 && Math.abs(placed.centerY) < 1e-9, 'center anchor lands at the origin');
  assert.equal(placed.centerZ, 0.4);
  const expectedH = ((200 / 2) / 1080) * TEXT_WORLD_STAGE.h;
  assert.ok(Math.abs(placed.planeH - expectedH) < 1e-12, 'plane height maps CSS-px fraction onto the world stage');
  assert.ok(Math.abs(placed.planeW - expectedH * 4) < 1e-12, 'aspect preserved');
  // align-aware anchor offsetting, same rule as the overlay layout
  const left = layoutTextPlaneWorld({ spec, layer: { ...layer, anchorX: 0, align: 'left' }, frameNativeH: 1080 });
  assert.ok(Math.abs(left.centerX - (-TEXT_WORLD_STAGE.w / 2 + left.planeW / 2)) < 1e-12);
  // out-of-range posZ clamps in layout too
  assert.equal(layoutTextPlaneWorld({ spec, layer: { ...layer, posZ: -9 }, frameNativeH: 1080 }).centerZ, -1.5);
});
