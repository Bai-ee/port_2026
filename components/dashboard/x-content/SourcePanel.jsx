'use client';

import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import NasPanel from './NasPanel.jsx';

// SourcePanel — floating right-side panel (same shell as the item drawer) with
// per-bucket source info. Opens from the toolbar's Source icon; never pushes layout.
export default function SourcePanel({ bucket, bucketId, count, sync, onSync, call, nasStatus, onReload, onClose }) {
  const name = bucket?.name || 'Source';
  let body;
  if (bucketId === 'nas') {
    body = <NasPanel call={call} status={nasStatus} onReload={onReload} />;
  } else if (bucketId === 'ue') {
    body = (
      <div id="x-content-source-rendered" className="xce-nas-panel">
        <p className="xce-field-hint">Fed by the Video Remix pipeline. Rendered videos appear here automatically.</p>
        <p className="xce-nas-estimate">{sync.lastSyncAt ? `Last synced ${sync.lastSyncText}` : 'Not synced yet'}{sync.total != null ? ` · ${sync.total} in feed` : ''}</p>
        <button type="button" id="x-content-source-sync" className="xce-btn-primary" disabled={sync.busy} onClick={onSync}>
          <RefreshCw size={14} className={sync.busy ? 'xce-spin' : ''} /> {sync.busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    );
  } else if (bucketId === 'discogs') {
    body = (
      <div id="x-content-source-discogs" className="xce-nas-panel">
        <p className="xce-field-hint">Fed by the Discogs pipeline.</p>
        <p className="xce-nas-estimate">{count} items</p>
      </div>
    );
  } else {
    body = (
      <div id="x-content-source-info" className="xce-nas-panel">
        <p className="xce-field-hint">Items here are added on the Content tab or moved in from other buckets.</p>
        <p className="xce-nas-estimate">{count} items</p>
      </div>
    );
  }
  return (
    <div id="x-content-source-panel-backdrop" className="xce-bk-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section id="x-content-source-panel" className="xce-bk-drawer" role="dialog" aria-label={`${name} source`}>
        <header id="x-content-source-panel-header" className="xce-bk-drawer-head">
          <div>
            <p className="xce-inv-title">{name}</p>
            <p className="xce-inv-meta">Source</p>
          </div>
          <button type="button" className="xce-bk-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        {body}
      </section>
    </div>
  );
}
