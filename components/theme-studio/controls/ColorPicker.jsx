'use client';

import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import NumericField from './NumericField.jsx';
import LabeledSlider from './LabeledSlider.jsx';
import Swatch, { GamutTag } from './Swatch.jsx';
import { HexField } from './OklchEditor.jsx';
import {
  advisoryIssues, colorGamutInfo, hueTrackGradient, lcToPad, normalizeHexInput, oklchHex, oklchToHsl, oklchToRgb,
  padRowGradients, padToLc, parseColorPaste, parseHslText, parseRgbText, hslToOklch, rgbToOklch, sliderBounds,
} from '../../../lib/theme-studio/color-fields.js';
import { sliderKeyStep } from '../../../lib/theme-studio/keymap.js';
import { COLOR_PICKER_POPOVER } from '../../../lib/theme-studio/ui-state.js';
import { useStudio } from '../StudioContext.jsx';

const PAD_ROWS = 24;
const POPOVER_W = 288;

/** Text field that commits parsed text (rgb / hsl) on Enter or blur and reverts when it cannot. */
function ParsedField({
  id, label, text, disabled, hint, onCommit,
}) {
  const { announce } = useStudio();
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) { setDraft(text); setInvalid(false); }
  }, [text]);
  const commit = () => {
    if (draft.trim() === text) { setInvalid(false); return; }
    if (!onCommit(draft)) {
      setInvalid(true);
      announce(`${label}: not a valid value. ${hint}`);
      setDraft(text);
      return;
    }
    setInvalid(false);
  };
  return (
    <div className="ts-field" id={`${id}-field`}>
      <label className="ts-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        className="ts-input"
        style={{ fontFamily: 'var(--ts-mono)', fontSize: 12.5 }}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid ? 'true' : undefined}
        disabled={disabled}
        value={draft}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape' && draft !== text) { e.stopPropagation(); setDraft(text); setInvalid(false); }
        }}
      />
    </div>
  );
}

/** The 2D lightness x chroma pad at the current hue. Pointer drag or arrow keys. */
function LcPad({
  id, value, bounds, disabled, onPatch, onEnd,
}) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const hueKey = Math.round(value.h);
  const rows = useMemo(() => padRowGradients(hueKey, PAD_ROWS), [hueKey]);
  const pos = lcToPad(value, bounds);

  const fromPointer = (e) => {
    const r = ref.current.getBoundingClientRect();
    return padToLc({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }, bounds);
  };
  const stepL = 0.005;
  const stepC = 0.005;
  return (
    <div
      ref={ref}
      id={id}
      role="group"
      tabIndex={disabled ? -1 : 0}
      aria-label="Lightness and chroma pad. Left and right arrows change chroma, up and down arrows change lightness. Shift moves faster."
      aria-disabled={disabled ? 'true' : undefined}
      aria-roledescription="two-dimensional slider"
      style={{
        position: 'relative', height: 148, borderRadius: 'var(--ts-radius-sm)', border: '1px solid var(--ts-line-strong)', overflow: 'hidden',
        touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair', opacity: disabled ? 0.6 : 1, display: 'flex', flexDirection: 'column',
      }}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        dragging.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
        e.currentTarget.focus({ preventScroll: true });
        onPatch(fromPointer(e), 'drag');
      }}
      onPointerMove={(e) => { if (dragging.current) onPatch(fromPointer(e), 'drag'); }}
      onPointerUp={() => { if (dragging.current) { dragging.current = false; onEnd(); } }}
      onPointerCancel={() => { if (dragging.current) { dragging.current = false; onEnd(); } }}
      onKeyUp={() => onEnd()}
      onKeyDown={(e) => {
        if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        let patch = null;
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          const v = sliderKeyStep(k, { value: value.c, min: bounds.c[0], max: bounds.c[1], step: stepC, shift: e.shiftKey });
          if (v !== null && v !== value.c) patch = { c: v };
        } else if (k === 'ArrowUp' || k === 'ArrowDown') {
          const v = sliderKeyStep(k, { value: value.l, min: bounds.l[0], max: bounds.l[1], step: stepL, shift: e.shiftKey });
          if (v !== null && v !== value.l) patch = { l: v };
        } else {
          return;
        }
        e.preventDefault();
        if (patch) onPatch(patch, 'key');
      }}
    >
      {rows.map((bg, i) => (
        <div key={i} aria-hidden="true" style={{ flex: 1, background: bg }} />
      ))}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, width: 16, height: 16, marginLeft: -8, marginTop: -8,
          borderRadius: '50%', border: '2px solid var(--ts-bg)', boxShadow: '0 0 0 1.5px var(--ts-fg)', pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/**
 * Color picker popover: L x C pad, hue strip, OKLCH / hex / RGB / HSL fields, paste, optional
 * EyeDropper. Presentational: the caller owns the edit (onPatch / onHex run inside an edit-session
 * gesture, so a linked role becomes custom in the SAME undo entry as the first value change).
 *
 *   value {l,c,h,a}      the resolved color being edited
 *   readOnly             locked role: everything disabled, "Unlock to edit" shown
 *   willSwitch           role is linked: a hint says the first edit makes it custom
 *   onPatch({l|c|h}, kind)  onHex(hex)  onEnd()  onClose()  onUnlock()
 *   openerRef            element that opened it (anchor + focus return)
 */
