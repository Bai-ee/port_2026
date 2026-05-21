'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react';

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

export default function SocialPostingPanel({ getIdToken, sourceDraft, sourceLabel = 'dashboard' }) {
  const [content, setContent] = useState(sourceDraft || '');
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocal());
  const [posts, setPosts] = useState([]);
  const [agents, setAgents] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (sourceDraft && !content.trim()) setContent(sourceDraft);
  }, [sourceDraft]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function runAction(action) {
    if (!canSubmit && action !== 'process-due') return;
    setBusy(action);
    setNotice(null);
    try {
      if (action === 'optimize') {
        const data = await apiFetch({ action: 'optimize', content, source: sourceLabel });
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
        const data = await apiFetch({ action, content, source: sourceLabel, agents });
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
          source: sourceLabel,
          scheduledAt: new Date(scheduledAt).toISOString(),
          agents,
        });
        setPosts((prev) => [data.post, ...prev.filter((post) => post.id !== data.post.id)]);
        setNotice({ kind: 'ok', text: `Scheduled for ${formatDate(data.post.scheduledAt)}.` });
        return;
      }

      if (action === 'draft') {
        const data = await apiFetch({ action, content, source: sourceLabel, agents });
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
          {sourceDraft ? (
            <button type="button" className="sp-link-btn" onClick={() => setContent(sourceDraft)}>
              Use generated dashboard creative
            </button>
          ) : null}
          <div className="sp-actions">
            <button type="button" onClick={() => runAction('optimize')} disabled={!canSubmit || !!busy}>
              {busy === 'optimize' ? <Loader2 size={15} className="sp-spin" /> : <Wand2 size={15} />} Optimize
            </button>
            <button type="button" onClick={() => runAction('draft')} disabled={!canSubmit || !!busy}>
              Save Draft
            </button>
            <button type="button" className="sp-primary" onClick={() => runAction('post-now')} disabled={!canSubmit || !!busy || !credentialReady}>
              {busy === 'post-now' ? <Loader2 size={15} className="sp-spin" /> : <Send size={15} />} Post Now
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
                {busy === 'diagnose' ? <Loader2 size={14} className="sp-spin" /> : <Sparkles size={14} />}
              </button>
              <button type="button" className="sp-icon-btn" onClick={() => runAction('process-due')} disabled={!!busy} aria-label="Post due scheduled items">
                {busy === 'process-due' ? <Loader2 size={14} className="sp-spin" /> : <RefreshCw size={14} />}
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
        .sp-icon-btn { min-height: 26px; width: 28px; padding: 0; }
        .sp-queue-actions { display: inline-flex; gap: 6px; }
        .sp-spin { animation: sp-spin 0.8s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .sp-grid { grid-template-columns: 1fr; }
          .sp-compose { grid-row: auto; }
          .sp-schedule-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
