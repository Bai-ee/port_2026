'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

// FolderRow — All · manual folders · smart folders (rule chip) · + Folder ·
// suggested folders. Presentational; the parent owns persistence.

// Mirrors folders.js rule validation: contains = array facet, equals = scalar,
// vibe = one of the vibe keys, tag = item tag.
const RULE_SHAPES = {
  contains: ['people', 'crews', 'labels', 'venues', 'cities', 'partyNames', 'gear', 'genres'],
  equals: ['decade', 'eraYear', 'status', 'title'],
  vibe: ['vibe.kind', 'vibe.time', 'vibe.light'],
  tag: ['tags'],
};
const OPS = Object.keys(RULE_SHAPES);

export function ruleLabel(rule) {
  return rule ? `${rule.field} ${rule.op} ${rule.value}` : '';
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function NewFolderForm({ bucketId, busy, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [smart, setSmart] = useState(false);
  const [op, setOp] = useState('contains');
  const [field, setField] = useState('gear');
  const [value, setValue] = useState('');
  const ok = name.trim() && (!smart || value.trim());
  const submit = (e) => {
    e.preventDefault();
    if (!ok) return;
    const folder = { id: `${slug(name)}-${Date.now().toString(36).slice(-4)}`, bucketId, name: name.trim() };
    if (smart) folder.rule = { field, op, value: value.trim() };
    else folder.itemIds = [];
    onSave(folder);
  };
  return (
    <form id="x-content-folder-add-form" className="xce-bk-form" onSubmit={submit}>
      <div className="xce-field"><label htmlFor="x-content-folder-add-name">Folder name</label>
        <input id="x-content-folder-add-name" className="xce-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
      <div className="xce-toggle-row">
        <button type="button" className={`xce-toggle${!smart ? ' is-on' : ''}`} onClick={() => setSmart(false)}>Manual</button>
        <button type="button" className={`xce-toggle${smart ? ' is-on' : ''}`} onClick={() => setSmart(true)}>Smart (rule)</button>
      </div>
      {smart ? (
        <div className="xce-bk-share-row" id="x-content-folder-rule-row">
          <div className="xce-field"><label htmlFor="x-content-folder-rule-field">Field</label>
            <select id="x-content-folder-rule-field" className="xce-select" value={field} onChange={(e) => setField(e.target.value)}>{RULE_SHAPES[op].map((f) => <option key={f}>{f}</option>)}</select></div>
          <div className="xce-field"><label htmlFor="x-content-folder-rule-op">Op</label>
            <select id="x-content-folder-rule-op" className="xce-select" value={op} onChange={(e) => { setOp(e.target.value); setField(RULE_SHAPES[e.target.value][0]); }}>{OPS.map((f) => <option key={f}>{f}</option>)}</select></div>
          <div className="xce-field"><label htmlFor="x-content-folder-rule-value">Value</label>
            <input id="x-content-folder-rule-value" className="xce-input" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        </div>
      ) : null}
      <div className="xce-actions">
        <button type="submit" className="xce-btn-primary" disabled={busy || !ok}>Create folder</button>
        <button type="button" className="xce-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function FolderRow({ folders, counts, selectedId, allCount, suggestions, bucketId, busy, onSelect, onSave, onDelete }) {
  const [adding, setAdding] = useState(false);
  const selected = folders.find((f) => f.id === selectedId);
  return (
    <div id="x-content-folder-section" className="xce-bk-folder-section">
      <div id="x-content-folder-row" className="xce-bk-folders" role="tablist" aria-label="Folders">
        <button type="button" className={`xce-bk-folder${selectedId === 'all' ? ' is-active' : ''}`} onClick={() => onSelect('all')}>All <span className="xce-bk-count">{allCount}</span></button>
        {folders.map((f) => (
          <button key={f.id} type="button" className={`xce-bk-folder${selectedId === f.id ? ' is-active' : ''}`} onClick={() => onSelect(f.id)}>
            {f.name} <span className="xce-bk-count">{counts[f.id] ?? 0}</span>
            {f.rule ? <span className="xce-chip xce-bk-rule">{ruleLabel(f.rule)}</span> : null}
          </button>
        ))}
        <button type="button" id="x-content-folder-add" className="xce-bk-folder xce-bk-folder-add" onClick={() => setAdding(true)}><Plus size={12} /> Folder</button>
      </div>
      {selected ? (
        <p className="xce-sub">
          {selected.rule ? 'Smart folder' : 'Manual folder'}
          {' '}<button type="button" className="xce-bk-link" disabled={busy} onClick={() => onDelete(selected.id)}><Trash2 size={11} /> delete folder</button>
        </p>
      ) : null}
      {suggestions.length ? (
        <div id="x-content-folder-suggestions" className="xce-bk-folders" aria-label="Suggested folders">
          <span className="xce-sub">Suggested:</span>
          {suggestions.slice(0, 6).map((s, i) => (
            <button key={`${s.name}-${i}`} type="button" className="xce-bk-folder xce-bk-suggest" disabled={busy}
              onClick={() => onSave({ id: `${slug(s.name)}-${Date.now().toString(36).slice(-4)}`, bucketId, name: s.name, ...(s.rule ? { rule: s.rule } : { itemIds: s.itemIds || [] }) })}>
              <Plus size={11} /> {s.name}{s.count != null ? ` (${s.count})` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {adding ? <NewFolderForm bucketId={bucketId} busy={busy} onCancel={() => setAdding(false)} onSave={async (f) => { await onSave(f); setAdding(false); }} /> : null}
    </div>
  );
}
