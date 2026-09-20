'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Lock, PenSquare, RefreshCw, Video } from 'lucide-react';

// Archive Inbox — assets the Archive has confirmed, becoming things you can post.
//
// This is the operator's half of the seam. The Archive's `/archive` surface owns
// review: Jev proposes, a human confirms, and only a CONFIRMED record appears
// here. This card never writes back to `archive_review` — it reads it, shows
// what each confirmed asset became, and takes the one thing the Archive
// deliberately does not hold: the story.
//
// A story is a publishing decision, not an archival fact, so it lives on this
// side (`x_content_packages`) and is the only field this card writes.
//
// Styling note (same trap as XCalendarCard/XMonitorCard): this uses
// `<style jsx global>` with EVERY selector prefixed by `#archive-inbox-card`,
// because plain `<style jsx>` only scopes JSX written directly in this
// component's return and silently skips markup rendered from a mapped array.

const STORY_MIN = 40;

function rightsLabel(rights) {
  if (rights === 'owned') return { text: 'owned', tone: 'ok' };
  if (rights === 'cleared') return { text: 'cleared', tone: 'ok' };
  if (rights === 'never-public') return { text: 'never public', tone: 'stop' };
  return { text: 'needs client clearance', tone: 'stop' };
}

export default function ArchiveInboxCard({ getIdToken }) {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    if (!getIdToken) return;
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/archive-inbox?action=inbox', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read the archive inbox.');
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setCounts(data.counts || null);
    } catch (err) {
      setError(err?.message || 'Could not read the archive inbox.');
      setRows([]);
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const saveStory = useCallback(async (row) => {
    if (!getIdToken) return;
    const id = row.package.id;
    const draft = drafts[id] || {};
    setSavingId(id);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/archive-inbox?action=save-story', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          story: draft.story ?? row.package.story ?? '',
          title: draft.title ?? row.package.title ?? '',
          sha256: (row.package.assetRefs || []).slice(-1)[0] || null,
          series: row.package.series || null,
          pillar: row.package.pillar || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save the story.');
      await load();
    } catch (err) {
      setError(err?.message || 'Could not save the story.');
    } finally {
      setSavingId(null);
    }
  }, [getIdToken, drafts, load]);

  const setDraft = useCallback((id, patch) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }, []);

  // Rows that cannot be posted lead, because they are the ones with work in
  // them. A finished row is a result, not a task.
  const ordered = useMemo(() => {
    const rank = (r) => {
      if (r.package.rights === 'client-approval-needed') return 2;
      if (!r.hasStory) return 0;
      return r.validation.ok ? 3 : 1;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [rows]);

  return (
    <div id="archive-inbox-card">
      <style jsx global>{`
        #archive-inbox-card { display:flex; flex-direction:column; gap:14px; min-height:0; }
        #archive-inbox-card .ai-head { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
        #archive-inbox-card .ai-kpis { display:flex; gap:16px; flex-wrap:wrap; margin-right:auto; }
        #archive-inbox-card .ai-kpi { display:flex; flex-direction:column; gap:1px; }
        #archive-inbox-card .ai-kpi b { font-size:19px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
        #archive-inbox-card .ai-kpi span { font-size:10px; letter-spacing:.08em; text-transform:uppercase; opacity:.62; }
        #archive-inbox-card .ai-btn {
          display:inline-flex; align-items:center; gap:6px; padding:7px 12px; font-size:12px; font-weight:600;
          border:1px solid rgba(128,128,128,.34); border-radius:6px; background:transparent; color:inherit; cursor:pointer;
        }
        #archive-inbox-card .ai-btn:hover:not(:disabled) { border-color:currentColor; }
        #archive-inbox-card .ai-btn:disabled { opacity:.5; cursor:not-allowed; }
        #archive-inbox-card .ai-btn--go { background:#111; color:#fff; border-color:#111; }
        #archive-inbox-card .ai-err {
          padding:8px 10px; border-radius:6px; font-size:12px;
          background:rgba(185,28,28,.09); color:#b91c1c;
        }
        #archive-inbox-card .ai-list { display:flex; flex-direction:column; gap:8px; }
        #archive-inbox-card .ai-row {
          border:1px solid rgba(128,128,128,.26); border-left-width:3px; border-radius:6px; padding:10px 12px;
          display:flex; flex-direction:column; gap:6px;
        }
        #archive-inbox-card .ai-row.is-ready { border-left-color:#15803d; }
        #archive-inbox-card .ai-row.is-story { border-left-color:#b45309; }
        #archive-inbox-card .ai-row.is-blocked { border-left-color:#b91c1c; }
        #archive-inbox-card .ai-row-top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        #archive-inbox-card .ai-name { font-weight:600; font-size:13px; }
        #archive-inbox-card .ai-file { font-family:ui-monospace,monospace; font-size:11px; opacity:.6; word-break:break-all; }
        #archive-inbox-card .ai-pill {
          display:inline-flex; align-items:center; gap:4px; font-size:10px; letter-spacing:.05em;
          text-transform:uppercase; padding:2px 7px; border-radius:999px; border:1px solid currentColor;
        }
        #archive-inbox-card .ai-pill.ok { color:#15803d; }
        #archive-inbox-card .ai-pill.warn { color:#b45309; }
        #archive-inbox-card .ai-pill.stop { color:#b91c1c; }
        #archive-inbox-card .ai-pill.flat { color:inherit; opacity:.55; }
        #archive-inbox-card .ai-meta { display:flex; gap:12px; flex-wrap:wrap; font-size:11px; opacity:.62; }
        #archive-inbox-card .ai-story { font-size:12.5px; opacity:.85; }
        #archive-inbox-card .ai-note { font-size:11px; opacity:.6; }
        #archive-inbox-card .ai-correct { font-size:11px; color:#b45309; }
        #archive-inbox-card .ai-edit { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
        #archive-inbox-card .ai-edit label { display:flex; flex-direction:column; gap:3px; font-size:10px; letter-spacing:.08em; text-transform:uppercase; opacity:.6; }
        #archive-inbox-card .ai-edit input, #archive-inbox-card .ai-edit textarea {
          font:inherit; font-size:13px; padding:7px 9px; border-radius:6px; width:100%;
          border:1px solid rgba(128,128,128,.34); background:transparent; color:inherit;
        }
        #archive-inbox-card .ai-edit textarea { min-height:72px; resize:vertical; }
        #archive-inbox-card .ai-edit-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        #archive-inbox-card .ai-empty { padding:26px 12px; text-align:center; font-size:12.5px; opacity:.6; border:1px dashed rgba(128,128,128,.34); border-radius:6px; }
        @media (max-width:560px) { #archive-inbox-card .ai-kpis { gap:12px; } }
      `}</style>

      <div className="ai-head">
        <div className="ai-kpis">
          <div className="ai-kpi"><b>{counts?.confirmed ?? '—'}</b><span>Confirmed</span></div>
          <div className="ai-kpi"><b>{counts?.ready ?? '—'}</b><span>Postable</span></div>
          <div className="ai-kpi"><b>{counts?.needsStory ?? '—'}</b><span>Need a story</span></div>
          <div className="ai-kpi"><b>{counts?.rightsBlocked ?? '—'}</b><span>Rights-blocked</span></div>
        </div>
        <button type="button" className="ai-btn" onClick={() => load().catch(() => {})} disabled={loading}>
          <RefreshCw size={13} /> {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {error ? <div className="ai-err">{error}</div> : null}

      {!loading && !error && ordered.length === 0 ? (
        <div className="ai-empty">
          Nothing confirmed yet. Assets appear here once someone has reviewed them
          in <strong>/archive</strong> — Jev proposes, a person confirms, and only then
          does an asset become something you could post.
        </div>
      ) : null}

      <div className="ai-list">
        {ordered.map((row) => {
          const p = row.package;
          const rights = rightsLabel(p.rights);
          const blocked = p.rights === 'client-approval-needed' || p.rights === 'never-public';
          const cls = blocked ? 'is-blocked' : row.validation.ok ? 'is-ready' : 'is-story';
          const open = openId === p.id;
          const draft = drafts[p.id] || {};
          const storyVal = draft.story ?? p.story ?? '';
          const titleVal = draft.title ?? p.title ?? '';
          return (
            <div key={p.id} className={`ai-row ${cls}`}>
              <div className="ai-row-top">
                <span className="ai-name">{p.title || row.archiveName || p.id}</span>
                {row.validation.ok ? (
                  <span className="ai-pill ok"><CheckCircle2 size={11} /> postable</span>
                ) : blocked ? (
                  <span className="ai-pill stop"><Lock size={11} /> {rights.text}</span>
                ) : (
                  <span className="ai-pill warn"><PenSquare size={11} /> needs a story</span>
                )}
                {p.mediaState === 'video' ? <span className="ai-pill flat"><Video size={11} /> video</span> : null}
                {row.permanent ? <span className="ai-pill flat"><Archive size={11} /> permanent</span> : null}
              </div>

              <div className="ai-file">{row.archiveName}</div>

              <div className="ai-meta">
                <span>{row.seriesLabel ? `${p.series} ${row.seriesLabel}` : 'no series'}</span>
                <span>{p.pillar || 'no pillar'}</span>
                <span>{p.eraYear ?? 'era unknown'}</span>
                <span>{row.sourcePathCount} NAS path{row.sourcePathCount === 1 ? '' : 's'}</span>
              </div>

              {storyVal ? <div className="ai-story">{storyVal}</div> : null}

              {row.corrections?.length ? (
                <div className="ai-correct">
                  <AlertTriangle size={11} /> you overruled the model on {row.corrections.map((c) => c.questionId).join(', ')}
                </div>
              ) : null}

              {blocked ? (
                <div className="ai-note">
                  Client work. It stays out of the plan until the rights question is answered
                  &ldquo;no&rdquo; in /archive — automating the wrong asset once costs a client relationship.
                </div>
              ) : null}

              {!blocked && (
                open ? (
                  <div className="ai-edit">
                    <label htmlFor={`ai-title-${p.id}`}>
                      Title
                      <input
                        id={`ai-title-${p.id}`}
                        type="text"
                        value={titleVal}
                        placeholder="Housepit CHI · East Room"
                        onChange={(e) => setDraft(p.id, { title: e.target.value })}
                      />
                    </label>
                    <label htmlFor={`ai-story-${p.id}`}>
                      Story — the one field no model can produce
                      <textarea
                        id={`ai-story-${p.id}`}
                        value={storyVal}
                        placeholder="What actually happened. Not what is in the picture — what you remember."
                        onChange={(e) => setDraft(p.id, { story: e.target.value })}
                      />
                    </label>
                    <div className="ai-edit-actions">
                      <button
                        type="button"
                        className="ai-btn ai-btn--go"
                        disabled={savingId === p.id}
                        onClick={() => saveStory(row)}
                      >
                        {savingId === p.id ? 'Saving…' : 'Save story'}
                      </button>
                      <button type="button" className="ai-btn" onClick={() => setOpenId(null)}>Cancel</button>
                      {storyVal.trim().length > 0 && storyVal.trim().length < STORY_MIN ? (
                        <span className="ai-note">Short — the story is the post, the artifact is the attachment.</span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="ai-edit-actions">
                    <button type="button" className="ai-btn" onClick={() => setOpenId(p.id)}>
                      <PenSquare size={13} /> {storyVal ? 'Edit story' : 'Write the story'}
                    </button>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
