'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, Copy, FilePlus2, Save, Send, Sparkles, Wand2 } from 'lucide-react';

// Copywriter — a quick X/Twitter notepad. Draft, save, evaluate (live X-algo
// score, deterministic + free), update in place, and schedule/publish on the fly.
// Shares the /api/social-posting backend + social_posts store with Schedule Posts,
// so drafts written here appear there and vice-versa.

function toDatetimeLocal(date) {
  const d = date ? new Date(date) : new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function scoreTone(pct) {
  if (pct >= 60) return 'ok';
  if (pct >= 40) return 'warn';
  return 'low';
}

export default function CopywriterCard({ getIdToken }) {
  const [content, setContent] = useState('');
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocal());
  const [posts, setPosts] = useState([]);
  const [credentials, setCredentials] = useState(null);
  const [score, setScore] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [copiedCand, setCopiedCand] = useState(null);

  const scoreReqRef = useRef(0);

  const charCount = content.length;
  const overLimit = charCount > 280;
  const canSubmit = content.trim().length > 0 && !overLimit;

  const apiFetch = useCallback(async (body = null) => {
    const token = await getIdToken();
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      : { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    const res = await fetch('/api/social-posting', options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.hint || data?.error || `HTTP ${res.status}`);
    return data;
  }, [getIdToken]);

  const loadPosts = useCallback(async () => {
    try {
      const data = await apiFetch();
      setPosts(data.posts || []);
      setCredentials(data.credentials || null);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load saved drafts.' });
    }
  }, [apiFetch]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const credentialReady = useMemo(() => {
    if (!credentials) return true;
    return credentials.hasApiKey && credentials.hasApiSecret && credentials.hasAccessToken && credentials.hasAccessSecret;
  }, [credentials]);

  // Live, free score-as-you-type — debounced, race-safe (stale responses dropped).
  useEffect(() => {
    const text = content.trim();
    if (!text) { setScore(null); setScoring(false); return; }
    const reqId = ++scoreReqRef.current;
    setScoring(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch({ action: 'score', content });
        if (scoreReqRef.current === reqId) setScore(data.score || null);
      } catch {
        if (scoreReqRef.current === reqId) setScore(null);
      } finally {
        if (scoreReqRef.current === reqId) setScoring(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [content, apiFetch]);

  function resetComposer() {
    setContent('');
    setEditingId(null);
    setScore(null);
    setNotice(null);
    setScheduledAt(toDatetimeLocal());
  }

  function loadIntoComposer(post) {
    setEditingId(post.id);
    setContent(post.content || '');
    setScheduledAt(post.scheduledAt ? toDatetimeLocal(post.scheduledAt) : toDatetimeLocal());
    setNotice(null);
  }

  // Upsert the returned post into local state without a full reload.
  function upsertPost(post) {
    if (!post) return;
    setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
  }

  async function save() {
    if (!canSubmit || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const data = editingId
        ? await apiFetch({ action: 'update', postId: editingId, content, scheduledAt: null, source: 'copywriter' })
        : await apiFetch({ action: 'draft', content, source: 'copywriter' });
      upsertPost(data.post);
      setEditingId(data.post?.id || null);
      setNotice({ kind: 'ok', text: editingId ? 'Draft updated.' : 'Saved as a draft.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not save draft.' });
    } finally {
      setBusy('');
    }
  }

  async function schedule() {
    if (!canSubmit || busy) return;
    setBusy('schedule');
    setNotice(null);
    try {
      const iso = new Date(scheduledAt).toISOString();
      const data = editingId
        ? await apiFetch({ action: 'update', postId: editingId, content, scheduledAt: iso, source: 'copywriter' })
        : await apiFetch({ action: 'schedule', content, scheduledAt: iso, source: 'copywriter' });
      upsertPost(data.post);
      setEditingId(data.post?.id || null);
      setNotice({ kind: 'ok', text: `Scheduled for ${formatDate(data.post?.scheduledAt) || 'the chosen time'}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not schedule post.' });
    } finally {
      setBusy('');
    }
  }

  async function postNow() {
    if (!canSubmit || busy || !credentialReady) return;
    setBusy('post-now');
    setNotice(null);
    try {
      const data = await apiFetch({ action: 'post-now', content, source: 'copywriter' });
      upsertPost(data.post);
      setNotice({ kind: 'ok', text: data.post?.twitterId ? `Posted to X: ${data.post.twitterId}` : 'Posted to X.' });
      resetComposer();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not post to X.' });
    } finally {
      setBusy('');
    }
  }

  async function enhance() {
    if (!canSubmit || busy) return;
    setBusy('enhance');
    setNotice(null);
    setCandidates(null);
    try {
      const data = await apiFetch({ action: 'enhance', content, source: 'copywriter' });
      const list = (data.candidates || []).filter((c) => c && c.text);
      if (!list.length) throw new Error('No enhancements returned.');
      setCandidates(list);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not enhance draft.' });
    } finally {
      setBusy('');
    }
  }

  function useCandidate(cand) {
    setContent(cand.text);
    setCandidates(null);
    setNotice({ kind: 'ok', text: `Loaded the ${cand.label} rewrite — review, then save or post.` });
  }

  async function copyCandidate(cand) {
    try {
      await navigator.clipboard.writeText(cand.text);
      setCopiedCand(cand.id);
      setTimeout(() => setCopiedCand(null), 1400);
    } catch {
      setNotice({ kind: 'error', text: 'Clipboard not available in this context.' });
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setNotice({ kind: 'error', text: 'Clipboard not available in this context.' });
    }
  }

  const pct = score ? Math.round((score.xGrowthScore || 0) * 100) : 0;
  const tone = scoreTone(pct);
  const topRecs = (score?.recommendations || [])
    .slice()
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
    .slice(0, 2);
  const warnings = Array.from(new Set((score?.warnings || []).map((w) => w.message))).slice(0, 3);

  // The notepad shows editable rows only — published posts drop out.
  const savedDrafts = posts.filter((p) => p.status !== 'posted' && p.status !== 'posting').slice(0, 12);

  // Analyzed Posts — two fixed slots, always rendered as placeholders until
  // AI Enhance fills them (brand-voice + best-for-X rewrites, each scored).
  const CAND_SLOTS = [
    { id: 'voice', label: 'Brand Voice', hint: 'A rewrite in your system / Brain voice.' },
    { id: 'algo', label: 'Best for X', hint: 'A rewrite tuned to score best on the X algorithm.' },
  ];
  const candById = (id) => (candidates || []).find((c) => c.id === id) || null;
  const enhancing = busy === 'enhance';

  return (
    <div id="copywriter-card">
      {/* ── Composer ───────────────────────────────────────────────── */}
      <section id="copywriter-composer" className="cw-panel">
        <div className="cw-head">
          <span className="cw-kicker">{editingId ? 'Editing Draft' : 'Composer'}</span>
          <small className={overLimit ? 'cw-over' : ''}>{charCount}/280</small>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Jot a tweet… it scores live as you type. Save it, tweak it, schedule it."
          rows={6}
          autoFocus
        />
        <div id="copywriter-actions" className="cw-actions">
          <button type="button" onClick={save} disabled={!canSubmit || !!busy}>
            {busy === 'save' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Save size={14} />}
            {editingId ? 'Update Draft' : 'Save Draft'}
          </button>
          <button type="button" onClick={enhance} disabled={!canSubmit || !!busy}>
            {busy === 'enhance' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Wand2 size={14} />}
            AI Enhance
          </button>
          <button type="button" onClick={copyToClipboard} disabled={!content.trim()}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
          {editingId ? (
            <button type="button" onClick={resetComposer} disabled={!!busy}>
              <FilePlus2 size={14} /> New
            </button>
          ) : null}
          <button type="button" className="cw-primary" onClick={postNow} disabled={!canSubmit || !!busy || !credentialReady}>
            {busy === 'post-now' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Send size={14} />}
            Post Now
          </button>
        </div>
        <div id="copywriter-schedule-row" className="cw-schedule-row">
          <label>
            <span><CalendarClock size={13} /> Schedule</span>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <button type="button" onClick={schedule} disabled={!canSubmit || !!busy}>
            {busy === 'schedule' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : null}
            Schedule
          </button>
        </div>
        {!credentialReady ? <p className="cw-error">X credentials are not fully configured on the server — Post Now is disabled.</p> : null}
        {notice ? <p className={`cw-notice cw-notice-${notice.kind}`}>{notice.text}</p> : null}
      </section>

      {/* ── Live score ─────────────────────────────────────────────── */}
      <section id="copywriter-score" className="cw-panel">
        <div className="cw-head">
          <span className="cw-kicker">Live Score</span>
          <Sparkles size={14} className="cw-head-icon" />
        </div>
        {score ? (
          <div className="cw-score-body">
            <div className="cw-score-top">
              <div className={`cw-meter cw-meter-${tone}`}>
                <div className="cw-meter-num">{pct}</div>
                <div className="cw-meter-cap">X-algo score</div>
              </div>
              <div className="cw-tags">
                {score.postType ? <span className="cw-chip">{String(score.postType).replace(/-/g, ' ')}</span> : null}
                {score.targetAction ? <span className="cw-chip cw-chip-muted">drives {score.targetAction}</span> : null}
              </div>
            </div>
            <div className="cw-bar"><span className={`cw-bar-fill cw-bar-${tone}`} style={{ width: `${pct}%` }} /></div>
            {topRecs.length ? (
              <ul className="cw-recs">
                {topRecs.map((r, i) => <li key={i}><strong>{r.action}.</strong> {r.reason}</li>)}
              </ul>
            ) : <p className="cw-muted">No changes suggested — this reads well.</p>}
            {warnings.length ? (
              <ul className="cw-warns">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="cw-empty">{scoring ? 'Scoring…' : 'Start typing to see a live, free X-algo score.'}</div>
        )}
      </section>

      {/* ── Analyzed Posts — always shown; AI Enhance fills the slots ─── */}
      <section id="copywriter-enhance" className="cw-panel">
        <div className="cw-head">
          <span className="cw-kicker"><Sparkles size={13} /> Analyzed Posts</span>
          {candidates ? (
            <button type="button" className="cw-clear" onClick={() => setCandidates(null)}>Clear</button>
          ) : <small>AI ENHANCE</small>}
        </div>
        <p className="cw-sub">Two spelling &amp; grammar-checked rewrites — a brand-voice version and a best-for-X version. Run <strong>AI Enhance</strong> above to fill these, then pick one.</p>
        <div className="cw-cand-stack">
          {CAND_SLOTS.map((slot) => {
            const c = candById(slot.id);
            if (c) {
              const cpct = Math.round((c.score?.xGrowthScore || 0) * 100);
              const ct = scoreTone(cpct);
              return (
                <article key={slot.id} className="cw-cand">
                  <div className="cw-cand-head">
                    <span className="cw-cand-kicker">{slot.label}</span>
                    <span className={`cw-cand-score cw-cand-score-${ct}`} title="X-algo score">{cpct}</span>
                  </div>
                  <p className="cw-cand-body">{c.text}</p>
                  <div className="cw-cand-foot">
                    <span className="cw-cand-count">{c.text.length}/280</span>
                    <div className="cw-cand-actions">
                      <button type="button" className="cw-cand-copy" onClick={() => copyCandidate(c)}>
                        {copiedCand === c.id ? <Check size={13} /> : <Copy size={13} />} {copiedCand === c.id ? 'Copied' : 'Copy'}
                      </button>
                      <button type="button" className="cw-cand-use" onClick={() => useCandidate(c)}>Use this</button>
                    </div>
                  </div>
                </article>
              );
            }
            return (
              <article key={slot.id} className={`cw-cand cw-cand-empty${enhancing ? ' cw-cand-loading' : ''}`}>
                <div className="cw-cand-head">
                  <span className="cw-cand-kicker">{slot.label}</span>
                  <span className="cw-cand-score cw-cand-score-empty">—</span>
                </div>
                <p className="cw-cand-placeholder">{enhancing ? 'Analyzing…' : slot.hint}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Saved notepad ──────────────────────────────────────────── */}
      <section id="copywriter-saved-list" className="cw-panel cw-saved">
        <div className="cw-head">
          <span className="cw-kicker">Saved Drafts</span>
          <small>{savedDrafts.length}</small>
        </div>
        {savedDrafts.length ? savedDrafts.map((post) => {
          const when = formatDate(post.scheduledAt);
          const ps = post.agents?.engagementOptimizer?.xGrowthScore;
          return (
            <button
              type="button"
              key={post.id}
              className={`cw-saved-item cw-status-${post.status} ${editingId === post.id ? 'cw-saved-active' : ''}`}
              onClick={() => loadIntoComposer(post)}
            >
              <div className="cw-saved-meta">
                <span className="cw-saved-status">{post.status}</span>
                {when ? <span className="cw-saved-when">{when}</span> : null}
                {typeof ps === 'number' ? <span className="cw-saved-score">{Math.round(ps * 100)}</span> : null}
              </div>
              <p>{post.content}</p>
            </button>
          );
        }) : <div className="cw-empty">No saved drafts yet. Write one and hit Save.</div>}
      </section>

      <style jsx>{`
        /* Single-column vertical stack — white theme (dashboard modal style guide) */
        #copywriter-card { margin-top: 18px; display: grid; gap: 14px; }
        .cw-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        .cw-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
        .cw-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        .cw-head small { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(42,36,32,0.5); }
        .cw-head-icon { color: rgba(42,36,32,0.4); }
        .cw-over { color: #9f1f17 !important; }
        textarea { width: 100%; resize: vertical; min-height: 132px; border: 1px solid rgba(42,36,32,0.14); border-radius: 10px; padding: 14px 16px; background: rgba(255,255,255,0.98); color: #2a2420; font: inherit; line-height: 1.5; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); }
        textarea:focus, input:focus { border-color: rgba(42,36,32,0.36); box-shadow: 0 0 0 3px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.65); }
        .cw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); color: #2a2420; min-height: 38px; padding: 0 15px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        button:hover:not(:disabled) { background: rgba(255,255,255,0.95); border-color: rgba(42,36,32,0.2); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
        button:active:not(:disabled) { transform: translateY(0); transition-duration: 80ms; }
        button:disabled { opacity: 0.48; cursor: not-allowed; }
        .cw-primary { background: #2a2420; color: #ffffff; border-color: #2a2420; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
        .cw-primary:hover:not(:disabled) { background: #3a332e; border-color: #3a332e; box-shadow: 0 4px 14px rgba(42,36,32,0.2), inset 0 1px 0 rgba(255,255,255,0.12); }
        .cw-schedule-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; margin-top: 12px; }
        label { display: flex; flex-direction: column; gap: 6px; }
        label span { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.6); }
        input { min-height: 40px; border: 1px solid rgba(42,36,32,0.14); border-radius: 10px; padding: 0 12px; background: rgba(255,255,255,0.98); color: #2a2420; font: inherit; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); }
        .cw-notice, .cw-error { margin: 12px 0 0; font-size: 12px; line-height: 1.4; }
        .cw-notice-ok { color: #285f3b; }
        .cw-notice-error, .cw-error { color: #9f1f17; }
        .cw-muted { font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.6); }
        .cw-sub { margin: -4px 0 12px; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        .cw-sub strong { color: rgba(42,36,32,0.8); }
        .cw-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        /* Live score */
        .cw-score-body { display: grid; gap: 12px; }
        .cw-score-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
        .cw-meter { display: flex; align-items: baseline; gap: 8px; }
        .cw-meter-num { font-family: var(--font-mono); font-size: 34px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
        .cw-meter-cap { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(42,36,32,0.5); }
        .cw-meter-ok .cw-meter-num { color: #285f3b; }
        .cw-meter-warn .cw-meter-num { color: #b7791f; }
        .cw-meter-low .cw-meter-num { color: #9f1f17; }
        .cw-bar { height: 7px; border-radius: 4px; background: rgba(42,36,32,0.09); overflow: hidden; }
        .cw-bar-fill { display: block; height: 100%; border-radius: 4px; }
        .cw-bar-ok { background: #2f9e6b; }
        .cw-bar-warn { background: #d9a441; }
        .cw-bar-low { background: #d1584d; }
        .cw-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .cw-chip { display: inline-flex; align-items: center; min-height: 28px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; padding: 0 12px; border-radius: 999px; background: rgba(42,36,32,0.06); border: 1px solid rgba(42,36,32,0.08); color: #3a332e; text-transform: capitalize; }
        .cw-chip-muted { background: rgba(255,255,255,0.5); border-color: rgba(42,36,32,0.14); color: rgba(42,36,32,0.6); text-transform: none; }
        .cw-recs { margin: 0; padding-left: 16px; display: grid; gap: 6px; }
        .cw-recs li { font-size: 12px; line-height: 1.45; color: rgba(42,36,32,0.72); }
        .cw-recs strong { color: #2a2420; }
        .cw-warns { margin: 4px 0 0; padding-left: 16px; display: grid; gap: 4px; }
        .cw-warns li { font-size: 11px; line-height: 1.4; color: #b7791f; }
        /* Analyzed Posts — vertical stack of full-width cards / placeholders */
        .cw-clear { min-height: 28px; padding: 0 12px; font-size: 11px; }
        .cw-cand-stack { display: grid; gap: 12px; }
        .cw-cand { display: flex; flex-direction: column; gap: 10px; min-height: 104px; padding: 14px; border: 1px solid rgba(42,36,32,0.14); border-radius: 12px; background: rgba(255,255,255,0.78); box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: border-color 160ms ease, box-shadow 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        .cw-cand:not(.cw-cand-empty):hover { border-color: rgba(42,36,32,0.24); box-shadow: 0 6px 20px rgba(42,36,32,0.09); transform: translateY(-2px); }
        .cw-cand-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .cw-cand-kicker { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #3a332e; }
        .cw-cand-score { font-family: var(--font-mono); font-size: 13px; font-weight: 700; min-width: 30px; text-align: center; padding: 2px 8px; border-radius: 999px; background: rgba(42,36,32,0.06); }
        .cw-cand-score-ok { color: #285f3b; }
        .cw-cand-score-warn { color: #b7791f; }
        .cw-cand-score-low { color: #9f1f17; }
        .cw-cand-score-empty { color: rgba(42,36,32,0.4); }
        .cw-cand-body { margin: 0; flex: 1; font-size: 14px; line-height: 1.55; color: #2a2420; white-space: pre-wrap; }
        .cw-cand-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .cw-cand-count { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
        .cw-cand-actions { display: inline-flex; gap: 6px; }
        .cw-cand-copy { min-height: 34px; padding: 0 12px; font-size: 11px; }
        .cw-cand-use { min-height: 36px; padding: 0 18px; font-size: 12px; font-weight: 700; border: 0; color: #fff; background: linear-gradient(135deg, hsl(185,100%,42%) 0%, hsl(262,90%,58%) 52%, hsl(314,90%,52%) 100%); box-shadow: 0 2px 10px rgba(0,180,210,0.24), inset 0 1px 0 rgba(255,255,255,0.28); }
        .cw-cand-use:hover:not(:disabled) { background: linear-gradient(135deg, hsl(185,100%,42%) 0%, hsl(262,90%,58%) 52%, hsl(314,90%,52%) 100%); box-shadow: 0 4px 16px rgba(0,180,210,0.34), inset 0 1px 0 rgba(255,255,255,0.28); transform: translateY(-1px); }
        .cw-cand-empty { border-style: dashed; background: rgba(255,255,255,0.34); box-shadow: none; }
        .cw-cand-placeholder { margin: 0; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.48); }
        .cw-cand-loading .cw-cand-placeholder { color: rgba(42,36,32,0.72); }
        .cw-cand-loading { border-color: rgba(42,36,32,0.24); animation: cw-pulse 1.4s ease-in-out infinite; }
        @keyframes cw-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
        /* Saved list */
        .cw-saved { max-height: 360px; overflow: auto; }
        .cw-saved-item { display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 12px 14px; min-height: 0; font-weight: 500; border: 1px solid rgba(42,36,32,0.1); border-radius: 12px; background: rgba(255,255,255,0.72); box-shadow: none; }
        .cw-saved-item:hover:not(:disabled) { border-color: rgba(42,36,32,0.24); background: rgba(255,255,255,0.98); box-shadow: 0 4px 16px rgba(42,36,32,0.07); transform: translateY(-1px); }
        .cw-saved-active { border-color: rgba(42,36,32,0.5); background: rgba(255,255,255,1); }
        .cw-saved-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .cw-saved-status { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.55); }
        .cw-saved-when, .cw-saved-score { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
        .cw-saved-score { margin-left: auto; padding: 1px 7px; border-radius: 999px; background: rgba(42,36,32,0.06); }
        .cw-saved-item p { margin: 0; font-size: 13px; line-height: 1.45; color: rgba(42,36,32,0.82); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .cw-status-scheduled { border-left: 3px solid #4a7c7e; }
        .cw-status-failed { border-left: 3px solid #9f1f17; }
        @media (max-width: 480px) {
          .cw-schedule-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
