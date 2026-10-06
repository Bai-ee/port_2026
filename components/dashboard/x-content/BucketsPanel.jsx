'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Skeleton, RetryError } from './Feedback.jsx';

import { mergeBuckets, resolveBucket } from '../../../features/x-content-inventory/buckets.js';
import { itemsInFolder, folderCounts, suggestFolders } from '../../../features/x-content-inventory/folders.js';
import { buildIndex, search } from '../../../features/x-content-inventory/search-index.js';
import BucketRail from './BucketRail.jsx';
import BucketToolbar from './BucketToolbar.jsx';
import ItemGrid, { isAutoDaily } from './ItemGrid.jsx';
import { effectiveFacets } from '../../../features/x-content-inventory/facets.js';
import ItemDrawer from './ItemDrawer.jsx';
import SourcePanel from './SourcePanel.jsx';
import { NasContext } from './nas-context.js';

// BucketsPanel — the library: buckets (sources) → folders → items.
//
// `call(action, body)` is the card's authenticated POST helper (quote-targets
// route, admin-only). Items are the card's already-loaded `packages`; after a
// write we ask the card to reload them via `onReload`. Nothing here posts or
// schedules. CSS lives in XContentEngineCard (`xce-bk-*`).

// The search module's return shape is normalised here so a ranked list of
// items, {id}/{item} hits or bare ids all work.
function hitIds(result) {
  const list = Array.isArray(result) ? result : Array.isArray(result?.hits) ? result.hits : Array.isArray(result?.results) ? result.results : [];
  return list.map((h) => (typeof h === 'string' ? h : h?.id ?? h?.item?.id)).filter(Boolean);
}
function toItems(result, byId) {
  return (Array.isArray(result) ? result : []).map((x) => (typeof x === 'string' ? byId.get(x) : byId.get(x?.id) || x)).filter(Boolean);
}
function asCountMap(c) {
  if (c instanceof Map) return Object.fromEntries(c);
  return c && typeof c === 'object' ? c : {};
}

function ago(iso) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso?.toDate ? iso.toDate().toISOString() : iso);
  if (!Number.isFinite(t)) return 'recently';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

const BUCKET_STORAGE_KEY = 'xce-last-bucket';
function readSavedBucket() {
  try {
    return (typeof window !== 'undefined' && window.localStorage.getItem(BUCKET_STORAGE_KEY)) || 'all';
  } catch {
    return 'all';
  }
}