export default function ColorPicker({
  idBase, label, value, readOnly = false, willSwitch = false, hueDisabled = false, hueNote, roleId, mode,
  onPatch, onHex, onEnd, onClose, onUnlock, openerRef,
}) {
  const { ui, mobile, announce } = useStudio();
  const rootRef = useRef(null);
  const focusInside = useRef(true);
  const [place, setPlace] = useState(null);
  const bounds = sliderBounds(ui.fullRange);
  const hex = oklchHex(value);
  const rgb = oklchToRgb(value);
  const hsl = oklchToHsl(value);
  const gamut = colorGamutInfo(value);
  const advisory = !ui.fullRange && roleId ? advisoryIssues(roleId, mode, value) : [];
  const canEyedrop = typeof window !== 'undefined' && 'EyeDropper' in window;
  const trackBg = useMemo(() => hueTrackGradient(value.l, value.c), [value.l, value.c]);

  // Anchor under (or over) the opener on desktop; bottom sheet on mobile.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const anchor = openerRef && openerRef.current;
    if (!el) return undefined;
    const compute = () => {
      if (mobile || !anchor || !anchor.isConnected) { setPlace(null); return; }
      const a = anchor.getBoundingClientRect();
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.min(Math.max(8, a.left), Math.max(8, vw - POPOVER_W - 8));
      let top = a.bottom + 6;
      if (top + h > vh - 8) top = Math.max(8, a.top - h - 6);
      setPlace({ top, left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [mobile, openerRef]);

  // Focus in on open; on close hand focus back to the swatch that opened it.
  useEffect(() => {
    const el = rootRef.current;
    if (el) el.focus({ preventScroll: true });
    const opener = openerRef && openerRef.current;
    return () => {
      if (focusInside.current && opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [openerRef]);

  // Outside click closes (clicks on a picker trigger are theirs to handle).
  useEffect(() => {
    const onDown = (e) => {
      const el = rootRef.current;
      if (!el || !(e.target instanceof Element)) return;
      if (el.contains(e.target) || e.target.closest('[data-ts-picker-trigger]')) return;
      if (e.target.closest('input, textarea, select, button, a, [tabindex]')) focusInside.current = false;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const applyHex = (h) => {
    const n = normalizeHexInput(h);
    if (n) onHex(n);
    return !!n;
  };

  const onPaste = (e) => {
    if (readOnly) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const t = text.trim();
    const t0 = e.target;
    const inField = t0 instanceof HTMLInputElement;
    // A bare "123" pasted into a number field is a number; only an explicit color form applies there.
    const explicit = t.startsWith('#') || /^(rgb|hsl)a?\(/i.test(t);
    if (inField && !explicit) return;
    const parsed = parseColorPaste(t);
    if (!parsed) return;
    e.preventDefault();
    onHex(parsed);
    announce(`${label}: pasted ${parsed}.`);
  };

  const pickFromScreen = async () => {
    try {
      const r = await new window.EyeDropper().open();
      if (r && r.sRGBHex) { applyHex(r.sRGBHex); announce(`${label}: picked ${r.sRGBHex}.`); }
    } catch (err) {
      // cancelled with Esc
    }
  };

  const wrapStyle = mobile
    ? {
      position: 'fixed', left: 8, right: 8, bottom: 'max(8px, env(safe-area-inset-bottom, 0px))', maxHeight: '70dvh', overflowY: 'auto',
    }
    : {
      position: 'fixed', width: POPOVER_W, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto',
      top: place ? place.top : 0, left: place ? place.left : 0, visibility: place ? 'visible' : 'hidden',
    };

  return (
    <div
      ref={rootRef}
      id={COLOR_PICKER_POPOVER}
      data-picker-for={roleId || undefined}
      role="dialog"
      aria-modal="false"
      aria-label={`Color picker, ${label}`}
      tabIndex={-1}
      onPaste={onPaste}
      onFocus={() => { focusInside.current = true; }}
      style={{
        ...wrapStyle, zIndex: 10, background: 'var(--ts-bg)', color: 'var(--ts-fg)', border: '1px solid var(--ts-line)',
        borderRadius: 'var(--ts-radius)', boxShadow: '0 12px 32px var(--ts-shadow)', padding: 12, display: 'flex', flexDirection: 'column',
        gap: 10, outline: 'none', boxSizing: 'border-box',
      }}
    >
      <div id={`${idBase}-picker-head`} className="ts-oklch-head" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Swatch color={hex} />
          <code className="ts-code" id={`${idBase}-picker-hex`}>{hex}</code>
          {gamut.mapped ? <GamutTag id={`${idBase}-picker-gamut-tag`} /> : null}
        </span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {canEyedrop && !readOnly ? (
            <button type="button" className="ts-btn ts-btn--sm" id={`${idBase}-eyedropper`} onClick={pickFromScreen}>
              Pick from screen
            </button>
          ) : null}
          <button type="button" className="ts-btn ts-btn--sm" id={`${idBase}-picker-close`} onClick={onClose}>Done</button>
        </span>
      </div>

      {readOnly ? (
        <div className="ts-stack ts-stack--tight" id={`${idBase}-picker-locked`}>
          <p className="ts-hint">This color is locked, so the picker is read-only.</p>
          <div className="ts-btn-row">
            <button type="button" className="ts-btn ts-btn--sm" id={`${idBase}-picker-unlock`} onClick={onUnlock}>Unlock to edit</button>
          </div>
        </div>
      ) : willSwitch ? (
        <p className="ts-hint" id={`${idBase}-picker-linked-note`}>Editing makes this color custom. It stops following the master hue. Undo restores the link.</p>
      ) : null}

      <LcPad id={`${idBase}-pad`} value={value} bounds={bounds} disabled={readOnly} onPatch={onPatch} onEnd={onEnd} />

      <LabeledSlider
        id={`${idBase}-picker-h`}
        label="Hue"
        unit="°"
        kind="degrees"
        value={value.h}
        min={bounds.h[0]}
        max={bounds.h[1]}
        step={1}
        page={15}
        wrap
        description={hueDisabled ? (hueNote || 'Hue is fixed to keep the meaning of this color.') : undefined}
        trackBackground={trackBg}
        disabled={readOnly || hueDisabled}
        onValue={(v, k) => onPatch({ h: v }, k)}
        onEnd={onEnd}
      />

      <div id={`${idBase}-picker-oklch`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          ['l', 'L', bounds.l, 0.005, 0.05],
          ['c', 'C', bounds.c, 0.005, 0.04],
          ['h', 'H', bounds.h, 1, 15],
        ].map(([k, lbl, b, step, page]) => (
          <div className="ts-field" key={k}>
            <span className="ts-label">{lbl}</span>
            <NumericField
              id={`${idBase}-picker-num-${k}`}
              label={{ l: 'Lightness', c: 'Chroma', h: 'Hue' }[k]}
              value={value[k]}
              min={b[0]}
              max={b[1]}
              step={step}
              page={page}
              wrap={k === 'h'}
              wide
              disabled={readOnly || (k === 'h' && hueDisabled)}
              onCommit={(v, kind) => onPatch({ [k]: v }, kind)}
              onEnd={onEnd}
            />
          </div>
        ))}
      </div>

      <div className="ts-field" id={`${idBase}-picker-hex-field`}>
        <span className="ts-label">Hex</span>
        <HexField id={`${idBase}-picker-hexinput`} label={label} hex={hex} disabled={readOnly} onCommit={onHex} />
      </div>
      <ParsedField
        id={`${idBase}-picker-rgb`}
        label="RGB"
        text={`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`}
        hint="Use three numbers from 0 to 255."
        disabled={readOnly}
        onCommit={(t) => {
          const v = parseRgbText(t);
          if (!v) return false;
          const o = rgbToOklch(v, value.h);
          onHex(oklchHex(o));
          return true;
        }}
      />
      <ParsedField
        id={`${idBase}-picker-hsl`}
        label="HSL"
        text={`hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`}
        hint="Use hue 0 to 360, then saturation and lightness as percentages."
        disabled={readOnly}
        onCommit={(t) => {
          const v = parseHslText(t);
          if (!v) return false;
          onHex(oklchHex(hslToOklch(v, value.h)));
          return true;
        }}
      />

      {gamut.mapped ? (
        <p className="ts-hint" id={`${idBase}-picker-gamut-note`}>
          Chroma above the sRGB screen gamut is kept in the theme. Screens show the closest in-gamut color, ΔEOK {gamut.deltaE.toFixed(3)}.
        </p>
      ) : null}
      {advisory.length ? (
        <p className="ts-hint" id={`${idBase}-picker-range-warning`} role="status">
          <strong>Outside the suggested range for this role:</strong>
          {' '}
          {advisory.map((a) => `${a.field === 'l' ? 'lightness' : 'chroma'} ${a.value.toFixed(3)} (suggested ${a.min} to ${a.max})`).join(', ')}
          . Turn on Full range to hide this.
        </p>
      ) : null}
      <p className="ts-hint">Paste a hex, rgb() or hsl() color anywhere in this panel.</p>
    </div>
  );
}
