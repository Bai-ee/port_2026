'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react';

function toDatetimeLocal(date) {
  const d = date ? new Date(date) : new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SocialPostingPanel({ getIdToken, sourceDraft, sourceLabel = 'dashboard', strategyPostPool = [] }) {
  const strategySuggestions = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(strategyPostPool) ? strategyPostPool : [])
      .map((item, index) => {
        const text = String(item?.text || item?.content || '').trim();
        if (!text) return null;
        const key = text.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          id: item?.id || `strategy-${index}`,
          text: text.slice(0, 280),
          date: item?.date || '',
          theme: item?.theme || item?.kind || '',
          rationale: item?.rationale || item?.angle || '',
          scheduledAt: item?.scheduledAt || '',
          source: item?.source || 'strategy',
        };
      })
      .filter(Boolean);
  }, [strategyPostPool]);
  const [strategyIndex, setStrategyIndex] = useState(0);
  const selectedStrategyPost = strategySuggestions[strategyIndex % Math.max(strategySuggestions.length, 1)] || null;
  const activeSourceDraft = selectedStrategyPost?.text || sourceDraft || '';
  const activeSourceLabel = selectedStrategyPost ? `strategy:${selectedStrategyPost.source || '30-day'}` : sourceLabel;
  const [content, setContent] = useState(activeSourceDraft || '');
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocal());
  const [posts, setPosts] = useState([]);
  const [agents, setAgents] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (strategyIndex >= strategySuggestions.length && strategySuggestions.length > 0) setStrategyIndex(0);
  }, [strategyIndex, strategySuggestions.length]);

  useEffect(() => {
    if (activeSourceDraft && !content.trim()) setContent(activeSourceDraft);
  }, [activeSourceDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const charCount = content.length;
  const canSubmit = content.trim().length > 0 && charCount <= 280;

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
      setNotice({ kind: 'error', text: err.message || 'Could not load social queue.' });
    }
  }, [apiFetch]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const credentialReady = useMemo(() => {
    if (!credentials) return true;
    return credentials.hasApiKey && credentials.hasApiSecret && credentials.hasAccessToken && credentials.hasAccessSecret;
  }, [credentials]);

  function loadStrategySuggestion(item = selectedStrategyPost) {
    if (!item?.text) return;
    setContent(item.text);
    if (item.scheduledAt) setScheduledAt(toDatetimeLocal(item.scheduledAt));
  }

  function refreshStrategySuggestion() {
    if (!strategySuggestions.length) return;
    const currentTheme = String(selectedStrategyPost?.theme || '').trim().toLowerCase();
    const similarIndexes = strategySuggestions
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => (
        index !== strategyIndex
        && currentTheme
        && String(item.theme || '').trim().toLowerCase() === currentTheme
      ))
      .map(({ index }) => index);
    const candidates = similarIndexes.length
      ? similarIndexes
      : strategySuggestions.map((_, index) => index).filter((index) => index !== strategyIndex);
    const nextIndex = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : strategyIndex;
    setStrategyIndex(nextIndex);
    loadStrategySuggestion(strategySuggestions[nextIndex]);
  }

  async function runAction(action) {
    if (!canSubmit && action !== 'process-due') return;
    setBusy(action);
    setNotice(null);
    try {
      if (action === 'optimize') {
        const data = await apiFetch({ action: 'optimize', content, source: activeSourceLabel });
        setContent(data.optimized || content);
        setAgents(data.agents || null);
        setNotice({ kind: 'ok', text: 'Agents optimized the draft.' });
        return;
      }

      if (action === 'diagnose') {
        const data = await apiFetch({ action });
        setDiagnostics(data.diagnostics || null);
        setNotice({
          kind: data.diagnostics?.ok ? 'ok' : 'error',
          text: data.diagnostics?.message || 'Twitter diagnostics complete.',
        });
        return;
      }

      if (action === 'post-now') {
        const data = await apiFetch({ action, content, source: activeSourceLabel, agents });
        setPosts((prev) => [data.post, ...prev.filter((post) => post.id !== data.post.id)]);
        setContent('');
        setAgents(null);
        setNotice({ kind: 'ok', text: data.post?.twitterId ? `Posted to X: ${data.post.twitterId}` : 'Posted to X.' });
        return;
      }

      if (action === 'schedule') {
        const data = await apiFetch({
          action,
          content,
          source: activeSourceLabel,
          scheduledAt: new Date(scheduledAt).toISOString(),
          agents,
        });
        setPosts((prev) => [data.post, ...prev.filter((post) => post.id !== data.post.id)]);
        setNotice({ kind: 'ok', text: `Scheduled for ${formatDate(data.post.scheduledAt)}.` });
        return;
      }

      if (action === 'draft') {
        const data = await apiFetch({ action, content, source: activeSourceLabel, agents });
        setPosts((prev) => [data.post, ...prev.filter((post) => post.id !== data.post.id)]);
        setNotice({ kind: 'ok', text: 'Saved as a draft.' });
        return;
      }

      if (action === 'process-due') {
        const data = await apiFetch({ action });
        await loadPosts();
        setNotice({ kind: 'ok', text: `Posted ${data.posted?.length || 0} due item(s). ${data.failed?.length || 0} failed.` });
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Social posting action failed.' });
    } finally {
      setBusy('');
    }
  }

  // Dashboard-side counterpart to the emailed "Post to X" approval link —
  // approve (publishes immediately) or reject an 'awaiting_approval' row.
  async function handleApproval(postId, action) {
    const busyKey = `${action}:${postId}`;
    setBusy(busyKey);
    setNotice(null);
    try {
      const data = await apiFetch({ action, postId });
      setPosts((prev) => prev.map((p) => (p.id === data.post.id ? data.post : p)));
      setNotice({ kind: 'ok', text: action === 'approve-post' ? 'Approved and published.' : 'Rejected.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Action failed.' });
    } finally {
      setBusy('');
    }
  }

  const recent = posts.slice(0, 6);

  return (
    <div id="social-posting-panel">
      <div className="sp-grid">
        <section className="sp-compose">
          <div className="sp-section-head">
            <span>Composer</span>
            <small className={charCount > 280 ? 'sp-over' : ''}>{charCount}/280</small>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the X post you want published..."
            rows={7}
          />
          {selectedStrategyPost ? (
            <div className="sp-strategy-card">
              <div className="sp-strategy-head">
                <span>30-day strategy draft</span>
                <small>{strategyIndex + 1}/{strategySuggestions.length}</small>
              </div>
              <p>{selectedStrategyPost.text}</p>
              <div className="sp-strategy-meta">
                {selectedStrategyPost.date ? <span>{selectedStrategyPost.date}</span> : null}
                {selectedStrategyPost.theme ? <span>{selectedStrategyPost.theme}</span> : null}
                {selectedStrategyPost.source ? <span>{selectedStrategyPost.source}</span> : null}
              </div>
              {selectedStrategyPost.rationale ? <small className="sp-strategy-rationale">{selectedStrategyPost.rationale}</small> : null}
              <div className="sp-strategy-actions">
                <button type="button" className="sp-link-btn" onClick={() => loadStrategySuggestion()}>
                  Use this post
                </button>
                <button type="button" className="sp-link-btn" onClick={refreshStrategySuggestion}>
                  <RefreshCw size={13} /> Refresh similar
                </button>
              </div>
            </div>
          ) : sourceDraft ? (
            <button type="button" className="sp-link-btn" onClick={() => setContent(sourceDraft)}>
              Use generated dashboard creative
            </button>
          ) : null}
          <div className="sp-actions">
            <button type="button" onClick={() => runAction('optimize')} disabled={!canSubmit || !!busy}>
              {busy === 'optimize' ? <span className="comet-spinner" style={{ width: 15, height: 15, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Wand2 size={15} />} Optimize
            </button>
            <button type="button" onClick={() => runAction('draft')} disabled={!canSubmit || !!busy}>
              Save Draft
            </button>
            <button type="button" className="sp-primary" onClick={() => runAction('post-now')} disabled={!canSubmit || !!busy || !credentialReady}>
              {busy === 'post-now' ? <span className="comet-spinner" style={{ width: 15, height: 15, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Send size={15} />} Post Now
            </button>
          </div>
          <div className="sp-schedule-row">
            <label>
              <span><CalendarClock size={14} /> Schedule</span>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </label>
            <button type="button" onClick={() => runAction('schedule')} disabled={!canSubmit || !!busy}>
              Schedule
            </button>
          </div>
          {!credentialReady ? <p className="sp-error">Twitter credentials are not fully configured on the server.</p> : null}
          {notice ? <p className={`sp-notice sp-notice-${notice.kind}`}>{notice.text}</p> : null}
          {diagnostics ? (
            <div className="sp-diagnostics">
              <strong>{diagnostics.account?.username ? `@${diagnostics.account.username}` : diagnostics.issue || 'Twitter access'}</strong>
              {diagnostics.message ? <span>{diagnostics.message}</span> : null}
              <span>{diagnostics.readable ? 'OAuth read check passed' : 'OAuth read check failed'}</span>
              {typeof diagnostics.v2Readable === 'boolean' ? (
                <span>{diagnostics.v2Readable ? 'X API v2 check passed' : `X API v2 check failed${diagnostics.twitterError?.data?.reason ? `: ${diagnostics.twitterError.data.reason}` : ''}`}</span>
              ) : null}
              <span>{diagnostics.credentials?.envNames?.accessToken ? `Token env: ${diagnostics.credentials.envNames.accessToken}` : 'Token env missing'}</span>
              {diagnostics.credentials?.previews?.apiKey ? <span>{`API key: ${diagnostics.credentials.previews.apiKey}`}</span> : null}
              {diagnostics.credentials?.previews?.accessToken ? <span>{`Access token: ${diagnostics.credentials.previews.accessToken}`}</span> : null}
            </div>
          ) : null}
        </section>

        <section className="sp-agents">
          <div className="sp-section-head">
            <span>Agents</span>
            <Sparkles size={15} />
          </div>
          {agents ? (
            <div className="sp-agent-list">
              {Object.entries(agents).map(([key, agent]) => (
                <article key={key} className="sp-agent-card">
                  <strong>{key.replace(/([A-Z])/g, ' $1')}</strong>
                  <p>{agent.note || (agent.hashtags || []).join(' ') || agent.status}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="sp-empty">Run Optimize to pass the post through content, hashtag, and engagement agents.</div>
          )}
        </section>

        <section className="sp-queue">
          <div className="sp-section-head">
            <span>Queue</span>
            <div className="sp-queue-actions">
              <button type="button" className="sp-icon-btn" onClick={() => runAction('diagnose')} disabled={!!busy} aria-label="Check Twitter access">
                {busy === 'diagnose' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Sparkles size={14} />}
              </button>
              <button type="button" className="sp-icon-btn" onClick={() => runAction('process-due')} disabled={!!busy} aria-label="Post due scheduled items">
                {busy === 'process-due' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>
          {recent.length ? recent.map((post) => (
            <article key={post.id} className={`sp-post sp-post-${post.status}`}>
              <div>
                <strong>{post.status}</strong>
                <span>{post.twitterId ? `#${post.twitterId}` : formatDate(post.scheduledAt || post.postedAt || post.createdAt)}</span>
              </div>
              <p>{post.content}</p>
              {post.error ? <small>{post.errorHint || post.error}</small> : null}
              {post.status === 'awaiting_approval' ? (
                <div id={`social-post-approval-row-${post.id}`} className="sp-approval-actions">
                  <button type="button" onClick={() => handleApproval(post.id, 'approve-post')} disabled={!!busy}>
                    {busy === `approve-post:${post.id}` ? 'Posting…' : 'Approve & Post'}
                  </button>
                  <button type="button" onClick={() => handleApproval(post.id, 'reject-post')} disabled={!!busy}>
                    {busy === `reject-post:${post.id}` ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              ) : null}
            </article>
          )) : (
            <div className="sp-empty">No posts saved yet.</div>
          )}
        </section>
      </div>

      <style jsx>{`
        #social-posting-panel { margin-top: 18px; }
        .sp-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(240px, 0.75fr); gap: 14px; }
        .sp-compose, .sp-agents, .sp-queue { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.62); border-radius: 8px; padding: 14px; }
        .sp-compose { grid-row: span 2; }
        .sp-section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
        .sp-section-head span { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.66); }
        .sp-section-head small { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.58); }
        .sp-over { color: #b42318 !important; }
        textarea { width: 100%; resize: vertical; min-height: 150px; border: 1px solid rgba(42,36,32,0.16); border-radius: 8px; padding: 12px; background: rgba(255,252,244,0.94); color: #211d1a; font: inherit; line-height: 1.45; outline: none; }
        textarea:focus, input:focus { border-color: rgba(42,36,32,0.48); }
        .sp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: #e6ded3; color: #211d1a; min-height: 36px; padding: 0 12px; font-weight: 800; cursor: pointer; }
        button:disabled { opacity: 0.48; cursor: not-allowed; }
        .sp-primary { background: #24211e; color: #f7f4ef; }
        .sp-link-btn { margin-top: 8px; min-height: 28px; padding: 0; border: 0; background: transparent; color: #4a7c7e; font-size: 12px; }
        .sp-strategy-card { margin-top: 10px; display: grid; gap: 7px; border: 1px solid rgba(42,36,32,0.1); border-radius: 8px; background: rgba(250,247,242,0.78); padding: 10px; }
        .sp-strategy-head, .sp-strategy-meta, .sp-strategy-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .sp-strategy-head span { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.66); }
        .sp-strategy-head small, .sp-strategy-meta span { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.54); }
        .sp-strategy-card p { margin: 0; font-size: 12px; line-height: 1.4; color: #211d1a; }
        .sp-strategy-rationale { font-size: 11px; line-height: 1.35; color: rgba(42,36,32,0.56); }
        .sp-strategy-actions { justify-content: flex-start; }
        .sp-strategy-actions .sp-link-btn { margin-top: 0; display: inline-flex; align-items: center; gap: 5px; }
        .sp-schedule-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; margin-top: 10px; }
        label { display: flex; flex-direction: column; gap: 6px; }
        label span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; text-transform: uppercase; color: rgba(42,36,32,0.64); }
        input { min-height: 36px; border: 1px solid rgba(42,36,32,0.16); border-radius: 8px; padding: 0 10px; background: rgba(255,252,244,0.94); color: #211d1a; }
        .sp-notice, .sp-error { margin: 10px 0 0; font-size: 12px; line-height: 1.35; }
        .sp-notice-ok { color: #146c43; }
        .sp-notice-error, .sp-error { color: #b42318; }
        .sp-diagnostics { display: grid; gap: 3px; margin-top: 10px; border: 1px solid rgba(42,36,32,0.1); border-radius: 8px; background: rgba(250,247,242,0.74); padding: 10px; }
        .sp-diagnostics strong { font-size: 12px; color: #211d1a; }
        .sp-diagnostics span { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.58); }
        .sp-agent-list { display: grid; gap: 8px; }
        .sp-agent-card, .sp-post, .sp-empty { border: 1px solid rgba(42,36,32,0.1); border-radius: 8px; background: rgba(250,247,242,0.74); padding: 10px; }
        .sp-agent-card strong, .sp-post strong { display: block; text-transform: capitalize; font-size: 12px; color: #211d1a; }
        .sp-agent-card p, .sp-post p, .sp-empty { margin: 4px 0 0; font-size: 12px; line-height: 1.35; color: rgba(42,36,32,0.68); }
        .sp-queue { max-height: 320px; overflow: auto; }
        .sp-post { margin-bottom: 8px; }
        .sp-post div { display: flex; justify-content: space-between; gap: 8px; }
        .sp-post span, .sp-post small { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.54); }
        .sp-post-posted { border-color: rgba(20,108,67,0.24); }
        .sp-post-failed { border-color: rgba(180,35,24,0.3); }
        .sp-post-awaiting_approval { border-color: rgba(180,140,20,0.32); }
        .sp-approval-actions { display: flex; gap: 6px; margin-top: 8px; }
        .sp-approval-actions button { min-height: 28px; padding: 0 10px; font-size: 11px; }
        .sp-icon-btn { min-height: 26px; width: 28px; padding: 0; }
        .sp-queue-actions { display: inline-flex; gap: 6px; }
        @media (max-width: 760px) {
          .sp-grid { grid-template-columns: 1fr; }
          .sp-compose { grid-row: auto; }
          .sp-schedule-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
