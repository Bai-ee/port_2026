'use client';

import React from 'react';
import Section from '../controls/Section.jsx';
import HueSlider from '../controls/HueSlider.jsx';
import LabeledSlider from '../controls/LabeledSlider.jsx';
import Swatch from '../controls/Swatch.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair,
} from '../StudioContext.jsx';
import { setMasterHue, setIntensity } from '../../../lib/theme/index.js';
import { MODE_LABEL } from '../../../lib/theme-studio/view-models.js';

const SHOWN = [
  ['accent', 'Accent'],
  ['accent-bright', 'Bright'],
  ['support-1', 'Support 1'],
  ['support-2', 'Support 2'],
];

export default function MasterSection() {
  const { edit, endEdit } = useStudio();
  const draft = useDraft();
  const mode = useEditingMode();
  const pair = useResolvedPair();
  if (!draft || !pair) return null;
  const { hue, intensity } = draft.master;
  const roles = pair[mode].roles;
  const accent = roles.accent.oklch;

  return (
    <Section id="master" num="02" title="Master hue" summary={`${Math.round(hue)}°, intensity ${intensity}`}>
      <p className="ts-p">
        Move one slider and the accent, supporting colors and decorative ramps follow together in
        {' '}
        <strong>both</strong>
        {' '}
        palettes. Custom and locked colors stay put. Status colors never follow.
      </p>
      <HueSlider
        id="theme-studio-master-hue"
        label="Master hue"
        value={hue}
        trackL={accent.l}
        trackC={Math.max(accent.c, 0.08)}
        description="0 to 360 degrees. Typing a value outside the range wraps around the color wheel."
        onValue={(v, kind) => edit((d) => setMasterHue(d, v), { kind, label: 'Master hue', coalesceKey: 'master-hue' })}
        onEnd={endEdit}
      />
      <LabeledSlider
        id="theme-studio-master-intensity"
        label="Intensity"
        value={intensity}
        min={0}
        max={1.5}
        step={0.01}
        page={0.1}
        kind="factor"
        description="0 is grey, 1 matches today, 1.5 is punchy. Colors that cannot reach this saturation are brought back to the nearest displayable color."
        trackBackground="linear-gradient(to right, var(--ts-bg-sunken), var(--ts-line-strong))"
        onValue={(v, kind) => edit((d) => setIntensity(d, v), { kind, label: 'Intensity', coalesceKey: 'master-intensity' })}
        onEnd={endEdit}
      />
      <div className="ts-stack--tight ts-stack" id="theme-studio-master-result-row">
        <p className="ts-sub">Result, {MODE_LABEL[mode]} palette</p>
        <div className="ts-swatchrow">
          {SHOWN.map(([id, label]) => (
            <figure key={id}>
              <Swatch color={roles[id].value} size="lg" />
              <figcaption>{label}</figcaption>
              <code>{roles[id].hex}</code>
            </figure>
          ))}
        </div>
      </div>
    </Section>
  );
}
