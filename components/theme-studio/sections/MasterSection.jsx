'use client';

import React from 'react';
import Section from '../controls/Section.jsx';
import HueSlider from '../controls/HueSlider.jsx';
import LabeledSlider from '../controls/LabeledSlider.jsx';
import Swatch from '../controls/Swatch.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair,
} from '../StudioContext.jsx';
import { MODE_LABEL, masterKnobModels } from '../../../lib/theme-studio/view-models.js';

const SHOWN = [
  ['accent', 'Accent'],
  ['accent-bright', 'Bright'],
  ['support-1', 'Support 1'],
  ['support-2', 'Support 2'],
];

// Plain-language hint under each knob. Where the knob writes is documented in MASTER_KNOBS.
const HINTS = {
  hue: '0 to 360 degrees. Typing a value outside the range wraps around the color wheel.',
  intensity: '0 is grey, 1 matches today, 1.5 is punchy. Colors that cannot reach this saturation are brought back to the nearest displayable color.',
  lightness: 'Lighter or darker accent, supporting and decorative colors in both palettes. 0 matches today.',
  contrast: 'Pushes linked surfaces, text and neutrals away from mid grey (above 1) or toward it (below 1) in both palettes. 1 matches today.',
  chroma: 'Multiplies the color strength of accent, supporting and decorative colors in both palettes. 1 matches today.',
  'warmth-hue': 'The tint carried by pages, surfaces and ink. An absolute hue unless the tint follows the master hue (Accent, supporting and neutrals). Baseline 56.',
  'warmth-strength': '0 removes the warm tint from pages, surfaces and ink. 1 matches today.',
  'hue-spread': 'Scales how far the bright accent and the two supporting colors sit from the master hue. 1 matches today, 0 collapses them onto it.',
  'dark-depth': 'Darker (positive) or lighter (negative) page, surface, raised and inset colors in the dark palette only. 0 matches today.',
};

const GROUPS = [
  { id: 'color', title: 'Color', ids: ['hue', 'intensity', 'chroma', 'lightness'] },
  { id: 'tone', title: 'Tone and depth', ids: ['contrast', 'dark-depth'] },
  { id: 'harmony', title: 'Warmth and hue spread', ids: ['warmth-hue', 'warmth-strength', 'hue-spread'] },
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
  const knobs = masterKnobModels(draft, mode);
  const byId = Object.fromEntries(knobs.map((k) => [k.id, k]));

  const resetButton = (k) => (
    <button
      type="button"
      id={`ts-master-${k.id}-reset`}
      className="ts-btn ts-btn--sm ts-btn--ghost"
      aria-label={`Reset ${k.label} to ${k.def}`}
      disabled={k.atDefault}
      onClick={() => edit((d) => k.write(d, k.def, mode), { kind: 'set', label: `Reset ${k.label}` })}
    >
      Reset
    </button>
  );

  const renderKnob = (id) => {
    const k = byId[id];
    const common = {
      id: k.domId,
      label: k.label,
      description: HINTS[id],
      value: k.value,
      headExtra: resetButton(k),
      onValue: (v, kind) => edit((d) => k.write(d, v, mode), { kind, label: k.label, coalesceKey: `master-${k.id}` }),
      onEnd: endEdit,
    };
    if (k.wrap) {
      const tint = id === 'hue';
      return (
        <HueSlider
          key={id}
          {...common}
          trackL={tint ? accent.l : 0.82}
          trackC={tint ? Math.max(accent.c, 0.08) : 0.07}
        />
      );
    }
    return (
      <LabeledSlider
        key={id}
        {...common}
        min={k.min}
        max={k.max}
        step={k.step}
        page={k.page}
        kind={k.kind}
        trackBackground={id === 'intensity' ? 'linear-gradient(to right, var(--ts-bg-sunken), var(--ts-line-strong))' : undefined}
      />
    );
  };

  return (
    <Section id="master" num="02" title="Master controls" summary={`${Math.round(hue)}°, intensity ${intensity}`}>
      <div className="ts-stack" id="ts-master-v2-section">
        <p className="ts-p">
          Move one slider and the accent, supporting colors and decorative ramps follow together in
          {' '}
          <strong>both</strong>
          {' '}
          palettes. Custom and locked colors stay put. Status colors never follow. Each slider has its own Reset.
        </p>
        {GROUPS.map((g) => (
          <div className="ts-stack" id={`ts-master-${g.id}-group`} key={g.id}>
            <p className="ts-sub">{g.title}</p>
            {g.ids.map(renderKnob)}
          </div>
        ))}
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
      </div>
    </Section>
  );
}
