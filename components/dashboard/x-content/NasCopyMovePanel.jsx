'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, ArrowUp } from 'lucide-react';
import { ConfirmButton, RetryError } from './Feedback.jsx';

// NasCopyMovePanel — quick copy/move of the NAS selection to another folder.
// Talks to the Mac analyzer directly (`${base}/nas/ops/*`, loopback JSON).
// Flow: pick destination -> plan (preview) -> apply -> poll job.
// `selected` is NasPanel's Map (relativePath -> kind 'dir'|'file'; object values also tolerated).

const POLL_MS = 1500;
const OLD_ANALYZER = 'Restart the analyzer to enable copy/move';

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} KB`;
  return `${v} B`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const baseName = (p) => String(p || '').split('/').filter(Boolean).pop() || String(p || '');
const trunc = (s, n = 60) => { const t = String(s || ''); return t.length > n ? `…${t.slice(-n)}` : t; };
const isFinished = (j) => ['done', 'complete', 'completed', 'failed', 'cancelled', 'canceled', 'error'].includes(String(j?.state || '').toLowerCase());
const isDoneState = (j) => ['done', 'complete', 'completed'].includes(String(j?.state || '').toLowerCase());
const isFailedState = (j) => ['failed', 'error'].includes(String(j?.state || '').toLowerCase());

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error(OLD_ANALYZER);
  if (!r.ok || j.ok === false) throw new Error(j?.error || 'Request failed.');
  return j;
}

export default function NasCopyMovePanel({ base, sources = [], sourceId, path, selected, clearSelected, onDone }) {
  const [op, setOp] = useState(null); // 'copy' | 'move' | null (picker closed)
  const [destSourceId, setDestSourceId] = useState('');
  const [destPath, setDestPath] = useState('');
  const [destParent, setDestParent] = useState(null);
  const [destEntries, setDestEntries] = useState([]);
  const [destBusy, setDestBusy] = useState(false);
  const [destError, setDestError] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [recent, setRecent] = useState([]);
  const alive = useRef(true);
  const lastReq = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const paths = [...(selected?.keys?.() || [])];
  const count = paths.length;

  const reset = useCallback(() => { setOp(null); setPlan(null); setError(''); setJobId(null); setJob(null); }, []);

  // ---- destination browser (folders only) ----
  const browseDest = useCallback(async (sid, p) => {
    if (!sid || !base) return;
    setDestBusy(true); setDestError('');
    try {
      const r = await fetch(`${base}/nas/browse?sourceId=${encodeURIComponent(sid)}&path=${encodeURIComponent(p)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!alive.current) return;
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not browse this folder.');
      setDestEntries((Array.isArray(j.entries) ? j.entries : []).filter((e) => e.kind === 'dir'));
      setDestParent(typeof j.parent === 'string' ? j.parent : null);
    } catch (err) {
      if (alive.current) { setDestEntries([]); setDestError(err.message || 'Could not browse this folder.'); }
    } finally { if (alive.current) setDestBusy(false); }
  }, [base]);

  useEffect(() => {
    if (op && !plan && !jobId && destSourceId) browseDest(destSourceId, destPath);
  }, [op, plan, jobId, destSourceId, destPath, browseDest]);

  const open = (which) => {
    setOp(which); setPlan(null); setError(''); setJobId(null); setJob(null);
    setDestSourceId(sourceId || sources[0]?.id || '');
    setDestPath(path || '');
  };
  const changeDestSource = (id) => { setDestSourceId(id); setDestPath(''); setDestParent(null); };

  // ---- plan -> apply ----
  const runPlan = async () => {
    setBusy(true); setError('');
    const body = { op, sourceId, paths, destSourceId, destPath };
    lastReq.current = body;
    try {
      const j = await postJson(`${base}/nas/ops/plan`, body);
      if (alive.current) setPlan(j);
    } catch (err) {
      if (alive.current) setError(err.message || 'Could not plan this operation.');
    } finally { if (alive.current) setBusy(false); }
  };

  const runApply = async (p) => {
    if (!p?.ok || !p.planId) return; // never apply without a successful plan
    setBusy(true); setError('');
    try {
      const j = await postJson(`${base}/nas/ops/apply`, { planId: p.planId });
      if (alive.current) { setJobId(j.jobId); setJob(null); }
    } catch (err) {
      if (alive.current) setError(err.message || 'Could not start the operation.');
    } finally { if (alive.current) setBusy(false); }
  };

  const retry = async () => {
    setError(''); setJobId(null); setJob(null); setBusy(true);
    try {
      const j = await postJson(`${base}/nas/ops/plan`, lastReq.current || { op, sourceId, paths, destSourceId, destPath });
      if (!alive.current) return;
      setPlan(j);
      const a = await postJson(`${base}/nas/ops/apply`, { planId: j.planId });
      if (alive.current) setJobId(a.jobId);
    } catch (err) {
      if (alive.current) setError(err.message || 'Retry failed.');
    } finally { if (alive.current) setBusy(false); }
  };

  const cancelJob = async () => {
    if (!jobId) return;
    try { await postJson(`${base}/nas/ops/cancel`, { jobId }); } catch (err) { if (alive.current) setError(err.message || 'Could not cancel.'); }
  };

  // ---- poll jobs while a job is active ----
  const doneNotified = useRef(false);
  useEffect(() => {
    if (!jobId) return undefined;
    doneNotified.current = false;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`${base}/nas/ops/jobs`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (stopped || !alive.current) return;
        if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not read job status.');
        const list = Array.isArray(j.jobs) ? j.jobs : [];
        setRecent(list.slice(0, 3));
        const mine = list.find((x) => x.id === jobId || x.jobId === jobId);
        if (mine) {
          setJob(mine);
          if (isFinished(mine)) {
            stopped = true; clearInterval(timer);
            if (isDoneState(mine) && !doneNotified.current) { doneNotified.current = true; onDone?.(); clearSelected?.(); }
          }
        }
      } catch (err) {
        if (!stopped && alive.current) setError(err.message || 'Could not read job status.');
      }
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, base]);

  if (!count && !jobId && !op) return null;

  const destLabel = (sources.find((x) => x.id === destSourceId)?.label || destSourceId) + (destPath ? ` · ${destPath}` : '');
  const destCrumbs = destPath ? destPath.split('/').filter(Boolean) : [];
  const destRoot = sources.find((x) => x.id === destSourceId)?.label || 'Root';
  const verb = op === 'move' ? 'Move' : 'Copy';
  const t = plan?.totals || {};
  const pct = job && Number(job.bytes) > 0 ? Math.min(100, Math.round((Number(job.bytesDone) / Number(job.bytes)) * 100)) : 0;
  const running = job && !isFinished(job);

  return (
    <div id="x-content-nasops-panel" className="xce-nasops-panel">
      {!op ? (
        <div id="x-content-nasops-actions-row" className="xce-nasops-row">
          <span id="x-content-nasops-count" className="xce-nasops-count">{count} selected</span>
          <button type="button" id="x-content-nasops-copy-open" className="xce-btn-ghost" onClick={() => open('copy')}>Copy to…</button>
          <button type="button" id="x-content-nasops-move-open" className="xce-btn-ghost" onClick={() => open('move')}>Move to…</button>
        </div>
      ) : null}

      {op && !plan && !jobId ? (
        <div id="x-content-nasops-picker" className="xce-nasops-picker">
          <p className="xce-kicker">{verb} {plural(count, 'item')} to</p>
          {sources.length > 1 ? (
            <div className="xce-field">
              <label htmlFor="x-content-nasops-dest-source">Destination source</label>
              <select id="x-content-nasops-dest-source" className="xce-select" value={destSourceId} onChange={(e) => changeDestSource(e.target.value)}>
                {sources.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
              </select>
            </div>
          ) : null}
          <nav id="x-content-nasops-dest-breadcrumb" className="xce-nas-crumbs" aria-label="Destination folder path">
            <button type="button" id="x-content-nasops-dest-up" className="xce-nas-crumb" disabled={!destPath} aria-label="Up one folder" onClick={() => setDestPath(destParent != null ? destParent : destCrumbs.slice(0, -1).join('/'))}><ArrowUp size={12} /></button>
            <button type="button" className="xce-nas-crumb" onClick={() => setDestPath('')}>{destRoot}</button>
            {destCrumbs.map((c, i) => (
              <React.Fragment key={`${c}-${i}`}>
                <ChevronRight size={12} />
                <button type="button" className="xce-nas-crumb" onClick={() => setDestPath(destCrumbs.slice(0, i + 1).join('/'))}>{c}</button>
              </React.Fragment>
            ))}
          </nav>
          <ul id="x-content-nasops-dest-list" className="xce-nas-list xce-nasops-dest-list">
            {destBusy ? <li className="xce-nas-empty">Loading…</li>
              : destError ? <li className="xce-nas-empty is-error"><RetryError id="x-content-nasops-dest-error" message={destError} onRetry={() => browseDest(destSourceId, destPath)} busy={destBusy} /></li>
              : !destEntries.length ? <li className="xce-nas-empty">No subfolders.</li>
              : destEntries.map((e) => (
                <li key={e.relativePath} className="xce-nas-row">
                  <button type="button" className="xce-nas-name" onClick={() => setDestPath(e.relativePath)}><Folder size={14} /><span>{e.name}</span></button>
                </li>
              ))}
          </ul>
          <div id="x-content-nasops-picker-buttons" className="xce-nasops-buttons">
            <button type="button" id="x-content-nasops-use-folder" className="xce-btn-primary" disabled={busy || !destSourceId} onClick={runPlan}>
              {busy ? 'Planning…' : 'Use this folder'}
            </button>
            <button type="button" id="x-content-nasops-picker-cancel" className="xce-btn-ghost" onClick={reset}>Cancel</button>
          </div>
        </div>
      ) : null}

      {plan && !jobId ? (
        <div id="x-content-nasops-preview" className="xce-nasops-preview">
          <p id="x-content-nasops-preview-line" className="xce-nasops-line">
            {verb} {plural((plan.items || []).length || count, 'item')} ({plural(t.files || 0, 'file')}, {fmtBytes(t.bytes)}) to {destLabel}
          </p>
          {t.renamed > 0 ? <p className="xce-field-hint">{t.renamed} will be renamed to avoid overwriting</p> : null}
          {op === 'move' ? (
            <p className="xce-field-hint">{plan.sameShare ? 'Same share: instant rename' : 'Different drive share: copies first, then removes the originals (slower)'}</p>
          ) : null}
          {(plan.items || []).length ? (
            <details className="xce-more" id="x-content-nasops-items-details">
              <summary className="xce-more-summary">Items</summary>
              <div className="xce-more-body" id="x-content-nasops-items-body">
                {plan.items.map((it, i) => (
                  <p key={`${it.from}-${i}`} className="xce-field-hint">{baseName(it.from)} → {trunc(it.to)}{it.renamed ? ' (renamed)' : ''}{it.sizeBytes ? ` · ${fmtBytes(it.sizeBytes)}` : ''}</p>
                ))}
              </div>
            </details>
          ) : null}
          <div id="x-content-nasops-confirm-buttons" className="xce-nasops-buttons">
            {op === 'move' ? (
              <ConfirmButton id="x-content-nasops-move-confirm" label="Move" prompt="Move?" disabled={busy} onConfirm={() => runApply(plan)} />
            ) : (
              <button type="button" id="x-content-nasops-copy-confirm" className="xce-btn-primary" disabled={busy} onClick={() => runApply(plan)}>{busy ? 'Starting…' : 'Copy'}</button>
            )}
            <button type="button" id="x-content-nasops-back" className="xce-btn-ghost" disabled={busy} onClick={() => setPlan(null)}>Back</button>
            <button type="button" id="x-content-nasops-preview-cancel" className="xce-btn-ghost" disabled={busy} onClick={reset}>Cancel</button>
          </div>
        </div>
      ) : null}

      {jobId ? (
        <div id="x-content-nasops-job" className="xce-nasops-job">
          <p className="xce-nasops-line">
            {!job ? 'Starting…'
              : isDoneState(job) ? 'Done'
              : isFailedState(job) ? 'Failed'
              : String(job.state || '').toLowerCase() === 'cancelled' || String(job.state || '').toLowerCase() === 'canceled' ? 'Cancelled'
              : Number(job.attempt) > 1 ? `Retrying (attempt ${job.attempt})…` : `${verb === 'Move' ? 'Moving' : 'Copying'}…`}
            {job && Number(job.files) ? <span className="xce-bk-count"> {job.filesDone || 0}/{job.files}</span> : null}
          </p>
          <div className="xce-nas-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${isDoneState(job) ? 100 : pct}%` }} /></div>
          {running && job.currentFile ? <p id="x-content-nasops-current-file" className="xce-field-hint">{trunc(job.currentFile)}</p> : null}
          {isFailedState(job) && job.error ? <p className="xce-error">{job.error}</p> : null}
          <div id="x-content-nasops-job-buttons" className="xce-nasops-buttons">
            {running ? <button type="button" id="x-content-nasops-cancel" className="xce-btn-ghost" onClick={cancelJob}>Cancel</button> : null}
            {isFailedState(job) ? <button type="button" id="x-content-nasops-retry" className="xce-btn-primary" disabled={busy} onClick={retry}>Retry</button> : null}
            {job && isFinished(job) ? <button type="button" id="x-content-nasops-dismiss" className="xce-btn-ghost" onClick={() => { if (isDoneState(job)) onDone?.(); reset(); }}>{isDoneState(job) ? 'Refresh' : 'Close'}</button> : null}
          </div>
        </div>
      ) : null}

      {error ? <div id="x-content-nasops-error"><RetryError id="x-content-nasops-error-line" message={error} onRetry={op && !plan && !jobId ? runPlan : null} busy={busy} /></div> : null}

      {recent.length ? (
        <details className="xce-more" id="x-content-nasops-recent-details">
          <summary className="xce-more-summary">Recent copy/move jobs</summary>
          <div className="xce-more-body" id="x-content-nasops-recent-body">
            {recent.map((j, i) => (
              <p key={j.id || j.jobId || i} className="xce-field-hint">{String(j.op || j.type || 'job')} · {String(j.state || '')} · {j.filesDone || 0}/{j.files || 0} files{j.error ? ` · ${j.error}` : ''}</p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
