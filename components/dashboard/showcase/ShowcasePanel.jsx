'use client';

// SITE SHOWCASE panel — owner-only, opened from the "Site Showcase Video" card (Creative Team bucket) in
// DashboardPage. Pick one of three suggested HITLOOP site-showcase videos and render it.
//
// The browser only talks to /api/dashboard/showcase: it lists options, queues a job, and polls its status. The render
// itself runs in the `showcase-render` Cloud Run service (see app/api/dashboard/showcase/route.js). The request carries
// only { focusId, format, theme }; the service builds the spec from its own bundled focus file.
//
// Styling uses the Studio rail tokens (GLASS / ui from the studio rail-ui) only, no colour literals.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GLASS, ui } from '../../../app/dashboard/studio/components/rail-ui';

const POLL_MS = 5000;
const POLL_MAX_MS = 25 * 60 * 1000;
const HISTORY_LIMIT = 10;
const THEMES = [['cycle', 'Cycle light / dark'], ['light', 'Light'], ['dark', 'Dark']];
const RENDER_HINT = '≈ $0.10, 3–6 min';

const isActive = (job) => job?.status === 'queued' || job?.status === 'rendering';
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const panel = {
  border: '1px solid ' + GLASS.hair, borderRadius: 14, padding: 16, background: GLASS.bg,
  display: 'flex', flexDirection: 'column', gap: 10,
};
const body = { fontFamily: GLASS.sans, fontSize: 13, color: GLASS.inkSoft, lineHeight: 1.45, margin: 0 };

