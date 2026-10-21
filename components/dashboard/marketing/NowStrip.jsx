'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 60000;
const STATE_LABEL = { posted: 'Posted', scheduled: 'Scheduled', approved: 'Approved', draft: 'Draft', suggested: 'Suggested', pick: 'Hot pick', empty: 'Empty' };
const STATE_COLOR = {
  posted: 'var(--t-success)', scheduled: 'var(--t-success)', approved: 'var(--t-success)',
  draft: 'var(--t-warning)', suggested: 'var(--t-text)', pick: 'var(--t-text)', empty: 'var(--t-danger)',
};

function relativeAgo(iso, nowMs) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return 'never';
  const mins = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// "Right now": the current/next daily baseline slot, whether it is filled, the one next action, and data freshness.
// Read-only fetch of the `now` action (same `call` helper as the rest of the card, so ?as= is honoured). The only write
// is the owner-clicked Approve (calendar-approve); freshness links never trigger a refresh.
export default function NowStrip({ call, clientId, onNavigate, onOpenCard }) {
  const [now, setNow] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await call('now');
      if (!alive.current) return;
      setNow(data?.now || null);
      setError('');
      setTick(Date.now());
    } catch (e) {
      if (alive.current) setError(e?.message || 'Could not load the live view.');
    }
  }, [call]);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, clientId]);

  const runAction = async () => {
    const action = now?.action;
    if (!action) return;
    if (action.kind === 'approve' && action.ref?.postId) {
      setBusy(true);
      try {
        await call('calendar-approve', { postId: action.ref.postId, expectedRevision: action.ref.expectedRevision });
        await load();
      } catch (e) {
        setError(e?.message || 'Approve failed.');
      } finally {
        if (alive.current) setBusy(false);
      }
      return;
    }
    onNavigate?.('queue');
  };

  const openFreshness = (id) => {
    if (id === 'posts' && typeof onOpenCard === 'function') { onOpenCard('strategy-results'); return; }
    // Refresh lives in the header panel; bring it into view (never starts a run from here).
    try { document.getElementById('marketing-refresh-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* no-op */ }
  };

  const action = now?.action;
  const actionLabel = action ? (action.kind === 'approve' ? (busy ? 'Approving...' : 'Approve now') : action.kind === 'open-editor' ? 'Open editor' : 'Open calendar') : null;

  return (
    <section id="strategy-now-strip-shell" data-section="now-strip" aria-label="Right now" style={{ border: '1px solid color-mix(in srgb, var(--t-text) 16%, transparent)', borderRadius: 12, padding: 12, marginBottom: 12, background: 'var(--t-surface)', minWidth: 0 }}>
      <div id="strategy-now-clock-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
        <span>RIGHT NOW</span>
        <span>{now ? `${now.localTime} ${String(now.tz || '').split('/').pop().replace('_', ' ')}` : ''}</span>
      </div>
      <div id="strategy-now-headline" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14, minWidth: 0, overflowWrap: 'anywhere' }}>{now ? now.headline : (error || 'Loading...')}</strong>
        {actionLabel ? <button type="button" id="strategy-now-primary-action" className="xce-btn-primary" disabled={busy} onClick={runAction}>{actionLabel}</button> : null}
      </div>
      {error && now ? <div id="strategy-now-error" style={{ fontSize: 11, color: 'var(--t-danger)', marginTop: 4 }}>{error}</div> : null}
      {now?.slots?.length ? (
        <div id="strategy-now-slots-row" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '10px 0 8px', paddingBottom: 2, maxWidth: '100%' }}>
          {now.slots.map((s, i) => {
            const isCurrent = now.current === i;
            const past = now.current !== i && (now.next == null ? true : i < now.next);
            return (
              <div key={`${s.time}-${i}`} id={`strategy-now-slot-${s.time.replace(':', '')}`} aria-current={isCurrent ? 'true' : undefined}
                style={{ flex: '0 0 auto', minWidth: 104, padding: '6px 10px', borderRadius: 10, border: isCurrent ? '2px solid var(--t-text)' : '1px solid color-mix(in srgb, var(--t-text) 16%, transparent)', opacity: past ? 0.55 : 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.time}{now.next === i ? ' · next' : ''}</div>
                <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{s.track}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: STATE_COLOR[s.state] }}>{STATE_LABEL[s.state] || s.state}</div>
              </div>
            );
          })}
        </div>
      ) : null}
      {now?.freshness?.length ? (
        <div id="strategy-now-freshness-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11 }}>
          {now.freshness.map((f) => (
            <span key={f.id} id={`strategy-now-freshness-${f.id}`} style={{ color: f.stale ? 'var(--t-warning)' : 'inherit' }}>
              {f.label}: {relativeAgo(f.asOf, tick)}{f.stale ? ' (stale)' : ''}{' '}
              <button type="button" onClick={() => openFreshness(f.id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}>Refresh</button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
