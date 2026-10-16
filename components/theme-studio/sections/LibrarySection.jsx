'use client';

import React, { useMemo, useState } from 'react';
import Section from '../controls/Section.jsx';
import Banner from '../controls/Banner.jsx';
import ConfirmButton from '../controls/ConfirmButton.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useStoreSelector, useThemeLibrary, useLibraryVersion,
} from '../StudioContext.jsx';
import { slugify } from '../../../lib/theme-studio/io.js';

const selDirty = (s) => s.dirty;

function Swatches({ preview }) {
  return (
    <span className="ts-btn-row" aria-hidden="true" style={{ gap: 4, flex: 'none' }}>
      {[preview.page, preview.accent, preview.text].map((hex, i) => (
        <span key={i} className="ts-swatch ts-swatch--sm"><i style={{ background: hex }} /></span>
      ))}
    </span>
  );
}

function Row({ entry, dirty, lib, bump, edit, announce, dispatch }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(entry.name);
  const idBase = `ts-library-item-${entry.id}`;

  const load = () => {
    const r = lib.load(entry.id);
    if (!r.ok) { announce(r.notice); bump(); return; }
    edit(() => r.definition, { kind: 'set', label: `Load "${entry.name}"` });
    dispatch({ type: 'origin/set', value: 'imported' });
    announce(`Loaded "${entry.name}" into your draft. Undo restores the previous draft.`);
  };
  const commitRename = () => {
    const r = lib.rename(entry.id, name);
    setRenaming(false);
    announce(r.ok ? `Renamed to "${r.entry.name}".` : r.notice);
    bump();
  };
  const run = (fn, ok) => { const r = fn(); announce(r.ok ? ok(r) : r.notice); bump(); };

  return (
    <li className="ts-card" id={idBase} data-library-entry={entry.id} style={{ listStyle: 'none' }}>
      <div className="ts-card-head">
        <Swatches preview={entry.preview} />
        {renaming ? (
          <form
            style={{ display: 'flex', gap: 6, flex: 1 }}
            onSubmit={(e) => { e.preventDefault(); commitRename(); }}
          >
            <input
              className="ts-input"
              aria-label={`New name for ${entry.name}`}
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); setName(entry.name); } }}
            />
            <button type="submit" className="ts-btn ts-btn--sm ts-btn--primary">Save name</button>
          </form>
        ) : (
          <strong className="ts-card-title" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{entry.name}</strong>
        )}
        <button
          type="button"
          className="ts-btn ts-btn--sm"
          aria-pressed={entry.starred ? 'true' : 'false'}
          aria-label={entry.starred ? `Unstar ${entry.name}` : `Star ${entry.name}`}
          onClick={() => run(() => lib.star(entry.id), (r) => (r.entry.starred ? `Starred "${entry.name}". Starred themes are kept when the library is full.` : `Unstarred "${entry.name}".`))}
        >
          <span aria-hidden="true">{entry.starred ? '★' : '☆'}</span>
        </button>
      </div>
      <div className="ts-btn-row">
        {dirty ? (
          <ConfirmButton
            id={`${idBase}-load`}
            label="Load"
            prompt={`Replace your unsaved draft with "${entry.name}"? You can undo this.`}
            confirmLabel="Load theme"
            danger={false}
            onConfirm={load}
          />
        ) : (
          <button type="button" className="ts-btn ts-btn--sm" id={`${idBase}-load`} onClick={load}>Load</button>
        )}
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => { setName(entry.name); setRenaming(true); }}>Rename</button>
        <button type="button" className="ts-btn ts-btn--sm" onClick={() => run(() => lib.duplicate(entry.id), (r) => `Duplicated as "${r.entry.name}".${r.notice ? ` ${r.notice}` : ''}`)}>Duplicate</button>
        <ConfirmButton
          id={`${idBase}-delete`}
          label="Delete"
          prompt={`Delete "${entry.name}" from My Themes? This cannot be undone.`}
          confirmLabel="Delete theme"
          onConfirm={() => run(() => lib.remove(entry.id), () => `Deleted "${entry.name}".`)}
        />
      </div>
    </li>
  );
}

