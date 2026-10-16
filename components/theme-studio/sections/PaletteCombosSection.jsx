'use client';

import React, { useMemo, useState } from 'react';
import Section from '../controls/Section.jsx';
import { useStudio, useDraft, useEditingMode } from '../StudioContext.jsx';
import {
  PALETTE_PRESETS, presetSwatches, activePalettePreset, applyCombo,
} from '../../../lib/theme-studio/palette-presets.js';
import { HARMONIES, getHarmony, buildHarmonyPatch, shufflePatch } from '../../../lib/theme-studio/harmony.js';
import { MODE_LABEL } from '../../../lib/theme-studio/view-models.js';

/**
 * Click-to-try palette combos. Each card previews five resolved roles for the
 * palette being edited; clicking applies the combo's patch to the draft as one
 * undo entry. Custom and locked roles are untouched (applyCombo).
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
  const [harmony, setHarmony] = useState('triad');
  // null = follow the master hue; a number = a chosen seed hue.
  const [seedHue, setSeedHue] = useState(null);
  // Shuffle seed: what the NEXT Shuffle will use (editable), and the one last used.
  const [nextSeed, setNextSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [lastSeed, setLastSeed] = useState(null);
  const masterHue = draft ? draft.master.hue : 0;
  const effectiveSeed = seedHue == null ? masterHue : seedHue;
  const harmonyPreview = useMemo(() => {
    if (!draft) return [];
    const patch = buildHarmonyPatch(draft, { harmony, seedHue: effectiveSeed });
    return presetSwatches(draft, { patch }, mode);
  }, [draft, harmony, effectiveSeed, mode]);
  const protectedRoles = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const m of Object.keys(draft.modes)) {
      for (const r of Object.values(draft.modes[m].roles)) if (r.locked || r.link === 'custom') n += 1;
    }
    return n;
  }, [draft]);
  if (!draft) return null;

  const tryCombo = (p) => {
    edit((d) => applyCombo(d, p), { kind: 'set', label: `Combo: ${p.name}` });
    announce(`${p.name} applied to both palettes. Undo to go back.`);
  };

  const generate = () => {
    const h = getHarmony(harmony);
    const patch = buildHarmonyPatch(draft, { harmony, seedHue: effectiveSeed });
    edit((d) => applyCombo(d, { patch }), { kind: 'set', label: `Harmony: ${h.name}` });
    announce(`${h.name} harmony applied at hue ${patch.hue}. Undo to go back.`);
  };
  const shuffle = () => {
    // The patch is a pure function of the seed, so typing the same seed reproduces a combo.
    const seed = Math.abs(Math.floor(Number(nextSeed))) || 0;
    const patch = shufflePatch(draft, { seed });
    edit((d) => applyCombo(d, { patch }), { kind: 'set', label: `Combo: Shuffle (seed ${seed})` });
    setLastSeed(seed);
    setNextSeed(Math.floor(Math.random() * 100000));
    announce(`Shuffled a new combo with seed ${seed}. Undo to go back.`);
  };

  return (
    <Section id="combos" num="03" title="Palette combos" summary={active ? PALETTE_PRESETS.find((p) => p.id === active).name : 'Custom mix'}>
      <p className="ts-p">
        Click a combo to try it live. Each one sets the master hue, intensity, support offsets and
        neutral tint for <strong>both</strong> palettes; exact combos (Happy Hues) also pin their light-palette colors.
        Custom and locked colors stay put. One click is one undo.
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

      <div id="ts-harmony-builder" data-section="harmony-builder">
        <p className="ts-sub">Build a combo from a color harmony</p>
        <div className="ts-field" id="ts-harmony-controls-row">
          <label htmlFor="ts-harmony-select">Harmony</label>
          <select id="ts-harmony-select" value={harmony} onChange={(e) => setHarmony(e.target.value)}>
            {HARMONIES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <label htmlFor="ts-harmony-seed-hue">Seed hue</label>
          <input
            id="ts-harmony-seed-hue"
            type="number"
            min={0}
            max={360}
            step={1}
            value={Math.round(effectiveSeed)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setSeedHue(((v % 360) + 360) % 360);
            }}
          />
          <button
            type="button"
            className="ts-btn ts-btn--ghost ts-btn--sm"
            id="ts-harmony-use-master"
            disabled={seedHue == null}
            onClick={() => setSeedHue(null)}
          >
            use master ({Math.round(masterHue)})
          </button>
        </div>
        <p className="ts-sub" id="ts-harmony-note">{getHarmony(harmony).note}</p>
        <span className="ts-combo-strip" id="ts-harmony-preview-strip" aria-hidden="true">
          {harmonyPreview.map((hex, i) => <i key={i} style={{ background: hex }} />)}
        </span>
        <div className="ts-field" id="ts-harmony-actions-row">
          <button type="button" className="ts-btn ts-btn--sm" id="ts-harmony-generate" onClick={generate}>Generate</button>
          <button type="button" className="ts-btn ts-btn--sm" id="ts-harmony-shuffle" onClick={shuffle}>Shuffle</button>
          <label htmlFor="ts-harmony-shuffle-seed">Seed</label>
          <input
            id="ts-harmony-shuffle-seed"
            type="number"
            min={0}
            step={1}
            style={{ width: 84 }}
            value={nextSeed}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setNextSeed(Math.max(0, Math.floor(v))); }}
          />
        </div>
        <p className="ts-sub" id="ts-harmony-seed-note">
          Shuffle uses the seed shown and then picks a new one. {lastSeed == null ? 'Type a seed to reproduce a combo.' : `Last shuffle used seed ${lastSeed}; type it back to get the same combo.`}
        </p>
        <p className="ts-sub" id="ts-harmony-lock-hint">
          Generate and Shuffle set hue, offsets and neutral tint only. {protectedRoles
            ? `${protectedRoles} locked or custom role${protectedRoles === 1 ? ' is' : 's are'} left untouched.`
            : 'Roles you lock or set to a custom color are left untouched.'} One press is one undo.
        </p>
      </div>
    </Section>
  );
}
