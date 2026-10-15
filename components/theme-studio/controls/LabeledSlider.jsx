'use client';

import React, { useEffect, useRef } from 'react';
import NumericField from './NumericField.jsx';
import { sliderKeyStep } from '../../../lib/theme-studio/keymap.js';
import { valueText } from '../../../lib/theme-studio/format.js';

/**
 * Slider with a visible label, a numeric field and a hint.
 *   onValue(v, kind)  kind: 'drag' (pointer, transient) | 'key' (keyboard, coalesced) | 'set' (typed)
 *   onEnd()           pointer released / blurred / key released: closes the drag => one undo entry
 * Arrow keys step, Shift x10, PageUp/PageDown, Home/End are handled here so
 * Shift works and hue can wrap.
 */
export default function LabeledSlider({
  id, label, description, value, min, max, step = 1, page, wrap = false, unit, kind: textKind = 'unit',
  trackBackground, disabled = false, onValue, onEnd, headExtra,
}) {
  const pointer = useRef(false);
  const cleanup = useRef(null);
  const hintId = description ? `${id}-hint` : undefined;

  useEffect(() => () => { if (cleanup.current) cleanup.current(); }, []);

  const finish = () => {
    pointer.current = false;
    if (cleanup.current) { cleanup.current(); cleanup.current = null; }
    onEnd && onEnd();
  };

  const onPointerDown = () => {
    pointer.current = true;
    // The pointer can be released outside the input; listen on the window until it is.
    const up = () => finish();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    cleanup.current = () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  };

  const style = trackBackground ? { '--ts-track': trackBackground } : undefined;

  return (
    <div className="ts-field" id={`${id}-field`}>
      <div className="ts-field-head">
        <label className="ts-label" htmlFor={id}>
          {label}
        </label>
        <span className="ts-numwrap">
          {headExtra}
          <NumericField
            id={`${id}-number`}
            label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            page={page}
            wrap={wrap}
            disabled={disabled}
            onCommit={onValue}
            onEnd={onEnd}
          />
          {unit ? <span className="ts-unit" aria-hidden="true">{unit}</span> : null}
        </span>
      </div>
      <input
        id={id}
        className="ts-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={style}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText(textKind, value, 2)}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onChange={(e) => onValue(Number(e.target.value), pointer.current ? 'drag' : 'key')}
        onBlur={finish}
        onKeyUp={() => onEnd && onEnd()}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const v = sliderKeyStep(e.key, { value, min, max, step, page, shift: e.shiftKey, wrap });
          if (v === null) return;
          e.preventDefault();
          if (v !== value) onValue(v, 'key');
        }}
      />
      {description ? <p className="ts-hint" id={hintId}>{description}</p> : null}
    </div>
  );
}
