'use client';

import React, { useState } from 'react';
import { FolderPlus, Info, Plus, DatabaseZap, Trash2 } from 'lucide-react';
import Popover from './Popover.jsx';
import { NewFolderForm } from './FolderRow.jsx';
import { Legend } from './ItemGrid.jsx';

// BucketToolbar — ONE fixed-height row above the grid, identical for every
// bucket, so switching buckets never shifts the layout. Views (folders + quick
// filters) live in a single select; folder management, suggestions, sync and
// the dot legend are tucked into popovers.

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export default function BucketToolbar({
  views, viewId, onView, folders, selectedFolder, suggestions, bucketId, busy,
  onSaveFolder, onDeleteFolder, sourceLabel, sourceActive, onSource, resultLabel,
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div id="x-content-bucket-toolbar" className="xce-bk-toolbar">
      <select id="x-content-bucket-view" className="xce-select xce-bk-view" aria-label="View" value={viewId} onChange={(e) => onView(e.target.value)}>
        {views.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.count != null ? ` (${o.count})` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="xce-bk-toolbar-count" id="x-content-bucket-result-count">{resultLabel}</span>
      <span className="xce-bk-toolbar-icons">
        <Popover id="x-content-folder-menu" title="Folders" icon={<FolderPlus size={14} />}>
          {(close) => (adding ? (
            <NewFolderForm bucketId={bucketId} busy={busy} onCancel={() => setAdding(false)}
              onSave={async (f) => { await onSaveFolder(f); setAdding(false); close(); }} />
          ) : (
            <div className="xce-pop-list">
              <button type="button" className="xce-pop-item" onClick={() => setAdding(true)}><Plus size={13} /> New folder</button>
              {selectedFolder ? (
                <button type="button" className="xce-pop-item is-danger" disabled={busy} onClick={() => { onDeleteFolder(selectedFolder.id); close(); }}>
                  <Trash2 size={13} /> Delete “{selectedFolder.name}”
                </button>
              ) : null}
              {suggestions.length ? <p className="xce-pop-label">Suggested</p> : null}
              {suggestions.slice(0, 8).map((s, i) => (
                <button key={`${s.name}-${i}`} type="button" className="xce-pop-item" disabled={busy}
                  onClick={() => { onSaveFolder({ id: `${slug(s.name)}-${Date.now().toString(36).slice(-4)}`, bucketId, name: s.name, ...(s.rule ? { rule: s.rule } : { itemIds: s.itemIds || [] }) }); close(); }}>
                  <Plus size={13} /> {s.name}{s.count != null ? <span className="xce-bk-count">{s.count}</span> : null}
                </button>
              ))}
              {!folders.length && !suggestions.length ? <p className="xce-pop-label">No folders yet</p> : null}
            </div>
          ))}
        </Popover>
        <button type="button" id="x-content-bucket-source" className={`xce-bk-icon${sourceActive ? ' is-open' : ''}`} title={sourceLabel} aria-label={sourceLabel} onClick={onSource}>
          <DatabaseZap size={14} />
        </button>
        <Popover id="x-content-legend-menu" title="What the dots mean" icon={<Info size={14} />}>
          <Legend />
        </Popover>
      </span>
    </div>
  );
}
