'use client';

import React, { useEffect, useRef, useState } from 'react';
import { formatNumber, parseNumberInput, stepDecimals } from '../../../lib/theme-studio/format.js';
import { sliderKeyStep } from '../../../lib/theme-studio/keymap.js';
import { useStudio } from '../StudioContext.jsx';

/**
 * Numeric text field paired with a slider. Commits on Enter or blur; Escape
 * reverts. Out-of-range input wraps (hue) or clamps, and says so in the live region.
 * Arrow keys inside the field step the value like the slider does.
 */
export default function NumericField({
  id, label, value, min, max, step = 1, page, wrap = false, disabled = false, wide = false, onCommit, onEnd,
}) {
  const { announce } = useStudio();
  const dp = Math.max(stepDecimals(step), 2);
  const shown = formatNumber(value, dp);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setText(shown);
      setInvalid(false);
    }
  }, [shown]);

  const commit = () => {
    const r = parseNumberInput(text, { min, max, wrap, dp });
    if (!r.ok) {
      setInvalid(true);
      announce(`${label}: ${r.message}`);
      setText(shown);
      return;
    }
    setInvalid(false);
    if (r.message) announce(`${label}: ${r.message}`);
    setText(formatNumber(r.value, dp));
    if (r.value !== value) onCommit(r.value, 'set');
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`ts-num${wide ? ' ts-num--wide' : ''}`}
      aria-label={`${label}, value`}
      aria-invalid={invalid ? 'true' : undefined}
      disabled={disabled}
      value={text}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => { setText(e.target.value); setInvalid(false); }}
      onBlur={() => { focused.current = false; commit(); onEnd && onEnd(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
        if (e.key === 'Escape') {
          if (text !== shown) { e.stopPropagation(); setText(shown); setInvalid(false); }
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
          const v = sliderKeyStep(e.key, { value, min, max, step, page, shift: e.shiftKey, wrap });
          if (v !== null) { e.preventDefault(); if (v !== value) onCommit(v, 'key'); setText(formatNumber(v, dp)); }
        }
      }}
    />
  );
}
