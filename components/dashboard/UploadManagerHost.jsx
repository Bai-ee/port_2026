'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { uploadManager } from '../../lib/dashboard/upload-manager';
import { withImpersonation } from '../../lib/dashboard/bootstrap-session.js';

// Mounted once in DashboardPage. Wires the background upload manager to the
// signed-in user (auth header + the job's own ?as= client id), resumes unfinished
// uploads after a refresh, and shows a header chip + panel while jobs exist.

const CHIP = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 2px', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit' };
const PANEL = { position: 'absolute', top: '100%', right: 0, zIndex: 50, width: 'min(360px, 92vw)', maxHeight: '60vh', overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--t-surface)', color: 'var(--t-text)', border: '1px solid color-mix(in srgb, var(--t-text) 14%, transparent)', borderRadius: 10, fontSize: 12 };
const ROW = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const NAME = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const MUTED = { opacity: 0.7, fontSize: 11, flex: '0 0 auto' };
const BTN = { background: 'none', border: '1px solid color-mix(in srgb, var(--t-text) 24%, transparent)', borderRadius: 6, color: 'inherit', cursor: 'pointer', fontSize: 11, padding: '2px 8px' };

export default function UploadManagerHost({ user }) {
  const jobs = useSyncExternalStore(uploadManager.subscribe, uploadManager.getSnapshot, uploadManager.getSnapshot);
  const [open, setOpen] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;
  const uid = user?.uid || null;

  // Auth is read per request; ?as= comes from the job's own clientId (not the live switcher).
  useEffect(() => {
    uploadManager.configure({
      ownerId: uid,
      request: async (path, body, clientId) => {
        const u = userRef.current;
        const token = u ? await u.getIdToken() : null;
        const res = await fetch(withImpersonation(path, clientId), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status}).`), { status: res.status, data });
        return data;
      },
    });
    if (uid) uploadManager.resumeAll();
  }, [uid]);

  const visible = jobs.filter((j) => j.ownerId == null || j.ownerId === uid);
  if (!visible.length) return null;
  const active = visible.filter((j) => j.stage !== 'done' && j.stage !== 'error');
  const files = (active.length ? active : visible).flatMap((j) => j.files);
  const label = active.length
    ? `Uploading ${files.filter((f) => f.status === 'done').length}/${files.length}`
    : visible.some((j) => j.stage === 'error') ? 'Upload paused' : 'Uploads done';

  return (
    <span id="upload-manager-host-shell" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span className="cap-source-divider" aria-hidden="true" />
      <button type="button" id="upload-manager-status-chip" style={CHIP} aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Show upload progress">
        <span id="upload-manager-status-label" style={{ fontFamily: "'Doto', var(--font-mono)", fontWeight: 900, fontSize: 16, lineHeight: 1, letterSpacing: '0.04em' }}>{label}</span>
      </button>
      {open ? (
        <div id="upload-manager-panel" style={PANEL}>
          {visible.map((j) => (
            <div key={j.id} id={`upload-manager-job-${j.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={ROW}>
                <strong style={NAME}>{j.bucketName}</strong>
                <span style={MUTED}>{j.stage === 'done' ? (j.summary || 'done') : j.stage}</span>
                {j.stage === 'error' ? <button type="button" style={BTN} onClick={() => uploadManager.retry(j.id)}>Retry</button> : null}
                <button type="button" style={BTN} onClick={() => uploadManager.dismiss(j.id)}>Dismiss</button>
              </div>
              {j.error && j.stage === 'error' ? <div style={{ ...MUTED, overflowWrap: 'anywhere' }}>{j.error}</div> : null}
              {j.stage !== 'done' ? j.files.map((f) => (
                <div key={f.key} style={ROW}>
                  <span style={NAME} title={f.error || f.name}>{f.name}</span>
                  <span style={MUTED}>{f.status === 'uploading' ? `${f.progress}%` : f.status}</span>
                  {f.status === 'needs-repick' ? (
                    <label style={{ ...BTN, cursor: 'pointer' }}>
                      Re-pick
                      <input type="file" hidden accept="video/*,image/*" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadManager.repick(j.id, f.key, file); }} />
                    </label>
                  ) : null}
                </div>
              )) : null}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
