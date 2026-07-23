'use client';

// SCENE TEMPLATES rail card — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md
// "Template system" § Scene Template, Phase 5. Save/load/duplicate/rename/
// archive/export/import a full scene recipe (elements, look, camera, cloth,
// video settings — the exact fields ClothStudio.jsx already persists as your
// next-visit defaults). LOCAL-only (localStorage) this round — see
// elements/templates.js's header for what's deferred (Element/Look/Render
// preset kinds, cloud/admin promotion, thumbnails, real schema migration).
// Flag-gated the same way as the Elements card in ClothStudio.jsx.

import React, { useState } from 'react';
import {
  FolderOpen, Save, Play, Copy, Archive, ArchiveRestore, Download, Upload, Pencil, Check, X,
} from 'lucide-react';
import { GLASS, ui, RailCard } from './rail-ui';
import { listActiveTemplates, listArchivedTemplates, MAX_TEMPLATES } from '../elements/templates';

function TemplateRow({ t, onLoad, onResave, onRename, onDuplicate, onArchive, onUnarchive, onExport, archived }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(t.name);
  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== t.name) onRename(t.id, next);
    setRenaming(false);
  };
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', borderRadius: 10,
        background: 'rgba(0,0,0,0.03)', border: '1px solid transparent',
        opacity: archived ? 0.6 : 1,
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
          <span style={{ flex: 1, minWidth: 0, fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.name}
          </span>
          {!archived ? (
            <>
              <button type="button" title="Load" onClick={() => onLoad(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.ink, padding: 4 }}>
                <Play size={13} strokeWidth={2.5} />
              </button>
              <button type="button" title="Save current scene over this template" onClick={() => onResave(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
                <Save size={13} strokeWidth={2.5} />
              </button>
              <button type="button" title="Rename" onClick={() => setRenaming(true)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
                <Pencil size={13} strokeWidth={2.5} />
              </button>
              <button type="button" title="Duplicate" onClick={() => onDuplicate(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
                <Copy size={13} strokeWidth={2.5} />
              </button>
              <button type="button" title="Export as JSON" onClick={() => onExport(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
                <Download size={13} strokeWidth={2.5} />
              </button>
              <button type="button" title="Archive" onClick={() => onArchive(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
                <Archive size={13} strokeWidth={2.5} />
              </button>
            </>
          ) : (
            <button type="button" title="Restore" onClick={() => onUnarchive(t.id)} style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: GLASS.inkMute, padding: 4 }}>
              <ArchiveRestore size={13} strokeWidth={2.5} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function SceneTemplatesCard({
  open, onToggle,
  templates, nameDraft, onNameDraftChange,
  onSave, onLoad, onResave, onRename, onDuplicate, onArchive, onUnarchive, onExport, onImportJSON,
  status,
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importDraft, setImportDraft] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const active = listActiveTemplates(templates || []);
  const archived = listArchivedTemplates(templates || []);
  const atCap = (templates || []).length >= MAX_TEMPLATES;

  const commitImport = () => {
    if (!importDraft.trim()) return;
    onImportJSON(importDraft);
    setImportDraft('');
    setImportOpen(false);
  };

  return (
    <RailCard
      id="cloth-scene-templates-panel" icon={<FolderOpen size={18} strokeWidth={2} />} title="Scene Templates"
      subtitle={`${active.length} saved${archived.length ? ` · ${archived.length} archived` : ''}`}
      color="#22c55e" open={open} onToggle={onToggle}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>SAVE CURRENT SCENE</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={nameDraft}
            onChange={(e) => onNameDraftChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !atCap) onSave(); }}
            placeholder="Untitled Scene"
            disabled={atCap}
            style={{ ...ui.btn(), flex: 1, height: 30, padding: '0 10px', fontSize: 11, opacity: atCap ? 0.4 : 1 }}
          />
          <button
            title={atCap ? `Template cap reached (${MAX_TEMPLATES})` : 'Save'}
            disabled={atCap}
            style={{ ...ui.btn(), height: 30, padding: '0 12px', fontSize: 10, opacity: atCap ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={onSave}
          >
            <Save size={12} strokeWidth={2.5} /> Save
          </button>
        </div>
        <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
          Captures elements, look, camera, cloth and video settings — everything this tool already remembers as your defaults, just named and saved on demand. Local to this browser.
        </span>
      </label>

      {active.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active.map((t) => (
            <TemplateRow key={t.id} t={t} onLoad={onLoad} onResave={onResave} onRename={onRename} onDuplicate={onDuplicate} onArchive={onArchive} onUnarchive={onUnarchive} onExport={onExport} archived={false} />
          ))}
        </div>
      ) : (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No saved templates yet.</span>
      )}

      {archived.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            style={{ ...ui.label, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: GLASS.inkMute }}
          >
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived ? archived.map((t) => (
            <TemplateRow key={t.id} t={t} onLoad={onLoad} onResave={onResave} onRename={onRename} onDuplicate={onDuplicate} onArchive={onArchive} onUnarchive={onUnarchive} onExport={onExport} archived />
          )) : null}
        </div>
      ) : null}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <button
          type="button"
          style={{ ...ui.btn(importOpen), width: '100%', height: 30, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => setImportOpen((v) => !v)}
        >
          <Upload size={12} strokeWidth={2.5} /> Import from JSON
        </button>
        {importOpen ? (
          <>
            <textarea
              value={importDraft}
              onChange={(e) => setImportDraft(e.target.value)}
              placeholder="Paste an exported template's JSON…"
              rows={4}
              style={{ ...ui.btn(), width: '100%', fontFamily: GLASS.mono, fontSize: 10, padding: 8, resize: 'vertical' }}
            />
            <button
              type="button"
              disabled={!importDraft.trim()}
              style={{ ...ui.btn(), width: '100%', height: 28, fontSize: 10, opacity: importDraft.trim() ? 1 : 0.4 }}
              onClick={commitImport}
            >
              Import
            </button>
          </>
        ) : null}
      </label>

      {status ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>{status}</span>
      ) : null}
    </RailCard>
  );
}
