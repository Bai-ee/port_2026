'use client';

import React from 'react';
import Icon from './Icon.jsx';
import UnsavedIndicator from './controls/UnsavedIndicator.jsx';
import {
  useStudio, useStoreSelector, useEditingMode, usePreviewMode,
} from './StudioContext.jsx';
import { modeStatus } from '../../lib/theme-studio/view-models.js';

const selDirty = (s) => s.dirty;
const selSavedAt = (s) => s.savedAt;
const selCanUndo = (s) => s.canUndo;
const selCanRedo = (s) => s.canRedo;
const selApplied = (s) => s.applied;

/** Title, the always-visible Editing / Previewing statement, undo / redo / save. */
export default function StudioHeader() {
  const { store, closeStudio, saveDraft } = useStudio();
  const dirty = useStoreSelector(store, selDirty);
  const savedAt = useStoreSelector(store, selSavedAt);
  const canUndo = useStoreSelector(store, selCanUndo);
  const canRedo = useStoreSelector(store, selCanRedo);
  const applied = useStoreSelector(store, selApplied);
  const editing = useEditingMode();
  const preview = usePreviewMode();
  const status = modeStatus(editing, preview);

  return (
    <header className="ts-header" id="theme-studio-header">
      <div className="ts-header-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="ts-title" id="theme-studio-heading" tabIndex={-1}>Theme Studio</h2>
          <p className="ts-subtitle" id="theme-studio-subtitle">
            Local draft{applied ? ', applied on every page' : ''}. Not published.
          </p>
        </div>
        <button type="button" className="ts-btn ts-btn--ghost ts-btn--icon" id="theme-studio-close" aria-label="Close Theme Studio" onClick={closeStudio}>
          <Icon name="close" />
        </button>
      </div>

      <div className="ts-modeline" id="theme-studio-modeline">
        <div className="ts-chip ts-chip--edit" id="theme-studio-editing-chip">
          <Icon name="pencil" />
          <span className="ts-chip-text">
            <span className="ts-chip-k">Editing</span>
            <span className="ts-chip-v">{status.editing}</span>
          </span>
        </div>
        <div className={`ts-chip${status.differs ? ' ts-chip--differs' : ''}`} id="theme-studio-previewing-chip">
          <Icon name="eye" />
          <span className="ts-chip-text">
            <span className="ts-chip-k">Previewing</span>
            <span className="ts-chip-v">{status.previewing}</span>
          </span>
        </div>
      </div>

      <div className="ts-toolbar" id="theme-studio-toolbar">
        <button type="button" className="ts-btn ts-btn--sm ts-btn--icon" id="theme-studio-undo" aria-label="Undo" title="Undo (Ctrl or Cmd+Z)" disabled={!canUndo} onClick={() => store.undo()}>
          <Icon name="undo" />
        </button>
        <button type="button" className="ts-btn ts-btn--sm ts-btn--icon" id="theme-studio-redo" aria-label="Redo" title="Redo (Shift+Ctrl or Cmd+Z)" disabled={!canRedo} onClick={() => store.redo()}>
          <Icon name="redo" />
        </button>
        <span className="ts-toolbar-sep" aria-hidden="true" />
        <button type="button" className="ts-btn ts-btn--sm" id="theme-studio-save" onClick={saveDraft}>
          <Icon name="save" size={14} /> Save locally
        </button>
        <UnsavedIndicator dirty={dirty} savedAt={savedAt} />
      </div>
    </header>
  );
}
