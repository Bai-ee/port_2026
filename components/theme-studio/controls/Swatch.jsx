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
