'use client';

import React, { useMemo } from 'react';
import Section from '../controls/Section.jsx';
import { useStudio, useDraft, useEditingMode } from '../StudioContext.jsx';
import { applyPalettePreset } from '../../../lib/theme/index.js';
import {
  PALETTE_PRESETS, presetSwatches, activePalettePreset,
} from '../../../lib/theme-studio/palette-presets.js';
import { MODE_LABEL } from '../../../lib/theme-studio/view-models.js';

/**
 * Click-to-try palette combos. Each card previews five resolved roles for the
 * palette being edited; clicking applies the combo's patch to the draft as one
 * undo entry. Custom and locked roles are untouched (applyPalettePreset).
 */
export default function PaletteCombosSection() {
  const { edit, announce } = useStudio();
  const draft = useDraft();
  const mode = useEditingMode();

  const cards = useMemo(() => {
    if (!draft) return [];
    return PALETTE_PRESETS.map((p) => ({ preset: p, swatches: presetSwatches(draft, p, mode) }));
  }, [draft, mode]);
  const active = useMemo(() => activePalettePreset(draft), [draft]);
  if (!draft) return null;

  const tryCombo = (p) => {
    edit((d) => applyPalettePreset(d, p), { kind: 'set', label: `Combo: ${p.name}` });
    announce(`${p.name} applied to both palettes. Undo to go back.`);
  };

  return (
    <Section id="combos" num="01b" title="Palette combos" summary={active ? PALETTE_PRESETS.find((p) => p.id === active).name : 'Custom mix'}>
      <p className="ts-p">
        Click a combo to try it live. Each one sets the master hue, intensity, support offsets and
        neutral tint for <strong>both</strong> palettes. Custom and locked colors stay put. One click is one undo.
      </p>
      <p className="ts-sub">Previewing the {MODE_LABEL[mode]} palette: page · accent · bright · support 1 · support 2</p>
      <div className="ts-combo-grid" id="theme-studio-palette-combos-grid" role="list">
        {cards.map(({ preset, swatches }) => (
          <button
            key={preset.id}
            type="button"
            role="listitem"
            className={`ts-combo${active === preset.id ? ' ts-combo--active' : ''}`}
            id={`theme-studio-combo-${preset.id}`}
            aria-pressed={active === preset.id ? 'true' : 'false'}
            title={preset.note}
            onClick={() => tryCombo(preset)}
          >
            <span className="ts-combo-strip" aria-hidden="true">
              {swatches.map((hex, i) => <i key={i} style={{ background: hex }} />)}
            </span>
            <span className="ts-combo-name">{preset.name}</span>
            <span className="ts-combo-note">{preset.note}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}
