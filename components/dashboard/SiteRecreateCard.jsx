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

  // ── Hosted demo content editor ─────────────────────────────────────────
  const [demoPages, setDemoPages] = useState(null); // null = not loaded
  const [demoEditSlug, setDemoEditSlug] = useState('home');
  const [demoEdits, setDemoEdits] = useState({}); // key -> value (dirty only)
  const [demoSaving, setDemoSaving] = useState(false);

  useEffect(() => { setDemoPages(null); setDemoEdits({}); setDemoEditSlug('home'); }, [activeJobId]);

  async function loadDemoPages() {
    if (!user || !activeJob?.demo?.url) return;
    try {
      const data = await authFetch(user, `/api/dashboard/site-clone?action=demo-pages&jobId=${encodeURIComponent(activeJob.jobId)}`, { method: 'GET' });
      setDemoPages(data.pages || []);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load demo content.' });
    }
  }

  async function saveDemoEdits() {
    const edits = Object.entries(demoEdits).map(([key, value]) => ({ key, value }));
    if (!edits.length || !user || !activeJob) return;
    setDemoSaving(true);
    try {
      await authFetch(user, '/api/dashboard/site-clone?action=save-slots', {
        method: 'POST',
        body: JSON.stringify({ jobId: activeJob.jobId, slug: demoEditSlug, edits }),
      });
      setDemoEdits({});
      setDemoPages((prev) => (prev || []).map((p) => (p.slug === demoEditSlug
        ? { ...p, slots: p.slots.map((s) => (demoEdits[s.key] != null ? { ...s, value: demoEdits[s.key] } : s)) }
        : p)));
      setNotice({ kind: 'ok', text: 'Saved — refresh the live demo to see your edits.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not save edits.' });
    } finally {
      setDemoSaving(false);
    }
  }

  const demoEditPage = (demoPages || []).find((p) => p.slug === demoEditSlug) || null;
  const demoDirtyCount = Object.keys(demoEdits).length;

  // ── One-click hosting (Vercel + Turso, provisioned by the admin CLI) ───
  const [hostBusy, setHostBusy] = useState(false);
  async function requestHosting() {
    if (!user || !activeJob) return;
    setHostBusy(true);
    try {
      await authFetch(user, '/api/dashboard/site-clone?action=request-hosting', {
        method: 'POST',
        body: JSON.stringify({ jobId: activeJob.jobId, target: 'vercel' }),
      });
      setNotice({ kind: 'ok', text: 'Hosting requested — the live site + admin links appear on this card when provisioning completes.' });
      await loadJobs();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not request hosting.' });
    } finally {
      setHostBusy(false);
    }
  }

  // ── Arweave launch (permanent, wallet-funded — estimate-first) ─────────
  const [arweaveEstimate, setArweaveEstimate] = useState(null);
  const [arweaveBusy, setArweaveBusy] = useState(false);
  // Dirty = any content edit (card editor OR hosted Payload webhook) after
  // the last permanent publish.
  const arweaveContentDirty = Boolean(
    activeJob?.arweave?.deployedAt
    && activeJob?.contentUpdatedAt
    && new Date(activeJob.contentUpdatedAt) > new Date(activeJob.arweave.deployedAt)
  );

  useEffect(() => { setArweaveEstimate(null); }, [activeJobId]);

  async function loadArweaveEstimate() {
    if (!user || !activeJob) return;
    setArweaveBusy(true);
    try {
      const data = await authFetch(user, `/api/dashboard/site-clone?action=arweave-estimate&jobId=${encodeURIComponent(activeJob.jobId)}`, { method: 'GET' });
      setArweaveEstimate(data.estimate);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not estimate Arweave cost.' });
    } finally {
      setArweaveBusy(false);
    }
  }

  async function launchOnArweave() {
    if (!user || !activeJob) return;
    setArweaveBusy(true);
    try {
      await authFetch(user, '/api/dashboard/site-clone?action=arweave-deploy', {
        method: 'POST',
        body: JSON.stringify({ jobId: activeJob.jobId }),
      });
      setNotice({ kind: 'ok', text: 'Site launched on Arweave — permanent link below.' });
      await loadJobs();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Arweave launch failed.' });
    } finally {
      setArweaveBusy(false);
    }
  }

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

      {/* ── Live Demo — hosted, editable ───────────────────────────── */}
      <section id="site-recreate-demo-panel" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker">Live Demo — Your Site, Editable</span>
          {activeJob?.demo?.url ? (
            <a href={activeJob.demo.url} target="_blank" rel="noreferrer" className="sr-open-link">
              <ExternalLink size={12} /> Open live demo
            </a>
          ) : null}
        </div>
        {!activeJob?.demo?.url ? (
          <div className="sr-empty">No hosted demo yet — it appears here once a run completes.</div>
        ) : (
          <>
            <p className="sr-sub">
              Hosted at <a href={activeJob.demo.url} target="_blank" rel="noreferrer">{activeJob.demo.url}</a> — the exact recreated site,
              {` ${activeJob.demo.slotCount || 0} editable pieces of content across ${activeJob.demo.pageCount || 0} pages.`}
            </p>
            {demoPages === null ? (
              <button type="button" className="cta-pill-btn" id="site-recreate-demo-edit-btn" onClick={loadDemoPages}>
                EDIT CONTENT
              </button>
            ) : (
              <div id="site-recreate-demo-editor">
                <div className="sr-demo-editor-controls">
                  <select
                    value={demoEditSlug}
                    onChange={(e) => { setDemoEditSlug(e.target.value); setDemoEdits({}); }}
                    aria-label="Page to edit"
                  >
                    {(demoPages || []).map((p) => (
                      <option key={p.slug} value={p.slug}>{p.slug === 'home' ? 'Home' : p.title || p.slug}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cta-pill-btn"
                    disabled={!demoDirtyCount || demoSaving}
                    onClick={saveDemoEdits}
                  >
                    {demoSaving ? 'SAVING…' : demoDirtyCount ? `SAVE ${demoDirtyCount} EDIT${demoDirtyCount > 1 ? 'S' : ''}` : 'SAVED'}
                  </button>
                </div>
                <div className="sr-demo-slot-list">
                  {(demoEditPage?.slots || []).filter((s) => s.kind === 'text').map((s) => (
                    <label key={s.key} className="sr-demo-slot-row">
                      <span className="sr-demo-slot-label">{s.label}</span>
                      <textarea
                        rows={Math.min(4, Math.max(1, Math.ceil(((demoEdits[s.key] ?? s.value) || '').length / 60)))}
                        value={demoEdits[s.key] ?? s.value}
                        onChange={(e) => setDemoEdits((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <p className="sr-status-meta">Image swaps live in the downloadable CMS (Payload admin) — this editor covers text.</p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Download ───────────────────────────────────────────────── */}
      <section id="site-recreate-download-row" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker">Download</span>
        </div>
        {activeJob?.zip?.downloadUrl || activeJob?.cms?.downloadUrl ? (
          <>
            {activeJob?.zip?.downloadUrl ? (
              <a href={activeJob.zip.downloadUrl} className="sr-download-btn" download>
                <Download size={14} /> Download Zip
              </a>
            ) : null}
            {activeJob?.cms?.downloadUrl ? (
              <a
                id="site-recreate-cms-download-btn"
                href={activeJob.cms.downloadUrl}
                className="sr-download-btn sr-download-cms"
                download
              >
                <Download size={14} /> Download CMS (editable)
              </a>
            ) : null}
            {activeJob?.cms?.hostedUrl ? (
              <p className="sr-verify-summary">
                Hosted CMS live: <a href={activeJob.cms.hostedUrl} target="_blank" rel="noreferrer">{activeJob.cms.hostedUrl.replace(/^https?:\/\//, '')}</a>
                {' · '}<a href={activeJob.cms.hostedAdminUrl || `${activeJob.cms.hostedUrl}/admin`} target="_blank" rel="noreferrer">open /admin</a>
              </p>
            ) : activeJob?.hostRequest ? (
              <p className="sr-verify-summary">
                Hosting requested ({formatDate(activeJob.hostRequest.requestedAt) || 'just now'}) — provisioning the live site + admin. The links appear here when it's up.
              </p>
            ) : activeJob?.cms?.downloadUrl ? (
              <button
                type="button"
                id="site-recreate-host-vercel-btn"
                className="cta-pill-btn"
                disabled={hostBusy}
                onClick={requestHosting}
              >
                {hostBusy ? 'REQUESTING…' : 'HOST LIVE — SITE + ADMIN'}
              </button>
            ) : null}
            {activeJob?.cms?.downloadUrl ? (
              <p className="sr-verify-summary">
                Your exact site + WYSIWYG admin (Payload, Turso-ready) · {activeJob.cms.pageCount || 0} pages · {activeJob.cms.slotCount || 0} editable slots
                {activeJob.cms.verified ? ' · verified' : ''} — unzip, then npm install · npm run seed · npm run dev (see README).
              </p>
            ) : null}
            {verifySummary ? <p className="sr-verify-summary">{verifySummary}</p> : null}
          </>
        ) : (
          <div className="sr-empty">No zip yet — it appears here once a run completes.</div>
        )}
      </section>

      {/* ── Arweave — permanent hosting ────────────────────────────── */}
      <section id="site-recreate-arweave-panel" className="sr-panel">
        <div className="sr-head">
          <span className="sr-kicker"><Globe size={13} /> Launch on Arweave</span>
          {activeJob?.arweave?.arweaveUrl ? (
            <a href={activeJob.arweave.arweaveUrl} target="_blank" rel="noreferrer" className="sr-open-link">
              <ExternalLink size={12} /> View on Arweave
            </a>
          ) : null}
        </div>
        {activeJob?.arweave?.arweaveUrl ? (
          <>
            <p className="sr-sub">
              Permanently hosted — deployed {formatDate(activeJob.arweave.deployedAt) || ''}.
            </p>
            <p className="sr-verify-summary">
              Manifest: <a href={activeJob.arweave.arweaveUrl} target="_blank" rel="noreferrer">{activeJob.arweave.manifestId}</a>
              {activeJob.arweave.arnsUrl ? <> · ArNS: <a href={activeJob.arweave.arnsUrl} target="_blank" rel="noreferrer">{activeJob.arweave.arnsUrl}</a></> : null}
            </p>
            {arweaveContentDirty ? (
              <>
                <p className="sr-sub" id="site-recreate-arweave-dirty-note">
                  <strong>Content has changed since this publish</strong> — the Arweave copy is a permanent
                  snapshot of the older version. Republish to put the latest content on-chain.
                </p>
                {!arweaveEstimate ? (
                  <button type="button" className="cta-pill-btn" disabled={arweaveBusy} onClick={loadArweaveEstimate}>
                    {arweaveBusy ? 'ESTIMATING…' : 'ESTIMATE REPUBLISH'}
                  </button>
                ) : (
                  <button type="button" className="cta-pill-btn" disabled={arweaveBusy} onClick={launchOnArweave}>
                    {arweaveBusy ? 'PUBLISHING…' : 'REPUBLISH TO ARWEAVE — PERMANENT'}
                  </button>
                )}
              </>
            ) : null}
          </>
        ) : !activeJob?.zip?.downloadUrl ? (
          <div className="sr-empty">Available once a run completes — puts the recreated site on permanent decentralized storage.</div>
        ) : (
          <>
            <p className="sr-sub">
              Publish the recreated site to permanent, decentralized storage with a public manifest link.
              Uploads are wallet-funded and <strong>cannot be deleted</strong>.
            </p>
            {!arweaveEstimate ? (
              <button
                type="button"
                id="site-recreate-arweave-estimate-btn"
                className="cta-pill-btn"
                disabled={arweaveBusy}
                onClick={loadArweaveEstimate}
              >
                {arweaveBusy ? 'ESTIMATING…' : 'ESTIMATE COST'}
              </button>
            ) : (
              <>
                <p className="sr-verify-summary">
                  ≈ {(arweaveEstimate.sizeBytes / (1024 * 1024)).toFixed(1)}MB · {arweaveEstimate.fileCount || '—'} files ·
                  {' '}{typeof arweaveEstimate.costAR === 'number' ? `${arweaveEstimate.costAR.toFixed(5)} AR` : '— AR'}
                  {typeof arweaveEstimate.costUSD === 'number' ? ` (~$${arweaveEstimate.costUSD.toFixed(2)})` : ''}
                </p>
                <button
                  type="button"
                  id="site-recreate-arweave-launch-btn"
                  className="cta-pill-btn"
                  disabled={arweaveBusy}
                  onClick={launchOnArweave}
                >
                  {arweaveBusy ? 'LAUNCHING…' : 'LAUNCH ON ARWEAVE — PERMANENT'}
                </button>
              </>
            )}
          </>
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
        .sr-download-btn { display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; margin-bottom: 4px; }
        .sr-download-cms { border: 1px solid rgba(42,36,32,0.24); }
        .sr-demo-editor-controls { display: flex; align-items: center; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
        .sr-demo-editor-controls select { font-family: var(--font-mono); font-size: 12px; padding: 8px 10px; border: 1px solid rgba(42,36,32,0.2); border-radius: 10px; background: #fff; }
        .sr-demo-slot-list { max-height: 340px; overflow: auto; display: grid; gap: 8px; border: 1px solid rgba(42,36,32,0.1); border-radius: 12px; padding: 10px; background: rgba(255,255,255,0.6); }
        .sr-demo-slot-row { display: grid; gap: 3px; }
        .sr-demo-slot-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; color: rgba(42,36,32,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sr-demo-slot-row textarea { font-size: 12px; padding: 6px 8px; border: 1px solid rgba(42,36,32,0.16); border-radius: 8px; resize: vertical; background: #fff; }
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
