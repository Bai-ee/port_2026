'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Check, Circle, Folder, Loader2, RefreshCw, X as XIcon } from 'lucide-react';
import { ConfirmButton, RetryError, Skeleton } from '../content-ui/Feedback.jsx';

// DiscogsPanel — read record labels on the Mac, match them to Discogs, review, add to the collection, undo.
// Free / read-only calls go to the Mac analyzer DIRECTLY (`${localThumbBase}/nas/status|browse`,
// `/discogs/status|estimate`). Everything that costs money or writes goes through `call(action)`:
// discogs-status / discogs-plan / discogs-jobs / discogs-cancel / discogs-records / discogs-decide /
// discogs-apply / discogs-undo. `status.localThumbBase` comes from BucketsPanel's nas-status poll.
// Contract: docs/plans/DISCOGS-PANEL-CONTRACT.md.

const PLAN_LIMIT = 300;
const APPLY_LIMIT = 100;
const ESTIMATE_TIMEOUT_MS = 180000; // first scan of a folder is slow (fingerprints over SMB)
const FINISHED = new Set(['COMPLETE', 'FAILED', 'CANCELLED']);
const isFinished = (s) => FINISHED.has(String(s || '').toUpperCase());
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const num = (n) => (Number(n) || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const lastName = (p) => String(p || '').split('/').filter(Boolean).pop() || 'whole source';
const slug = (s) => String(s || '').replace(/[^\w-]+/g, '-');
const releaseUrl = (id) => `https://www.discogs.com/release/${encodeURIComponent(id)}`;
const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const scoreLabel = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  return `${Math.round(n <= 1 ? n * 100 : n)}% match`;
};

const FILTERS = [
  { id: 'ready', label: 'Ready' },
  { id: 'review', label: 'Needs review' },
  { id: 'added', label: 'Added' },
  { id: 'owned', label: 'Already owned' },
  { id: 'unreadable', label: 'Unreadable' },
  { id: 'skipped', label: 'Skipped' },
];
// "adding" rows are in flight: they sit under Added.
const filterOf = (row) => (row?.status === 'adding' ? 'added' : row?.status);

function readLine(row) {
  const r = row?.read;
  if (!r) return row?.files?.[0] || row?.groupId || 'Unreadable photo';
  const main = [r.artist, r.title].filter(Boolean).join(' - ');
  return main || row?.files?.[0] || row?.groupId;
}
function metaLine(row) {
  const r = row?.read;
  const bits = r ? [r.label, r.catno, r.year].filter(Boolean) : [];
  const imgs = Number(row?.images) || 0;
  bits.push(plural(imgs, 'photo', 'photos'));
  return bits.join(' · ');
}
const reasonsOf = (c) => (Array.isArray(c?.reasons) ? c.reasons.join(', ') : String(c?.reasons || ''));
const decisionOf = (row) => {
  const d = row?.decision;
  if (!d) return null;
  if (typeof d === 'string') return { decision: d, releaseId: null };
  return { decision: d.decision, releaseId: d.releaseId ?? null };
};

