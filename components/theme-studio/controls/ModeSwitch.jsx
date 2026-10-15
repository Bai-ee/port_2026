'use client';

import React, { useRef } from 'react';

/**
 * Segmented single-choice control (radiogroup). Arrow keys move and select,
 * Home/End jump. With no value selected the first option is the tab stop.
 */
export default function ModeSwitch({
  id, label, options, value, onChange, block = false, disabled = false, hideLabel = true,
}) {
  const refs = useRef([]);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const move = (from, dir) => {
    const n = options.length;
    const next = dir === 'home' ? 0 : dir === 'end' ? n - 1 : (from + dir + n) % n;
    onChange(options[next].value);
    const el = refs.current[next];
    if (el) el.focus();
  };
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className={`ts-seg${block ? ' ts-seg--block' : ''}`}
      data-hide-label={hideLabel ? 'true' : undefined}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          id={`${id}-${String(o.value)}`}
          aria-checked={o.value === value ? 'true' : 'false'}
          tabIndex={o.value === value || (checkedIndex < 0 && i === 0) ? 0 : -1}
          disabled={disabled || o.disabled}
          className="ts-seg-btn"
          title={o.hint}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            else if (e.key === 'Home') { e.preventDefault(); move(i, 'home'); }
            else if (e.key === 'End') { e.preventDefault(); move(i, 'end'); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
