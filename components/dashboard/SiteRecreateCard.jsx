'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Globe, ShieldCheck, ExternalLink, Download, CalendarClock } from 'lucide-react';

// Site Recreate — submit a live site URL, get back an exact static
// recreation (live preview + downloadable zip) plus a human-handoff upsell
// for DNS/hosting. Admin-gated (job creation only — cloning arbitrary sites
// is a legal/abuse surface, see docs/plans/SITE-RECREATE-AUTOMATION-PLAN.md
// Risk #1). Phase 1: card + job plumbing only — jobs sit `queued` until the
// clone engine (Phase 2 CLI / Phase 4 Cloud Run) claims and runs them; the
// RECREATE button already streams through the shared run terminal and will
// show real progress the moment a worker starts processing the job.

const CONTACT_HREF = 'https://calendly.com/bballi/30min';

async function authFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function statusLabel(status) {
  switch (status) {
    case 'queued': return 'Queued';
    case 'processing': return 'Recreating';
    case 'verifying': return 'Verifying';
    case 'done': return 'Done';
    case 'failed': return 'Failed';
    default: return status || '—';
  }
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SiteRecreateCard({ user, runWithTerminal }) {
  const [targetUrl, setTargetUrl] = useState('');
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);

  const loadJobs = useCallback(async () => {
    if (!user) return null;
    try {
      const data = await authFetch(user, '/api/dashboard/site-clone?action=list', { method: 'GET' });
      const list = data.jobs || [];
      setJobs(list);
      setActiveJobId((prev) => prev || list[0]?.jobId || null);
      return list;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load site-recreate jobs.' });
      return null;
    }
  }, [user]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const activeJob = jobs.find((j) => j.jobId === activeJobId) || null;
  const canSubmit = /^https?:\/\/\S+$/i.test(targetUrl.trim()) && ownershipAttested && !busy;

  async function recreate() {
    if (!canSubmit || !user || typeof runWithTerminal !== 'function') return;
    setBusy(true);
    setNotice(null);
    const submittedUrl = targetUrl.trim();
    let host = submittedUrl;
    try { host = new URL(submittedUrl).hostname.replace(/^www\./, ''); } catch { /* keep raw string */ }

    try {
      await runWithTerminal({
        title: 'RECREATING SITE',
        brand: 'Site Recreate',
        host,
        stages: [
          { pfx: '[SUBMIT]', text: 'validating URL & creating job…' },
          { pfx: '[QUEUE]', text: 'queued — waiting for the clone engine…' },
        ],
        task: async ({ advance, note }) => {
          const created = await authFetch(user, '/api/dashboard/site-clone?action=create', {
            method: 'POST',
            body: JSON.stringify({ targetUrl: submittedUrl, ownershipAttested: true }),
          });
          const jobId = created.jobId;
          setActiveJobId(jobId);

          let lastStatus = created.job?.status || 'queued';
          let lastLogCount = created.job?.log?.length || 0;
          let job = created.job || null;

          for (let attempt = 0; attempt < 300; attempt += 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 3000));
            // eslint-disable-next-line no-await-in-loop
            const data = await authFetch(user, `/api/dashboard/site-clone?action=status&jobId=${encodeURIComponent(jobId)}`, { method: 'GET' });
            job = data.job;
            if (!job) continue;

            if (job.status !== lastStatus) {
              lastStatus = job.status;
              if (job.status === 'processing') advance('[CLONE]', 'recreating pages & mirroring assets…');
              else if (job.status === 'verifying') advance('[VERIFY]', 'verifying zero console errors…');
            }
            const newLines = (job.log || []).slice(lastLogCount);
            newLines.forEach((l) => note(l.line));
            lastLogCount = (job.log || []).length;

            if (job.status === 'done') break;
            if (job.status === 'failed') throw new Error(job.error || 'Clone job failed.');
          }

          await loadJobs();
          if (job?.status === 'done') {
            const vr = job.verifyReport;
            return { doneText: `Done ✓ — ${job.assetCount || 0} assets${vr ? `, ${vr.consoleErrors || 0} console errors` : ''}` };
          }
          return { doneText: 'Still queued — an admin needs to run the clone engine to continue.' };
        },
      });
      setTargetUrl('');
      setOwnershipAttested(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not recreate site.' });
      await loadJobs();
    } finally {
      setBusy(false);
    }
  }

  const verifySummary = activeJob?.verifyReport
    ? `${activeJob.verifyReport.pagesChecked ?? 0} pages · ${activeJob.assetCount ?? 0} assets · ${activeJob.verifyReport.consoleErrors ?? 0} errors`
    : null;

  return (
    <div id="site-recreate-card">
      {/* ── Submit ─────────────────────────────────────────────────── */}
      <section id="site-recreate-url-input-row" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker"><Globe size={13} /> Recreate a Site</span>
          {activeJob?.platform ? <span className="sr-chip">{activeJob.platform}</span> : null}
        </div>
        <p className="sr-sub">Enter a live site URL you own or control. We rebuild it as an exact static copy — same pages, images, and copy, with checkout/tracking stripped.</p>
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={busy}
        />
        <label className="sr-attest">
          <input type="checkbox" checked={ownershipAttested} onChange={(e) => setOwnershipAttested(e.target.checked)} disabled={busy} />
          <span><ShieldCheck size={13} /> I own or am authorized to recreate this site.</span>
        </label>
        <button type="button" className="sr-primary" onClick={recreate} disabled={!canSubmit}>
          {busy ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : null}
          Recreate My Site
        </button>
        {notice ? <p className={`sr-notice sr-notice-${notice.kind}`}>{notice.text}</p> : null}
      </section>

      {/* ── Status ─────────────────────────────────────────────────── */}
      <section id="site-recreate-run-status-panel" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker">Run Status</span>
          {activeJob ? <span className={`sr-status sr-status-${activeJob.status}`}>{statusLabel(activeJob.status)}</span> : null}
        </div>
        {activeJob ? (
          <div className="sr-status-body">
            <p className="sr-status-url">{activeJob.targetUrl}</p>
            <p className="sr-status-meta">Submitted {formatDate(activeJob.createdAt) || '—'}</p>
            {activeJob.status === 'failed' && activeJob.error ? <p className="sr-error">{activeJob.error}</p> : null}
          </div>
        ) : (
          <div className="sr-empty">No runs yet. Submit a URL above to start one.</div>
        )}
      </section>

      {/* ── Preview ────────────────────────────────────────────────── */}
      <section id="site-recreate-preview-panel" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker">Live Preview</span>
          {activeJob?.preview?.vercelUrl ? (
            <a href={activeJob.preview.vercelUrl} target="_blank" rel="noreferrer" className="sr-open-link">
              <ExternalLink size={12} /> Open in new tab
            </a>
          ) : null}
        </div>
        {activeJob?.preview?.vercelUrl ? (
          <iframe title="Recreated site preview" src={activeJob.preview.vercelUrl} className="sr-preview-frame" />
        ) : activeJob?.preview?.screenshots?.length ? (
          <div className="sr-screenshot-strip">
            {activeJob.preview.screenshots.map((src, i) => (
              <img key={i} src={src} alt={`Recreated page ${i + 1}`} />
            ))}
          </div>
        ) : (
          <div className="sr-empty">No preview yet — it appears here once a run completes.</div>
        )}
      </section>

      {/* ── Download ───────────────────────────────────────────────── */}
      <section id="site-recreate-download-row" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker">Download</span>
        </div>
        {activeJob?.zip?.downloadUrl ? (
          <>
            <a href={activeJob.zip.downloadUrl} className="sr-download-btn" download>
              <Download size={14} /> Download Zip
            </a>
            {verifySummary ? <p className="sr-verify-summary">{verifySummary}</p> : null}
          </>
        ) : (
          <div className="sr-empty">No zip yet — it appears here once a run completes.</div>
        )}
      </section>

      {/* ── Upsell ─────────────────────────────────────────────────── */}
      <section id="site-recreate-upsell-panel" className="sr-panel sr-upsell">
        <div className="sr-head">
          <span className="sr-kicker"><CalendarClock size={13} /> Ready to Go Live?</span>
        </div>
        <p className="sr-sub">A human transfers your DNS and hosts this for you.</p>
        <a href={CONTACT_HREF} target="_blank" rel="noreferrer" className="sr-primary sr-contact-btn">Contact Your Human</a>
      </section>

      {/* ── History ────────────────────────────────────────────────── */}
      {jobs.length > 1 ? (
        <section id="site-recreate-jobs-list" className="sr-panel sr-history">
          <div className="sr-head">
            <span className="sr-kicker">Previous Runs</span>
            <small>{jobs.length}</small>
          </div>
          {jobs.map((j) => (
            <button
              type="button"
              key={j.jobId}
              className={`sr-history-item ${j.jobId === activeJobId ? 'sr-history-active' : ''}`}
              onClick={() => setActiveJobId(j.jobId)}
            >
              <span className={`sr-status sr-status-${j.status}`}>{statusLabel(j.status)}</span>
              <span className="sr-history-url">{j.targetUrl}</span>
              <span className="sr-history-when">{formatDate(j.createdAt) || '—'}</span>
            </button>
          ))}
        </section>
      ) : null}

      <style jsx>{`
        #site-recreate-card { margin-top: 18px; display: grid; gap: 14px; }
        .sr-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        .sr-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
        .sr-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        .sr-head small { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.5); }
        .sr-sub { margin: -4px 0 12px; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        .sr-chip { display: inline-flex; align-items: center; min-height: 24px; font-size: 11px; font-weight: 700; padding: 0 10px; border-radius: 999px; background: rgba(42,36,32,0.06); border: 1px solid rgba(42,36,32,0.08); color: #3a332e; text-transform: capitalize; }
        input[type="url"] { width: 100%; min-height: 44px; border: 1px solid rgba(42,36,32,0.14); border-radius: 10px; padding: 0 14px; background: rgba(255,255,255,0.98); color: #2a2420; font: inherit; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); }
        input[type="url"]:focus { outline: none; border-color: rgba(42,36,32,0.36); box-shadow: 0 0 0 3px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.65); }
        .sr-attest { display: flex; align-items: center; gap: 8px; margin: 12px 0; font-size: 12px; color: rgba(42,36,32,0.75); cursor: pointer; }
        .sr-attest span { display: inline-flex; align-items: center; gap: 6px; }
        .sr-attest input[type="checkbox"] { width: 16px; height: 16px; }
        button, .sr-primary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); color: #2a2420; min-height: 40px; padding: 0 18px; font-weight: 700; font-size: 12px; cursor: pointer; text-decoration: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        button:disabled { opacity: 0.48; cursor: not-allowed; }
        .sr-primary { background: #2a2420; color: #ffffff; border-color: #2a2420; width: 100%; }
        .sr-primary:hover:not(:disabled) { background: #3a332e; border-color: #3a332e; transform: translateY(-1px); }
        .sr-notice { margin: 12px 0 0; font-size: 12px; line-height: 1.4; }
        .sr-notice-error { color: #9f1f17; }
        .sr-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        .sr-status { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; background: rgba(42,36,32,0.06); color: rgba(42,36,32,0.6); }
        .sr-status-done { background: rgba(47,158,107,0.14); color: #285f3b; }
        .sr-status-failed { background: rgba(209,88,77,0.14); color: #9f1f17; }
        .sr-status-processing, .sr-status-verifying { background: rgba(217,164,65,0.16); color: #b7791f; }
        .sr-status-body { display: grid; gap: 4px; }
        .sr-status-url { margin: 0; font-size: 13px; font-weight: 600; color: #2a2420; word-break: break-all; }
        .sr-status-meta { margin: 0; font-size: 11px; color: rgba(42,36,32,0.5); }
        .sr-error { margin: 6px 0 0; font-size: 12px; color: #9f1f17; }
        .sr-open-link { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #2a2420; text-decoration: none; }
        .sr-preview-frame { width: 100%; height: 320px; border: 1px solid rgba(42,36,32,0.14); border-radius: 12px; background: #fff; }
        .sr-screenshot-strip { display: flex; gap: 10px; overflow-x: auto; }
        .sr-screenshot-strip img { height: 220px; border-radius: 10px; border: 1px solid rgba(42,36,32,0.14); }
        .sr-download-btn { display: inline-flex; align-items: center; gap: 6px; }
        .sr-verify-summary { margin: 10px 0 0; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); }
        .sr-upsell { background: rgba(42,36,32,0.03); }
        .sr-contact-btn { width: auto; }
        .sr-history { max-height: 300px; overflow: auto; }
        .sr-history-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; margin-bottom: 8px; padding: 10px 12px; min-height: 0; font-weight: 500; border: 1px solid rgba(42,36,32,0.1); border-radius: 12px; background: rgba(255,255,255,0.72); }
        .sr-history-item:hover:not(:disabled) { border-color: rgba(42,36,32,0.24); background: rgba(255,255,255,0.98); }
        .sr-history-active { border-color: rgba(42,36,32,0.5); background: rgba(255,255,255,1); }
        .sr-history-url { flex: 1; font-size: 12px; color: rgba(42,36,32,0.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sr-history-when { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
      `}</style>
    </div>
  );
}
