'use client';

// MASTER SAVE rail card — one-click full-state versions. Unlike Scene
// Templates (SceneTemplatesCard.jsx, look/elements/camera only), a version
// captures the COMPLETE studio state including timeline keyframes and export
// settings — the exact blob the studio already persists as next-visit
// defaults, named on demand. elements/master-saves.js owns the pure schema;
// ClothStudio.jsx owns capture/apply. Local to this browser; at the cap the
// oldest version is replaced, so Save never disables.

import React, { useState } from 'react';
import { History, Save, Play, Pencil, Check, X, Trash2 } from 'lucide-react';
import { GLASS, ui, RailCard } from './rail-ui';
import { MAX_MASTER_SAVES } from '../elements/master-saves';

function formatSavedAt(ts) {
  try {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function VersionRow({ v, onLoad, onOverwrite, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(v.name);
  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== v.name) onRename(v.id, next);
    setRenaming(false);
  };
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', borderRadius: 10,
        background: 'rgba(0,0,0,0.03)', border: '1px solid transparent',
      }}
    >
      {renaming ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            style={{ ...ui.btn(), flex: 1, height: 26, padding: '0 8px', fontSize: 11 }}
          />
          <button type="button" title="Save name" onClick={commitRename} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.ink, padding: 4 }}>
            <Check size={13} strokeWidth={2.5} />
          </button>
          <button type="button" title="Cancel" onClick={() => setRenaming(false)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
            <X size={13} strokeWidth={2.5} />
          </button>
        </>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.name}
            </span>
            <span style={{ fontFamily: GLASS.sans, fontSize: 9.5, color: GLASS.inkMute }}>{formatSavedAt(v.updatedAt)}</span>
          </div>
          <button type="button" title="Load this version" onClick={() => onLoad(v.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.ink, padding: 4 }}>
            <Play size={13} strokeWidth={2.5} />
          </button>
          <button type="button" title="Overwrite with current settings" onClick={() => onOverwrite(v.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
            <Save size={13} strokeWidth={2.5} />
          </button>
          <button type="button" title="Rename" onClick={() => setRenaming(true)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
            <Pencil size={13} strokeWidth={2.5} />
          </button>
          <button type="button" title="Delete version" onClick={() => onDelete(v.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
            <Trash2 size={13} strokeWidth={2.5} />
          </button>
        </>
      )}
    </div>
  );
}

export default function MasterSavesCard({
  open, onToggle,
  saves, nameDraft, onNameDraftChange,
  onSaveVersion, onLoad, onOverwrite, onRename, onDelete,
  status,
}) {
  const list = [...(saves || [])].reverse(); // newest first
  return (
    <RailCard
      id="cloth-master-saves-panel" icon={<History size={18} strokeWidth={2} />} title="Master Save"
      subtitle={`${(saves || []).length}/${MAX_MASTER_SAVES} versions`}
      color="#f59e0b" open={open} onToggle={onToggle}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>SAVE A VERSION OF EVERYTHING</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="cloth-master-save-name-input"
            value={nameDraft}
            onChange={(e) => onNameDraftChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSaveVersion(); }}
            placeholder="Name (optional)"
            style={{ ...ui.btn(), flex: 1, height: 30, padding: '0 10px', fontSize: 11 }}
          />
          <button
            id="cloth-master-save-version-btn"
            title="Save a version of the complete current state"
            style={{ ...ui.btn(true), height: 30, padding: '0 12px', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            onClick={onSaveVersion}
          >
            <Save size={12} strokeWidth={2.5} /> Save Version
          </button>
        </div>
        <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
          One click captures everything as-is — subject, artwork, image layers, elements, look, lights, camera, background &amp; scene tweaks, hero text, timeline keyframes and export settings. Load brings it all back. Local to this browser; at {MAX_MASTER_SAVES} versions the oldest is replaced.
        </span>
      </label>

      {list.length ? (
        <div id="cloth-master-save-version-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((v) => (
            <VersionRow key={v.id} v={v} onLoad={onLoad} onOverwrite={onOverwrite} onRename={onRename} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No versions yet — hit Save Version to capture your current setup.</span>
      )}

      {status ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>{status}</span>
      ) : null}
    </RailCard>
  );
}