export default function LibrarySection() {
  const {
    store, announce, edit, dispatch, downloadFile,
  } = useStudio();
  const draft = useDraft();
  const dirty = useStoreSelector(store, selDirty);
  const lib = useThemeLibrary();
  const version = useLibraryVersion();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [mergeImport, setMergeImport] = useState(true);
  const bump = () => {}; // writes notify the shared library store

  // `version` is the re-read trigger after every library write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { entries, notice: readNotice } = useMemo(() => lib.list(), [lib, version]);

  if (!draft) return null;

  const say = (text) => { setNote(text); announce(text); };

  const save = (e) => {
    e.preventDefault();
    const r = lib.save({ name: name || draft.meta.name, definition: draft });
    bump();
    if (r.ok) { setName(''); say(`Saved "${r.entry.name}" to My Themes.${r.notice ? ` ${r.notice}` : ''}`); } else say(r.notice);
  };

  const exportAll = () => {
    downloadFile(`${slugify('my-themes')}.library.json`, 'application/json', lib.exportAll());
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = lib.importAll(await f.text(), { merge: mergeImport });
      bump();
      say(r.notice);
    } catch {
      say('Could not read that file.');
    }
  };

  return (
    <Section id="library" num="04" title="My themes" summary={entries.length ? `${entries.length} saved` : 'None yet'}>
      <div id="ts-library-section" className="ts-stack" data-section="library">
        <form className="ts-card" id="ts-library-save-form" onSubmit={save}>
          <label className="ts-label" htmlFor="ts-library-name">Save current as…</label>
          <div className="ts-btn-row">
            <input
              id="ts-library-name"
              className="ts-input"
              style={{ flex: 1, minWidth: 0 }}
              value={name}
              maxLength={80}
              placeholder={draft.meta.name || 'Theme name'}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="ts-btn ts-btn--primary" id="ts-library-save">
              <Icon name="save" size={14} /> Save
            </button>
          </div>
          <p className="ts-hint">Snapshots stay in this browser only. Up to {lib.cap}; the oldest unstarred one is removed when full.</p>
        </form>

        {readNotice ? <Banner tone="warn"><p>{readNotice}</p></Banner> : null}
        {note ? <p className="ts-hint" id="ts-library-note" role="status">{note}</p> : null}

        {entries.length === 0 ? (
          <p className="ts-hint" id="ts-library-empty">
            No saved themes yet. Name your current draft above and save it to keep a snapshot you can load back later.
          </p>
        ) : (
          <ul className="ts-stack" id="ts-library-list" aria-label="My themes" style={{ margin: 0, padding: 0 }}>
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} dirty={dirty} lib={lib} bump={bump} edit={edit} announce={announce} dispatch={dispatch} />
            ))}
          </ul>
        )}

        <div className="ts-card" id="ts-library-transfer">
          <h4 className="ts-card-title">Back up or move your themes</h4>
          <div className="ts-btn-row">
            <button type="button" className="ts-btn" id="ts-library-export" disabled={entries.length === 0} onClick={exportAll}>
              <Icon name="download" size={14} /> Export all
            </button>
            <label className="ts-file ts-btn" id="ts-library-import">
              <Icon name="upload" size={14} /> Import all
              <input type="file" accept=".json,application/json" aria-label="Import a My Themes library file" onChange={onFile} />
            </label>
          </div>
          <label className="ts-hint" htmlFor="ts-library-merge">
            <input id="ts-library-merge" type="checkbox" checked={mergeImport} onChange={(e) => setMergeImport(e.target.checked)} />
            {' '}Add to my existing themes (untick to replace them)
          </label>
        </div>
      </div>
    </Section>
  );
}
