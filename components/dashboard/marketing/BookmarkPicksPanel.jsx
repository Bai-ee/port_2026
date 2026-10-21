'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;
const SCAN_WAIT_MS = 12 * 60 * 1000;
const SCAN_TERMINAL = new Set(['done', 'partial', 'failed', 'rate-limited', 'bird-unavailable']);
const REPLY_MAX = 280;
const FILTERS = [
  { id: 'open', label: 'Respond' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'all', label: 'All' },
];
const RESPOND_LABEL = { quote: 'Quote', reply: 'Reply', swipe: 'Swipe' };
const BORDER = '1px solid color-mix(in srgb, var(--t-text) 16%, transparent)';

function relativeAgo(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function ageLabel(hours) {
  if (!Number.isFinite(hours)) return '';
  return hours < 1 ? '<1h' : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
}

const pill = { fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: BORDER, whiteSpace: 'nowrap' };

// Bookmark picks: the owner's X bookmarks judged against the strategy. The only writes are owner clicks
// (bookmark-decide: quote draft / reply draft / dismiss). Nothing here posts to X.
export default function BookmarkPicksPanel({ call, clientId, onNavigate }) {
  const [filter, setFilter] = useState('open');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState({});
  const [replyFor, setReplyFor] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [kept, setKept] = useState({});
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await call('bookmarks-list', { filter, limit: 30 });
      if (!alive.current) return;
      setData(res || null);
      setError('');
    } catch (e) {
      if (alive.current) setError(e?.message || 'Could not load bookmark picks.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [call, filter]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    return () => { alive.current = false; };
  }, [load, clientId]);

  const scanNow = async () => {
    setScanning(true);
    setScanNote('Queued — your Mac picks it up within a minute…');
    setError('');
    try {
      const res = await call('bookmarks-find', { clientId });
      if (!res?.requestId) {
        setScanNote(res?.instructions || 'The bookmarks scan runs on your Mac.');
        return;
      }
      const started = Date.now();
      let finished = null;
      while (alive.current && Date.now() - started < SCAN_WAIT_MS) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, POLL_MS));
        // eslint-disable-next-line no-await-in-loop
        const st = await call('quote-scan-status', { clientId, requestId: res.requestId }).catch(() => null);
        const req = st?.request;
        if (req && SCAN_TERMINAL.has(req.status)) { finished = req; break; }
        if (alive.current) setScanNote(req?.status === 'running' ? 'Scanning on your Mac…' : 'Queued — your Mac picks it up within a minute…');
      }
      if (!alive.current) return;
      if (!finished) { setScanNote('Still waiting on your Mac. It stays queued and runs when the Mac checks in.'); return; }
      if (finished.status === 'done' || finished.status === 'partial') setScanNote('');
      else setScanNote(finished.status === 'rate-limited' ? 'X rate-limited the scan; try again in ~15 min.' : `Scan ${finished.status}${finished.error ? ` (${finished.error})` : ''}.`);
      await load();
    } catch (e) {
      if (alive.current) setError(e?.message || 'Scan failed.');
    } finally {
      if (alive.current) setScanning(false);
    }
  };

  const decide = async (pick, decision, text) => {
    setBusyId(pick.id);
    setRowError((m) => ({ ...m, [pick.id]: '' }));
    try {
      await call('bookmark-decide', { id: pick.id, decision, ...(decision === 'reply' ? { text } : {}) });
      if (!alive.current) return;
      setData((d) => (d ? { ...d, picks: (d.picks || []).filter((p) => p.id !== pick.id) } : d)); // optimistic removal
      if (replyFor === pick.id) { setReplyFor(null); setReplyText(''); }
      if (decision === 'quote') onNavigate?.('queue');
    } catch (e) {
      if (alive.current) setRowError((m) => ({ ...m, [pick.id]: e?.message || 'Could not save that.' }));
    } finally {
      if (alive.current) setBusyId(null);
    }
  };

  const picks = Array.isArray(data?.picks) ? data.picks : [];
  const shown = filter === 'open' ? picks.filter((p) => p.respond !== 'swipe') : filter === 'swipe' ? picks.filter((p) => p.respond === 'swipe') : picks;

  return (
    <section id="strategy-bookmarks-panel" data-section="bookmark-picks" aria-label="From your bookmarks" style={{ border: BORDER, borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--t-surface)', minWidth: 0 }}>
      <div id="strategy-bookmarks-header-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span id="strategy-bookmarks-title" style={{ fontSize: 11, opacity: 0.75, minWidth: 0, overflowWrap: 'anywhere' }}>
          FROM YOUR BOOKMARKS · {picks.length} pick{picks.length === 1 ? '' : 's'} · scanned {relativeAgo(data?.scannedAt)}
        </span>
        <button type="button" id="strategy-bookmarks-scan-button" className="xce-btn-ghost" disabled={scanning} onClick={scanNow}>
          {scanning ? 'Scanning...' : 'Scan now'}
        </button>
      </div>
      <div id="strategy-bookmarks-filter-row" role="group" aria-label="Bookmark filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" id={`strategy-bookmarks-filter-${f.id}`} aria-pressed={filter === f.id}
            className={filter === f.id ? 'xce-btn-primary' : 'xce-btn-ghost'} style={{ minHeight: 30, padding: '0 12px' }} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {scanNote ? <div id="strategy-bookmarks-scan-note" style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>{scanNote}</div> : null}
      {error ? <div id="strategy-bookmarks-error" style={{ fontSize: 11, color: 'var(--t-danger)', marginBottom: 6 }}>{error}</div> : null}
      {loading && !data ? <div id="strategy-bookmarks-loading" style={{ fontSize: 12, opacity: 0.7 }}>Loading...</div> : null}
      {!loading && !shown.length && !error ? (
        <div id="strategy-bookmarks-empty" style={{ fontSize: 12, opacity: 0.7 }}>No bookmark picks yet — Scan now (free).</div>
      ) : null}
      <div id="strategy-bookmarks-list" style={{ display: 'grid', gap: 8 }}>
        {shown.map((p) => {
          const busy = busyId === p.id;
          const replying = replyFor === p.id;
          return (
            <div key={p.id} id={`strategy-bookmark-row-${p.id}`} style={{ border: BORDER, borderRadius: 10, padding: 10, minWidth: 0 }}>
              <div id={`strategy-bookmark-meta-${p.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', fontSize: 11, marginBottom: 4 }}>
                <strong style={{ overflowWrap: 'anywhere' }}>{p.url ? <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{p.author}</a> : p.author}</strong>
                <span style={{ opacity: 0.7 }}>{[ageLabel(p.ageHours), Number.isFinite(p.likes) ? `${p.likes} likes` : ''].filter(Boolean).join(' · ')}</span>
                {p.media && p.media !== 'none' ? <span style={pill}>{p.media}</span> : null}
                {p.lane ? <span style={pill}>{p.lane}</span> : null}
                <span style={{ ...pill, background: 'var(--t-text)', color: 'var(--t-surface)' }}>{RESPOND_LABEL[p.respond] || p.respond}</span>
              </div>
              <div id={`strategy-bookmark-text-${p.id}`} style={{ fontSize: 13, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.text}</div>
              {p.how ? <div id={`strategy-bookmark-how-${p.id}`} style={{ fontSize: 12, opacity: 0.8, marginTop: 4, overflowWrap: 'anywhere' }}>{p.how}</div> : null}
              {p.why ? <div id={`strategy-bookmark-why-${p.id}`} style={{ fontSize: 11, opacity: 0.6, marginTop: 2, overflowWrap: 'anywhere' }}>{p.why}</div> : null}
              {replying ? (
                <div id={`strategy-bookmark-reply-${p.id}`} style={{ marginTop: 8 }}>
                  <textarea id={`strategy-bookmark-reply-input-${p.id}`} value={replyText} maxLength={REPLY_MAX} rows={3} onChange={(e) => setReplyText(e.target.value)}
                    aria-label="Reply text" style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: 8, borderRadius: 8, border: BORDER, background: 'var(--t-surface)', color: 'var(--t-text)' }} />
                  <div style={{ fontSize: 11, opacity: 0.6, textAlign: 'right' }}>{replyText.length}/{REPLY_MAX}</div>
                </div>
              ) : null}
              <div id={`strategy-bookmark-actions-${p.id}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {p.respond === 'quote' ? <button type="button" id={`strategy-bookmark-quote-${p.id}`} className="xce-btn-primary" disabled={busy} onClick={() => decide(p, 'quote')}>{busy ? 'Saving...' : 'Draft quote'}</button> : null}
                {p.respond === 'reply' && !replying ? <button type="button" id={`strategy-bookmark-reply-open-${p.id}`} className="xce-btn-primary" disabled={busy} onClick={() => { setReplyFor(p.id); setReplyText(''); }}>Reply…</button> : null}
                {p.respond === 'reply' && replying ? <button type="button" id={`strategy-bookmark-reply-save-${p.id}`} className="xce-btn-primary" disabled={busy || !replyText.trim()} onClick={() => decide(p, 'reply', replyText.trim())}>{busy ? 'Saving...' : 'Save reply draft'}</button> : null}
                {p.respond === 'swipe' ? <button type="button" id={`strategy-bookmark-keep-${p.id}`} className="xce-btn-ghost" aria-pressed={!!kept[p.id]} onClick={() => setKept((m) => ({ ...m, [p.id]: true }))}>{kept[p.id] ? 'Kept' : 'Keep'}</button> : null}
                <button type="button" id={`strategy-bookmark-skip-${p.id}`} className="xce-btn-ghost" disabled={busy} onClick={() => decide(p, 'dismiss')}>Skip</button>
              </div>
              {rowError[p.id] ? <div id={`strategy-bookmark-error-${p.id}`} style={{ fontSize: 11, color: 'var(--t-danger)', marginTop: 4 }}>{rowError[p.id]}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
