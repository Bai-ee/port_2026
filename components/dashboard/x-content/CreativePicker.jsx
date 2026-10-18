'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import LoadingRing from '../content-ui/ui/LoadingRing';
import MiniThumb from './MiniThumb.jsx';
import { PICKER_FILTERS, pickerTiles } from './creative-picker-model.js';

// CreativePicker — inline panel inside the post editor: choose a Content Center item whose media becomes the post's
// creative. Presentational about the pick: it only emits onPick(packageId); the parent calls the
// `post-attach-item-media` action. Loads the client's items with the same `inventory-list` call the Library uses.
// Read-only, free. Never an overlay or modal.

const ENDPOINT = '/api/dashboard/quote-targets';
const THUMB = 84;

export default function CreativePicker({ clientId, getIdToken, onPick, onCancel, selectedPackageId = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(60);

  const call = useCallback(async (action, body = {}) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `${action} failed.`), { status: res.status });
    return data;
  }, [getIdToken]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    call('inventory-list')
      .then((r) => { if (live) setItems(Array.isArray(r?.packages) ? r.packages : []); })
      .catch((err) => { if (live) setError(err.message || 'Could not load the library.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [call, clientId]);

  useEffect(() => { setLimit(60); }, [query, filter]);

  const tiles = useMemo(() => pickerTiles(items, { query, filter }), [items, query, filter]);
  const shown = tiles.slice(0, limit);

  return (
    <section id="creative-picker-panel" className="creative-picker" aria-label="Choose a creative from the library">
      <header id="creative-picker-header-row" className="creative-picker-head">
        <h3 id="creative-picker-title">Choose a creative</h3>
        <button type="button" id="creative-picker-cancel-button" className="creative-picker-close" onClick={onCancel} aria-label="Close picker">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div id="creative-picker-controls-row" className="creative-picker-controls">
        <label id="creative-picker-search-shell" className="creative-picker-search">
          <Search size={14} aria-hidden="true" />
          <input id="creative-picker-search-input" type="search" value={query} placeholder="Search your library" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div id="creative-picker-filter-row" className="creative-picker-filters" role="group" aria-label="Filter creatives">
          {PICKER_FILTERS.map((f) => (
            <button key={f.id} type="button" id={`creative-picker-filter-${f.id}-button`} className={`creative-picker-chip${filter === f.id ? ' is-on' : ''}`}
              aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      {loading ? <LoadingRing id="creative-picker-status" label="Loading your library" size={28} minHeight={120} /> : null}
      {error ? <p id="creative-picker-error" className="creative-picker-note is-error" role="alert">{error}</p> : null}
      {!loading && !error && !tiles.length ? <p id="creative-picker-empty" className="creative-picker-note">Nothing matches. Try another search or filter.</p> : null}

      <ul id="creative-picker-grid" className="creative-picker-grid">
        {shown.map(({ item, state }) => {
          const disabled = !state.usable;
          const on = selectedPackageId === item.id;
          return (
            <li key={item.id}>
              <button type="button" id={`creative-picker-tile-${item.id}`} className={`creative-picker-tile${on ? ' is-selected' : ''}`}
                disabled={disabled} aria-pressed={on} aria-describedby={disabled ? `creative-picker-reason-${item.id}` : undefined}
                title={disabled ? state.reason : item.title || item.id} onClick={() => onPick && onPick(item.id)}>
                <MiniThumb id={item.id} call={call} kind={state.kind} nasSha={item.nasSha || null} size={THUMB} label={item.title || item.id} />
                <span className="creative-picker-tile-title">{item.title || item.id}</span>
                {disabled ? <span id={`creative-picker-reason-${item.id}`} className="creative-picker-tile-reason">{state.reason}</span>
                  : <span className="creative-picker-tile-kind">{state.kind === 'video' ? 'MP4 video' : 'Image'}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {tiles.length > shown.length ? (
        <button type="button" id="creative-picker-load-more-button" className="creative-picker-chip" onClick={() => setLimit((n) => n + 60)}>
          Load more ({tiles.length - shown.length})
        </button>
      ) : null}

      <style jsx global>{`
        #creative-picker-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--t-control-border); border-radius: 12px; background: var(--t-surface); color: var(--t-text); }
        #creative-picker-header-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #creative-picker-title { margin: 0; font-size: 14px; font-weight: 600; }
        #creative-picker-cancel-button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: -8px; border: 0; background: transparent; color: var(--t-text-muted); cursor: pointer; border-radius: 8px; }
        #creative-picker-controls-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        #creative-picker-search-shell { flex: 1 1 180px; display: flex; align-items: center; gap: 6px; padding: 0 10px; min-height: 44px; border: 1px solid var(--t-control-border); border-radius: 8px; background: var(--t-page); color: var(--t-text-muted); }
        #creative-picker-search-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--t-text); font: inherit; font-size: 16px; }
        #creative-picker-filter-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .creative-picker-chip { min-height: 44px; padding: 0 12px; border: 1px solid var(--t-control-border); border-radius: 999px; background: transparent; color: var(--t-text); font: inherit; font-size: 12px; cursor: pointer; }
        .creative-picker-chip.is-on { background: var(--t-text); color: var(--t-page); border-color: var(--t-text); }
        .creative-picker-note { margin: 0; font-size: 12px; color: var(--t-text-muted); }
        .creative-picker-note.is-error { color: var(--t-danger); }
        #creative-picker-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; max-height: 420px; overflow-y: auto; }
        .creative-picker-tile { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 6px; border: 1px solid var(--t-control-border); border-radius: 10px; background: var(--t-page); color: var(--t-text); font: inherit; text-align: left; cursor: pointer; }
        .creative-picker-tile:hover:not(:disabled) { border-color: var(--t-text); }
        .creative-picker-tile.is-selected { border-color: var(--t-text); box-shadow: 0 0 0 2px var(--t-text); }
        .creative-picker-tile:disabled { opacity: 0.55; cursor: not-allowed; }
        .creative-picker-tile:focus-visible, .creative-picker-chip:focus-visible, #creative-picker-cancel-button:focus-visible { outline: 2px solid var(--t-text); outline-offset: 2px; }
        .creative-picker-tile-title { font-size: 12px; line-height: 1.25; width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .creative-picker-tile-kind, .creative-picker-tile-reason { font-size: 11px; color: var(--t-text-muted); }
        @media (max-width: 480px) {
          #creative-picker-panel { padding: var(--mobile-gutter); border-radius: 10px; }
          #creative-picker-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); max-height: 60vh; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .creative-picker-tile { transition: border-color 0.15s ease-out; }
        }
      `}</style>
    </section>
  );
}
