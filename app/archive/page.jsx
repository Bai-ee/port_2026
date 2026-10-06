'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import QuickIngestPanel from '../../components/archive/QuickIngestPanel';
import { formatBytes, entriesFromResult, segmentsFor, joinPath, slugifyCollectionId, commonParent, flattenVisible, summarizeSelection } from './browser-utils';

const pipeline = ['NAS SOURCE', 'HASH + DEDUPE', 'TWELVELABS', 'JEV', 'HUMAN REVIEW', 'ARWEAVE'];

// A worker heartbeats at most every ~60s while idle; 3x that is a generous
// margin before treating it as gone rather than a missed poll.
const WORKER_OFFLINE_MS = 180000;

function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// PROCESSING/ERROR/PAUSED are trusted as-sent (the worker explicitly reported
// them). Anything else (ONLINE, or no state at all) is only trustworthy while
// recent — a heartbeat older than WORKER_OFFLINE_MS means the worker likely
// died without ever sending an OFFLINE heartbeat, so render it OFFLINE instead
// of a stale ONLINE forever.
function deriveWorkerDisplay(worker) {
  if (!worker) return { label: null, color: '#555', detail: '' };
  const { state, lastHeartbeatAt } = worker;
  const heartbeatAgo = lastHeartbeatAt ? relativeTime(lastHeartbeatAt) : '';
  if (state === 'PROCESSING') return { label: 'PROCESSING', color: '#4ade80', detail: heartbeatAgo };
  if (state === 'ERROR') return { label: 'ERROR', color: '#e0524f', detail: heartbeatAgo };
  if (state === 'PAUSED') return { label: 'PAUSED', color: '#e0b34d', detail: heartbeatAgo };
  const ageMs = lastHeartbeatAt ? Date.now() - Date.parse(lastHeartbeatAt) : Infinity;
  if (!Number.isFinite(ageMs) || ageMs > WORKER_OFFLINE_MS) {
    return { label: 'OFFLINE', color: '#555', detail: lastHeartbeatAt ? `last seen ${heartbeatAgo}` : 'never seen' };
  }
  return { label: state || 'ONLINE', color: '#4ade80', detail: heartbeatAgo };
}

// Organizer command results as the worker emits them (assetManager
// lib/archive/daemon.ts):
//   plan  → result.plan = { root, collectionId, moves[], skipped[], counts }
//   apply → result = { mode:'apply', jobId, root, collectionId, moved[], skipped[], counts, failedAt }
//   undo  → result = { jobId, restored: string[], errors[] }
// The panel renders one normalized { plan, applied, undone } shape.
function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function organizePlanFromResult(result) {
  if (!result) return null;
  if (result.plan) return result.plan;
  if (result.mode === 'apply') {
    const moves = result.moved || [];
    const skipped = result.skipped || [];
    return { root: result.root, collectionId: result.collectionId, moves, skipped, counts: result.counts || { moves: moves.length, skipped: skipped.length } };
  }
  return null;
}
function organizeAppliedFromResult(result) {
  if (!result) return null;
  if (result.applied) return result.applied;
  if (result.mode === 'apply') return { jobId: result.jobId, moved: (result.moved || []).length, failedAt: result.failedAt || null };
  return null;
}
function organizeUndoneFromResult(result) {
  if (!result) return null;
  if (result.undone) return result.undone;
  if (Array.isArray(result.restored)) return { jobId: result.jobId, restored: result.restored.length, errors: result.errors || [] };
  return null;
}

// Entries-per-folder cap for inline tree rendering (Phase 2). A folder this
// large renders a warning instead of rows — see renderExpandedFolderChildren
// / the root-listing render in ArchivePage. Kept as a module constant so the
// number lives in exactly one place.
const MAX_INLINE_ENTRIES = 2000;

