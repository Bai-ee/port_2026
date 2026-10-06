'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, EyeOff, Eye, Pencil, Plus, Check, X, MoreHorizontal } from 'lucide-react';
import { SOURCE_KINDS, bucketIdFromName } from '../../../features/x-content-inventory/buckets.js';
import Popover from './Popover.jsx';

// BucketRail — the bucket list (a bucket is a SOURCE). Presentational: every
// change is handed to the parent as an `onUpsert(bucket)` call.
// Emits `xce-` classNames only; CSS lives in XContentEngineCard.

export function shareSummary(share = {}) {
  const bits = [];
  if (share.perDayMax != null) bits.push(`≤${share.perDayMax}/day`);
  if (share.perWeekMax != null) bits.push(`≤${share.perWeekMax}/wk`);
  else if (share.perWeekMin != null) bits.push(`${share.perWeekMin}+/wk`);
  if (share.maxSharePct != null) bits.push(`max ${share.maxSharePct}%`);
  return bits.join(' · ') || 'no share set';
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));

function AddBucketForm({ buckets, busy, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState('manual');
  const [perDayMax, setPerDayMax] = useState('');
  const [perWeekMax, setPerWeekMax] = useState('');
  const [maxSharePct, setMaxSharePct] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const id = bucketIdFromName(name);
    if (!id) return;
    const share = {};
    if (num(perDayMax) != null) share.perDayMax = num(perDayMax);
    if (num(perWeekMax) != null) share.perWeekMax = num(perWeekMax);
    if (num(maxSharePct) != null) share.maxSharePct = num(maxSharePct);
    const order = buckets.reduce((m, b) => Math.max(m, b.order ?? 0), -1) + 1;
    onSave({ id, name: name.trim(), sourceKind, color: '#475569', order, active: true, share });
  };

  return (
    <form id="x-content-bucket-add-form" className="xce-bk-form" onSubmit={submit}>
      <div className="xce-field"><label htmlFor="x-content-bucket-add-name">Name</label>
        <input id="x-content-bucket-add-name" className="xce-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flyers" /></div>
      <div className="xce-field"><label htmlFor="x-content-bucket-add-kind">Source</label>
        <select id="x-content-bucket-add-kind" className="xce-select" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
          {SOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select></div>
      <div className="xce-bk-share-row" id="x-content-bucket-add-share-row">
        <div className="xce-field"><label htmlFor="x-content-bucket-add-day">Max/day</label>
          <input id="x-content-bucket-add-day" className="xce-input" inputMode="numeric" value={perDayMax} onChange={(e) => setPerDayMax(e.target.value)} /></div>
        <div className="xce-field"><label htmlFor="x-content-bucket-add-week">Max/week</label>
          <input id="x-content-bucket-add-week" className="xce-input" inputMode="numeric" value={perWeekMax} onChange={(e) => setPerWeekMax(e.target.value)} /></div>
        <div className="xce-field"><label htmlFor="x-content-bucket-add-pct">Max %</label>
          <input id="x-content-bucket-add-pct" className="xce-input" inputMode="numeric" value={maxSharePct} onChange={(e) => setMaxSharePct(e.target.value)} /></div>
      </div>
      <div className="xce-actions">
        <button type="submit" className="xce-btn-primary" disabled={busy || !bucketIdFromName(name) || buckets.some((b) => b.id === bucketIdFromName(name))}>Add bucket</button>
        <button type="button" className="xce-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function BucketRail({ buckets, counts, selectedId, onSelect, onUpsert, busy }) {
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const move = (idx, dir) => {
    const a = buckets[idx];
    const b = buckets[idx + dir];
    if (!a || !b) return;
    // Swap order values; renumber by index so ties from seed data cannot stick.
    onUpsert([{ ...a, order: idx + dir }, { ...b, order: idx }]);
  };

  const commitRename = (b) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name && name !== b.name) onUpsert([{ ...b, name }]);
  };

  return (
    <aside id="x-content-bucket-rail" className="xce-bk-rail" aria-label="Buckets">
      <ul id="x-content-bucket-list" className="xce-bk-list">
        <li className="xce-bk-item">
          <span className="xce-bk-row">
            <button type="button" id="x-content-bucket-all" className={`xce-bk-chip${selectedId === 'all' ? ' is-active' : ''}`} onClick={() => onSelect('all')}>
              <span className="xce-bk-name">All buckets</span>
              <span className="xce-bk-count">{counts.all ?? 0}</span>
            </button>
            <span className="xce-bk-more-spacer" aria-hidden="true" />
          </span>
        </li>
        {buckets.map((b, idx) => (
          <li key={b.id} className={`xce-bk-item${b.active === false ? ' is-inactive' : ''}`} id={`x-content-bucket-item-${b.id}`}>
            {renamingId === b.id ? (
              <span className="xce-bk-rename">
                <input className="xce-input" aria-label="Bucket name" value={renameValue} autoFocus maxLength={60}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(b); if (e.key === 'Escape') setRenamingId(null); }} />
                <button type="button" className="xce-bk-icon" aria-label="Save name" onClick={() => commitRename(b)}><Check size={13} /></button>
                <button type="button" className="xce-bk-icon" aria-label="Cancel rename" onClick={() => setRenamingId(null)}><X size={13} /></button>
              </span>
            ) : (
              <span className="xce-bk-row">
                <button type="button" className={`xce-bk-chip${selectedId === b.id ? ' is-active' : ''}`} onClick={() => onSelect(b.id)}
                  title={`${b.name} · ${b.active === false ? 'inactive · ' : ''}${shareSummary(b.share)}`}>
                  <span className="xce-bk-dot" style={{ background: b.color || '#475569' }} />
                  <span className="xce-bk-name">{b.name}</span>
                  <span className="xce-bk-count">{counts[b.id] ?? 0}</span>
                </button>
                <Popover id={`x-content-bucket-menu-${b.id}`} title={`${b.name} options`} icon={<MoreHorizontal size={14} />} className="xce-bk-more">
                  {(close) => (
                    <div className="xce-pop-list">
                      <p className="xce-pop-label">{b.active === false ? 'Inactive · ' : ''}{shareSummary(b.share)}</p>
                      <button type="button" className="xce-pop-item" disabled={busy} onClick={() => { setRenamingId(b.id); setRenameValue(b.name); close(); }}><Pencil size={13} /> Rename</button>
                      <button type="button" className="xce-pop-item" disabled={busy || idx === 0} onClick={() => { move(idx, -1); close(); }}><ArrowUp size={13} /> Move up</button>
                      <button type="button" className="xce-pop-item" disabled={busy || idx === buckets.length - 1} onClick={() => { move(idx, 1); close(); }}><ArrowDown size={13} /> Move down</button>
                      <button type="button" className="xce-pop-item" disabled={busy} onClick={() => { onUpsert([{ ...b, active: b.active === false }]); close(); }}>
                        {b.active === false ? <><Eye size={13} /> Show bucket</> : <><EyeOff size={13} /> Hide bucket</>}
                      </button>
                    </div>
                  )}
                </Popover>
              </span>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <AddBucketForm buckets={buckets} busy={busy} onCancel={() => setAdding(false)}
          onSave={async (b) => { await onUpsert([b]); setAdding(false); }} />
      ) : (
        <button type="button" id="x-content-bucket-add" className="xce-btn-ghost" onClick={() => setAdding(true)}><Plus size={13} /> Add bucket</button>
      )}
    </aside>
  );
}