export default function BucketsPanel({ call, packages, loading, error, onReload }) {
  const [buckets, setBuckets] = useState(() => mergeBuckets([]));
  const [folders, setFolders] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const [bucketId, setBucketId] = useState(readSavedBucket);
  // Remember the last bucket per viewer; a bucket that no longer exists falls back to All.
  useEffect(() => {
    try { window.localStorage.setItem(BUCKET_STORAGE_KEY, bucketId); } catch { /* storage unavailable */ }
  }, [bucketId]);
  useEffect(() => {
    if (!metaLoading && bucketId !== 'all' && !buckets.some((b) => b.id === bucketId)) setBucketId('all');
  }, [metaLoading, buckets, bucketId]);
  // One view per bucket: 'all' | 'folder:<id>' | 'q:mine' | 'q:daily' | 'q:dj:<name>'
  const [viewId, setViewId] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [sync, setSync] = useState({ busy: false, error: '', total: null, lastSyncAt: null });

  const [sourceOpen, setSourceOpen] = useState(false);
  const [nasStatus, setNasStatus] = useState(null);

  // NAS reachability: needed for tile thumbnails on the NAS bucket and the source panel.
  // Polled every 20s only while the NAS bucket is selected or its source panel is open.
  const loadNasStatus = useCallback(async () => {
    try {
      const r = await call('nas-status');
      if (r && r.ok !== false) setNasStatus(r);
    } catch { setNasStatus((s) => (s ? { ...s, online: false } : s)); }
  }, [call]);
  const nasWatch = bucketId === 'nas' || bucketId === 'all';
  useEffect(() => {
    if (!nasWatch) return undefined;
    loadNasStatus();
    const t = setInterval(loadNasStatus, 20000);
    return () => clearInterval(t);
  }, [nasWatch, loadNasStatus, sourceOpen]);
  const nasCtx = useMemo(() => ({ online: !!nasStatus?.online, base: nasStatus?.localThumbBase || '' }), [nasStatus]);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError('');
    try {
      const [b, f] = await Promise.all([call('list-buckets'), call('list-folders')]);
      setBuckets(mergeBuckets(Array.isArray(b?.buckets) ? b.buckets : []));
      setFolders(Array.isArray(f?.folders) ? f.folders : []);
    } catch (err) {
      setMetaError(err.message || 'Could not load buckets.');
    } finally {
      setMetaLoading(false);
    }
  }, [call]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Pull the Video Remix feed into the library (server throttles unless force).
  const syncRendered = useCallback(async (force) => {
    setSync((s) => ({ ...s, busy: true, error: '' }));
    try {
      const r = await call('sync-rendered-videos', force ? { force: true } : {});
      setSync({ busy: false, error: '', total: r?.total ?? null, lastSyncAt: r?.lastSyncAt || null });
      if (r && (r.created || r.updated || force)) await onReload();
    } catch (err) {
      setSync((s) => ({ ...s, busy: false, error: err.message || 'Sync failed.' }));
    }
  }, [call, onReload]);
  const syncedOnce = useRef(false);
  useEffect(() => {
    if (syncedOnce.current) return;
    syncedOnce.current = true;
    syncRendered(false);
  }, [syncRendered]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setActionError('');
    try { await fn(); return true; } catch (err) { setActionError(err.message || 'Action failed.'); return false; } finally { setBusy(false); }
  }, []);

  const items = useMemo(
    // Retired items (e.g. renders whose video file was deleted: tag media-missing) never show.
    () => (packages || []).filter((p) => p?.status !== 'retired').map((p) => ({ ...p, _bucketId: resolveBucket(p, buckets) })),
    [packages, buckets],
  );
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const bucketById = useMemo(() => Object.fromEntries(buckets.map((b) => [b.id, b])), [buckets]);

  const bucketCounts = useMemo(() => {
    const c = { all: items.length };
    for (const i of items) c[i._bucketId] = (c[i._bucketId] || 0) + 1;
    return c;
  }, [items]);

  const bucketItems = useMemo(() => (bucketId === 'all' ? items : items.filter((i) => i._bucketId === bucketId)), [items, bucketId]);
  const bucketFolders = useMemo(() => folders.filter((f) => bucketId === 'all' || f.bucketId === bucketId), [folders, bucketId]);

  const counts = useMemo(() => {
    try { return asCountMap(folderCounts(bucketFolders, bucketItems, buckets)); } catch { return {}; }
  }, [bucketItems, bucketFolders, buckets]);

  const suggestions = useMemo(() => {
    if (bucketId === 'all') return [];
    try {
      const s = suggestFolders(bucketItems, { bucketId, buckets, existing: bucketFolders });
      return Array.isArray(s) ? s : [];
    } catch { return []; }
  }, [bucketItems, bucketFolders, bucketId, buckets]);

  const index = useMemo(() => { try { return buildIndex(items, { buckets }); } catch { return null; } }, [items, buckets]);

  const isRendered = bucketId === 'ue';
  const djNames = useMemo(() => suggestions
    .filter((x) => x?.rule?.field === 'people' && x.rule.value)
    .slice(0, 8)
    .map((x) => ({ name: x.rule.value, count: x.count })), [suggestions]);
  // Folder suggestions shown in the Folders menu exclude DJ names (those are quick views).
  const folderSuggestions = useMemo(() => suggestions.filter((x) => x?.rule?.field !== 'people'), [suggestions]);

  const quick = useMemo(() => ({
    mine: (list) => list.filter((i) => i.rights === 'owned'),
    daily: (list) => list.filter(isAutoDaily),
    dj: (name) => (list) => list.filter((i) => (effectiveFacets(i).people || []).some((p) => String(p).toLowerCase() === name.toLowerCase())),
  }), []);

  // View options for the single select — same control for every bucket.
  const views = useMemo(() => {
    const groups = [{ label: 'Folders', options: [{ id: 'all', label: 'All', count: bucketItems.length },
      ...bucketFolders.map((f) => ({ id: `folder:${f.id}`, label: f.name, count: counts[f.id] ?? 0 }))] }];
    const q = [];
    if (bucketItems.some((i) => i.rights === 'owned')) q.push({ id: 'q:mine', label: 'Mine', count: quick.mine(bucketItems).length });
    if (bucketItems.some(isAutoDaily)) q.push({ id: 'q:daily', label: 'Daily auto', count: quick.daily(bucketItems).length });
    if (q.length) groups.push({ label: 'Quick views', options: q });
    if (isRendered && djNames.length) groups.push({ label: 'By DJ', options: djNames.map((d) => ({ id: `q:dj:${d.name}`, label: d.name, count: d.count })) });
    return groups;
  }, [bucketItems, bucketFolders, counts, quick, isRendered, djNames]);

  const selectedFolder = viewId.startsWith('folder:') ? bucketFolders.find((f) => f.id === viewId.slice(7)) : null;

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    if (searching) {
      if (!index) return [];
      try { return hitIds(search(index, query)).map((id) => byId.get(id)).filter(Boolean); } catch { return []; }
    }
    if (selectedFolder) {
      try { return toItems(itemsInFolder(selectedFolder, bucketItems, buckets), byId); } catch { return []; }
    }
    if (viewId === 'q:mine') return quick.mine(bucketItems);
    if (viewId === 'q:daily') return quick.daily(bucketItems);
    if (viewId.startsWith('q:dj:')) return quick.dj(viewId.slice(5))(bucketItems);
    return bucketItems;
  }, [searching, index, query, byId, selectedFolder, viewId, bucketItems, buckets, quick]);

  const openItem = openId ? byId.get(openId) : null;
  const manualFolders = useMemo(() => folders.filter((f) => !f.rule), [folders]);
  const anyError = metaError || error;

  const selectBucket = (id) => { setBucketId(id); setViewId('all'); };

  const upsertBuckets = (list) => run(async () => {
    for (const bucket of list) await call('upsert-bucket', { bucket });
    await loadMeta();
  });
  const upsertFolder = (folder) => run(async () => { await call('upsert-folder', { folder }); await loadMeta(); });
  const deleteFolder = (id) => run(async () => { await call('delete-folder', { id }); setViewId('all'); await loadMeta(); });

  const saveItem = (id, humanEdits, story) => run(async () => {
    const body = { id, humanEdits };
    if (typeof story === 'string' && story !== String(byId.get(id)?.story ?? '')) body.story = story;
    await call('update-item-facets', body);
    await onReload();
  });
  const moveItem = (id, to) => run(async () => { await call('move-item', { id, bucketId: to }); await onReload(); });
  const addToFolder = (fid, id) => run(async () => {
    const f = folders.find((x) => x.id === fid);
    if (!f) return;
    const ids = new Set(f.itemIds || []);
    ids.add(id);
    await call('upsert-folder', { folder: { ...f, itemIds: [...ids] } });
    await loadMeta();
  });

  return (
    <NasContext.Provider value={nasCtx}>
    <div id="x-content-buckets-panel" className="xce-panel xce-bk">
      {anyError ? <RetryError id="x-content-buckets-error" message={anyError} onRetry={onReload} busy={!!loading} /> : null}
      {actionError && !openItem ? <p className="xce-error" id="x-content-buckets-action-error">{actionError}</p> : null}
      {sync.error ? <p className="xce-error" id="x-content-rendered-sync-error">{sync.error}</p> : null}

      <div id="x-content-bucket-search" className="xce-bk-search">
        <Search size={14} />
        <input className="xce-input" aria-label="Search all buckets" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything — try gear:909, year:1997, vibe:night" title="Filters: people: gear: year: decade: venue: vibe: bucket:" />
      </div>

      {loading && !items.length ? (
        <Skeleton id="x-content-buckets-loading" rows={8} variant="card" />
      ) : (
        <div id="x-content-buckets-layout" className="xce-bk-layout">
          <BucketRail buckets={buckets} counts={bucketCounts} selectedId={bucketId} onSelect={selectBucket} onUpsert={upsertBuckets} busy={busy} />
          <div id="x-content-buckets-main" className="xce-bk-main">
            <BucketToolbar
              views={views} viewId={searching ? 'all' : viewId} onView={setViewId}
              folders={bucketFolders} selectedFolder={selectedFolder} suggestions={folderSuggestions}
              bucketId={bucketId === 'all' ? (buckets[0]?.id || 'identity') : bucketId} busy={busy}
              onSaveFolder={upsertFolder} onDeleteFolder={deleteFolder}
              sourceLabel="Source" sourceActive={sourceOpen} onSource={() => setSourceOpen(true)}
              resultLabel={searching ? `${visible.length} results · all buckets` : `${visible.length} items`} />
            {visible.length && searching ? (
              // Search spans every bucket: group hits by bucket so cross-source matches read at a glance.
              <div id="x-content-search-results" className="xce-bk-results">
                {buckets.map((b) => {
                  const hits = visible.filter((i) => i._bucketId === b.id);
                  if (!hits.length) return null;
                  return (
                    <section key={b.id} id={`x-content-search-group-${b.id}`} className="xce-bk-result-group">
                      <h4 className="xce-bk-result-head"><span className="xce-bk-dot" style={{ background: b.color || '#475569' }} />{b.name}<span className="xce-bk-count">{hits.length}</span></h4>
                      <ItemGrid items={hits} bucketById={bucketById} selectedItemId={openId} onOpen={setOpenId} call={call} />
                    </section>
                  );
                })}
              </div>
            ) : visible.length ? (
              <ItemGrid items={visible} bucketById={bucketById} selectedItemId={openId} onOpen={setOpenId} call={call} />
            ) : (
              <div className="xce-empty" id="x-content-buckets-empty">
                {searching ? 'Nothing matches that search.' : items.length ? 'No items in this view.' : 'No content yet. Add items on the Content tab.'}
              </div>
            )}
          </div>
        </div>
      )}

      {openItem ? (
        <ItemDrawer item={openItem} buckets={buckets} manualFolders={manualFolders} busy={busy} error={actionError} call={call}
          onClose={() => { setOpenId(null); setActionError(''); }} onSave={saveItem} onMove={moveItem} onAddToFolder={addToFolder} onReload={onReload} />
      ) : null}

      {sourceOpen ? (
        <SourcePanel bucket={bucketById[bucketId]} bucketId={bucketId} count={bucketItems.length}
          sync={{ ...sync, lastSyncText: sync.lastSyncAt ? ago(sync.lastSyncAt) : '' }}
          onSync={() => { syncRendered(true); loadMeta(); }}
          call={call} nasStatus={nasStatus} onReload={onReload} onClose={() => setSourceOpen(false)} />
      ) : null}
    </div>
    </NasContext.Provider>
  );
}
