'use client';

import { useEffect, useState } from 'react';

// Public status band for the Life Timeline ingest. Reads /api/life/status (no auth, numbers only).
// Refreshes every 60 s. Mobile first: single column, 2 columns from 560px, 4 from 900px.

const C = {
  surface: 'var(--t-dash-surface)',
  raised: 'var(--t-dash-surface-raised)',
  text: 'var(--t-dash-text-primary)',
  muted: 'var(--t-dash-text-secondary)',
  border: 'var(--t-dash-border)',
  accent: 'var(--t-accent)',
  ok: 'var(--t-success)',
  okBg: 'var(--t-success-bg)',
  warn: 'var(--t-warning)',
  danger: 'var(--t-danger)',
  dangerBg: 'var(--t-danger-bg)',
};

const STALE_MIN = 15;
const REFRESH_MS = 60000;
const nf = new Intl.NumberFormat('en-US');
const fmtN = (n) => (n == null ? '-' : nf.format(n));

export function minutesSince(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 60000));
}

export function fmtAgo(min) {
  if (min == null) return 'unknown';
  if (min < 1) return 'just now';
  if (min < 90) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

export function fmtSince(min) {
  if (min == null) return '-';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function statusAlert(status, now = Date.now()) {
  if (!status) return { alert: false, reasons: [] };
  const reasons = [];
  const age = minutesSince(status.updatedAt, now);
  if (age == null || age > STALE_MIN) reasons.push('stale');
  if (status.run?.state === 'stopped') reasons.push('stopped');
  if (status.run?.error) reasons.push('error');
  return { alert: reasons.length > 0, reasons, age };
}

function Box({ id, title, children, tone, wide }) {
  const bad = tone === 'bad';
  return (
    <section
      id={id}
      style={{
        background: bad ? C.dangerBg : C.surface, border: `1px solid ${bad ? C.danger : C.border}`, borderRadius: 12,
        padding: 12, minWidth: 0, boxSizing: 'border-box', gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      <h2 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>{title}</h2>
      {children}
    </section>
  );
}

const big = { fontSize: 24, fontWeight: 600, lineHeight: 1.2 };
const sub = { fontSize: 12, color: C.muted, marginTop: 2, overflowWrap: 'anywhere' };

export default function StatusBand() {
  const [status, setStatus] = useState(undefined); // undefined = loading, null = none yet
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/life/status', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (alive) { setStatus(body.status || null); setError(''); setNow(Date.now()); }
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load');
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { alive = false; clearInterval(t); clearInterval(tick); };
  }, []);

  const wrap = { maxWidth: 1200, margin: '0 auto 16px' };

  if (status === undefined) {
    return <div id="life-status-band" style={{ ...wrap, color: C.muted, fontSize: 13 }}>{error ? `Status unavailable: ${error}` : 'Loading status…'}</div>;
  }
  if (status === null) {
    return <div id="life-status-band" style={{ ...wrap, color: C.muted, fontSize: 13 }}>No status yet. The Mac heartbeat has not reported.</div>;
  }

  const { run = {}, progress: p = {}, machine: m = {}, recent = [] } = status;
  const a = statusAlert(status, now);
  const stepMin = minutesSince(run.stepStartedAt, now);
  const pct = p.batchesTotal ? Math.min(100, Math.round(((p.batchesDone || 0) / p.batchesTotal) * 100)) : 0;
  const stateLabel = run.error ? `${run.state || 'unknown'} · ${run.error}` : (run.state || 'unknown');
  const etaText = p.etaFinishAt
    ? new Date(p.etaFinishAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '-';
  const diskLow = m.diskFreeGb != null && m.diskFreeGb < 20;

  return (
    <div id="life-status-band" style={wrap}>
      <div
        id="life-status-heartbeat"
        role={a.alert ? 'alert' : 'status'}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', padding: '8px 12px', marginBottom: 8, borderRadius: 12, fontSize: 13,
          background: a.alert ? C.dangerBg : C.okBg, border: `1px solid ${a.alert ? C.danger : C.ok}`, color: a.alert ? C.danger : C.ok,
        }}
      >
        <strong>{a.alert ? 'Needs attention' : 'Healthy'}</strong>
        <span>heartbeat {fmtAgo(a.age)}</span>
        {a.reasons.includes('stale') && <span>(older than {STALE_MIN} min)</span>}
        {a.reasons.includes('stopped') && <span>· run stopped{run.stoppedAt ? ` at ${run.stoppedAt}` : ''}</span>}
        {a.reasons.includes('error') && <span>· {run.error}</span>}
        {error && <span style={{ color: C.muted }}>· refresh failed</span>}
      </div>

      <div id="life-status-grid" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
        <Box id="life-status-run" title="Run" tone={run.state === 'stopped' || run.error ? 'bad' : undefined}>
          <div style={big}>{stateLabel}</div>
          <div style={sub}>
            Batch {run.batch || '-'} · step {run.step || '-'}
            {stepMin != null ? ` · ${fmtSince(stepMin)} in step` : ''}
          </div>
          <div style={sub}>Switch: {run.enabled || '-'}</div>
        </Box>

        <Box id="life-status-progress" title="Progress">
          <div style={big}>{fmtN(p.batchesDone)} / {fmtN(p.batchesTotal)} <span style={{ fontSize: 13, color: C.muted, fontWeight: 400 }}>batches</span></div>
          <div
            id="life-status-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            style={{ height: 8, borderRadius: 4, background: C.raised, overflow: 'hidden', margin: '6px 0' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: C.accent }} />
          </div>
          <div style={sub}>
            This batch: {fmtN(p.itemsDownloadedThisBatch)}{p.itemsThisBatchTotal != null ? ` / ${fmtN(p.itemsThisBatchTotal)}` : ''} downloaded
          </div>
          {p.batchesRemaining?.length > 0 && <div style={sub}>Next: {p.batchesRemaining.slice(0, 4).join(', ')}{p.batchesRemaining.length > 4 ? '…' : ''}</div>}
        </Box>

        <Box id="life-status-items" title="Items">
          <div style={big}>{fmtN(p.pushed)} <span style={{ fontSize: 13, color: C.muted, fontWeight: 400 }}>/ {fmtN(p.assets)} pushed</span></div>
          <div style={sub}>+{fmtN(p.pushedLast24h)} in the last 24 h</div>
          <div style={sub}>{fmtN(p.unpushed)} waiting · {fmtN(p.noThumb)} without thumb</div>
          <div style={sub}>Last push {fmtAgo(minutesSince(p.lastPushAt, now))}</div>
        </Box>

        <Box id="life-status-eta" title="ETA">
          <div style={big}>{etaText}</div>
          <div style={sub}>{p.itemsPerMin != null ? `${p.itemsPerMin.toFixed(1)} items/min` : 'rate unknown'}</div>
        </Box>

        <Box id="life-status-machine" title="Machine">
          <div style={big}>{m.power || '-'}{m.batteryPct != null ? ` · ${Math.round(m.batteryPct)}%` : ''}</div>
          <div style={sub}>{m.chargerWatts != null ? `Charger ${m.chargerWatts} W · ` : ''}Mem free {m.memFreePct != null ? `${Math.round(m.memFreePct)}%` : '-'}</div>
          <div style={{ ...sub, color: diskLow ? C.danger : C.muted }}>Disk free {m.diskFreeGb != null ? `${Math.round(m.diskFreeGb)} GB` : '-'}</div>
          <div style={{ ...sub, color: m.nasMounted === false ? C.danger : C.muted }}>NAS {m.nasMounted == null ? '-' : m.nasMounted ? 'mounted' : 'NOT mounted'}</div>
          <div style={{ ...sub, color: m.controlServerUp === false ? C.danger : C.muted }}>Control server {m.controlServerUp == null ? '-' : m.controlServerUp ? 'up' : 'down'}</div>
        </Box>

        <Box id="life-status-recent" title="Recent events" wide>
          {recent.length === 0 ? <div style={sub}>No events yet.</div> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {recent.slice(0, 10).map((e, i) => (
                <li key={`${e.at || 'x'}-${i}`} style={{ fontSize: 13, display: 'flex', gap: 8, minWidth: 0 }}>
                  <span style={{ color: C.muted, flex: '0 0 auto' }}>{e.at ? fmtAgo(minutesSince(e.at, now)) : '-'}</span>
                  <span style={{ overflowWrap: 'anywhere' }}>{e.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>
    </div>
  );
}
