'use client';

import React, { useMemo } from 'react';
import LabeledSlider from './LabeledSlider.jsx';
import { hueTrackGradient } from '../../../lib/theme-studio/color-fields.js';

/** 0 to 360 degrees, wraps. The track shows the current lightness and chroma at every hue. */
export default function HueSlider({
  id, label, description, value, trackL = 0.7, trackC = 0.12, min = 0, max = 360, onValue, onEnd, disabled,
}) {
  const bg = useMemo(() => hueTrackGradient(trackL, trackC), [trackL, trackC]);
  return (
    <LabeledSlider
      id={id}
      label={label}
      description={description}
      value={value}
      min={min}
      max={max}
      step={1}
      page={15}
      wrap
      unit="°"
      kind="degrees"
      trackBackground={bg}
      disabled={disabled}
      onValue={onValue}
      onEnd={onEnd}
    />
  );
}
