'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

// Life Timeline P4: bare owner-only validation view (test harness, not the final UI).
// Data: /api/life/{months,month,item}, gated server-side by LIFE_OWNER_UIDS.

const C = {
  page: 'var(--t-dash-page)',
  surface: 'var(--t-dash-surface)',
  raised: 'var(--t-dash-surface-raised)',
  text: 'var(--t-dash-text-primary)',
  muted: 'var(--t-dash-text-secondary)',
  border: 'var(--t-dash-border)',
  accent: 'var(--t-accent)',
  danger: 'var(--t-danger)',
  overlay: 'var(--t-overlay)',
  onOverlay: 'var(--t-on-overlay)',
};

function monthRange(months) {
  if (!months.length) return [];
  const counts = new Map(months.map((m) => [m.ym, m.count]));
  const [y0, m0] = months[0].ym.split('-').map(Number);
  const [y1, m1] = months[months.length - 1].ym.split('-').map(Number);
  const out = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); ) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ ym, count: counts.get(ym) || 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const fmtDur = (s) => {
  if (s == null) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function LifeTimelinePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [index, setIndex] = useState(null);
  const [fatal, setFatal] = useState('');
  const [ym, setYm] = useState(null);
  const [month, setMonth] = useState(null);
  const [monthError, setMonthError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const monthRetried = useRef(false);
  const detailRetried = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      const here = `${window.location.pathname}${window.location.search || ''}`;
      router.replace(`/login?redirect=${encodeURIComponent(here)}&next=${encodeURIComponent(here)}`);
    }
  }, [user, loading, router]);

  const api = useCallback(async (path) => {
    const token = await user.getIdToken();
    const r = await fetch(path, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status });
    return body;
  }, [user]);

  const describe = (e) => (e.status === 503 ? 'Life timeline not configured: set LIFE_OWNER_UIDS'
    : e.status === 403 ? 'Owner only' : e.message);

  useEffect(() => {
    if (!user) return;
    api('/api/life/months').then(setIndex).catch((e) => setFatal(describe(e)));
  }, [user, api]);

  const range = useMemo(() => monthRange(index?.months || []), [index]);
  const maxCount = useMemo(() => Math.max(1, ...range.map((m) => m.count)), [range]);

  const loadMonth = useCallback(async (target) => {
    setYm(target);
    setMonthError('');
    monthRetried.current = false;
    try { setMonth(await api(`/api/life/month?ym=${target}`)); } catch (e) { setMonth(null); setMonthError(describe(e)); }
  }, [api]);

  const refetchMonthOnce = useCallback(async () => {
    if (monthRetried.current || !ym) return;
    monthRetried.current = true;
    try { setMonth(await api(`/api/life/month?ym=${ym}`)); } catch { /* keep stale grid */ }
  }, [api, ym]);

  const openItem = useCallback(async (id) => {
    setSelected(id);
    setDetail(null);
    detailRetried.current = false;
    try { setDetail(await api(`/api/life/item?id=${id}`)); } catch (e) { setDetail({ error: describe(e) }); }
  }, [api]);

  const refetchDetailOnce = useCallback(async () => {
    if (detailRetried.current || !selected) return;
    detailRetried.current = true;
    try { setDetail(await api(`/api/life/item?id=${selected}`)); } catch { /* ignore */ }
  }, [api, selected]);

  const onScrubKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = range.findIndex((m) => m.ym === ym);
    const next = e.key === 'ArrowLeft' ? (i < 0 ? 0 : i - 1) : (i < 0 ? 0 : i + 1);
    if (range[next]) loadMonth(range[next].ym);
  };

  useEffect(() => {
    if (!selected) return undefined;
    const h = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selected]);

  const shell = { minHeight: '100vh', background: C.page, color: C.text, padding: '16px 8px', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' };

  if (loading || !user) return <div id="life-timeline-page-shell" style={shell}>Loading…</div>;

  const item = detail?.item;

  return (
    <div id="life-timeline-page-shell" style={shell}>
      <div id="life-timeline-header" style={{ maxWidth: 1200, margin: '0 auto 12px' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Life Timeline</h1>
        <p id="life-timeline-harness-note" style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
          Test harness: bare validation view of the private photo index (thumbnails and 1600px previews only).
          {index ? ` ${index.total} items.` : ''}
        </p>
      </div>

      {fatal && <div id="life-timeline-error-banner" style={{ maxWidth: 1200, margin: '0 auto', color: C.danger }}>{fatal}</div>}

      {index && (
        <div id="life-month-scrubber-row" style={{ maxWidth: 1200, margin: '0 auto 12px', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div
            id="life-month-scrubber-bars"
            role="listbox"
            aria-label="Months"
            tabIndex={0}
            onKeyDown={onScrubKey}
            style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: 72, overflowX: 'auto', background: C.surface, border: `1px solid ${C.border}`, padding: 4 }}
          >
            {range.map((m) => (
              <button
                key={m.ym}
                type="button"
                role="option"
                aria-selected={m.ym === ym}
                title={`${m.ym}: ${m.count}`}
                onClick={() => loadMonth(m.ym)}
                style={{
                  flex: '0 0 6px', minWidth: 6, height: `${Math.max(2, (m.count / maxCount) * 100)}%`, padding: 0, border: 0, cursor: 'pointer',
                  background: m.ym === ym ? C.accent : m.count ? C.muted : C.border,
                }}
              />
            ))}
          </div>
          {index.unknownCount > 0 && (
            <button id="life-unknown-date-button" type="button" onClick={() => loadMonth('unknown')}
              style={{ padding: '8px 10px', background: ym === 'unknown' ? C.accent : C.surface, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              Unknown date ({index.unknownCount})
            </button>
          )}
        </div>
      )}

      {index && !range.length && !index.unknownCount && <div style={{ maxWidth: 1200, margin: '0 auto', color: C.muted }}>No items yet.</div>}
      {ym && <div id="life-month-title" style={{ maxWidth: 1200, margin: '0 auto 8px', fontSize: 14 }}>{ym}{month ? ` · ${month.items.length} items` : ''}</div>}
      {monthError && <div id="life-month-error" style={{ maxWidth: 1200, margin: '0 auto', color: C.danger }}>{monthError}</div>}

      {month && (
        <div id="life-month-grid" style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
          {month.items.map((it) => (
            <button key={it.id} type="button" onClick={() => openItem(it.id)}
              style={{ position: 'relative', padding: 0, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', aspectRatio: it.w && it.h ? `${it.w} / ${it.h}` : '1 / 1', overflow: 'hidden' }}>
              {it.thumbUrl && (
                <img src={it.thumbUrl} alt="" loading="lazy" onError={refetchMonthOnce} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
              {it.k === 'v' && (
                <span style={{ position: 'absolute', right: 4, bottom: 4, padding: '1px 5px', fontSize: 11, background: C.overlay, color: C.onOverlay }}>
                  ▶ {fmtDur(it.d)}
                </span>
              )}
              {it.m && (
                <span style={{ position: 'absolute', left: 4, top: 4, padding: '1px 5px', fontSize: 11, background: C.overlay, color: C.onOverlay }}>LIVE</span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div id="life-item-drawer-overlay" onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, background: C.overlay, display: 'flex', justifyContent: 'flex-end', zIndex: 50 }}>
          <div id="life-item-drawer-panel" onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(640px, 100%)', height: '100%', overflowY: 'auto', background: C.raised, color: C.text, padding: '16px 8px', boxSizing: 'border-box' }}>
            <button id="life-item-drawer-close" type="button" onClick={() => setSelected(null)}
              style={{ marginBottom: 8, padding: '4px 10px', background: C.surface, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer' }}>Close</button>
            {!detail && <div>Loading…</div>}
            {detail?.error && <div style={{ color: C.danger }}>{detail.error}</div>}
            {item && (
              <div id="life-item-drawer-content">
                {detail.previewUrl && (
                  <img src={detail.previewUrl} alt="" onError={refetchDetailOnce} style={{ width: '100%', display: 'block' }} />
                )}
                {item.kind === 'video' && <div style={{ color: C.muted, fontSize: 12 }}>Video: poster only ({fmtDur(item.durationSec)})</div>}
                <dl id="life-item-drawer-meta" style={{ fontSize: 13, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
                  <dt>Taken</dt><dd style={{ margin: 0 }}>{item.takenLocal || 'unknown'}</dd>
                  <dt>Timezone</dt><dd style={{ margin: 0 }}>{item.tz || '—'}</dd>
                  <dt>Source</dt><dd style={{ margin: 0 }}>{item.tsSource || '—'} ({item.tsKind})</dd>
                  <dt>GPS</dt><dd style={{ margin: 0 }}>{item.gps ? `${item.gps.lat}, ${item.gps.lon}` : '—'}</dd>
                  <dt>Albums</dt><dd style={{ margin: 0 }}>{item.albums?.length ? item.albums.join(', ') : '—'}</dd>
                  <dt>Size</dt><dd style={{ margin: 0 }}>{item.width}×{item.height}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