export default function DiscogsPanel({ call, status, onReload }) {
  const base = String(status?.localThumbBase || '').replace(/\/+$/, '');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ---- setup: Mac / NAS (direct) + Discogs status (direct) + analyzer capabilities (cloud) ----
  const [mac, setMac] = useState(null); // null = checking; {offline:true} | /nas/status payload
  const [dstat, setDstat] = useState(null); // /discogs/status payload | {offline:true} | {unsupported:true}
  const [supports, setSupports] = useState(null); // discogs-status.supportsDiscogs
  const refreshSetup = useCallback(async () => {
    const [m, d, s] = await Promise.all([
      base ? fetch(`${base}/nas/status`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('x')))).catch(() => ({ offline: true })) : Promise.resolve({ offline: true }),
      base ? fetch(`${base}/discogs/status`, { cache: 'no-store' }).then(async (r) => {
        if (r.status === 404 || r.status === 501) return { unsupported: true };
        if (!r.ok) throw new Error('x');
        return r.json();
      }).catch(() => ({ offline: true })) : Promise.resolve({ offline: true }),
      call('discogs-status').catch(() => null),
    ]);
    if (!alive.current) return;
    setMac(m); setDstat(d);
    if (s && s.ok !== false) setSupports(!!s.supportsDiscogs);
  }, [base, call]);
  useEffect(() => {
    refreshSetup();
    const t = setInterval(refreshSetup, 10000);
    return () => clearInterval(t);
  }, [refreshSetup]);

  const macOffline = !base || !mac || mac.offline;
  const sources = Array.isArray(mac?.sources) ? mac.sources : [];
  const discogsLoaded = supports === true && !dstat?.unsupported;
  const hasToken = !!dstat?.configured?.discogsToken;
  const hasAnthropic = !!dstat?.configured?.anthropicKey;

  // ---- folder ----
  const [sourceId, setSourceId] = useState('');
  // mac.mounted is true only when EVERY NAS share is mounted; Discogs only needs the chosen source.
  const chosenSource = sources.find((x) => x.id === sourceId);
  const mounted = !macOffline && (chosenSource ? !!chosenSource.reachable : !!mac.mounted);
  const setupOk = !macOffline && discogsLoaded && hasToken && hasAnthropic && mounted;
  const [path, setPath] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [parent, setParent] = useState(null);
  const [entries, setEntries] = useState([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState('');

  useEffect(() => {
    if (folderTouched || !sources.length) return;
    const sid = dstat?.defaultSourceId && sources.some((x) => x.id === dstat.defaultSourceId) ? dstat.defaultSourceId : sources[0].id;
    setSourceId(sid);
    setPath(dstat?.defaultSourceId === sid && typeof dstat?.defaultPath === 'string' ? dstat.defaultPath : '');
  }, [sources, dstat, folderTouched]);

  const browse = useCallback(async (sid, p) => {
    if (!sid || !base) return;
    setBrowsing(true); setBrowseError('');
    try {
      const r = await fetch(`${base}/nas/browse?sourceId=${encodeURIComponent(sid)}&path=${encodeURIComponent(p)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!alive.current) return;
      if (!r.ok || j.ok === false) throw new Error(j?.error || 'Could not open this folder.');
      setEntries((Array.isArray(j.entries) ? j.entries : []).filter((e) => e.kind === 'dir'));
      setParent(typeof j.parent === 'string' ? j.parent : null);
    } catch (err) {
      if (alive.current) { setEntries([]); setBrowseError(err.message || 'Could not open this folder.'); }
    } finally { if (alive.current) setBrowsing(false); }
  }, [base]);
  useEffect(() => {
    if (!browseOpen || !sourceId || !mounted) return;
    browse(sourceId, browsePath);
  }, [browseOpen, sourceId, browsePath, mounted, browse]);

  const openBrowser = () => { setBrowsePath(path); setBrowseOpen((o) => !o); };
  const changeSource = (id) => { setFolderTouched(true); setSourceId(id); setPath(''); setBrowsePath(''); };
  const useFolder = () => { setFolderTouched(true); setPath(browsePath); setBrowseOpen(false); };
  const rootLabel = (sources.find((x) => x.id === sourceId) || sources[0])?.label || 'Root';
  const crumbs = browsePath ? browsePath.split('/').filter(Boolean) : [];
  const folderLabel = `${rootLabel}${path ? ` / ${path.split('/').filter(Boolean).join(' / ')}` : ''}`;

  // ---- live estimate (free, answered by the Mac, no model calls) ----
  const [live, setLive] = useState({ status: 'idle', data: null, error: '' });
  const [liveNonce, setLiveNonce] = useState(0);
  const estimate = live.status === 'ready' ? live.data : null;
  const canEstimate = !macOffline && mounted && discogsLoaded && !!sourceId;
  useEffect(() => {
    if (!canEstimate) { setLive({ status: 'idle', data: null, error: '' }); return undefined; }
    const ctrl = new AbortController();
    let timedOut = false;
    setLive((l) => ({ status: 'loading', data: l.data, error: '' }));
    const t = setTimeout(async () => {
      const guard = setTimeout(() => { timedOut = true; ctrl.abort(); }, ESTIMATE_TIMEOUT_MS);
      try {
        const r = await fetch(`${base}/discogs/estimate`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
          body: JSON.stringify({ sourceId, relativePath: path, limit: PLAN_LIMIT }),
        });
        if (r.status === 404 || r.status === 501) { setLive({ status: 'unsupported', data: null, error: '' }); return; }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not price this folder.');
        setLive({ status: 'ready', data: j, error: '' });
      } catch (err) {
        if (err.name === 'AbortError' && !timedOut) return;
        setLive({ status: 'error', data: null, error: timedOut ? 'Scanning this folder took too long. Try again; the second scan is much faster.' : (err.message || 'Could not price this folder.') });
      } finally { clearTimeout(guard); }
    }, 500);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [canEstimate, base, sourceId, path, liveNonce]);

  // ---- cap + plan ----
  const [capUsd, setCapUsd] = useState('2');
  const cap = Math.min(20, Math.max(0, Number(capUsd) || 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { if (alive.current) setError(err.message || 'Action failed.'); } finally { if (alive.current) setBusy(false); }
  };

  // ---- jobs + records ----
  const [jobs, setJobs] = useState([]);
  const [plan, setPlan] = useState(null);
  const [rows, setRows] = useState([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const prevStates = useRef(new Map());
  const loadRecords = useCallback(async () => {
    try {
      const r = await call('discogs-records');
      if (!alive.current || !r || r.ok === false) return;
      setPlan(r.plan || null);
      setRows(Array.isArray(r.rows) ? r.rows : []);
    } catch { /* keep last rows */ } finally { if (alive.current) setRecordsLoaded(true); }
  }, [call]);
  const loadJobs = useCallback(async () => {
    try {
      const r = await call('discogs-jobs');
      if (!alive.current || !r || r.ok === false) return;
      const list = Array.isArray(r.jobs) ? r.jobs : [];
      setJobs(list);
      let finished = false;
      for (const j of list) {
        const prev = prevStates.current.get(j.id);
        if (prev && !isFinished(prev) && isFinished(j.state)) finished = true;
        prevStates.current.set(j.id, j.state);
      }
      if (finished) { loadRecords(); onReload?.(); }
    } catch { /* keep last list */ }
  }, [call, onReload, loadRecords]);
  useEffect(() => {
    loadRecords();
    loadJobs();
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [loadJobs, loadRecords]);

  const planRunning = jobs.some((j) => String(j.type).toUpperCase() === 'DISCOGS_PLAN' && !isFinished(j.state));
  const canPlan = setupOk && !!sourceId && cap > 0 && !planRunning && !busy;
  const startPlan = () => act(async () => {
    const r = await call('discogs-plan', { sourceId, relativePath: path, limit: PLAN_LIMIT, capUsd: cap });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not start reading labels.');
    await loadJobs();
  });
  const cancel = (id) => act(async () => {
    const r = await call('discogs-cancel', { commandId: id });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not stop this job.');
    await loadJobs();
  });
  const undo = (job) => act(async () => {
    const r = await call('discogs-undo', { applyCommandId: job.id });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not start the undo.');
    await loadJobs();
  });

  // ---- results ----
  const [filter, setFilter] = useState('ready');
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [manual, setManual] = useState({});
  const [rowBusy, setRowBusy] = useState('');
  const [notes, setNotes] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const counts = useMemo(() => {
    const c = { ready: 0, review: 0, added: 0, owned: 0, unreadable: 0, skipped: 0 };
    for (const r of rows) { const k = filterOf(r); if (k in c) c[k] += 1; }
    return c;
  }, [rows]);
  const planId = plan?.planId || '';
  useEffect(() => {
    // New plan: land on the first chip that has something in it.
    const first = FILTERS.find((f) => counts[f.id] > 0);
    setFilter(first ? first.id : 'ready');
    setUnchecked(new Set());
    setConfirmApply(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const shown = rows.filter((r) => filterOf(r) === filter);
  const readyRows = rows.filter((r) => r.status === 'ready');
  const applyIds = readyRows.filter((r) => !unchecked.has(r.groupId)).map((r) => r.groupId);
  const batchIds = applyIds.slice(0, APPLY_LIMIT);
  const toggleRow = (id) => setUnchecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const decide = async (groupId, decision, releaseId, isManual) => {
    setRowBusy(groupId); setError('');
    try {
      const body = { groupId, decision };
      if (releaseId != null) body.releaseId = releaseId;
      if (isManual) body.manual = true;
      const r = await call('discogs-decide', body);
      if (!r || r.ok === false) throw new Error(r?.error || 'Could not save that choice.');
      await loadRecords();
    } catch (err) { if (alive.current) setError(err.message || 'Could not save that choice.'); } finally { if (alive.current) setRowBusy(''); }
  };
  const useManual = (row) => {
    const raw = String(manual[row.groupId] || '').trim();
    const id = Number(raw.replace(/\D/g, '') === raw ? raw : (raw.match(/release\/(\d+)/) || [])[1]);
    if (!Number.isInteger(id) || id <= 0) { setError('Enter a Discogs release number, for example 1234567.'); return; }
    decide(row.groupId, 'accept', id, true);
  };
  const runApply = () => act(async () => {
    setConfirmApply(false);
    const r = await call('discogs-apply', { planId, groupIds: batchIds, notes });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not start adding records.');
    await Promise.all([loadJobs(), loadRecords()]);
  });

  // ---- job rows ----
  const jobKind = (j) => {
    const st = String(j.state || '').toUpperCase();
    if (/^cancel/i.test(String(j.error || '')) || st === 'CANCELLED') return 'cancelled';
    if (st === 'COMPLETE') return 'complete';
    if (st === 'FAILED') return 'failed';
    if (st === 'QUEUED') return 'queued';
    return 'running';
  };
  const undone = useMemo(() => {
    const s = new Set();
    for (const j of jobs) if (String(j.type).toUpperCase() === 'DISCOGS_UNDO' && String(j.state).toUpperCase() !== 'FAILED' && String(j.state).toUpperCase() !== 'CANCELLED' && j.applyCommandId) s.add(j.applyCommandId);
    return s;
  }, [jobs]);
  const renderJob = (j) => {
    const type = String(j.type || '').toUpperCase();
    const kind = jobKind(j);
    const where = lastName(j.relativePath);
    const p = j.progress || {};
    const done = Number(p.done) || 0;
    const total = Number(p.total) || 0;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const spent = usd(p.spentUsd ?? j.spentUsd);
    const c = j.counts || {};
    let title; let detail;
    if (type === 'DISCOGS_PLAN') {
      const s = j.summary || {};
      if (kind === 'queued') { title = `Waiting · ${where}`; detail = 'Sent. Waiting for the Mac analyzer to pick it up. If this stays here, the analyzer is not running.'; }
      else if (kind === 'running') {
        const phase = p.phase;
        title = phase === 'scanning' ? `Scanning the folder · ${where}` : phase === 'matching' ? `Matching to Discogs · ${where}` : `Reading labels · ${where}`;
        detail = `${num(done)} of ${total ? num(total) : '?'} · ${spent} spent so far`;
      } else if (kind === 'complete') {
        title = `Read labels · ${where}`;
        detail = `${plural(s.groups, 'record', 'records')}: ${num(s.add)} ready, ${num(s.review)} to review, ${num(s.alreadyOwned)} already owned, ${num(s.unreadable)} unreadable · ${spent} spent.`;
      } else if (kind === 'cancelled') {
        title = `Stopped · ${where}`; detail = `You stopped it. Records read so far are kept below · ${spent} spent.`;
      } else { title = `Failed · ${where}`; detail = `${j.error || 'The label read did not finish.'} · ${spent} spent.`; }
    } else if (type === 'DISCOGS_APPLY') {
      if (kind === 'queued') { title = 'Waiting to add records'; detail = 'Sent. Waiting for the Mac analyzer to pick it up.'; }
      else if (kind === 'running') { title = `Adding ${total ? plural(total, 'record', 'records') : 'records'}…`; detail = `${num(done)} of ${total ? num(total) : '?'} added to your collection.`; }
      else if (kind === 'complete') { title = `Added ${plural(c.applied, 'record', 'records')}`; detail = `${num(c.applied)} added${c.skipped ? ` · ${num(c.skipped)} skipped (already owned)` : ''}${c.errors ? ` · ${num(c.errors)} errors` : ' · no errors'}${undone.has(j.id) ? ' · undone' : ''}.`; }
      else if (kind === 'cancelled') { title = 'Stopped adding records'; detail = 'You stopped it. Records already added stay in your collection until you undo them.'; }
      else { title = 'Adding records failed'; detail = j.error || 'Nothing more was added.'; }
    } else {
      if (kind === 'queued') { title = 'Waiting to undo'; detail = 'Sent. Waiting for the Mac analyzer to pick it up.'; }
      else if (kind === 'running') { title = 'Undoing…'; detail = `${num(done)} of ${total ? num(total) : '?'} removed from your collection.`; }
      else if (kind === 'complete') { title = `Undone: removed ${plural(c.removed, 'record', 'records')}`; detail = c.errors ? `${num(c.errors)} could not be removed.` : 'They are no longer in your Discogs collection.'; }
      else if (kind === 'cancelled') { title = 'Stopped the undo'; detail = 'Some records may still be in your collection.'; }
      else { title = 'Undo failed'; detail = j.error || 'Nothing was removed.'; }
    }
    const canUndo = type === 'DISCOGS_APPLY' && kind === 'complete' && Number(c.applied) > 0 && !!j.journal && !undone.has(j.id);
    return (
      <div key={j.id} id={`discogs-job-${slug(j.id)}`} className={`xce-nas-job xce-nas-job-${kind}`}>
        <div className="xce-nas-job-head">
          <span className="xce-nas-job-state">{title}</span>
          <span className="xce-bk-count">{ago(j.createdAt)}</span>
          {!isFinished(j.state) ? (
            <button type="button" id={`discogs-job-stop-${slug(j.id)}`} className="xce-bk-icon xce-nas-cancel" aria-label="Stop this job" title="Stop" disabled={busy} onClick={() => cancel(j.id)}><XIcon size={14} /></button>
          ) : null}
        </div>
        {kind === 'running' ? <div className="xce-nas-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div> : null}
        <p className="xce-field-hint">{detail}</p>
        {canUndo ? (
          <div id={`discogs-job-undo-${slug(j.id)}`} className="xce-discogs-job-actions">
            <ConfirmButton id={`discogs-undo-${slug(j.id)}`} label="Undo" className="xce-btn-ghost" confirmLabel="Yes, remove them" cancelLabel="Keep"
              prompt={`Remove these ${plural(c.applied, 'record', 'records')} from your Discogs collection?`} disabled={busy} onConfirm={() => undo(j)} />
          </div>
        ) : null}
      </div>
    );
  };
  const shownJobs = jobs.slice(0, 8);

  // ---- render ----
  // text = [label when ok, label when not ok]
  const item = (id, ok, [okText, todoText], hint) => (
    <li id={id} className={`xce-checklist-item ${ok ? 'is-ok' : 'is-todo'}`}>
      {ok ? <Check size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
      <span>{ok ? okText : todoText}{!ok && hint ? <> {hint}</> : null}</span>
    </li>
  );
  const checking = mac === null || (!macOffline && supports === null);
  const perRead = Number(estimate?.perReadUsd) || 0;
  const willRead = !estimate ? 0 : perRead > 0 ? Math.min(estimate.uncachedReads || 0, Math.floor(cap / perRead)) : (estimate.uncachedReads || 0);

  return (
    <div id="x-content-discogs-panel" className="xce-nas-panel xce-discogs-panel">
      <div id="discogs-setup-checklist" className="xce-discogs-setup">
        {checking ? <Skeleton id="discogs-setup-skeleton" rows={2} variant="tile" /> : (
          <>
            <ul id="discogs-setup-list" className="xce-checklist">
              {item('discogs-setup-mac', !macOffline, ['Mac analyzer is running', 'Mac analyzer is not running.'], <>Start it on the Mac: <code id="discogs-setup-analyzer-cmd" className="xce-nas-cmd">npm run archive:analyzer</code></>)}
              {item('discogs-setup-support', discogsLoaded, ['Discogs support is loaded', 'Discogs support is not loaded.'], macOffline ? '' : 'Restart the analyzer on the Mac to load Discogs support.')}
              {item('discogs-setup-token', hasToken, ['Discogs token is set', 'Discogs token is missing.'], macOffline || !discogsLoaded ? '' : 'Add DISCOGS_TOKEN to the analyzer environment on the Mac.')}
              {item('discogs-setup-anthropic', hasAnthropic, ['Anthropic key is set', 'Anthropic key is missing.'], macOffline || !discogsLoaded ? '' : 'Add ANTHROPIC_API_KEY to the analyzer environment on the Mac.')}
              {item('discogs-setup-nas', mounted, ['NAS is mounted', 'NAS is not mounted.'], macOffline ? '' : 'Connect it from the NAS source panel (Quick connect).')}
            </ul>
            {dstat?.username ? (
              <p id="discogs-setup-account" className="xce-field-hint">Connected as {dstat.username}{dstat.collectionCount != null ? ` · ${num(dstat.collectionCount)} records in your collection` : ''}.</p>
            ) : null}
            {!setupOk ? (
              <button type="button" id="discogs-setup-retry" className="xce-btn-ghost" onClick={refreshSetup}><RefreshCw size={13} /> Check again</button>
            ) : null}
          </>
        )}
      </div>

      <div id="discogs-folder-row" className="xce-discogs-folder">
        {sources.length > 1 ? (
          <div className="xce-field">
            <label htmlFor="discogs-source-select">Source</label>
            <select id="discogs-source-select" className="xce-select" value={sourceId} onChange={(e) => changeSource(e.target.value)}>
              {sources.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}
            </select>
          </div>
        ) : null}
        <p id="discogs-folder-current" className="xce-discogs-folder-line">
          <Folder size={14} /> <span>{sourceId ? folderLabel : 'No folder chosen yet'}</span>
        </p>
        <button type="button" id="discogs-folder-change" className="xce-btn-ghost" disabled={!mounted} onClick={openBrowser}>{browseOpen ? 'Close folder list' : 'Change folder'}</button>
        {browseOpen ? (
          <div id="discogs-folder-browser" className="xce-nas-browser">
            <nav id="discogs-folder-breadcrumb" className="xce-nas-crumbs" aria-label="Folder path">
              <button type="button" id="discogs-folder-up" className="xce-nas-crumb" disabled={!browsePath} aria-label="Up one folder" onClick={() => setBrowsePath(parent != null ? parent : crumbs.slice(0, -1).join('/'))}><ArrowUp size={12} /></button>
              <button type="button" className="xce-nas-crumb" onClick={() => setBrowsePath('')}>{rootLabel}</button>
              {crumbs.map((c, i) => (
                <React.Fragment key={`${c}-${i}`}>
                  <ChevronRight size={12} />
                  <button type="button" className="xce-nas-crumb" onClick={() => setBrowsePath(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                </React.Fragment>
              ))}
            </nav>
            <ul id="discogs-folder-entries" className="xce-nas-list">
              {browsing ? <li className="xce-nas-empty">Loading…</li>
                : browseError ? <li className="xce-nas-empty is-error"><RetryError id="discogs-folder-browse-error" message={browseError} onRetry={() => browse(sourceId, browsePath)} busy={browsing} /></li>
                : !entries.length ? <li className="xce-nas-empty">No subfolders here.</li>
                : entries.map((e) => (
                  <li key={e.relativePath} className="xce-nas-row">
                    <button type="button" className="xce-nas-name" onClick={() => setBrowsePath(e.relativePath)}>
                      <Folder size={14} /><span>{e.name}</span>
                      {Number.isFinite(Number(e.childCount)) ? <em className="xce-nas-meta">{e.childCount}</em> : null}
                    </button>
                  </li>
                ))}
            </ul>
            <button type="button" id="discogs-folder-use" className="xce-btn-primary" onClick={useFolder}>Use this folder{browsePath ? `: ${lastName(browsePath)}` : ''}</button>
          </div>
        ) : null}
      </div>

      <div id="discogs-estimate-line" className="xce-nas-plan" aria-live="polite">
        {!canEstimate ? (
          <p className="xce-field-hint">{setupOk || checking ? 'Pick a folder to see the price.' : 'Finish the setup checks above to see the price.'}</p>
        ) : live.status === 'unsupported' ? (
          <p className="xce-field-hint">Restart the analyzer on the Mac to load Discogs support.</p>
        ) : live.status === 'error' ? (
          <RetryError id="discogs-estimate-error" message={live.error} onRetry={() => setLiveNonce((n) => n + 1)} />
        ) : !estimate ? (
          <p className="xce-field-hint"><Loader2 size={12} className="xce-spin" /> Counting records and label photos in {lastName(path) === 'whole source' ? rootLabel : lastName(path)}. The first scan of a folder can take a minute or two; repeats are quick.</p>
        ) : (
          <>
            <p id="discogs-estimate-result" className="xce-nas-plan-main">
              {plural(estimate.groups, 'record', 'records')} · {plural(estimate.images, 'label photo', 'label photos')}{estimate.videos ? ` (${plural(estimate.videos, 'video', 'videos')} ignored)` : ''} · {num(estimate.cachedReads)} already read (free) · about {usd(estimate.estUsd)} to read {num(estimate.uncachedReads)} new
            </p>
            {live.status === 'loading' ? <p className="xce-field-hint">Updating…</p> : null}
            {estimate.groups > PLAN_LIMIT ? <p className="xce-field-hint">Each run reads up to {PLAN_LIMIT} records. Run it again for the rest.</p> : null}
            {perRead > 0 && cap < (Number(estimate.estUsd) || 0) ? (
              <p id="discogs-estimate-cap" className="xce-nas-plan-cap">Your cap of {usd(cap)} will stop it after about {num(willRead)} of {num(estimate.uncachedReads)} new reads. Raise the cap to read everything.</p>
            ) : null}
            <p className="xce-field-hint">Looking is free. Nothing is read or charged until you press Read labels &amp; match.</p>
          </>
        )}
      </div>

      <div id="discogs-plan-controls" className="xce-nas-controls">
        <div className="xce-field xce-nas-cap">
          <label htmlFor="discogs-cap">Cap $ (max 20)</label>
          <input id="discogs-cap" className="xce-input" type="number" inputMode="decimal" min="0" max="20" step="0.5" value={capUsd} onChange={(e) => setCapUsd(e.target.value)} />
        </div>
        <button type="button" id="discogs-plan-start" className="xce-btn-primary" disabled={!canPlan} onClick={startPlan}>
          {busy ? 'Working…' : planRunning ? 'Reading labels…' : `Read labels & match (up to ${usd(cap)})`}
        </button>
      </div>
      {cap <= 0 ? <p className="xce-field-hint" id="discogs-cap-hint">Set a cap above $0 to read labels.</p> : null}
      {error ? <p className="xce-error" id="discogs-error">{error}</p> : null}

      <div id="discogs-jobs-list" className="xce-nas-jobs">
        <p className="xce-kicker">Jobs</p>
        {!shownJobs.length ? <p className="xce-field-hint">No jobs yet.</p> : null}
        {shownJobs.slice(0, 3).map(renderJob)}
        {shownJobs.length > 3 ? (
          <details className="xce-more" id="discogs-job-history-details">
            <summary className="xce-more-summary">Older jobs ({shownJobs.length - 3})</summary>
            <div className="xce-more-body" id="discogs-job-history-body">{shownJobs.slice(3).map(renderJob)}</div>
          </details>
        ) : null}
      </div>

      <div id="discogs-results" className="xce-discogs-results">
        <p className="xce-kicker">Results{plan?.relativePath ? ` · ${lastName(plan.relativePath)}` : ''}</p>
        {!recordsLoaded ? <Skeleton id="discogs-results-skeleton" rows={3} variant="row" /> : !rows.length ? (
          <p className="xce-field-hint" id="discogs-results-empty">No label reads yet. Read a folder above and the records show up here.</p>
        ) : (
          <>
            {plan?.capReached ? <p className="xce-nas-plan-cap" id="discogs-results-cap">The cap was reached. {num(plan.remaining)} records were not read. Raise the cap and run it again for the rest.</p> : null}
            <div id="discogs-filter-chips" className="xce-discogs-chips" role="tablist" aria-label="Filter results">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} id={`discogs-filter-${f.id}`}
                  className={`xce-discogs-chip${filter === f.id ? ' is-on' : ''}`} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="xce-discogs-chip-count">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <ul id="discogs-rows" className="xce-discogs-rows">
              {!shown.length ? <li className="xce-nas-empty">Nothing in this group.</li> : shown.map((row) => {
                const rid = slug(row.groupId);
                const dec = decisionOf(row);
                const best = (row.candidates || []).find((c) => c.releaseId === row.best) || null;
                const chosenId = dec?.decision === 'accept' && dec.releaseId ? dec.releaseId : (row.status === 'ready' ? row.best : null);
                const isBusy = rowBusy === row.groupId;
                return (
                  <li key={row.groupId} id={`discogs-row-${rid}`} className={`xce-discogs-row is-${row.status}`}>
                    <div className="xce-discogs-row-main">
                      {row.status === 'ready' ? (
                        <input type="checkbox" id={`discogs-row-check-${rid}`} aria-label={`Add ${readLine(row)}`} checked={!unchecked.has(row.groupId)} onChange={() => toggleRow(row.groupId)} />
                      ) : null}
                      <div className="xce-discogs-row-text">
                        <p className="xce-discogs-row-title">{readLine(row)}</p>
                        <p className="xce-field-hint">{metaLine(row)}</p>
                        {row.reason ? <p className="xce-field-hint">{row.reason}</p> : null}
                        {row.status === 'ready' && chosenId ? (
                          <p className="xce-field-hint">Will add{best ? `: ${best.title || ''}${best.catno ? ` · ${best.catno}` : ''}` : ''} (<a href={releaseUrl(chosenId)} target="_blank" rel="noopener noreferrer">Discogs release {chosenId}</a>){row.catnoExact ? ' · catalogue number matches exactly' : ''}</p>
                        ) : null}
                        {row.status === 'added' || row.status === 'adding' ? (
                          <p className="xce-field-hint">
                            {row.status === 'adding' ? 'Adding to your collection…' : 'In your collection'}
                            {row.added?.releaseId ? <> (<a href={releaseUrl(row.added.releaseId)} target="_blank" rel="noopener noreferrer">Discogs release {row.added.releaseId}</a>)</> : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="xce-discogs-row-actions">
                        {row.status === 'ready' ? (
                          <>
                            {dec?.decision === 'accept' ? <button type="button" id={`discogs-row-change-${rid}`} className="xce-btn-ghost" disabled={isBusy} onClick={() => decide(row.groupId, 'reset')}>Change</button> : null}
                            <button type="button" id={`discogs-row-skip-${rid}`} className="xce-btn-ghost" disabled={isBusy} onClick={() => decide(row.groupId, 'skip')}>Skip</button>
                          </>
                        ) : null}
                        {row.status === 'review' ? <button type="button" id={`discogs-row-skip-${rid}`} className="xce-btn-ghost" disabled={isBusy} onClick={() => decide(row.groupId, 'skip')}>Skip</button> : null}
                        {row.status === 'skipped' ? <button type="button" id={`discogs-row-unskip-${rid}`} className="xce-btn-ghost" disabled={isBusy} onClick={() => decide(row.groupId, 'reset')}>Undo skip</button> : null}
                      </div>
                    </div>
                    {row.status === 'review' ? (
                      <div id={`discogs-row-candidates-${rid}`} className="xce-discogs-cands">
                        {!(row.candidates || []).length ? <p className="xce-field-hint">No likely matches found. Paste a release number below if you know it.</p> : null}
                        {(row.candidates || []).map((c) => (
                          <div key={c.releaseId} className="xce-discogs-cand">
                            <div className="xce-discogs-cand-text">
                              <a href={releaseUrl(c.releaseId)} target="_blank" rel="noopener noreferrer">{c.title || `Release ${c.releaseId}`}</a>
                              <span className="xce-field-hint">{[c.label, c.catno, c.year, (c.formats || []).join(', ')].filter(Boolean).join(' · ')}</span>
                              <span className="xce-field-hint">{[scoreLabel(c.score), reasonsOf(c)].filter(Boolean).join(' · ')}</span>
                            </div>
                            <button type="button" id={`discogs-row-use-${rid}-${c.releaseId}`} className="xce-btn-primary" disabled={isBusy} onClick={() => decide(row.groupId, 'accept', c.releaseId)}>Use this</button>
                          </div>
                        ))}
                        <div className="xce-discogs-manual">
                          <input id={`discogs-row-manual-${rid}`} className="xce-input" type="text" inputMode="numeric" placeholder="Discogs release number or link" aria-label="Discogs release number"
                            value={manual[row.groupId] || ''} onChange={(e) => setManual((m) => ({ ...m, [row.groupId]: e.target.value }))} />
                          <button type="button" id={`discogs-row-manual-use-${rid}`} className="xce-btn-ghost" disabled={isBusy || !String(manual[row.groupId] || '').trim()} onClick={() => useManual(row)}>Use this number</button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {rows.length ? (
        <div id="discogs-apply-bar" className="xce-discogs-apply">
          <label id="discogs-notes-toggle" className={`xce-toggle${notes ? ' is-on' : ''}`} htmlFor="discogs-notes">
            <input id="discogs-notes" type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
            Write a short note on each new record
          </label>
          {!confirmApply ? (
            <button type="button" id="discogs-apply-start" className="xce-btn-primary" disabled={!batchIds.length || busy || !setupOk} onClick={() => setConfirmApply(true)}>
              {batchIds.length ? `Add ${plural(batchIds.length, 'record', 'records')} to collection` : 'Nothing ticked to add'}
            </button>
          ) : (
            <div id="discogs-apply-confirm" className="xce-discogs-confirm" role="group" aria-label="Confirm adding records">
              <p className="xce-discogs-confirm-text">Add {plural(batchIds.length, 'record', 'records')} to your Discogs collection? You can undo this afterward from the Jobs list.</p>
              <button type="button" id="discogs-apply-confirm-yes" className="xce-btn-primary" disabled={busy} onClick={runApply}>Yes, add them</button>
              <button type="button" id="discogs-apply-confirm-no" className="xce-btn-ghost" onClick={() => setConfirmApply(false)}>Cancel</button>
            </div>
          )}
          {applyIds.length > APPLY_LIMIT ? <p className="xce-field-hint" id="discogs-apply-limit">{num(APPLY_LIMIT)} records are added at a time. Add these, then add the rest.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
