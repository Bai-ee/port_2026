'use client';

import React, { useMemo } from 'react';
import Section from '../controls/Section.jsx';
import ModeSwitch from '../controls/ModeSwitch.jsx';
import BeforeAfter from '../controls/BeforeAfter.jsx';
import ConfirmButton from '../controls/ConfirmButton.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useEditingMode, usePreviewMode, useStoreSelector, useCompare,
} from '../StudioContext.jsx';
import {
  modeStatus, presetLabel, countLockedRoles, MODE_LABEL,
} from '../../../lib/theme-studio/view-models.js';
import { createBaseline, copyMode, linkModes, resetMode } from '../../../lib/theme/index.js';

const selProduction = (s) => s.production;
const selDiffers = (s) => s.differsFromProduction;

export default function PresetModeSection() {
  const {
    store, ui, dispatch, edit, announce, closeStudio,
  } = useStudio();
  const draft = useDraft();
  const editing = useEditingMode();
  const preview = usePreviewMode();
  const production = useStoreSelector(store, selProduction);
  const differs = useStoreSelector(store, selDiffers);
  const compare = useCompare();
  const [direction, setDirection] = React.useState('light-dark');
  const from = direction === 'light-dark' ? 'light' : 'dark';
  const to = from === 'light' ? 'dark' : 'light';

  const preset = useMemo(() => presetLabel({ draft, production, origin: ui.origin }), [draft, production, ui.origin]);
  const status = modeStatus(editing, preview);
  const lockedTo = draft ? countLockedRoles(draft, to) : 0;

  const startFrom = (def, origin, msg) => {
    store.startDraft(def);
    dispatch({ type: 'origin/set', value: origin });
    announce(msg);
  };

  const setEditing = (m) => store.setEditingMode(m);
  const setPreview = (m) => store.setPreviewMode(m);
  const setCompare = (v) => store.setCompare(v);

  const doCopy = () => {
    edit((d) => copyMode(d, from, to, { skipLocked: true }), { kind: 'set', label: `Copy ${from} to ${to}` });
    announce(`Copied the ${from} palette to ${to}.${lockedTo ? ` ${lockedTo} locked roles in ${to} were skipped.` : ''}`);
  };
  const doLink = () => {
    edit((d) => linkModes(d, from, to), { kind: 'set', label: `${to} follows ${from}` });
    announce(`The ${to} palette now follows the ${from} palette.${lockedTo ? ` ${lockedTo} locked roles were skipped.` : ''}`);
  };
  const resetPalette = (m) => {
    edit((d) => resetMode(d, m), { kind: 'set', label: `Reset ${m} palette` });
    const n = draft ? countLockedRoles(draft, m) : 0;
    announce(`${m} palette reset to the baseline.${n ? ` ${n} locked roles were kept.` : ''}`);
  };
  const resetAll = () => {
    if (store.has('resetDraft')) store.resetDraft();
    else edit(() => production || createBaseline(), { kind: 'set', label: 'Reset draft' });
    dispatch({ type: 'origin/set', value: 'production' });
    announce('Draft reset.');
  };

  return (
    <Section id="mode" num="01" title="Mode and preset" summary={`${preset.label}, editing ${editing}`}>
      <div className="ts-stack" id="theme-studio-preset-block">
        <div className="ts-card-head">
          <div>
            <p className="ts-sub">Preset</p>
            <p className="ts-card-title" id="theme-studio-preset-name">{draft ? draft.meta.name : 'No draft'}</p>
          </div>
          <span className={`ts-badge ts-badge--${preset.key === 'draft' || preset.key === 'imported' ? 'warn' : 'ok'}`}>{preset.label}</span>
        </div>
        <p className="ts-hint">{preset.detail} Edits are a local draft: nothing reaches visitors until a developer publishes the exported file.</p>
        <div className="ts-btn-row">
          <ConfirmButton
            id="theme-studio-start-baseline"
            label="Start from Baseline"
            prompt="Replace your draft with the Baseline preset? You can undo this."
            confirmLabel="Replace draft"
            danger={false}
            onConfirm={() => startFrom(createBaseline(), 'production', 'Draft replaced with the Baseline preset.')}
          />
          <ConfirmButton
            id="theme-studio-start-production"
            label="Start from published"
            prompt="Replace your draft with the published theme? You can undo this."
            confirmLabel="Replace draft"
            danger={false}
            disabled={!production}
            onConfirm={() => startFrom(production, 'production', 'Draft replaced with the published theme.')}
          />
        </div>
      </div>

      <div className="ts-stack" id="theme-studio-mode-block">
        <div className="ts-field">
          <span className="ts-label" id="theme-studio-editing-label"><Icon name="pencil" size={13} /> Editing: which palette the controls change</span>
          <ModeSwitch
            id="theme-studio-editing-switch"
            label="Editing palette"
            value={editing}
            onChange={setEditing}
            block
            options={[{ value: 'light', label: 'Light palette' }, { value: 'dark', label: 'Dark palette' }]}
          />
        </div>
        <div className="ts-field">
          <span className="ts-label" id="theme-studio-previewing-label"><Icon name="eye" size={13} /> Previewing: what this page shows</span>
          <ModeSwitch
            id="theme-studio-preview-switch"
            label="Previewing mode"
            value={preview}
            onChange={setPreview}
            block
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
          <div className="ts-btn-row">
            {status.differs ? (
              <button type="button" className="ts-btn ts-btn--sm" onClick={() => setPreview(editing)}>
                Show the {editing} palette
              </button>
            ) : null}
            {preview ? (
              <button type="button" className="ts-btn ts-btn--sm ts-btn--ghost" onClick={() => setPreview(null)}>
                Stop overriding (use my own setting)
              </button>
            ) : null}
          </div>
          <p className="ts-hint" aria-live="polite">{status.hint}</p>
        </div>
      </div>

      <div className="ts-card" id="theme-studio-between-modes-card">
        <div className="ts-card-head"><h4 className="ts-card-title">Between palettes</h4></div>
        <ModeSwitch
          id="theme-studio-direction-switch"
          label="Direction"
          value={direction}
          onChange={setDirection}
          block
          options={[{ value: 'light-dark', label: 'Light to Dark' }, { value: 'dark-light', label: 'Dark to Light' }]}
        />
        <p className="ts-hint">
          Copy gives the {to} palette the {from} values once. Follow keeps the {to} palette tied to the {from} palette from now on.
          {lockedTo ? ` ${lockedTo} locked ${lockedTo === 1 ? 'role' : 'roles'} in ${to} are always skipped.` : ' Locked roles are always skipped.'}
        </p>
        <div className="ts-btn-row">
          <ConfirmButton
            id="theme-studio-copy-modes"
            label={`Copy ${MODE_LABEL[from]} to ${MODE_LABEL[to]}`}
            prompt={`Overwrite the ${to} palette with ${from} values? Locked roles are skipped.`}
            confirmLabel="Copy"
            icon="copy"
            danger={false}
            onConfirm={doCopy}
          />
          <ConfirmButton
            id="theme-studio-link-modes"
            label={`${MODE_LABEL[to]} follows ${MODE_LABEL[from]}`}
            prompt={`Make the ${to} palette follow the ${from} palette? Dark text on a dark page is possible, so check Accessibility after.`}
            confirmLabel="Follow"
            icon="link"
            danger={false}
            onConfirm={doLink}
          />
        </div>
      </div>

      <BeforeAfter value={compare} onChange={setCompare} differs={differs} />

      <div className="ts-stack" id="theme-studio-reset-block">
        <p className="ts-sub">Reset</p>
        <div className="ts-btn-row">
          <ConfirmButton
            id="theme-studio-reset-light"
            label="Reset Light palette"
            prompt="Reset every unlocked Light role and its settings to the baseline?"
            confirmLabel="Reset Light"
            icon="reset"
            onConfirm={() => resetPalette('light')}
          />
          <ConfirmButton
            id="theme-studio-reset-dark"
            label="Reset Dark palette"
            prompt="Reset every unlocked Dark role and its settings to the baseline?"
            confirmLabel="Reset Dark"
            icon="reset"
            onConfirm={() => resetPalette('dark')}
          />
          <ConfirmButton
            id="theme-studio-reset-draft"
            label="Reset whole draft"
            prompt="Discard all edits in this draft and start again? You can undo this."
            confirmLabel="Reset draft"
            icon="reset"
            onConfirm={resetAll}
          />
          <ConfirmButton
            id="theme-studio-discard-draft"
            label="Discard draft and close"
            prompt="Throw away this draft, including the saved copy in this browser?"
            confirmLabel="Discard"
            onConfirm={() => { store.discardDraft(); closeStudio(); }}
          />
        </div>
      </div>
    </Section>
  );
}
