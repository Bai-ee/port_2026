'use client';

import React, { useEffect, useRef, useState } from 'react';
import LabeledSlider from './LabeledSlider.jsx';
import Swatch from './Swatch.jsx';
import { axisTrackGradient, normalizeHexInput } from '../../../lib/theme-studio/color-fields.js';
import { formatOklch } from '../../../lib/theme-studio/format.js';
import { useStudio } from '../StudioContext.jsx';

/** HEX text field: commits a valid color on Enter or blur, otherwise reverts and says so. */
export function HexField({
  id, label, hex, disabled, onCommit,
}) {
  const { announce } = useStudio();
  const [text, setText] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) { setText(hex); setInvalid(false); }
  }, [hex]);
  const commit = () => {
    const n = normalizeHexInput(text);
    if (!n) {
      setInvalid(true);
      announce(`${label}: not a valid hex color. Use three or six hex digits.`);
      setText(hex);
      return;
    }
    setInvalid(false);
    setText(n);
    if (n !== hex) onCommit(n);
  };
  return (
    <input
      id={id}
      type="text"
      className="ts-input ts-hexfield"
      aria-label={`${label}, hex`}
      aria-invalid={invalid ? 'true' : undefined}
      autoComplete="off"
      spellCheck={false}
      maxLength={9}
      disabled={disabled}
      value={text}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => { setText(e.target.value); setInvalid(false); }}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape' && text !== hex) { e.stopPropagation(); setText(hex); setInvalid(false); }
      }}
    />
  );
}

/**
 * HEX plus OKLCH lightness / chroma / hue (and optional opacity) for one color.
 * Used for custom roles and custom scene colors.
 *   onPatch({l|c|h|a}, kind)   onHex(hex)   onEnd()
 */
export default function OklchEditor({
  idBase, label, value, hex, onPatch, onHex, onEnd, hueDisabled = false, hueNote, showAlpha = false, disabled = false,
}) {
  return (
    <div className="ts-oklch" id={`${idBase}-oklch`}>
      <div className="ts-oklch-head">
        <Swatch color={hex} />
        <HexField id={`${idBase}-hex`} label={label} hex={hex} disabled={disabled} onCommit={onHex} />
        <span className="ts-hint" style={{ fontFamily: 'var(--ts-mono)' }}>{formatOklch(value)}</span>
      </div>
      <LabeledSlider
        id={`${idBase}-l`}
        label="Lightness"
        value={value.l}
        min={0}
        max={1}
        step={0.005}
        page={0.05}
        trackBackground={axisTrackGradient('l', value)}
        disabled={disabled}
        onValue={(v, k) => onPatch({ l: v }, k)}
        onEnd={onEnd}
      />
      <LabeledSlider
        id={`${idBase}-c`}
        label="Chroma"
        value={value.c}
        min={0}
        max={0.4}
        step={0.005}
        page={0.04}
        trackBackground={axisTrackGradient('c', value)}
        disabled={disabled}
        onValue={(v, k) => onPatch({ c: v }, k)}
        onEnd={onEnd}
      />
      <LabeledSlider
        id={`${idBase}-h`}
        label="Hue"
        unit="°"
        kind="degrees"
        value={value.h}
        min={0}
        max={360}
        step={1}
        page={15}
        wrap
        description={hueDisabled ? (hueNote || 'Hue is fixed to keep the meaning of this color.') : undefined}
        trackBackground={axisTrackGradient('h', value)}
        disabled={disabled || hueDisabled}
        onValue={(v, k) => onPatch({ h: v }, k)}
        onEnd={onEnd}
      />
      {showAlpha ? (
        <LabeledSlider
          id={`${idBase}-a`}
          label="Opacity"
          value={value.a}
          min={0}
          max={1}
          step={0.01}
          page={0.1}
          disabled={disabled}
          onValue={(v, k) => onPatch({ a: v }, k)}
          onEnd={onEnd}
        />
      ) : null}
    </div>
  );
}
