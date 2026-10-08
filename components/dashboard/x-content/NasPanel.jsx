'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, Image as ImageIcon, Film, X as XIcon, ArrowUp, Loader2, Check, Circle, RefreshCw } from 'lucide-react';
import { RetryError, Skeleton } from './Feedback.jsx';
import NasCopyMovePanel from './NasCopyMovePanel.jsx';
import { NAS_PROMPT_VERSION } from '../../../features/x-content-inventory/nas.js';

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
const num = (n) => (Number(n) || 0).toLocaleString('en-US');
const lastName = (p) => String(p || '').split('/').filter(Boolean).pop() || 'whole source';
const pathsLabel = (paths) => {
  const list = Array.isArray(paths) ? paths : [];
  if (!list.length) return 'whole source';
  return list.length === 1 ? lastName(list[0]) : `${lastName(list[0])} + ${list.length - 1} more`;
};
const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

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
  // Live price for the current selection, answered by the Mac analyzer directly (no cloud round trip, no model calls).
  const [live, setLive] = useState({ status: 'idle', data: null, error: '' });
  const [liveNonce, setLiveNonce] = useState(0); // bump to re-run the price check (Retry)
  const estimate = live.status === 'ready' ? live.data : null;
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

  const changeSource = (id) => { setSourceId(id); setPath(''); setParent(null); setSelected(new Map()); };
  const goTo = (p) => { setPath(p); };
  const toggle = (e) => {
    setSelected((s) => { const n = new Map(s); if (n.has(e.relativePath)) n.delete(e.relativePath); else n.set(e.relativePath, e.kind); return n; });
  };
  const allHere = entries.length > 0 && entries.every((e) => selected.has(e.relativePath));
  const toggleAll = () => {
    setSelected((s) => {
      const n = new Map(s);
      if (allHere) entries.forEach((e) => n.delete(e.relativePath));
      else entries.forEach((e) => n.set(e.relativePath, e.kind));
      return n;
    });
  };
  const clearSelected = () => { setSelected(new Map()); };

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
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [loadJobs]);


  // ---- actions ----
  const paths = [...selected.keys()];
  const dirCount = [...selected.values()].filter((k) => k === 'dir').length;
  const fileCount = paths.length - dirCount;
  const cap = Math.min(20, Math.max(0, Number(capUsd) || 0));
  const act = async (fn) => {
    setActionBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message || 'Action failed.'); } finally { setActionBusy(false); }
  };
  const pathsKey = paths.join('\n');
  useEffect(() => {
    if (!pathsKey || !sourceId || !base || !online) { setLive({ status: 'idle', data: null, error: '' }); return undefined; }
    const ctrl = new AbortController();
    setLive((l) => ({ status: 'loading', data: l.data, error: '' }));
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${base}/nas/estimate`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ sourceId, paths: pathsKey.split('\n'), promptVersion: NAS_PROMPT_VERSION }),
        });
        if (r.status === 404 || r.status === 501) { setLive({ status: 'unsupported', data: null, error: '' }); return; }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false || !j.estimate) throw new Error(j.error || 'Could not price this selection.');
        setLive({ status: 'ready', data: j.estimate, error: '' });
      } catch (err) {
        if (err.name === 'AbortError') return;
        setLive({ status: 'error', data: null, error: err.message || 'Could not price this selection.' });
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [pathsKey, sourceId, base, online, liveNonce]);

  const start = () => act(async () => {
    const r = await call('nas-process', { sourceId, paths, capUsd: cap });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not start processing.');
    setSelected(new Map());
    await loadJobs();
  });
  const cancel = (id) => act(async () => {
    const r = await call('nas-cancel', { commandId: id });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not cancel.');
    await loadJobs();
  });

  const crumbs = path ? path.split('/').filter(Boolean) : [];
  const shownJobs = jobs.filter((j) => j.type !== 'estimate').slice(0, 8);
  const activeJob = shownJobs.find((j) => !j.dryRun && !isTerminal(j.state) && String(j.state || '').toUpperCase() !== 'QUEUED') || null;
  const rootLabel = (sources.find((x) => x.id === sourceId) || sources[0])?.label || 'Root';

  const jobKind = (j) => {
    const st = String(j.state || '').toUpperCase();
    if (j.dryRun) return st === 'COMPLETE' ? 'estimate' : FAILED.has(st) ? 'estimate-failed' : 'estimate-running';
    if (/^cancel/i.test(String(j.error || '')) || st === 'CANCELLED') return 'cancelled';
    if (st === 'COMPLETE') return 'complete';
    if (FAILED.has(st)) return 'failed';
    if (st === 'QUEUED') return 'queued';
    return 'running';
  };
  const renderJob = (j) => {
    const kind = jobKind(j);
    const where = pathsLabel(j.paths);
    const total = j.final?.total ?? j.progress?.total ?? 0;
    const done = j.final?.done ?? j.progress?.done ?? 0;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const spent = usd(j.progress?.spentUsd ?? j.spentUsd);
    const est = j.estimate;
    let title; let detail;
    if (kind === 'estimate') {
      title = `Estimate · ${where}`;
      detail = `Estimate only: nothing was analyzed or charged. ${num(est?.files)} files would cost about ${usd(est?.estUsd)}${est?.cached ? ` (${num(est.cached)} already analyzed, skipped)` : ''}.`;
    } else if (kind === 'estimate-running') {
      title = `Estimate · ${where}`; detail = 'Counting files and pricing them. Free.';
    } else if (kind === 'estimate-failed') {
      title = `Estimate · ${where}`; detail = j.error || 'The estimate did not finish.';
    } else if (kind === 'complete') {
      title = `Analyzed · ${where}`;
      detail = `${num(done)} of ${num(total)} analyzed · ${spent} spent${j.final?.cached ? ` · ${num(j.final.cached)} reused from before` : ''}${j.final?.errorCount ? ` · ${num(j.final.errorCount)} errors` : ' · no errors'}`;
    } else if (kind === 'cancelled') {
      title = `Stopped · ${where}`;
      detail = total ? `You stopped it after ${num(done)} of ${num(total)} files · ${spent} spent. Files already analyzed were kept.` : 'You stopped it before any file was analyzed · nothing spent.';
    } else if (kind === 'failed') {
      title = `Failed · ${where}`; detail = `${num(done)} of ${num(total)} done · ${spent} spent. ${j.error || ''}`.trim();
    } else if (kind === 'queued') {
      title = `Waiting · ${where}`; detail = 'Sent. Waiting for the Mac analyzer to pick it up. If this stays here, the analyzer is not running.';
    } else {
      title = `Analyzing · ${where}`; detail = `${num(done)} of ${total ? num(total) : '?'} files · ${spent} spent so far`;
    }
    const running = kind === 'running';
    return (
      <div key={j.id} className={`xce-nas-job xce-nas-job-${kind}`}>
        <div className="xce-nas-job-head">
          <span className="xce-nas-job-state">{title}</span>
          <span className="xce-bk-count">{ago(j.createdAt)}</span>
          {!isTerminal(j.state) ? (
            <button type="button" className="xce-bk-icon xce-nas-cancel" aria-label="Stop this job" title="Stop" disabled={actionBusy} onClick={() => cancel(j.id)}><XIcon size={14} /></button>
          ) : null}
        </div>
        {running ? <div className="xce-nas-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div> : null}
        <p className="xce-field-hint">{detail}</p>
      </div>
    );
  };

  const planBillable = estimate ? Math.max(0, (estimate.files || 0) - (estimate.cached || 0)) : 0;
  const planPerFile = planBillable ? (Number(estimate?.estUsd) || 0) / planBillable : 0;
  const planWillDo = !estimate ? 0 : planPerFile > 0 ? Math.min(planBillable, Math.floor(cap / planPerFile)) : planBillable;

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
      </div>
      {mac === null ? <Skeleton id="x-content-nas-skeleton" rows={2} variant="tile" /> : null}
      {mac && !mounted ? (
        <div id="x-content-nas-setup" className="xce-nas-setup">
          <ul id="x-content-nas-setup-checklist" className="xce-checklist">
            <li id="x-content-nas-setup-analyzer" className={`xce-checklist-item ${offline ? 'is-todo' : 'is-ok'}`}>
              {offline ? <Circle size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
              <span>
                {offline ? 'Start the analyzer on this Mac: ' : 'Analyzer running on this Mac'}
                {offline ? <code id="x-content-nas-analyzer-cmd" className="xce-nas-cmd">npm run archive:analyzer</code> : null}
              </span>
            </li>
            <li id="x-content-nas-setup-mount" className={`xce-checklist-item ${mounted ? 'is-ok' : 'is-todo'}`}>
              <Circle size={13} aria-hidden="true" />
              <span>{offline ? 'Mount the NAS (Quick connect appears once the analyzer is running)' : 'Mount the NAS: press Quick connect'}</span>
            </li>
            <li id="x-content-nas-setup-browser" className="xce-checklist-item is-todo">
              <Circle size={13} aria-hidden="true" />
              <span>Use Chrome on this Mac</span>
            </li>
          </ul>
          <button type="button" id="x-content-nas-setup-retry" className="xce-btn-ghost" onClick={refreshMac}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : null}

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
            : browseError ? <li className="xce-nas-empty is-error"><RetryError id="x-content-nas-browse-error" message={browseError} onRetry={() => browse(sourceId, path)} busy={browsing} /></li>
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

      {mounted ? (
        <NasCopyMovePanel base={base} sources={sources} sourceId={sourceId} path={path} selected={selected} clearSelected={clearSelected} onDone={() => browse(sourceId, path)} />
      ) : null}

      <div id="x-content-nas-controls" className="xce-nas-controls">
        <div className="xce-field xce-nas-cap">
          <label htmlFor="x-content-nas-cap">Cap $ (max 20)</label>
          <input id="x-content-nas-cap" className="xce-input" type="number" inputMode="decimal" min="0" max="20" step="0.5" value={capUsd}
            onChange={(e) => setCapUsd(e.target.value)} />
        </div>
      </div>
      <div id="x-content-nas-plan" className="xce-nas-plan" aria-live="polite">
        {!paths.length ? (
          <p className="xce-field-hint">Tick a folder or files above. The price shows here right away. Looking is free; nothing is analyzed or charged until you press Start.</p>
        ) : live.status === 'unsupported' ? (
          <p className="xce-field-hint">Restart the Mac analyzer to see prices here.</p>
        ) : live.status === 'error' ? (
          <RetryError id="x-content-nas-plan-error" message={live.error} onRetry={() => setLiveNonce((n) => n + 1)} />
        ) : !estimate ? (
          <p className="xce-field-hint">Counting the files in {pathsLabel(paths)} and pricing them…</p>
        ) : (
          <>
            <p id="x-content-nas-estimate-result" className="xce-nas-plan-main">
              {num(estimate.files)} files in {pathsLabel(paths)} ({num(estimate.images)} images, {num(estimate.videos)} videos).
              {estimate.cached ? ` ${num(estimate.cached)} already analyzed, so they are skipped and free.` : ' None are analyzed yet.'}
              {' '}{num(Math.max(0, estimate.files - estimate.cached))} new files would cost about {usd(estimate.estUsd)}.
            </p>
            <p id="x-content-nas-plan-cap" className="xce-nas-plan-cap">
              {planWillDo >= planBillable
                ? `Your cap of ${usd(cap)} covers all of it.`
                : `Your cap of ${usd(cap)} will stop it after about ${num(planWillDo)} of ${num(planBillable)} new files. Raise the cap to analyze everything.`}
            </p>
            <p className="xce-field-hint">{estimate.basis === 'measured' ? `Priced from your real average of ${usd(estimate.perFileUsd)} per file over ${num(estimate.samples)} files.` : 'Priced from the model rate card until enough real files are analyzed.'} Nothing has been analyzed or charged yet.</p>
          </>
        )}
      </div>
      <button type="button" id="x-content-nas-start" className="xce-btn-primary xce-nas-start" disabled={!online || !paths.length || actionBusy || live.status === 'loading'} onClick={start}>
        {actionBusy ? 'Working…' : estimate ? `Start: analyze ${num(planWillDo)} files (up to ${usd(cap)})` : `Start processing (up to ${usd(cap)})`}
      </button>
      <details className="xce-more" id="x-content-nas-organize-details">
        <summary className="xce-more-summary">Details</summary>
        <div className="xce-more-body">
          <p id="x-content-nas-organize-note" className="xce-field-hint">Analyzed files are copied into HITLOOP-ARCHIVE/content/&lt;type&gt;/&lt;year&gt;/ on the NAS. Originals are never moved.</p>
        </div>
      </details>
      {error ? <p className="xce-error" id="x-content-nas-error">{error}</p> : null}

      <div id="x-content-nas-jobs" className="xce-nas-jobs">
        <p className="xce-kicker">Jobs</p>
        <p id="x-content-nas-now" className={`xce-nas-now${activeJob ? ' is-busy' : ''}`}>
          {activeJob
            ? `Working now: ${pathsLabel(activeJob.paths)} · ${num(activeJob.progress?.done || 0)} of ${activeJob.progress?.total ? num(activeJob.progress.total) : '?'} files · ${usd(activeJob.progress?.spentUsd ?? activeJob.spentUsd)} spent so far.`
            : 'Nothing is running right now.'}
        </p>
        {!shownJobs.length ? <p className="xce-field-hint">No jobs yet.</p> : null}
        {shownJobs.slice(0, 3).map(renderJob)}
        {shownJobs.length > 3 ? (
          <details className="xce-more" id="x-content-nas-job-history-details">
            <summary className="xce-more-summary">Older jobs ({shownJobs.length - 3})</summary>
            <div className="xce-more-body" id="x-content-nas-job-history-body">
              {shownJobs.slice(3).map(renderJob)}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
