'use client';

import React from 'react';
import { useStudio } from '../StudioContext.jsx';

/** A color chip over a checkerboard, so translucent colors read honestly. */
export default function Swatch({ color, size, title }) {
  const cls = `ts-swatch${size === 'sm' ? ' ts-swatch--sm' : size === 'lg' ? ' ts-swatch--lg' : ''}`;
  return (
    <span className={cls} title={title}>
      <i style={{ background: color }} />
    </span>
  );
}

/** Read-only HEX with a copy button. */
export function SwatchCopy({ hex, label }) {
  const { copyText } = useStudio();
  return (
    <button type="button" className="ts-swatch-btn" aria-label={`Copy ${label ? `${label} ` : ''}${hex}`} onClick={() => copyText(hex, `${label ? `${label} ` : ''}${hex}`)}>
      <Swatch color={hex} size="sm" />
      <span>{hex}</span>
    </button>
  );
}

/**
 * Swatch that opens the color picker. A real button (keyboard + screen reader),
 * marked as a picker trigger so an outside-click on it does not double-close.
 */
export const SwatchButton = React.forwardRef(function SwatchButton({
  id, color, label, expanded = false, size, onClick, mapped = false,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      id={id}
      className="ts-swatch-btn"
      data-ts-picker-trigger="true"
      aria-haspopup="dialog"
      aria-expanded={expanded ? 'true' : 'false'}
      aria-label={`Edit ${label} in the color picker`}
      onClick={onClick}
    >
      <Swatch color={color} size={size} />
      {mapped ? <GamutTag /> : null}
    </button>
  );
});

/** Small tag shown when the displayed color is the gamut-mapped version of the authored one. */
export function GamutTag({ id }) {
  return (
    <span
      id={id}
      className="ts-badge ts-badge--advisory"
      title="This chroma is outside the sRGB screen gamut. The color shown is the closest in-gamut match."
      style={{ height: 16, padding: '0 5px', fontSize: 10 }}
    >
      gamut-mapped
    </span>
  );
}
