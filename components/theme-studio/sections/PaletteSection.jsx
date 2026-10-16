'use client';

import React from 'react';
import Section from '../controls/Section.jsx';
import LabeledSlider from '../controls/LabeledSlider.jsx';
import ModeSwitch from '../controls/ModeSwitch.jsx';
import Swatch from '../controls/Swatch.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import { KindBadge } from '../controls/LinkToggle.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair,
} from '../StudioContext.jsx';
import { setOffset, setNeutral, setModeSettings, getRoleDef } from '../../../lib/theme/index.js';
import {
  PALETTE_GROUPS, groupLinkState, resetRoles, offsetLabel, neutralHueLabel, MODE_LABEL,
} from '../../../lib/theme-studio/view-models.js';
import { roleKind, KIND_LABEL } from '../../../lib/theme-studio/role-state.js';

function GroupBlock({ group, def, mode, resolved }) {
  const { edit, dispatch, announce } = useStudio();
  const gs = groupLinkState(def, mode, group.ids);
  const badgeKind = gs.state === 'mixed' ? 'mixed' : gs.state;
  return (
    <div className="ts-card" id={`theme-studio-palette-${group.id}-card`}>
      <div className="ts-card-head">
        <div>
          <h4 className="ts-card-title">{group.label}</h4>
          <p className="ts-hint">{group.note}</p>
        </div>
        <span className={`ts-badge ts-badge--${badgeKind}`} id={`theme-studio-palette-${group.id}-badge`}>
          {gs.state === 'mixed' ? gs.label : <><Icon name={gs.state === 'locked' ? 'lock' : gs.state === 'custom' ? 'pencil' : 'link'} size={12} />{gs.label}</>}
        </span>
      </div>
      <ul className="ts-role-list" aria-label={`${group.label} colors`}>
        {group.ids.map((id) => {
          const r = resolved.roles[id];
          const kind = roleKind(def.modes[mode].roles[id]);
          const rd = getRoleDef(id);
          return (
            <li className="ts-role" key={id}>
              <button
                type="button"
                className="ts-role-head"
                id={`ts-palette-role-${id}-head`}
                onClick={(e) => {
                  // The swatch opens the color picker on the role (in Advanced); the rest of the row just reveals it.
                  dispatch({ type: 'role/reveal', id, group: rd.group });
                  if (e.target instanceof Element && e.target.closest('.ts-role-swatches')) dispatch({ type: 'colorPicker/open', roleId: id, mode });
                }}
                aria-label={`${r.css}, ${KIND_LABEL[kind]}, ${r.hex}. Open in Advanced. Click the swatch to pick a color`}
              >
                <span className="ts-role-swatches" aria-hidden="true" data-ts-picker-trigger="true"><Swatch color={r.value} /></span>
                <span className="ts-role-main">
                  <span className="ts-role-name">{r.css}</span>
                  <span className="ts-role-use">{r.hex}</span>
                </span>
                <span className="ts-role-meta"><KindBadge kind={kind} /></span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ts-btn-row">
        <button
          type="button"
          className="ts-btn ts-btn--sm"
          disabled={!gs.resettable}
          onClick={() => {
            edit((d) => resetRoles(d, mode, group.ids), { kind: 'set', label: `Reset ${group.label}` });
            announce(`${group.label} reset to linked. Locked roles were kept.`);
          }}
        >
          <Icon name="reset" size={14} /> Reset {group.label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

export default function PaletteSection() {
  const { edit, endEdit, ui, dispatch, announce } = useStudio();
  const draft = useDraft();
  const mode = useEditingMode();
  const pair = useResolvedPair();
  if (!draft || !pair) return null;
  const resolved = pair[mode];
  const { offsets, neutral } = draft;
  const settings = draft.modes[mode].settings;

  return (
    <Section id="palette" num="05" title="Accent, supporting and neutrals" summary={`${MODE_LABEL[mode]} palette`}>
      <p className="ts-p">
        Showing the
        {' '}
        <strong>{MODE_LABEL[mode]}</strong>
        {' '}
        palette. Each badge says whether those colors still follow the master hue (Linked), have been set by hand (Custom) or are protected (Locked).
      </p>

      <div id="ts-full-range-row">
        <Toggle
          id="ts-full-range-toggle"
          label="Hide suggested-range hints"
          description="Hides the amber suggested-range hints on roles and in the picker. Sliders already accept the full range; nothing is clamped. Off by default."
          checked={ui.fullRange}
          onChange={(v) => {
            dispatch({ type: 'fullRange/set', value: v });
            announce(v ? 'Suggested-range hints hidden.' : 'Suggested-range hints shown.');
          }}
        />
      </div>

      {PALETTE_GROUPS.map((g) => (
        <GroupBlock key={g.id} group={g} def={draft} mode={mode} resolved={resolved} />
      ))}

      <div className="ts-stack" id="theme-studio-offsets-block">
        <p className="ts-sub">Hue spread</p>
        {['accentBright', 'support1', 'support2'].map((k) => (
          <LabeledSlider
            key={k}
            id={`theme-studio-offset-${k}`}
            label={offsetLabel(k)}
            unit="°"
            kind="degrees"
            value={offsets[k]}
            min={-180}
            max={180}
            step={1}
            page={15}
            description={k === 'accentBright' ? 'Degrees away from the master hue. Applies to both palettes.' : undefined}
            onValue={(v, kind) => edit((d) => setOffset(d, k, v), { kind, label: offsetLabel(k), coalesceKey: `offset-${k}` })}
            onEnd={endEdit}
          />
        ))}
      </div>

      <div className="ts-stack" id="theme-studio-neutral-block">
        <p className="ts-sub">Neutral tint</p>
        <LabeledSlider
          id="theme-studio-neutral-strength"
          label="Tint strength"
          kind="factor"
          value={neutral.tintStrength}
          min={0}
          max={2}
          step={0.05}
          page={0.25}
          description="0 removes the warm tint from pages, surfaces and ink. 1 matches today."
          onValue={(v, kind) => edit((d) => setNeutral(d, { tintStrength: v }), { kind, label: 'Tint strength', coalesceKey: 'tint-strength' })}
          onEnd={endEdit}
        />
        <div className="ts-field">
          <span className="ts-label" id="theme-studio-neutral-source-label">Tint hue source</span>
          <ModeSwitch
            id="theme-studio-neutral-source"
            label="Tint hue source"
            value={neutral.hueSource}
            block
            onChange={(v) => edit((d) => setNeutral(d, { hueSource: v }), { kind: 'set', label: 'Tint hue source' })}
            options={[{ value: 'fixed', label: 'Fixed hue' }, { value: 'master', label: 'Follow master' }]}
          />
        </div>
        <LabeledSlider
          id="theme-studio-neutral-hue"
          label={neutralHueLabel(neutral.hueSource)}
          unit="°"
          kind="degrees"
          value={neutral.hue}
          min={0}
          max={360}
          step={1}
          page={15}
          wrap
          description={neutral.hueSource === 'master' ? 'Added to the master hue, so the neutrals move with it.' : 'An absolute hue. The baseline warm tint is 56.'}
          onValue={(v, kind) => edit((d) => setNeutral(d, { hue: v }), { kind, label: 'Tint hue', coalesceKey: 'tint-hue' })}
          onEnd={endEdit}
        />
      </div>

      <div className="ts-stack" id="theme-studio-mode-settings-block">
        <p className="ts-sub">{MODE_LABEL[mode]} palette tuning</p>
        <p className="ts-hint">Applies to accent, supporting and decorative colors that are still linked in this palette.</p>
        <LabeledSlider
          id="theme-studio-mode-lightness"
          label="Lightness shift"
          value={settings.lightnessShift}
          min={-0.15}
          max={0.15}
          step={0.005}
          page={0.025}
          onValue={(v, kind) => edit((d) => setModeSettings(d, mode, { lightnessShift: v }), { kind, label: `${mode} lightness shift`, coalesceKey: `mode-l-${mode}` })}
          onEnd={endEdit}
        />
        <LabeledSlider
          id="theme-studio-mode-chroma"
          label="Chroma scale"
          kind="factor"
          value={settings.chromaScale}
          min={0}
          max={2}
          step={0.05}
          page={0.25}
          onValue={(v, kind) => edit((d) => setModeSettings(d, mode, { chromaScale: v }), { kind, label: `${mode} chroma scale`, coalesceKey: `mode-c-${mode}` })}
          onEnd={endEdit}
        />
      </div>
    </Section>
  );
}