export default function ShowcasePanel({ isNarrow = false, authedFetch = null, user = null, isAdmin = false, onChange = null }) {
  const [options, setOptions] = useState([]);
  const [quota, setQuota] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [theme, setTheme] = useState('cycle');
  const [shuffle, setShuffle] = useState(0);
  const [activeJobId, setActiveJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(0);

  const ready = Boolean(user && authedFetch && isAdmin);

  const call = useCallback(async (url, init) => {
    const res = await authedFetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  }, [authedFetch]);

  const loadOptions = useCallback(async (n = 0) => {
    const data = await call(`/api/dashboard/showcase?action=options${n ? `&shuffle=${n}` : ''}`);
    setOptions(Array.isArray(data.options) ? data.options : []);
    setQuota(data.quota || null);
  }, [call]);

  const loadList = useCallback(async () => {
    const data = await call('/api/dashboard/showcase?action=list');
    const list = Array.isArray(data.jobs) ? data.jobs : [];
    setJobs(list);
    return list;
  }, [call]);

  // Initial load: options + history; resume polling if a job is still active.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [, list] = await Promise.all([loadOptions(0), loadList()]);
        if (cancelled) return;
        const running = list.find(isActive);
        if (running) {
          // One status call first: the server fails a job older than 20 minutes, so a stale one never shows as "Rendering".
          let current = running;
          try {
            const data = await call(`/api/dashboard/showcase?action=status&jobId=${encodeURIComponent(running.jobId)}`);
            if (data?.job) current = data.job;
          } catch { /* fall back to the listed state */ }
          if (cancelled) return;
          setJob(current);
          if (isActive(current)) {
            startedAt.current = Date.parse(current.createdAt) || Date.now();
            setActiveJobId(current.jobId);
          } else {
            loadList().catch(() => {});
            if (onChange) onChange();
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Could not load Site Showcase.');
      }
    })();
    return () => { cancelled = true; };
  }, [ready, call, loadOptions, loadList, onChange]);

  // Poll the active job every 5 s; stop at 25 minutes.
  useEffect(() => {
    if (!ready || !activeJobId) return undefined;
    let cancelled = false;
    setTimedOut(false);
    const tick = async () => {
      if (Date.now() - startedAt.current > POLL_MAX_MS) {
        setTimedOut(true);
        setActiveJobId(null);
        return;
      }
      try {
        const data = await call(`/api/dashboard/showcase?action=status&jobId=${encodeURIComponent(activeJobId)}`);
        if (cancelled) return;
        setJob(data.job);
        if (!isActive(data.job)) {
          setActiveJobId(null);
          loadList().catch(() => {});
          loadOptions(shuffle).catch(() => {});
          if (onChange) onChange();
        }
      } catch {
        // A single failed poll is not fatal; the next tick retries.
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ready, activeJobId, call, loadList, loadOptions, shuffle, onChange]);

  // Elapsed clock for the progress panel.
  useEffect(() => {
    if (!activeJobId) return undefined;
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [activeJobId]);

  const render = useCallback(async (option) => {
    if (busy || activeJobId) return;
    setBusy(true);
    setLoadError('');
    setElapsed(0);
    try {
      const data = await call('/api/dashboard/showcase?action=create', {
        method: 'POST',
        body: JSON.stringify({ focusId: option.focusId, format: option.format, theme }),
      });
      startedAt.current = Date.now();
      setJob({ jobId: data.jobId, status: 'queued', title: option.title, caption: option.caption, format: option.format, theme });
      setActiveJobId(data.jobId);
      if (onChange) onChange();
    } catch (err) {
      if (err.status === 409 && err.data?.jobId) {
        startedAt.current = Date.now();
        setActiveJobId(err.data.jobId);
      }
      setLoadError(err?.message || 'Could not start the render.');
    } finally {
      setBusy(false);
    }
  }, [busy, activeJobId, call, theme, onChange]);

  const reshuffle = useCallback(async () => {
    const next = shuffle >= 20 ? 1 : shuffle + 1;
    setShuffle(next);
    try { await loadOptions(next); } catch (err) { setLoadError(err?.message || 'Could not shuffle.'); }
  }, [shuffle, loadOptions]);

  const retry = useCallback(() => {
    const match = options.find((o) => o.focusId === job?.focusId) || (job?.focusId ? { focusId: job.focusId, format: job.format, title: job.title } : null);
    setJob(null);
    if (match) render(match);
  }, [options, job, render]);

  const outOfQuota = quota ? quota.used >= quota.max : false;
  const rendering = Boolean(activeJobId) || busy;
  const history = jobs.slice(0, HISTORY_LIMIT);

  return (
    <div
      id="showcase-studio-shell"
      onClick={(e) => e.stopPropagation()}
      style={{
        boxSizing: 'border-box', padding: isNarrow ? 12 : 16,
        background: GLASS.bg, fontFamily: GLASS.sans, color: GLASS.ink,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!ready ? (
          <p style={body}>{!user ? 'Sign in as the owner to use Site Showcase.' : 'Site Showcase is owner-only.'}</p>
        ) : (
          <>
            <div id="showcase-controls-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <label style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                Theme
                <select
                  id="showcase-theme-select"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  style={{ height: 36, borderRadius: 999, border: '1px solid ' + GLASS.hair, padding: '0 12px', fontFamily: GLASS.sans, fontSize: 12, color: GLASS.ink, background: GLASS.bg }}
                >
                  {THEMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button id="showcase-shuffle-btn" type="button" onClick={reshuffle} disabled={rendering} style={{ ...ui.btn(false), height: 36, opacity: rendering ? 0.5 : 1 }}>
                Shuffle options
              </button>
              <span id="showcase-quota-note" style={{ ...ui.label, color: outOfQuota ? GLASS.ink : GLASS.inkMute }}>
                {quota ? `${quota.used} of ${quota.max} renders used today` : ''}
              </span>
            </div>

            {loadError ? (
              <div id="showcase-load-error-panel" role="alert" style={panel}>
                <p style={body}>{loadError}</p>
              </div>
            ) : null}

            <div
              id="showcase-options-row"
              style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}
            >
              {options.map((o) => (
                <div key={o.focusId} id={`showcase-option-card-${o.n}`} style={panel}>
                  <span style={ui.label}>{o.format} · {o.kinds.join(' + ')}</span>
                  <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{o.title}</span>
                  <p style={body}>{o.caption}</p>
                  <button
                    id={`showcase-option-render-btn-${o.n}`}
                    type="button"
                    onClick={() => render(o)}
                    disabled={rendering || outOfQuota}
                    style={{ ...ui.cta, opacity: rendering || outOfQuota ? 0.5 : 1, cursor: rendering || outOfQuota ? 'not-allowed' : 'pointer' }}
                  >
                    Render {RENDER_HINT}
                  </button>
                </div>
              ))}
            </div>

            {activeJobId || timedOut ? (
              <div id="showcase-progress-panel" style={panel} aria-live="polite">
                <span style={ui.label}>{job?.title || 'Showcase render'}</span>
                <span id="showcase-progress-status" style={{ fontSize: 14, fontWeight: 600 }}>
                  {timedOut
                    ? 'Still running after 25 minutes. Stopped checking; reload to look again.'
                    : `${job?.status === 'rendering' ? 'Rendering' : 'Queued'} · ${clock(elapsed)}`}
                </span>
              </div>
            ) : null}

            {job?.status === 'done' && job.downloadUrl ? (
              <div id="showcase-result-panel" style={panel}>
                <span style={ui.label}>{job.title}</span>
                <video
                  id="showcase-result-video"
                  key={job.downloadUrl}
                  src={job.downloadUrl}
                  controls loop muted playsInline
                  style={{ width: '100%', maxHeight: 520, borderRadius: 10, background: GLASS.ink }}
                />
                <a id="showcase-result-download-link" href={job.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(false), textDecoration: 'none', alignSelf: 'flex-start' }}>
                  Download MP4
                </a>
                <p id="showcase-result-caption" style={body}>{job.caption}</p>
              </div>
            ) : null}

            {job?.status === 'failed' ? (
              <div id="showcase-error-panel" role="alert" style={panel}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Render failed{job.error?.stage ? ` (${job.error.stage})` : ''}</span>
                <p style={body}>{job.error?.message || 'Unknown error.'}</p>
                <button type="button" onClick={retry} disabled={rendering || outOfQuota} style={{ ...ui.btn(false), alignSelf: 'flex-start' }}>Retry</button>
              </div>
            ) : null}

            <div id="showcase-history-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={ui.label}>Recent renders</span>
              {history.length === 0 ? <p style={body}>Nothing rendered yet.</p> : history.map((h) => (
                <div key={h.jobId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid ' + GLASS.hair }}>
                  <span style={{ flex: '1 1 160px', fontSize: 13 }}>{h.title}</span>
                  <span style={ui.label}>{h.format} · {h.status}</span>
                  <span style={ui.label}>{h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</span>
                  {h.status === 'done' && h.downloadUrl ? (
                    <a href={h.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(false), height: 28, padding: '0 12px', fontSize: 10, textDecoration: 'none' }}>Open</a>
                  ) : (
                    <button type="button" onClick={() => setJob(h)} style={{ ...ui.btn(false), height: 28, padding: '0 12px', fontSize: 10 }}>View</button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
