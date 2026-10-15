'use client';

import React from 'react';
import Section from '../controls/Section.jsx';
import LabeledSlider from '../controls/LabeledSlider.jsx';
import ModeSwitch from '../controls/ModeSwitch.jsx';
import OklchEditor from '../controls/OklchEditor.jsx';
import Swatch from '../controls/Swatch.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair,
} from '../StudioContext.jsx';
import {
  setSceneSource, setSceneFollow, setSceneCustom, resetScene, hexToOklch,
} from '../../../lib/theme/index.js';
import { MODE_LABEL } from '../../../lib/theme-studio/view-models.js';
import { oklchHex } from '../../../lib/theme-studio/color-fields.js';

function ColorBlock({ idBase, title, color, mode, field, allowAlpha = false }) {
  const { edit, endEdit } = useStudio();
  const patchScene = (patch, kind) => edit(
    (d) => setSceneCustom(d, mode, { [field]: patch }),
    { kind, label: `${mode} scene ${title}`, coalesceKey: `scene-${mode}-${field}` },
  );
  return (
    <div className="ts-stack">
      <p className="ts-sub">{title}</p>
      <OklchEditor
        idBase={idBase}
        label={`${MODE_LABEL[mode]} scene ${title}`}
        value={{ ...color, a: 1 }}
        hex={oklchHex(color)}
        showAlpha={allowAlpha}
        onPatch={patchScene}
        onHex={(hex) => {
          const o = hexToOklch(hex, color.h);
          if (o) edit((d) => setSceneCustom(d, mode, { [field]: { l: o.l, c: o.c, h: o.h } }), { kind: 'set', label: `${mode} scene ${title} hex` });
        }}
        onEnd={endEdit}
      />
    </div>
  );
}

