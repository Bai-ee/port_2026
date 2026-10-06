'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Image as ImageIcon, Film, X as XIcon, ArrowUp, Loader2 } from 'lucide-react';

// NasPanel — NAS processing: Mac connect status, folder browser, estimate, start, jobs.
// Status / connect / browse talk to the Mac analyzer DIRECTLY (`${localThumbBase}/nas/*`).
// Card actions (via `call`): nas-estimate / nas-process / nas-jobs / nas-cancel.
// `status.localThumbBase` comes from BucketsPanel's 20s nas-status poll.
// Jobs poll every 3s while mounted (1.5s while an estimate is pending).

// archive_commands states: QUEUED → CLAIMED → RUNNING → COMPLETE | FAILED.
const DONE = new Set(['COMPLETE']);
const FAILED = new Set(['FAILED', 'CANCELLED']);
const isTerminal = (s) => DONE.has(String(s || '').toUpperCase()) || FAILED.has(String(s || '').toUpperCase());
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const fmtSize = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} KB`;
  return v ? `${v} B` : '';
};

export default function NasPanel({ call, status, onReload }) {
  const base = String(status?.localThumbBase || '').replace(/\/+$/, '');
  const [mac, setMac] = useState(null); // null = checking; {offline:true} | /nas/status payload
  const [connecting, setConnecting] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [path, setPath] = useState('');
  const [parent, setParent] = useState(null);
  const [entries, setEntries] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [selected, setSelected] = useState(() => new Map()); // relativePath -> 'dir' | 'file'
  const [capUsd, setCapUsd] = useState('5');
  const [estimateId, setEstimateId] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const prevStates = useRef(new Map());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const sources = Array.isArray(mac?.sources) ? mac.sources : [];
  const offline = !base || !mac || mac.offline;
  const mounted = !offline && !!mac.mounted;
  const online = mounted; // server-queued actions need the analyzer; browsing needs the mount

  // ---- Mac status / connect (direct) ----
  const refreshMac = useCallback(async () => {
    if (!base) { setMac({ offline: true }); return; }
    try {
      const r = await fetch(`${base}/nas/status`, { cache: 'no-store' });
      if (!r.ok) throw new Error('status failed');
      const j = await r.json();
      if (alive.current) setMac(j);
    } catch { if (alive.current) setMac({ offline: true }); }
  }, [base]);
  useEffect(() => {
    refreshMac();
    const t = setInterval(refreshMac, 8000);
    return () => clearInterval(t);
  }, [refreshMac]);

  const connect = async () => {
    setConnecting(true); setError('');
    try {
      const r = await fetch(`${base}/nas/connect`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Could not connect to the NAS.');
      if (alive.current) setMac(j);
    } catch (err) {
      if (alive.current) setError(err.message || 'Could not connect to the NAS.');
    } finally { if (alive.current) setConnecting(false); }
  };

  useEffect(() => {
    if (!sources.length) return;
    if (!sources.some((x) => x.id === sourceId)) setSourceId(sources[0].id);
  }, [sources, sourceId]);

  // ---- browse (direct) ----
  const browse = useCallback(async (sid, p) => {
    if (!sid || !base) return;
    setBrowsing(true);
    setBrowseError('');
    try {
      const r = await fetch(`${base}/nas/browse?sourceId=${encodeURIComponent(sid)}&path=${encodeURIComponent(p)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!alive.current) return;
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not browse this folder.');
      setEntries(Array.isArray(j.entries) ? j.entries : []);
      setParent(typeof j.parent === 'string' ? j.parent : null);
      setTruncated(!!j.truncated);
    } catch (err) {
      if (alive.current) { setEntries([]); setTruncated(false); setBrowseError(err.message || 'Could not browse this folder.'); }
    } finally {
      if (alive.current) setBrowsing(false);
    }
  }, [base]);

  useEffect(() => {
    if (!sourceId || !mounted) return;
    browse(sourceId, path);
  }, [sourceId, path, mounted, browse]);

  const resetEstimate = () => { setEstimate(null); setEstimateId(null); };
  const changeSource = (id) => { setSourceId(id); setPath(''); setParent(null); setSelected(new Map()); resetEstimate(); };
  const goTo = (p) => { setPath(p); };
  const toggle = (e) => {
    setSelected((s) => { const n = new Map(s); if (n.has(e.relativePath)) n.delete(e.relativePath); else n.set(e.relativePath, e.kind); return n; });
    resetEstimate();
  };
  const allHere = entries.length > 0 && entries.every((e) => selected.has(e.relativePath));
  const toggleAll = () => {
    setSelected((s) => {
      const n = new Map(s);
      if (allHere) entries.forEach((e) => n.delete(e.relativePath));
      else entries.forEach((e) => n.set(e.relativePath, e.kind));
      return n;
    });
    resetEstimate();
  };
  const clearSelected = () => { setSelected(new Map()); resetEstimate(); };

  // ---- jobs poll ----
  const loadJobs = useCallback(async () => {
    try {
      const r = await call('nas-jobs');
      if (!alive.current || !r || r.ok === false) return;
      const list = Array.isArray(r.jobs) ? r.jobs : [];
      setJobs(list);
      let completed = false;
      for (const j of list) {
        const prev = prevStates.current.get(j.id);
        if (prev && !isTerminal(prev) && DONE.has(j.state) && j.type !== 'estimate') completed = true;
        prevStates.current.set(j.id, j.state);
      }
      if (completed) onReload?.();
    } catch { /* keep last list */ }
  }, [call, onReload]);
  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, estimateId && !estimate ? 1500 : 3000);
    return () => clearInterval(t);
  }, [loadJobs, estimateId, estimate]);

  useEffect(() => {
    if (!estimateId) return;
    const j = jobs.find((x) => x.id === estimateId);
    const est = j?.result?.estimate || j?.estimate;
    if (est) setEstimate(est);
    else if (j && FAILED.has(j.state)) { setError(j.error || 'Estimate failed.'); setEstimateId(null); }
  }, [jobs, estimateId]);

  // ---- actions ----
  const paths = [...selected.keys()];
  const dirCount = [...selected.values()].filter((k) => k === 'dir').length;
  const fileCount = paths.length - dirCount;
  const cap = Math.min(20, Math.max(0, Number(capUsd) || 0));
  const act = async (fn) => {
    setActionBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message || 'Action failed.'); } finally { setActionBusy(false); }
  };
  const runEstimate = () => act(async () => {
    setEstimate(null);
    const r = await call('nas-estimate', { sourceId, paths });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not estimate.');
    setEstimateId(r.commandId);
  });
  const start = () => act(async () => {
    const r = await call('nas-process', { sourceId, paths, capUsd: cap });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not start processing.');
    setSelected(new Map()); resetEstimate();
    await loadJobs();
  });
  const cancel = (id) => act(async () => {
    const r = await call('nas-cancel', { commandId: id });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not cancel.');
    await loadJobs();
  });

  const crumbs = path ? path.split('/').filter(Boolean) : [];
  const shownJobs = jobs.filter((j) => j.type !== 'estimate').slice(0, 8);
  const rootLabel = (sources.find((x) => x.id === sourceId) || sources[0])?.label || 'Root';

  let dotColor = '#a8a29e';
  let statusText = 'Analyzer offline — start it on the Mac';
  if (mac === null) statusText = 'Checking the Mac analyzer…';
  else if (!offline && mounted) { dotColor = '#16a34a'; statusText = `NAS connected${mac.mountPoint ? ` · ${mac.mountPoint}` : ''}`; }
  else if (!offline) { dotColor = '#d97706'; statusText = 'NAS not mounted'; }

  return (
    <div id="x-content-nas-panel" className="xce-nas-panel">
      <div id="x-content-nas-connect-row" className="xce-nas-connect-row">
        <p id="x-content-nas-status" className="xce-nas-status">
          <span className="xce-bk-dotmark" role="img" aria-label={statusText} style={{ background: dotColor, borderColor: dotColor }} />
          <span>{statusText}</span>
        </p>
        {!offline && !mounted ? (
          <button type="button" id="x-content-nas-quick-connect" className="xce-btn-primary" disabled={connecting} onClick={connect}>
            {connecting ? <><Loader2 size={14} className="xce-spin" /> Connecting…</> : 'Quick connect'}
          </button>
        ) : null}
        {mac && offline ? (
          <code id="x-content-nas-analyzer-cmd" className="xce-nas-cmd">npm run archive:analyzer</code>
        ) : null}
      </div>

      {sources.length > 1 ? (
        <div className="xce-field">
          <label htmlFor="x-content-nas-source">Source</label>
          <select id="x-content-nas-source" className="xce-select" value={sourceId} onChange={(e) => changeSource(e.target.value)}>
            {sources.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
          </select>
        </div>
      ) : sources.length === 1 ? (
        <p id="x-content-nas-source-label" className="xce-field-hint">Source: {sources[0].label || sources[0].id}</p>
      ) : null}

      <div id="x-content-nas-browser" className="xce-nas-browser">
        <nav id="x-content-nas-breadcrumb" className="xce-nas-crumbs" aria-label="Folder path">
          <button type="button" id="x-content-nas-up" className="xce-nas-crumb" disabled={!path || !mounted} aria-label="Up one folder" onClick={() => goTo(parent != null ? parent : crumbs.slice(0, -1).join('/'))}><ArrowUp size={12} /></button>
          <button type="button" className="xce-nas-crumb" onClick={() => goTo('')}>{rootLabel}</button>
          {crumbs.map((c, i) => (
            <React.Fragment key={`${c}-${i}`}>
              <ChevronRight size={12} />
              <button type="button" className="xce-nas-crumb" onClick={() => goTo(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </React.Fragment>
          ))}
        </nav>
        <label id="x-content-nas-select-all" className="xce-nas-selall">
          <input type="checkbox" checked={allHere} disabled={!entries.length || browsing} onChange={toggleAll} />
          <span>Select all in this folder</span>
        </label>
        <ul id="x-content-nas-entries" className="xce-nas-list">
          {!mounted ? <li className="xce-nas-empty">{offline ? 'Start the analyzer on the Mac, then connect.' : 'Quick connect to browse the NAS.'}</li>
            : browsing ? <li className="xce-nas-empty">Loading…</li>
            : browseError ? <li className="xce-nas-empty is-error">{browseError}</li>
            : !entries.length ? <li className="xce-nas-empty">Nothing here.</li>
            : entries.map((e) => {
              const isDir = e.kind === 'dir';
              const MediaIcon = e.mediaType === 'video' ? Film : ImageIcon;
              return (
                <li key={e.relativePath} className="xce-nas-row">
                  <input type="checkbox" aria-label={`Select ${e.name}`} checked={selected.has(e.relativePath)} onChange={() => toggle(e)} />
                  {isDir ? (
                    <button type="button" className="xce-nas-name" onClick={() => goTo(e.relativePath)}>
                      <Folder size={14} /><span>{e.name}</span>
                      {Number.isFinite(Number(e.childCount)) ? <em className="xce-nas-meta">{e.childCount}</em> : null}
                    </button>
                  ) : (
                    <span className="xce-nas-name is-file"><MediaIcon size={14} /><span>{e.name}</span>{e.sizeBytes ? <em className="xce-nas-meta">{fmtSize(e.sizeBytes)}</em> : null}</span>
                  )}
                </li>
              );
            })}
        </ul>
        {truncated ? <p className="xce-field-hint" id="x-content-nas-truncated">Showing the first part of a large folder — open a subfolder to narrow it.</p> : null}
        <p id="x-content-nas-selected-line" className="xce-nas-selected">
          {paths.length ? (
            <>{dirCount} folder{dirCount === 1 ? '' : 's'}, {fileCount} file{fileCount === 1 ? '' : 's'} selected · <button type="button" className="xce-nas-clear" onClick={clearSelected}>Clear</button></>
          ) : 'Nothing selected'}
        </p>
      </div>

      <div id="x-content-nas-controls" className="xce-nas-controls">
        <button type="button" id="x-content-nas-estimate" className="xce-btn-ghost" disabled={!online || !paths.length || actionBusy || (estimateId && !estimate)} onClick={runEstimate}>
          {estimateId && !estimate ? 'Estimating…' : `Estimate${paths.length ? ` (${paths.length})` : ''}`}
        </button>
        <div className="xce-field xce-nas-cap">
          <label htmlFor="x-content-nas-cap">Cap $ (max 20)</label>
          <input id="x-content-nas-cap" className="xce-input" type="number" inputMode="decimal" min="0" max="20" step="0.5" value={capUsd}
            onChange={(e) => setCapUsd(e.target.value)} />
        </div>
      </div>
      {estimate ? (
        <p id="x-content-nas-estimate-result" className="xce-nas-estimate">
          {estimate.files} files · {estimate.images} images · {estimate.videos} videos · {estimate.cached} cached · est {usd(estimate.estUsd)}
        </p>
      ) : null}
      <button type="button" id="x-content-nas-start" className="xce-btn-primary xce-nas-start" disabled={!online || !paths.length || actionBusy} onClick={start}>
        {actionBusy ? 'Working…' : 'Start processing'}
      </button>
      <p id="x-content-nas-organize-note" className="xce-field-hint">Analyzed files are copied into HITLOOP-ARCHIVE/content/&lt;type&gt;/&lt;year&gt;/ on the NAS. Originals are never moved.</p>
      {error ? <p className="xce-error" id="x-content-nas-error">{error}</p> : null}

      <div id="x-content-nas-jobs" className="xce-nas-jobs">
        <p className="xce-kicker">Jobs</p>
        {!shownJobs.length ? <p className="xce-field-hint">No jobs yet.</p> : shownJobs.map((j) => {
          const total = j.progress?.total || 0;
          const done = j.progress?.done || 0;
          const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
          const active = !isTerminal(j.state);
          return (
            <div key={j.id} className="xce-nas-job">
              <div className="xce-nas-job-head">
                <span className="xce-nas-job-state">{j.state}</span>
                <span className="xce-bk-count">{done}/{total} · {usd(j.progress?.spentUsd ?? j.spentUsd)}</span>
                {active ? (
                  <button type="button" className="xce-bk-icon xce-nas-cancel" aria-label="Cancel job" title="Cancel" disabled={actionBusy} onClick={() => cancel(j.id)}><XIcon size={14} /></button>
                ) : null}
              </div>
              <div className="xce-nas-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              {j.error ? <p className="xce-field-hint">{j.error}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