export default function ArchivePage() {
  const { user, loading: authLoading } = useAuth();
  const authedFetch = useCallback(async (url, init={}) => {
    if (!user) throw new Error('ADMIN AUTH REQUIRED');
    const token = await user.getIdToken();
    return fetch(url,{...init,headers:{...(init.headers||{}),Authorization:`Bearer ${token}`},cache:init.cache||'no-store'});
  },[user]);
  const [workers, setWorkers] = useState([]);
  const [status, setStatus] = useState('CONNECTING');
  const [relativePath, setRelativePath] = useState('.');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [commandState, setCommandState] = useState('');
  const [browserEntries, setBrowserEntries] = useState([]);
  const [browserCounts, setBrowserCounts] = useState({ folders: 0, files: 0 });
  const [browseState, setBrowseState] = useState('');
  // Listing cache keyed by `${sourceId}::${relativePath}` so revisiting a
  // folder renders instantly while a background refresh replaces it.
  const listingCacheRef = useRef(new Map());
  // Bumped on every navigation; a poll whose requestId no longer matches the
  // latest one belongs to a path the user has already navigated away from,
  // so its result is dropped instead of clobbering the current listing.
  const browseRequestRef = useRef(0);

  // ── Tree browser (Phase 2) ────────────────────────────────────────────
  // Which folder paths (relative to the source root, independent of the
  // navigated `relativePath`) are expanded inline.
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  // Lazily-loaded listings for expanded folders, keyed by their own
  // relativePath: { entries, counts, status, error }. The navigated root's
  // own listing stays in browserEntries/browserCounts/browseState.
  const [nodeListings, setNodeListings] = useState({});

  // ── Selection (Phase 2) ───────────────────────────────────────────────
  // relativePath -> { kind, sizeBytes? }. Selecting a folder selects it as
  // one item; entries rendered under it are shown "implied" (muted,
  // checked, disabled) rather than individually selected.
  const [selected, setSelected] = useState(() => new Map());
  const [lastClickedPath, setLastClickedPath] = useState(null);
  const [selectionCollectionName, setSelectionCollectionName] = useState('');
  const [selectionAnalyzeState, setSelectionAnalyzeState] = useState('');
  const [selectionBusy, setSelectionBusy] = useState(false);
  // Media-only hashing (CANCEL_JOB + media-only workstream): default ON for
  // ADD TO ANALYZER selections. PROCESS FOLDER (the older button) always
  // sends mediaOnly:false regardless of this toggle — see processCollection.
  const [selectionMediaOnly, setSelectionMediaOnly] = useState(true);
  // CANCEL_JOB support: which command followSelectionCommand is currently
  // polling (so the CANCEL button knows what to target) and whether a cancel
  // has been requested for it (drives the CANCELLING… status text/disabled
  // state). Refs, not state, because the value must be read fresh from
  // inside followSelectionCommand's already-in-flight poll loop closure.
  const followedSelectionCommandIdRef = useRef(null);
  const selectionCancelRequestedRef = useRef(false);
  const [selectionCancelling, setSelectionCancelling] = useState(false);
  // The selection actually sent on the last successful ADD TO ANALYZER —
  // {collectionId, items}. The organizer panel scopes to it only while the
  // live selection still matches it exactly.
  const [lastAnalyzedSelection, setLastAnalyzedSelection] = useState(null);
  const autoCollectionNameRef = useRef('');

  const [reviewItems,setReviewItems]=useState([]);
  const [reviewState,setReviewState]=useState('');
  const [recentCommands,setRecentCommands]=useState([]);

  // PERMANENT ARCHIVE status (W7a) — no per-asset approval click, no
  // collection form. Documented assets are auto-uploaded by the worker;
  // this card is a read-only aggregate over archive_collections /
  // archive_review / archive_uploads / archive_records, plus the two admin
  // actions that still make sense as explicit buttons (viewer deploy, a
  // manual manifest-rebuild fallback). See api/_lib/archive-permanent-archive.cjs.
  const [permanentSummary,setPermanentSummary]=useState({collections:[],viewer:null,permanence:{autoUpload:false}});
  const [permanentSummaryState,setPermanentSummaryState]=useState('');
  const [viewerDeployState,setViewerDeployState]=useState('');
  const [manifestRebuildState,setManifestRebuildState]=useState({});

  const loadPermanentSummary=useCallback(async()=>{
    if(!user)return;
    try{
      const r=await authedFetch('/api/archive/approved?summary=1');
      const b=await r.json();
      if(r.ok){setPermanentSummary({collections:b.collections||[],viewer:b.viewer||null,permanence:b.permanence||{autoUpload:false}});setPermanentSummaryState('');}
      else setPermanentSummaryState(b.error||'SUMMARY FAILED');
    }catch{setPermanentSummaryState('SUMMARY OFFLINE');}
  },[user,authedFetch]);
  useEffect(()=>{loadPermanentSummary();},[loadPermanentSummary]);
  useEffect(()=>{
    if(!user)return;
    const t=setInterval(()=>loadPermanentSummary(),10000);
    return()=>clearInterval(t);
  },[user,loadPermanentSummary]);

  async function deployViewer(){
    setViewerDeployState('DEPLOYING');
    try{
      const r=await authedFetch('/api/archive/arweave/collection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'deploy-viewer'})});
      const b=await r.json();
      if(!r.ok){setViewerDeployState(b.error||'DEPLOY FAILED');return;}
      if(b.ok===false){setViewerDeployState(b.reason==='auto-upload-off'?'AUTO UPLOAD OFF':(b.reason||'BLOCKED'));return;}
      setViewerDeployState(b.skipped?'ALREADY CURRENT':`QUEUED · ${(b.commandId||'').slice(0,8)}`);
      await loadPermanentSummary();
    }catch{setViewerDeployState('DEPLOY FAILED');}
  }

  async function rebuildManifestFor(collectionId){
    setManifestRebuildState(s=>({...s,[collectionId]:'REBUILDING'}));
    try{
      const r=await authedFetch('/api/archive/arweave/collection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'rebuild-manifest',collectionId})});
      const b=await r.json();
      const label=!r.ok?(b.error||'FAILED'):(b.ok===false?(b.reason==='auto-upload-off'?'AUTO UPLOAD OFF':(b.reason||'BLOCKED')):`QUEUED · ${(b.commandId||'').slice(0,8)}`);
      setManifestRebuildState(s=>({...s,[collectionId]:label}));
      if(r.ok&&b.ok!==false)await loadPermanentSummary();
    }catch{setManifestRebuildState(s=>({...s,[collectionId]:'FAILED'}));}
  }

  const loadReview=useCallback(async()=>{
    if(!user)return;
    try{const r=await authedFetch('/api/archive/review?state=REVIEW_PENDING');const b=await r.json();if(r.ok)setReviewItems(b.items||[]);}
    catch{setReviewState('REVIEW OFFLINE');}
  },[user,authedFetch]);

  useEffect(()=>{loadReview();},[loadReview]);

  async function confirmDecision(item,decision,value){
    setReviewState('SAVING');
    const r=await authedFetch('/api/archive/review',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:item.id,decisionId:decision.id||decision.question,value})});
    if(r.ok){
      const b=await r.json();
      setReviewItems(xs=>xs.filter(x=>x.id!==item.id));
      setReviewState(b.recordVersionQueued?`CONFIRMED · record v${b.recordVersionQueued} queued`:'CONFIRMED');
      await loadPermanentSummary();
    }else setReviewState('SAVE FAILED');
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        // This endpoint is admin-authenticated. Existing HITLOOP auth may return 403
        // until the operator is signed in; the WIP surface handles that explicitly.
        if (authLoading) return;
        if (!user) { setStatus('ADMIN AUTH REQUIRED'); return; }
        const response = await authedFetch('/api/archive/workers');
        if (!active) return;
        if (!response.ok) { setStatus(response.status === 403 ? 'ADMIN AUTH REQUIRED' : 'CONTROL PLANE ERROR'); return; }
        const body = await response.json();
        setWorkers(body.workers || []);
        setStatus((body.workers || []).length ? 'CONNECTED' : 'WAITING FOR WORKER');
      } catch { if (active) setStatus('CONTROL PLANE OFFLINE'); }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [user, authLoading, authedFetch]);

  const worker = workers[0];
  const workerDisplay = deriveWorkerDisplay(worker);
  // Browsable sources = the worker's registered sources minus its cloud-intake
  // scratch source. The worker doc's own `sourceId` is just the last source
  // that heartbeated, so it must not drive Browse / Process Folder.
  const browsableSources = (worker?.sources || []).filter((s) => s.kind !== 'cloud-intake' && s.label !== 'Cloud intake');
  const activeSourceId = (selectedSourceId && browsableSources.some((s) => s.sourceId === selectedSourceId))
    ? selectedSourceId
    : (browsableSources[0]?.sourceId || null);
  // A live processing job's counters win; once idle, fall back to the last
  // completed job's numbers instead of showing "—" (heartbeat route no
  // longer blanks `counters`, but a worker that hasn't run a job since this
  // fix shipped, or was reset, still only has lastJobCounters to show).
  const liveCounters = worker?.counters;
  const lastJobCounters = worker?.lastJobCounters;
  const counters = liveCounters || lastJobCounters || {};
  const countersFromLastJob = !liveCounters && !!lastJobCounters;

  const loadRecentCommands = useCallback(async () => {
    if (!user || !worker?.workerId) return;
    try {
      const r = await authedFetch(`/api/archive/commands/process?workerId=${encodeURIComponent(worker.workerId)}`);
      const b = await r.json();
      if (r.ok) setRecentCommands(b.commands || []);
    } catch { /* strip stays on its last known list */ }
  }, [user, authedFetch, worker?.workerId]);

  useEffect(() => { loadRecentCommands(); }, [loadRecentCommands]);
  useEffect(() => {
    if (!user || !worker?.workerId) return;
    const t = setInterval(() => loadRecentCommands(), 15000);
    return () => clearInterval(t);
  }, [user, worker?.workerId, loadRecentCommands]);

  function countsFromEntries(entries){
    return { folders: entries.filter(e=>e.kind==='folder').length, files: entries.filter(e=>e.kind==='file').length };
  }

  // Runs one LIST_DIRECTORY round trip for `path` and returns
  // { relativePath, entries, counts } (also filling listingCacheRef), or
  // { error } — with no side effects on component state. `navigateTo` (the
  // top-level root) and `loadNode` (a lazily-expanded tree child) both build
  // on this; each owns its own loading/error state.
  async function fetchListing(path) {
    if (!worker?.workerId || !activeSourceId) return { error: 'WAITING FOR WORKER + SOURCE' };
    const targetPath = path || '.';
    try {
      const response = await authedFetch('/api/archive/browse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workerId:worker.workerId,sourceId:activeSourceId,relativePath:targetPath})});
      const body = await response.json();
      if(!response.ok) return { error: body.error||'BROWSE FAILED' };
      const deadline = Date.now() + 60000; // 60s cap
      while (Date.now() < deadline) {
        await new Promise(r=>setTimeout(r,250));
        const poll=await authedFetch(`/api/archive/browse?commandId=${body.commandId}`);
        const data=await poll.json();
        if(data.state==='COMPLETE'){
          const result = data.result || {};
          const nextPath = result.relativePath || targetPath;
          const nextEntries = entriesFromResult(result);
          const nextCounts = result.counts || countsFromEntries(nextEntries);
          const listing = { relativePath: nextPath, entries: nextEntries, counts: nextCounts };
          listingCacheRef.current.set(`${activeSourceId}::${nextPath}`, listing);
          return listing;
        }
        if(data.state==='FAILED') return { error: data.error||'BROWSE FAILED' };
      }
      return { error: 'WORKER RESPONSE PENDING' };
    } catch {
      return { error: 'OFFLINE' };
    }
  }

  // Navigates the top-level browser root to `path` (breadcrumb / folder-name
  // click / BROWSE / ↑ UP) — sets relativePath + the top listing state.
  async function navigateTo(path = relativePath) {
    if (!worker?.workerId || !activeSourceId) { setBrowseState('WAITING FOR WORKER + SOURCE'); return; }
    const targetPath = path || '.';
    const requestId = (browseRequestRef.current += 1);
    const cacheKey = `${activeSourceId}::${targetPath}`;
    const cached = listingCacheRef.current.get(cacheKey);
    if (cached) {
      // Render the cached listing immediately; the fetch below refreshes it
      // in the background and replaces it once the fresh result lands.
      setRelativePath(cached.relativePath);
      setBrowserEntries(cached.entries);
      setBrowserCounts(cached.counts);
    }
    setBrowseState('LISTING…');
    const listing = await fetchListing(targetPath);
    if (browseRequestRef.current !== requestId) return; // superseded by a newer navigation
    if (listing.error) { setBrowseState(listing.error); return; }
    setRelativePath(listing.relativePath);
    setBrowserEntries(listing.entries);
    setBrowserCounts(listing.counts);
    setBrowseState('');
  }

  // Loads (or re-hydrates from cache) an expanded tree node's own children,
  // keyed by its relativePath — independent of the navigated root.
  async function loadNode(path, opts = {}) {
    const cacheKey = `${activeSourceId}::${path}`;
    const cached = !opts.force && listingCacheRef.current.get(cacheKey);
    if (cached) {
      setNodeListings(prev => ({ ...prev, [path]: { entries: cached.entries, counts: cached.counts, status: '', error: '' } }));
      return;
    }
    setNodeListings(prev => ({ ...prev, [path]: { ...(prev[path]||{}), status: 'LISTING…', error: '' } }));
    const listing = await fetchListing(path);
    setNodeListings(prev => (listing.error
      ? { ...prev, [path]: { ...(prev[path]||{}), status: '', error: listing.error } }
      : { ...prev, [path]: { entries: listing.entries, counts: listing.counts, status: '', error: '' } }));
  }

  function toggleExpand(path) {
    const isExpanded = expandedPaths.has(path);
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (isExpanded) next.delete(path); else next.add(path);
      return next;
    });
    if (!isExpanded) loadNode(path);
  }

  function openFolder(name){ navigateTo(joinPath(relativePath, name)); }
  function goUp(){
    if (relativePath==='.') return;
    const segments = segmentsFor(relativePath);
    navigateTo(segments.length>1 ? segments[segments.length-2].path : '.');
  }

  // Folders-then-files at any tree level (root and every expanded child use
  // the same ordering).
  function sortEntries(entries){
    const folders = entries.filter(e=>e.kind==='folder');
    const files = entries.filter(e=>e.kind!=='folder');
    return [...folders, ...files];
  }

  // True when `path` sits under a currently-selected folder — such rows
  // render "implied" (muted, checked, disabled) rather than individually
  // selectable, since selecting a folder already covers its subtree.
  function isImplied(path){
    for (const [selPath, meta] of selected) {
      if (meta?.kind === 'folder' && path.startsWith(`${selPath}/`)) return true;
    }
    return false;
  }

  // The tree shape flattenVisible() expects: the navigated root's own
  // entries plus every expanded folder's loaded children, keyed by path.
  function buildVisibleTree(){
    const children = {};
    for (const [path, node] of Object.entries(nodeListings)) {
      if (node?.entries) children[path] = { entries: sortEntries(node.entries) };
    }
    return { path: relativePath, entries: sortEntries(browserEntries), children };
  }

  function toggleSelectAllFilesInFolder(folderPath, entries){
    const fileEntries = entries.filter(e=>e.kind==='file');
    if (!fileEntries.length) return;
    setSelected(prev => {
      const next = new Map(prev);
      const selectableFiles = fileEntries.filter(e=>!isImplied(joinPath(folderPath,e.name)));
      const allSelected = selectableFiles.length>0 && selectableFiles.every(e=>next.has(joinPath(folderPath,e.name)));
      for (const e of selectableFiles) {
        const p = joinPath(folderPath, e.name);
        if (allSelected) next.delete(p); else next.set(p, { kind:'file', sizeBytes:e.sizeBytes });
      }
      return next;
    });
  }

  function toggleRowSelection(e, path, kind, sizeBytes){
    e.preventDefault();
    if (isImplied(path)) return;
    const shift = e.shiftKey;
    if (shift && lastClickedPath) {
      const rows = flattenVisible(buildVisibleTree(), expandedPaths);
      const idxA = rows.findIndex(r=>r.path===lastClickedPath);
      const idxB = rows.findIndex(r=>r.path===path);
      if (idxA !== -1 && idxB !== -1) {
        const [lo,hi] = idxA < idxB ? [idxA,idxB] : [idxB,idxA];
        setSelected(prev => {
          const next = new Map(prev);
          for (let i=lo;i<=hi;i+=1) {
            const row = rows[i];
            if (isImplied(row.path)) continue;
            next.set(row.path, { kind: row.kind, sizeBytes: row.entry?.sizeBytes });
          }
          return next;
        });
        setLastClickedPath(path);
        return;
      }
    }
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(path)) next.delete(path); else next.set(path, { kind, sizeBytes });
      return next;
    });
    setLastClickedPath(path);
  }

  // Renders one tree level's rows (folders-then-files), recursing into any
  // expanded folder's own loaded children.
  function renderTreeLevel(parentPath, entries, depth){
    return sortEntries(entries).map(entry => {
      const path = joinPath(parentPath, entry.name);
      const isFolder = entry.kind === 'folder';
      const movable = isFolder ? true : entry.movable === true;
      const implied = isImplied(path);
      const isChecked = implied || selected.has(path);
      const expanded = expandedPaths.has(path);
      return (
        <div key={path}>
          <div className="archive-browser-row" data-kind={entry.kind} data-path={path}
            style={{display:'flex',alignItems:'center',gap:8,padding:'8px 4px',borderBottom:'1px solid #1e1e1e',opacity:movable?1:.42,paddingLeft:4+depth*18,flexWrap:'wrap'}}>
            <input type="checkbox" aria-label={`Select ${entry.name}`} checked={isChecked} disabled={implied}
              onChange={()=>{}} onClick={(e)=>toggleRowSelection(e, path, entry.kind, entry.sizeBytes)}
              style={{flex:'0 0 auto',opacity:implied?.5:1,cursor:implied?'default':'pointer'}} />
            {isFolder ? (
              <button onClick={()=>toggleExpand(path)} aria-expanded={expanded} aria-label={`${expanded?'Collapse':'Expand'} ${entry.name}`}
                style={{flex:'0 0 auto',width:16,background:'transparent',border:0,color:'#999',cursor:'pointer',padding:0,font:'inherit'}}>
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              <span style={{flex:'0 0 auto',width:16,textAlign:'center',opacity:.4}}>·</span>
            )}
            {isFolder ? (
              <button onClick={()=>navigateTo(path)} style={{flex:'1 1 auto',minWidth:0,textAlign:'left',background:'transparent',color:'#eee',border:0,padding:0,cursor:'pointer',font:'inherit',overflowWrap:'anywhere'}}>
                {entry.name}
              </button>
            ) : (
              <span style={{flex:'1 1 auto',minWidth:0,color:'#ccc',overflowWrap:'anywhere'}}>{entry.name}</span>
            )}
            {!isFolder && (
              <>
                <span style={{fontSize:11,opacity:.6,whiteSpace:'nowrap',flex:'0 0 auto'}}>{formatBytes(entry.sizeBytes)}</span>
                {entry.ext && <span style={{fontSize:10,opacity:.5,border:'1px solid #333',borderRadius:6,padding:'2px 6px',textTransform:'uppercase',flex:'0 0 auto'}}>{entry.ext}</span>}
              </>
            )}
          </div>
          {isFolder && expanded && renderExpandedFolderChildren(path, depth+1)}
        </div>
      );
    });
  }

  // A loaded/loading/errored expanded folder's own child rows, plus its
  // "select all files here" header row. Guards MAX_INLINE_ENTRIES so a huge
  // folder warns instead of rendering (and re-expanding it re-reads the
  // cached listing rather than re-fetching, so the warning never re-fetches).
  function renderExpandedFolderChildren(path, depth){
    const node = nodeListings[path];
    if (!node || node.status) {
      return <div style={{paddingLeft:4+depth*18,fontSize:11,opacity:.5,padding:'6px 4px'}}>{node?.status || 'LISTING…'}</div>;
    }
    if (node.error) {
      return <div style={{paddingLeft:4+depth*18,fontSize:11,color:'#e0847f',padding:'6px 4px'}}>{node.error}</div>;
    }
    const entries = node.entries || [];
    const totalCount = (node.counts?.folders ?? entries.filter(e=>e.kind==='folder').length) + (node.counts?.files ?? entries.filter(e=>e.kind!=='folder').length);
    if (totalCount > MAX_INLINE_ENTRIES) {
      return <div style={{paddingLeft:4+depth*18,fontSize:11,opacity:.6,padding:'6px 4px'}}>{totalCount.toLocaleString()} entries — too many to browse inline (limit {MAX_INLINE_ENTRIES.toLocaleString()}). Use PROCESS FOLDER on this path directly, or narrow further.</div>;
    }
    const fileEntries = entries.filter(e=>e.kind==='file');
    const selectableFiles = fileEntries.filter(e=>!isImplied(joinPath(path,e.name)));
    const allFilesSelected = selectableFiles.length>0 && selectableFiles.every(e=>selected.has(joinPath(path,e.name)));
    return (
      <div>
        {fileEntries.length>0 && (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 4px',paddingLeft:4+depth*18,fontSize:11,opacity:.6}}>
            <input type="checkbox" checked={allFilesSelected} onChange={()=>toggleSelectAllFilesInFolder(path, entries)} aria-label={`Select all files in ${path}`} />
            <span>select all files here ({fileEntries.length})</span>
          </div>
        )}
        {renderTreeLevel(path, entries, depth)}
      </div>
    );
  }

  async function processCollection() {
    if (!worker?.workerId || !activeSourceId) { setCommandState('WAITING FOR WORKER + SOURCE'); return; }
    setCommandState('QUEUING');
    try {
      const response = await authedFetch('/api/archive/commands/process', {
        method:'POST', headers:{'content-type':'application/json'},
        // PROCESS FOLDER is the older, unscoped button — it always hashes
        // everything, unaffected by the ADD TO ANALYZER selection bar's
        // MEDIA ONLY toggle (see archive-selection-media-only-toggle below).
        body:JSON.stringify({workerId:worker.workerId, sourceId:activeSourceId, relativePath:relativePath || '.', mediaOnly:false}),
      });
      const body = await response.json();
      setCommandState(response.ok ? `QUEUED · ${body.commandId.slice(0,8)}` : (body.error || 'QUEUE FAILED'));
    } catch { setCommandState('QUEUE FAILED'); }
  }

  // ── Selection -> ADD TO ANALYZER (Phase 2) ───────────────────────────────
  const selectionSummary = summarizeSelection(selected);
  const selectionItems = useMemo(
    () => Array.from(selected.entries()).map(([itemPath, meta]) => ({ relativePath: itemPath, kind: meta.kind })),
    [selected],
  );
  function itemsEqual(a, b) {
    if (a.length !== b.length) return false;
    const key = (it) => `${it.kind}:${it.relativePath}`;
    const setA = new Set(a.map(key));
    if (setA.size !== a.length) return false;
    return b.every((it) => setA.has(key(it)));
  }
  // The organizer panel below only scopes to the last analyzed selection
  // while the live selection still matches it exactly; otherwise it falls
  // back to the folder-scoped behavior unchanged from Phase 1.
  const usingSelectionScope = Boolean(lastAnalyzedSelection) && itemsEqual(lastAnalyzedSelection.items, selectionItems);

  // Prefill the collection-name input from the selection: the single
  // folder's own slug when exactly one folder is selected, otherwise the
  // slug of the selection's common parent folder. Only auto-updates the
  // field while it still holds our own last suggestion, so a manually
  // edited name survives further selection changes.
  useEffect(() => {
    const base = (selectionItems.length === 1 && selectionItems[0].kind === 'folder')
      ? selectionItems[0].relativePath
      : commonParent(selectionItems.map((it) => it.relativePath));
    const slug = slugifyCollectionId(base);
    // Capture the previous suggestion BEFORE overwriting the ref: the state
    // updater runs later, and reading the ref inside it would compare against
    // the new slug, so the field would never follow the selection.
    const previousSuggestion = autoCollectionNameRef.current;
    autoCollectionNameRef.current = slug;
    setSelectionCollectionName(prev => (prev === '' || prev === previousSuggestion) ? slug : prev);
  }, [selectionItems]);

  function clearSelection() {
    setSelected(new Map());
    setLastClickedPath(null);
    setSelectionAnalyzeState('');
  }

  async function addSelectionToAnalyzer() {
    if (!worker?.workerId || !activeSourceId) { setSelectionAnalyzeState('WAITING FOR WORKER + SOURCE'); return; }
    if (selectionItems.length === 0) { setSelectionAnalyzeState('SELECT AT LEAST ONE ITEM'); return; }
    // Never send a meaningless `root` for a real selection: if the field is
    // blank (or still the empty-selection placeholder), derive the name from
    // the selection itself.
    const items = selectionItems;
    const derived = slugifyCollectionId(
      (items.length === 1 && items[0].kind === 'folder') ? items[0].relativePath : commonParent(items.map((it) => it.relativePath)),
    );
    const typed = slugifyCollectionId(selectionCollectionName || '');
    const collectionId = (!typed || typed === 'root') && derived !== 'root' ? derived : (typed || 'root');
    setSelectionBusy(true);
    setSelectionAnalyzeState('QUEUING');
    try {
      const response = await authedFetch('/api/archive/commands/process', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ workerId: worker.workerId, sourceId: activeSourceId, type:'PROCESS_SELECTION', collectionId, items, mediaOnly: selectionMediaOnly }),
      });
      const body = await response.json();
      if (!response.ok) { setSelectionAnalyzeState(body.error || 'QUEUE FAILED'); setSelectionBusy(false); return; }
      setSelectionAnalyzeState('QUEUED');
      await followSelectionCommand(body.commandId, { collectionId, items });
    } catch { setSelectionAnalyzeState('QUEUE FAILED'); setSelectionBusy(false); }
  }

  // Follow a PROCESS_SELECTION command to its end. A folder selection can hash
  // for many minutes (453 files ≈ 17 min over SMB was observed), so this
  // never gives up on a short timer: it polls until COMPLETE/FAILED (or the
  // 6 h cap) and shows the live state with elapsed time.
  async function followSelectionCommand(commandId, { collectionId, items }) {
    setSelectionBusy(true);
    followedSelectionCommandIdRef.current = commandId;
    selectionCancelRequestedRef.current = false;
    setSelectionCancelling(false);
    const started = Date.now();
    const final = await pollCommandUntilDone(commandId, (data) => {
      setSelectionAnalyzeState(selectionCancelRequestedRef.current
        ? `CANCELLING… · ${formatElapsed(Date.now() - started)}`
        : `${data.state || 'RUNNING'} · ${formatElapsed(Date.now() - started)}`);
    });
    if (final?.state === 'COMPLETE') {
      setSelectionAnalyzeState(`COMPLETE · ${formatElapsed(Date.now() - started)}`);
      setLastAnalyzedSelection({ collectionId, items });
    } else if (final?.state === 'FAILED') {
      setSelectionAnalyzeState(final.error || 'FAILED');
    } else {
      setSelectionAnalyzeState('STILL RUNNING — reload to keep following');
    }
    followedSelectionCommandIdRef.current = null;
    selectionCancelRequestedRef.current = false;
    setSelectionCancelling(false);
    setSelectionBusy(false);
    loadRecentCommands();
  }

  // CANCEL button (shown whenever a selection command is being followed —
  // see the archive-selection-cancel-button JSX). Posts CANCEL_JOB targeting
  // the command followSelectionCommand is currently polling, then leaves
  // that same poll loop to pick up the eventual FAILED/COMPLETE — it never
  // resolves this function's own promise or races the follow loop.
  async function cancelSelectionCommand() {
    const commandId = followedSelectionCommandIdRef.current;
    if (!commandId || !worker?.workerId || !activeSourceId || selectionCancelRequestedRef.current) return;
    selectionCancelRequestedRef.current = true;
    setSelectionCancelling(true);
    setSelectionAnalyzeState('CANCELLING…');
    try {
      await authedFetch('/api/archive/commands/process', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ workerId: worker.workerId, sourceId: activeSourceId, type:'CANCEL_JOB', commandId }),
      });
    } catch { /* the existing follow loop keeps polling regardless; the owner can retry CANCEL if this POST itself failed */ }
  }

  // After a reload, pick up a PROCESS_SELECTION that is still in flight for
  // this worker (the recent-commands strip carries collectionId + itemCount)
  // so the bar shows RUNNING instead of nothing.
  const resumedSelectionCommandRef = useRef('');
  useEffect(() => {
    const live = recentCommands.find(c => c.type === 'PROCESS_SELECTION' && (c.state === 'QUEUED' || c.state === 'CLAIMED' || c.state === 'RUNNING'));
    if (!live || resumedSelectionCommandRef.current === live.id || selectionBusy) return;
    resumedSelectionCommandRef.current = live.id;
    setSelectionAnalyzeState(`${live.state} · ${live.collectionId || ''} (${live.itemCount ?? '?'} items) · resumed`);
    followSelectionCommand(live.id, { collectionId: live.collectionId, items: selectionItems });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentCommands]);

  // ── Organize (W-B): plan/apply/undo the folder selected above into the
  // worker's owned NAS root — docs/plans/ARCHIVE-NAS-STAGING-MASTER-PLAN-2026-09-20.md §3b.
  const [organizeResults, setOrganizeResults] = useState({}); // `${sourceId}::${relativePath}` -> {plan, applied, undone, lastActionWasApply}
  const [organizePolling, setOrganizePolling] = useState('');
  const [organizeError, setOrganizeError] = useState('');
  const [undoConfirming, setUndoConfirming] = useState(false);
  const [skippedOpen, setSkippedOpen] = useState(false);

  useEffect(() => { setUndoConfirming(false); setOrganizeError(''); }, [activeSourceId, relativePath, usingSelectionScope, lastAnalyzedSelection?.collectionId]);

  // Land on the drive's top level automatically: as soon as a worker and a
  // browsable source are online, list the source root once per source so the
  // owner sees the top-level folders and files without clicking BROWSE.
  const autoBrowsedSourceRef = useRef('');
  useEffect(() => {
    if (!worker?.workerId || !activeSourceId) return;
    if (autoBrowsedSourceRef.current === activeSourceId) return;
    autoBrowsedSourceRef.current = activeSourceId;
    navigateTo('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker?.workerId, activeSourceId]);

  // Panel keying: a live-selection scope keys on its collectionId (stable
  // across folder navigation); otherwise the folder-scoped
  // `${sourceId}::${relativePath}` key from Phase 1.
  const organizeScopeKey = usingSelectionScope ? lastAnalyzedSelection.collectionId : `${activeSourceId || ''}::${relativePath}`;

  // Best-effort seed from the shared "recent commands" strip (now carrying
  // sourceId/relativePath/collectionId/mode/result for
  // ORGANIZE_COLLECTION/UNDO_ORGANIZE — see commands/process route GET) so a
  // plan/apply/undo already among the worker's last 5 commands survives a
  // reload. Local session state (set directly by runOrganizeCommand below)
  // always wins once present.
  useEffect(() => {
    if (!activeSourceId) return;
    const key = organizeScopeKey;
    const scoped = usingSelectionScope
      ? recentCommands.filter(c => c.sourceId === activeSourceId && c.collectionId === lastAnalyzedSelection.collectionId && c.state === 'COMPLETE' && (c.type === 'ORGANIZE_COLLECTION' || c.type === 'UNDO_ORGANIZE'))
      : recentCommands.filter(c => c.sourceId === activeSourceId && c.relativePath === relativePath && c.state === 'COMPLETE' && (c.type === 'ORGANIZE_COLLECTION' || c.type === 'UNDO_ORGANIZE'));
    if (!scoped.length) return;
    setOrganizeResults(prev => {
      const existing = prev[key];
      if (existing && (existing.plan || existing.applied || existing.undone)) return prev;
      const planCmd = scoped.find(c => c.type === 'ORGANIZE_COLLECTION' && c.mode === 'plan');
      const applyCmd = scoped.find(c => c.type === 'ORGANIZE_COLLECTION' && c.mode === 'apply');
      const undoCmd = scoped.find(c => c.type === 'UNDO_ORGANIZE');
      // recentCommands is already sorted newest-first, so the first match here
      // is the most recent apply-or-undo action for this folder.
      const latestAction = scoped.find(c => (c.type === 'ORGANIZE_COLLECTION' && c.mode === 'apply') || c.type === 'UNDO_ORGANIZE');
      return {
        ...prev,
        [key]: {
          plan: organizePlanFromResult(planCmd?.result) || organizePlanFromResult(applyCmd?.result) || null,
          applied: organizeAppliedFromResult(applyCmd?.result),
          undone: organizeUndoneFromResult(undoCmd?.result),
          lastActionWasApply: latestAction ? (latestAction.type === 'ORGANIZE_COLLECTION' && latestAction.mode === 'apply') : false,
        },
      };
    });
  }, [recentCommands, activeSourceId, relativePath, usingSelectionScope, organizeScopeKey, lastAnalyzedSelection]);

  async function runOrganizeCommand(type, mode, kind) {
    if (!worker?.workerId || !activeSourceId) { setOrganizeError('WAITING FOR WORKER + SOURCE'); return; }
    const key = organizeScopeKey;
    setOrganizeError('');
    setOrganizePolling('QUEUING');
    try {
      const body = { workerId: worker.workerId, sourceId: activeSourceId, type };
      if (mode) body.mode = mode;
      if (usingSelectionScope) {
        body.collectionId = lastAnalyzedSelection.collectionId;
        if (type === 'ORGANIZE_COLLECTION') body.items = lastAnalyzedSelection.items;
      } else {
        body.relativePath = relativePath || '.';
      }
      const response = await authedFetch('/api/archive/commands/process', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body),
      });
      const respBody = await response.json();
      if (!response.ok) { setOrganizePolling(''); setOrganizeError(respBody.error || 'QUEUE FAILED'); return; }
      const commandId = respBody.commandId;
      setOrganizePolling('QUEUED');
      const started = Date.now();
      const data = await pollCommandUntilDone(commandId, (d) => setOrganizePolling(`${d.state || 'RUNNING'} · ${formatElapsed(Date.now() - started)}`));
      if (data?.state === 'COMPLETE') {
        setOrganizePolling('');
        setOrganizeResults(prev => {
          const existing = prev[key] || {};
          const next = { ...existing };
          if (kind === 'plan') next.plan = organizePlanFromResult(data.result);
          if (kind === 'apply') { next.applied = organizeAppliedFromResult(data.result); next.plan = organizePlanFromResult(data.result) || existing.plan || null; next.lastActionWasApply = true; }
          if (kind === 'undo') { next.undone = organizeUndoneFromResult(data.result); next.lastActionWasApply = false; }
          return { ...prev, [key]: next };
        });
        loadRecentCommands();
        return;
      }
      if (data?.state === 'FAILED') { setOrganizePolling(''); setOrganizeError(data.error || `${kind.toUpperCase()} FAILED`); return; }
      setOrganizePolling('STILL RUNNING — reload to keep following');
    } catch { setOrganizePolling(''); setOrganizeError('QUEUE FAILED'); }
  }

  // Shared command follower: 750 ms polls for the first 20 s, then every 2 s,
  // up to a 6 h cap. Resolves with the final command doc, or null on the cap.
  async function pollCommandUntilDone(commandId, onTick) {
    const cap = 6 * 60 * 60 * 1000;
    const started = Date.now();
    let ticks = 0;
    while (Date.now() - started < cap) {
      await new Promise(r => setTimeout(r, ticks < 27 ? 750 : 2000));
      ticks += 1;
      let data = null;
      try {
        const poll = await authedFetch(`/api/archive/commands/process?commandId=${commandId}`);
        data = await poll.json();
      } catch { continue; }
      if (data.state === 'COMPLETE' || data.state === 'FAILED') return data;
      onTick?.(data);
    }
    return null;
  }

  function planOrganize(){ runOrganizeCommand('ORGANIZE_COLLECTION','plan','plan'); }
  function applyOrganize(){ runOrganizeCommand('ORGANIZE_COLLECTION','apply','apply'); }
  function undoOrganize(){
    if (!undoConfirming) { setUndoConfirming(true); return; }
    setUndoConfirming(false);
    runOrganizeCommand('UNDO_ORGANIZE', undefined, 'undo');
  }

  const organizeState = organizeResults[organizeScopeKey] || {};
  const organizePlanForFolder = organizeState.plan;
  const organizeMoveCount = organizePlanForFolder?.counts?.moves ?? (organizePlanForFolder?.moves?.length || 0);
  const organizeSkipCount = organizePlanForFolder?.counts?.skipped ?? (organizePlanForFolder?.skipped?.length || 0);
  const organizeBytes = organizePlanForFolder?.counts?.bytes ?? 0;
  const canApplyOrganize = Boolean(activeSourceId) && organizeMoveCount > 0 && !organizePolling;
  const canUndoOrganize = Boolean(organizeState.lastActionWasApply) && !organizePolling;

  return (
    <main style={{minHeight:'100vh',background:'#080808',color:'#f4f4f0',fontFamily:'Arial, sans-serif',padding:'32px'}}>
      <div style={{maxWidth:1180,margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:48}}>
          <div><div style={{fontSize:12,letterSpacing:2,opacity:.5}}>HITLOOP / CREATIVE ARCHIVE</div><h1 style={{fontSize:48,margin:'8px 0'}}>Archive</h1></div>
          <div style={{border:'1px solid #333',borderRadius:999,padding:'8px 14px',fontSize:12}}>WIP · PHASE 2</div>
        </div>
        <section id="archive-source-panel" style={{border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:24,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>ARCHIVE SOURCE</div><h2 style={{margin:'8px 0'}}>Bryan NAS</h2><div style={{opacity:.6}}>WD My Cloud EX2 Ultra · ~1 TB</div></div>
            <div id="archive-worker-status-header" style={{textAlign:'right'}}>
              <div style={{fontSize:12,opacity:.45}}>WORKER</div>
              <div style={{marginTop:8}}>{worker ? <span><span style={{color:workerDisplay.color}}>●</span> {workerDisplay.label}</span> : `● ${status}`}</div>
              <div style={{fontSize:11,opacity:.4,marginTop:6}}>{worker ? workerDisplay.detail : ''}</div>
            </div>
          </div>
          <div style={{height:1,background:'#252525',margin:'24px 0'}} />
          <div id="archive-worker-counters-row" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {['discovered','hashed','duplicates','failed'].map(k=><div key={k}><div style={{fontSize:11,opacity:.4,textTransform:'uppercase'}}>{k}</div><div style={{fontSize:24,marginTop:6}}>{counters[k] ?? '—'}</div></div>)}
          </div>
          {countersFromLastJob && <div style={{fontSize:11,opacity:.4,marginTop:10}}>From last completed job{worker?.lastJobAt ? ` · ${relativeTime(worker.lastJobAt)}` : ''}</div>}
          <div id="archive-recent-commands-row" style={{marginTop:20,paddingTop:16,borderTop:'1px solid #252525'}}>
            <div style={{fontSize:11,opacity:.4,textTransform:'uppercase',marginBottom:8}}>Recent commands</div>
            {recentCommands.length === 0
              ? <div style={{opacity:.4,fontSize:12}}>No commands yet.</div>
              : recentCommands.map(c => (
                <div key={c.id} style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:12,padding:'6px 0',borderTop:'1px solid #1e1e1e'}}>
                  <span>{c.type}</span>
                  <span style={{opacity:.7}}>{c.state}{c.state === 'FAILED' && c.error ? ` · ${c.error}` : ''}</span>
                  <span style={{opacity:.4}}>{relativeTime(c.updatedAt || c.createdAt)}</span>
                </div>
              ))}
          </div>
        </section>
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{fontSize:12,opacity:.45}}>PROCESS A COLLECTION</div>
          <div id="archive-source-select-row" style={{display:'flex',gap:10,alignItems:'center',marginTop:12,fontSize:12,opacity:.7}}>
            <span>SOURCE</span>
            {browsableSources.length > 1
              ? <select id="archive-source-select" aria-label="Archive source" value={activeSourceId || ''} onChange={e=>{browseRequestRef.current+=1;listingCacheRef.current.clear();setSelectedSourceId(e.target.value);setBrowserEntries([]);setBrowserCounts({folders:0,files:0});setBrowseState('');setRelativePath('.');setExpandedPaths(new Set());setNodeListings({});setSelected(new Map());setLastClickedPath(null);setLastAnalyzedSelection(null);setSelectionAnalyzeState('');setSelectionCollectionName('');}} style={{background:'#080808',color:'#f4f4f0',border:'1px solid #333',borderRadius:8,padding:'6px 10px'}}>
                  {browsableSources.map(s=><option key={s.sourceId} value={s.sourceId}>{s.label}{s.state&&s.state!=='ONLINE'?` · ${s.state}`:''}</option>)}
                </select>
              : <span style={{color:'#f4f4f0'}}>{browsableSources[0]?.label || 'no browsable source registered'}</span>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:12,flexWrap:'wrap'}}>
            <input aria-label="NAS relative folder" value={relativePath} onChange={e=>setRelativePath(e.target.value)} placeholder="Housepit/San Francisco/2008" style={{flex:'1 1 420px',background:'#080808',border:'1px solid #333',borderRadius:10,padding:'14px 16px',color:'#f4f4f0'}} />
            <button onClick={processCollection} style={{background:'#f4f4f0',color:'#080808',border:0,borderRadius:10,padding:'14px 20px',fontWeight:700,cursor:'pointer'}}>PROCESS FOLDER</button>
          </div>
          <div style={{display:'flex',gap:8,marginTop:12}}><button onClick={()=>navigateTo(relativePath)} style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'8px 12px'}}>BROWSE</button><button onClick={goUp} disabled={relativePath==='.'} style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'8px 12px'}}>↑ UP</button></div>
          <div id="archive-browser-panel" style={{marginTop:12,border:'1px solid #1e1e1e',borderRadius:14,padding:'14px 16px',background:'#0c0c0c',maxWidth:'100%',overflow:'hidden'}}>
            <div id="archive-browser-breadcrumb" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:4,fontSize:12}}>
              {segmentsFor(relativePath).map((seg,i,arr)=>{
                const isCurrent = seg.path===relativePath;
                return (
                  <span key={seg.path} style={{display:'inline-flex',alignItems:'center',gap:4}}>
                    <button onClick={()=>navigateTo(seg.path)} disabled={isCurrent} style={{background:'transparent',border:0,padding:0,font:'inherit',color:isCurrent?'#f4f4f0':'#9a9a9a',cursor:isCurrent?'default':'pointer'}}>{seg.name}</button>
                    {i<arr.length-1 && <span style={{opacity:.3}}>/</span>}
                  </span>
                );
              })}
            </div>
            <div id="archive-browser-counts-row" style={{fontSize:11,opacity:.45,marginTop:6}}>{browserCounts.folders ?? 0} folders · {browserCounts.files ?? 0} files</div>
            <div id="archive-browser-status" style={{fontSize:11,opacity:.5,marginTop:4,minHeight:14}}>{browseState}</div>
            {/* No inner height cap: the tree grows and the page scrolls, so a
                deep expansion is never trapped in a small scroll box. */}
            <div id="archive-browser-rows" style={{marginTop:10,overflowX:'hidden',border: browserEntries.length ? '1px solid #1a1a1a' : 'none',borderRadius:10}}>
              {(() => {
                const rootTotal = (browserCounts.folders ?? 0) + (browserCounts.files ?? 0);
                if (rootTotal > MAX_INLINE_ENTRIES) {
                  return <div style={{opacity:.6,fontSize:12,padding:'10px 2px'}}>{rootTotal.toLocaleString()} entries in this folder — too many to browse inline (limit {MAX_INLINE_ENTRIES.toLocaleString()}). Use PROCESS FOLDER on this path directly, or narrow into a subfolder.</div>;
                }
                if (browserEntries.length === 0) {
                  return <div style={{opacity:.4,fontSize:12,padding:'10px 2px'}}>{browseState ? '' : 'No listing yet — click BROWSE.'}</div>;
                }
                return renderTreeLevel(relativePath, browserEntries, 0);
              })()}
            </div>
          </div>
          <div id="archive-selection-bar" style={{position:'sticky',bottom:0,marginTop:12,padding:12,background:'#101010',border:'1px solid #262626',borderRadius:14,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',zIndex:2}}>
            <div style={{fontSize:12,opacity:.8,flex:'1 1 auto',minWidth:180}}>
              {selectionSummary.total} items · {selectionSummary.folders} folders · {selectionSummary.files} files · ~{formatBytes(selectionSummary.bytes)}
            </div>
            <label id="archive-selection-media-only-toggle" title="hash only video + image files; skip audio/projects/other"
              style={{display:'flex',alignItems:'center',gap:6,fontSize:11,opacity:.8,cursor:'pointer',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={selectionMediaOnly} onChange={e=>setSelectionMediaOnly(e.target.checked)} />
              MEDIA ONLY
            </label>
            <input id="archive-selection-collection-input" aria-label="Collection name" value={selectionCollectionName}
              onChange={e=>setSelectionCollectionName(e.target.value)}
              style={{background:'#080808',border:'1px solid #333',borderRadius:8,padding:'8px 10px',color:'#f4f4f0',minWidth:160,flex:'0 1 220px'}} />
            <button id="archive-selection-clear-button" onClick={clearSelection} disabled={selectionSummary.total===0}
              style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'10px 14px',cursor:selectionSummary.total===0?'default':'pointer',opacity:selectionSummary.total===0?.4:1}}>
              CLEAR
            </button>
            <button id="archive-selection-analyze-button" onClick={addSelectionToAnalyzer} disabled={selectionSummary.total===0 || selectionBusy}
              style={{background:'#f4f4f0',color:'#080808',border:0,borderRadius:10,padding:'10px 18px',fontWeight:700,cursor:(selectionSummary.total===0||selectionBusy)?'default':'pointer',opacity:(selectionSummary.total===0||selectionBusy)?.5:1}}>
              ADD TO ANALYZER
            </button>
            {selectionBusy && (
              <button id="archive-selection-cancel-button" onClick={cancelSelectionCommand} disabled={selectionCancelling}
                style={{background:'transparent',color:'#e0524f',border:'1px solid #e0524f',borderRadius:10,padding:'10px 18px',fontWeight:700,cursor:selectionCancelling?'default':'pointer',opacity:selectionCancelling?.5:1}}>
                CANCEL
              </button>
            )}
            <div id="archive-selection-status" style={{fontSize:11,opacity:.6,width:'100%'}}>{selectionAnalyzeState}</div>
          </div>
          <style>{`
            @media (max-width: 480px) {
              #archive-selection-bar { padding: 8px !important; }
              #archive-selection-collection-input { flex: 1 1 100% !important; min-width: 0 !important; }
            }
          `}</style>
          <div style={{fontSize:11,opacity:.5,marginTop:10}}>{commandState || 'Select a folder, then process it. Originals remain untouched.'}</div>
          <div style={{fontSize:11,opacity:.42,marginTop:8}}>Signed in: {user?.email || (authLoading ? 'checking…' : 'not authenticated')}</div>
        </section>
        <section id="archive-organize-plan-panel" style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>ORGANIZE COLLECTION</div><h3 style={{fontSize:20,margin:'8px 0'}}>Move into HITLOOP-ARCHIVE/&lt;collection&gt;/&lt;pillar&gt;</h3></div>
            <div style={{fontSize:11,opacity:.5,textAlign:'right'}}>{organizePolling || organizeError}</div>
          </div>
          <div id="archive-organize-scope-label" style={{fontSize:11,opacity:.55,textTransform:'uppercase',letterSpacing:.4,marginTop:4}}>
            {!activeSourceId ? 'NO SOURCE SELECTED' : usingSelectionScope ? `SELECTION: ${lastAnalyzedSelection.collectionId} (${lastAnalyzedSelection.items.length} items)` : `FOLDER: ${relativePath === '.' ? 'root' : relativePath}`}
          </div>
          <p style={{maxWidth:720,opacity:.6,lineHeight:1.5,fontSize:13}}>Plans and moves the scope above inside the worker's owned root. PLAN writes nothing to disk; only APPLY moves files, and only after a plan exists.</p>
          <div id="archive-organize-plan-actions-row" style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12,alignItems:'center'}}>
            <button id="archive-organize-plan-button" onClick={planOrganize} disabled={!activeSourceId || !!organizePolling}
              style={{background:'#f4f4f0',color:'#080808',border:0,borderRadius:10,padding:'12px 18px',fontWeight:700,cursor:(!activeSourceId||organizePolling)?'default':'pointer',opacity:(!activeSourceId||organizePolling)?.5:1}}>
              PLAN ORGANIZE
            </button>
            <button id="archive-organize-apply-button" onClick={applyOrganize} disabled={!canApplyOrganize}
              style={{background:'transparent',color:'#ddd',border:'1px solid #444',borderRadius:10,padding:'12px 18px',cursor:canApplyOrganize?'pointer':'default',opacity:canApplyOrganize?1:.4}}>
              APPLY
            </button>
            <button id="archive-organize-undo-button" onClick={undoOrganize} disabled={!canUndoOrganize}
              style={{background:undoConfirming?'#e0524f':'transparent',color:undoConfirming?'#fff':(canUndoOrganize?'#e0847f':'#665'),border:`1px solid ${canUndoOrganize?'#7a2f2d':'#333'}`,borderRadius:10,padding:'12px 18px',cursor:canUndoOrganize?'pointer':'default',opacity:canUndoOrganize?1:.4}}>
              {undoConfirming ? 'CONFIRM UNDO' : 'UNDO'}
            </button>
            {undoConfirming && <button onClick={()=>setUndoConfirming(false)} style={{background:'transparent',color:'#888',border:'1px solid #333',borderRadius:10,padding:'12px 14px',cursor:'pointer'}}>CANCEL</button>}
          </div>
          <div id="archive-organize-plan-status" style={{fontSize:11,opacity:.5,marginTop:10}}>
            {organizePolling ? `Command ${organizePolling}` : (organizeError || (organizePlanForFolder ? 'Plan ready.' : 'No plan yet for this folder.'))}
          </div>
          {organizePlanForFolder && (
            <div id="archive-organize-plan-details" style={{marginTop:16,paddingTop:16,borderTop:'1px solid #252525'}}>
              <div id="archive-organize-plan-counts-row" style={{display:'flex',gap:20,flexWrap:'wrap',fontSize:12,opacity:.75}}>
                <span>{organizeMoveCount} moves</span>
                <span>{organizeSkipCount} skipped</span>
                <span>{formatBytes(organizeBytes)}</span>
                {organizeState.applied && <span style={{color: organizeState.applied.failedAt ? '#f87171' : '#4ade80'}}>{organizeState.applied.failedAt ? 'PARTIAL' : 'APPLIED'} · {organizeState.applied.moved} moved{organizeState.applied.failedAt ? ' · stopped, see journal' : ''}</span>}
                {organizeState.undone && <span style={{color:'#e0b34d'}}>UNDONE · {organizeState.undone.restored} restored</span>}
              </div>
              <div id="archive-organize-moves-table-shell" style={{marginTop:12,maxWidth:'100%',maxHeight:320,overflow:'auto',border:'1px solid #1e1e1e',borderRadius:10}}>
                <table style={{width:'100%',minWidth:560,borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr style={{textAlign:'left',opacity:.5}}>
                    <th style={{padding:'8px 10px',position:'sticky',top:0,background:'#101010'}}>FROM</th>
                    <th style={{padding:'8px 10px',position:'sticky',top:0,background:'#101010'}}>TO</th>
                    <th style={{padding:'8px 10px',position:'sticky',top:0,background:'#101010'}}>PILLAR</th>
                    <th style={{padding:'8px 10px',position:'sticky',top:0,background:'#101010'}}>CONFIDENCE</th>
                  </tr></thead>
                  <tbody>
                    {(organizePlanForFolder.moves||[]).map((m,i)=>(
                      <tr key={m.sha256||i} style={{borderTop:'1px solid #1e1e1e'}}>
                        <td style={{padding:'8px 10px',opacity:.8}}>{m.from}</td>
                        <td style={{padding:'8px 10px'}}>{m.to}</td>
                        <td style={{padding:'8px 10px',opacity:.8}}>{m.pillar||'_unsorted'}</td>
                        <td style={{padding:'8px 10px',opacity:.6}}>{m.confidence!=null?`${Math.round(Number(m.confidence)*100)}%`:'—'}</td>
                      </tr>
                    ))}
                    {(organizePlanForFolder.moves||[]).length===0 && <tr><td colSpan={4} style={{padding:'12px 10px',opacity:.5}}>No moves in this plan.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div id="archive-organize-skipped-panel" style={{marginTop:12}}>
                <button onClick={()=>setSkippedOpen(s=>!s)} style={{background:'transparent',color:'#ddd',border:'1px solid #333',borderRadius:8,padding:'8px 12px',cursor:'pointer',fontSize:11}}>
                  {skippedOpen?'▾':'▸'} SKIPPED ({organizeSkipCount})
                </button>
                {skippedOpen && (
                  <div style={{marginTop:10,maxHeight:220,overflowY:'auto',border:'1px solid #1e1e1e',borderRadius:10,padding:'4px 10px'}}>
                    {(organizePlanForFolder.skipped||[]).length===0
                      ? <div style={{opacity:.5,fontSize:12,padding:'8px 0'}}>Nothing skipped.</div>
                      : (organizePlanForFolder.skipped||[]).map((s,i)=>(
                        <div key={s.path||i} style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:12,padding:'6px 0',borderTop:i?'1px solid #1e1e1e':'none'}}>
                          <span style={{opacity:.8}}>{s.path}</span><span style={{opacity:.5}}>{s.reason}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        <QuickIngestPanel authedFetch={authedFetch} />
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16}}><div><div style={{fontSize:12,opacity:.45}}>HUMAN REVIEW</div><h3 style={{fontSize:24,margin:'8px 0'}}>Jev decisions · corrections mint a new record version</h3></div><div style={{fontSize:11,opacity:.5}}>{reviewItems.length} pending · {reviewState}</div></div>
          {reviewItems.length===0?<div style={{opacity:.5,padding:'18px 0'}}>No decisions waiting for review.</div>:reviewItems.map(item=><div key={item.id} style={{borderTop:'1px solid #252525',padding:'16px 0'}}>
            <div style={{fontSize:13,fontWeight:700}}>{item.archiveName||item.fileName||item.assetId||item.id}</div>
            {(item.decisions||[]).map((d,i)=><div key={d.id||i} style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',marginTop:12,flexWrap:'wrap'}}>
              <div><div style={{fontSize:12}}>{d.question}</div><div style={{fontSize:11,opacity:.5,marginTop:4}}>JEV · {d.selectedValue||d.selected||'—'} · {Math.round(Number(d.confidence||0)*100)}% · {d.reviewBand||''}</div></div>
              <div style={{display:'flex',gap:6}}>{(d.choices||[]).slice(0,4).map(ch=>{const value=typeof ch==='string'?ch:(ch.value||ch.label);return <button key={value} onClick={()=>confirmDecision(item,d,value)} style={{background:value===(d.selectedValue||d.selected)?'#f4f4f0':'transparent',color:value===(d.selectedValue||d.selected)?'#080808':'#ddd',border:'1px solid #444',borderRadius:999,padding:'7px 10px',cursor:'pointer'}}>{value}</button>})}</div>
            </div>)}
          </div>)}
        </section>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:16}}>
          {pipeline.map((x,i)=><div key={x} style={{border:'1px solid #252525',borderRadius:14,padding:16,minHeight:90,background:i<2?'#151515':'#0c0c0c'}}><div style={{fontSize:11,opacity:.4}}>0{i+1}</div><div style={{fontSize:12,marginTop:28}}>{x}</div></div>)}
        </div>
        <section id="archive-permanent-status-panel" style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24,background:'#101010'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
            <div><div style={{fontSize:12,opacity:.45}}>PERMANENT ARCHIVE</div><h3 style={{fontSize:24,margin:'8px 0'}}>Auto-uploaded once documented</h3></div>
            <div style={{fontSize:11,opacity:.5,textAlign:'right'}}>{permanentSummaryState}</div>
          </div>
          <p style={{maxWidth:720,opacity:.6,lineHeight:1.5,fontSize:13}}>There is no approval click. Once an asset is hashed, has READY TwelveLabs evidence and six Jev decisions, the worker uploads the original and a per-asset archive-record JSON to Arweave on its own — this card is a live status read, not a control. A human correction in Human Review above mints a new archive-record version; the collection manifest rebuilds automatically once every in-flight upload for that collection settles.</p>
          <div id="archive-permanence-auto-upload-status" style={{fontSize:11,opacity:.65,textTransform:'uppercase',letterSpacing:.4,marginTop:12}}>
            AUTO UPLOAD: <span style={{color:permanentSummary.permanence?.autoUpload?'#4ade80':'#e0b34d'}}>{permanentSummary.permanence?.autoUpload?'ON':'OFF'}</span>
          </div>

          <div id="archive-permanent-viewer-row" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:16,paddingTop:16,borderTop:'1px solid #252525'}}>
            <div>
              <div style={{fontSize:11,opacity:.45,textTransform:'uppercase'}}>Viewer</div>
              <div style={{fontSize:13,marginTop:4}}>
                {permanentSummary.viewer?.transactionId
                  ? <span>deployed · <a href={`https://arweave.net/${permanentSummary.viewer.transactionId}`} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>{permanentSummary.viewer.transactionId.slice(0,10)}…</a></span>
                  : 'not deployed to Arweave yet'}
              </div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:11,opacity:.5}}>{viewerDeployState}</span>
              <button onClick={deployViewer} style={{background:'transparent',color:'#fff',border:'1px solid #444',borderRadius:10,padding:'10px 14px',cursor:'pointer'}}>DEPLOY VIEWER</button>
            </div>
          </div>

          <div id="archive-permanent-collections-list" style={{marginTop:16}}>
            {permanentSummary.collections.length===0
              ? <div style={{opacity:.5,padding:'12px 0'}}>No collections yet — process a NAS folder above to start one.</div>
              : permanentSummary.collections.map(c=>(
                <div key={c.id} style={{borderTop:'1px solid #252525',padding:'16px 0',display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                    <div style={{fontSize:14,fontWeight:700}}>{c.title}</div>
                    <div style={{fontSize:12,opacity:.7}}>{c.documented} documented · {c.uploading} uploading · {c.uploaded} uploaded{c.failed?` · ${c.failed} failed`:''}</div>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:12,opacity:.65}}>
                    <div>
                      manifest {c.manifestVersion ? <>v{c.manifestVersion} · <a href={`https://arweave.net/${c.manifestTransactionId}`} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>{String(c.manifestTransactionId||'').slice(0,10)}…</a></> : 'not built yet'}
                      {' · '}record versions {c.recordVersionsTotal}
                      {' · '}{c.cost?.isLiveQuote
                        ? <>≈ ${c.cost.costUSD} <span style={{opacity:.5}}>(Turbo live · ${c.cost.usdPerGb}/GB)</span></>
                        : <>~{c.cost?.costAR ?? 0} AR <span style={{opacity:.5}}>(legacy estimate, not live)</span></>}
                    </div>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <a href={c.viewerUrl} target="_blank" rel="noreferrer" style={{color:'#ddd'}}>OPEN VIEWER ↗</a>
                      <span style={{opacity:.5}}>{manifestRebuildState[c.id]}</span>
                      <button onClick={()=>rebuildManifestFor(c.id)} style={{background:'transparent',color:'#fff',border:'1px solid #444',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:11}}>REBUILD MANIFEST</button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
        <section style={{marginTop:16,border:'1px solid #262626',borderRadius:20,padding:24}}>
          <div style={{fontSize:12,opacity:.45}}>CURRENT CHECKPOINT</div><h3 style={{fontSize:24,margin:'10px 0'}}>NAS → Jev review → permanent archive</h3>
          <p style={{maxWidth:720,opacity:.65,lineHeight:1.6}}>The control surface is now authenticated. Originals remain read-only; permanent Arweave upload is automatic once an asset is documented, and human review corrects the record afterward rather than gating it.</p>
        </section>
      </div>
    </main>
  );
}