function SceneCard({ mode, editing, def, resolved }) {
  const { edit, endEdit, announce } = useStudio();
  const sc = def.scene[mode];
  const rs = resolved[mode].scene;
  const idBase = `theme-studio-scene-${mode}`;
  const follow = sc.follow;
  const custom = sc.custom;

  const setFollow = (key, label, min, max, step, extra = {}) => (
    <LabeledSlider
      id={`${idBase}-${key}`}
      label={label}
      value={follow[key]}
      min={min}
      max={max}
      step={step}
      page={step * 10}
      onValue={(v, kind) => edit((d) => setSceneFollow(d, mode, { [key]: v }), { kind, label: `${mode} scene ${label}`, coalesceKey: `scene-${mode}-${key}` })}
      onEnd={endEdit}
      {...extra}
    />
  );

  return (
    <div className={`ts-card${editing ? ' ts-card--editing' : ''}`} id={`${idBase}-card`}>
      <div className="ts-card-head">
        <h4 className="ts-card-title">{MODE_LABEL[mode]} background</h4>
        <span className={`ts-badge${editing ? ' ts-badge--linked' : ''}`}>
          {editing ? <><Icon name="pencil" size={12} /> Editing</> : 'Not being edited'}
        </span>
      </div>
      <ModeSwitch
        id={`${idBase}-source`}
        label={`${MODE_LABEL[mode]} background source`}
        value={sc.source}
        block
        onChange={(v) => edit((d) => setSceneSource(d, mode, v), { kind: 'set', label: `${mode} scene source` })}
        options={[{ value: 'follow', label: 'Follow theme' }, { value: 'custom', label: 'Custom palette' }]}
      />
      {sc.source === 'follow' ? (
        <div className="ts-stack">
          <p className="ts-hint">The animated background takes the master hue, then these adjustments.</p>
          {setFollow('hueShiftDeg', 'Hue shift', -180, 180, 1, { unit: '°', kind: 'degrees' })}
          {setFollow('saturationMul', 'Saturation', 0, 1.5, 0.01, { kind: 'factor' })}
          {setFollow('lightnessDelta', 'Lightness change', -0.5, 0.5, 0.01)}
          {setFollow('opacityMul', 'Opacity', 0, 3, 0.05, { kind: 'factor' })}
          {setFollow('hueSpan', 'Hue travel over time', 0.05, 1, 0.01, { kind: 'turns', description: 'How far around the color wheel the particles drift. The baseline is 0.8 turns.' })}
        </div>
      ) : (
        <div className="ts-stack">
          <ColorBlock idBase={`${idBase}-base`} title="Base color" color={custom.base} mode={mode} field="base" />
          <Toggle
            id={`${idBase}-secondary-toggle`}
            label="Use a second color"
            description="The particles drift from the base color toward this one."
            checked={!!custom.secondary}
            onChange={(on) => edit(
              (d) => setSceneCustom(d, mode, { secondary: on ? { l: custom.base.l, c: custom.base.c, h: (custom.base.h + 60) % 360 } : null }),
              { kind: 'set', label: `${mode} scene second color` },
            )}
          />
          {custom.secondary ? (
            <ColorBlock idBase={`${idBase}-secondary`} title="Second color" color={custom.secondary} mode={mode} field="secondary" />
          ) : null}
          <ColorBlock idBase={`${idBase}-highlight`} title="Highlight color" color={custom.highlight} mode={mode} field="highlight" />
          <LabeledSlider
            id={`${idBase}-highlight-strength`}
            label="Highlight strength"
            value={custom.highlightStrength}
            min={0}
            max={1}
            step={0.01}
            page={0.1}
            description="0 turns the highlight off."
            onValue={(v, kind) => edit((d) => setSceneCustom(d, mode, { highlightStrength: v }), { kind, label: `${mode} scene highlight strength`, coalesceKey: `scene-${mode}-hs` })}
            onEnd={endEdit}
          />
          <LabeledSlider
            id={`${idBase}-opacity`}
            label="Opacity"
            kind="factor"
            value={custom.opacityMul}
            min={0}
            max={3}
            step={0.05}
            page={0.25}
            onValue={(v, kind) => edit((d) => setSceneCustom(d, mode, { opacityMul: v }), { kind, label: `${mode} scene opacity`, coalesceKey: `scene-${mode}-op` })}
            onEnd={endEdit}
          />
        </div>
      )}
      <div className="ts-stack--tight ts-stack">
        <p className="ts-sub">Resulting scene colors</p>
        <div className="ts-swatchrow" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[['Base', rs.swatches.base], ['Second', rs.swatches.secondary], ['Highlight', rs.swatches.highlight]].map(([n, hex]) => (
            <figure key={n}>
              <Swatch color={hex} size="lg" />
              <figcaption>{n}</figcaption>
              <code>{hex}</code>
            </figure>
          ))}
        </div>
      </div>
      <div className="ts-btn-row">
        <button
          type="button"
          className="ts-btn ts-btn--sm"
          onClick={() => { edit((d) => resetScene(d, mode), { kind: 'set', label: `Reset ${mode} scene` }); announce(`${MODE_LABEL[mode]} background reset.`); }}
        >
          <Icon name="reset" size={14} /> Reset {mode} background
        </button>
      </div>
    </div>
  );
}

export default function SceneSection() {
  const draft = useDraft();
  const mode = useEditingMode();
  const pair = useResolvedPair();
  if (!draft || !pair) return null;
  const other = mode === 'light' ? 'dark' : 'light';
  return (
    <Section id="scene" num="04" title="Background object" summary={`${draft.scene[mode].source === 'custom' ? 'Custom' : 'Follows theme'} (${mode})`}>
      <p className="ts-p">
        The animated background has its own colors for Light and Dark. Changes use the existing background, so no second
        canvas is created.
      </p>
      <SceneCard mode={mode} editing def={draft} resolved={pair} />
      <SceneCard mode={other} editing={false} def={draft} resolved={pair} />
    </Section>
  );
}
