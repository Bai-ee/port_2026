'use client';

// REMIX review (?tool=remix&view=review, admin only) — owner curates rendered videos into the official
// bucket. Data/API: features/rendered-videos/curation.js via /api/dashboard/quote-targets
// (curation-list / curation-set / media-urls). Posters load lazily; a video element exists only for the
// ONE tile being played (no metadata prefetch for the rest).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GLASS, ui } from '../components/rail-ui';

const API = '/api/dashboard/quote-targets';
const TARGET = 30;
const PAGE = 30;
const POSTER_BATCH = 60;
const FILTERS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];

const stateOf = (item) => item?.curation?.state || 'pending';
const fmtDate = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };
const fmtDur = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

function recount(items) {
  const c = { pending: 0, approved: 0, rejected: 0 };
  for (const it of items) c[stateOf(it)] += 1;
  return c;
}

export default function RemixReview({ isNarrow = false, railW = 336, authedFetch = null }) {
  const [days, setDays] = useState(10);
  const [items, setItems] = useState(null); // null = loading
  const [approvedOutside, setApprovedOutside] = useState(0); // approved rows NOT in the loaded window (server total minus window)
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null); // { message }
  const [notOwner, setNotOwner] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [posters, setPosters] = useState({});
  const [playing, setPlaying] = useState(null); // { id, url } | { id, loading:true }
  const [focusId, setFocusId] = useState(null);
  const [toast, setToast] = useState(null);
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const seqRef = useRef({}); // per-id request sequence: only the latest request for an id may apply/rollback
  const confirmedRef = useRef({}); // per-id last server-confirmed curation (rollback target)
  const requestedRef = useRef(new Set()); // poster ids already fetched or in flight
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const call = useCallback(async (body) => {
    const res = await authedFetch(API, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }, [authedFetch]);

  const flash = useCallback((message) => setToast({ message }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Load (and reload when "Load older" widens the window).
  useEffect(() => {
    if (!authedFetch) return undefined;
    let cancelled = false;
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const data = await call({ action: 'curation-list', days });
        if (cancelled) return;
        if (data.skipped === 'not-owner') { setNotOwner(true); setItems([]); return; }
        const list = data.items || [];
        confirmedRef.current = {};
        setItems(list);
        setApprovedOutside(Math.max(0, (data.approvedTotal || 0) - recount(list).approved));
        setTruncated(Boolean(data.truncated));
      } catch (err) {
        if (cancelled) return;
        setError({ message: /pilot/i.test(`${err.message}`) || err.status === 403 ? 'Owner account only' : err.message });
        setItems((cur) => cur || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authedFetch, call, days]);

  const visible = useMemo(() => (items || []).filter((i) => filter === 'all' || stateOf(i) === filter), [items, filter]);
  const rendered = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const renderedKey = rendered.map((i) => i.id).join(',');
  useEffect(() => { setLimit(PAGE); }, [filter]);

  // Poster URLs only for rendered tiles, batches <=60 (media-urls cap). Each id is requested once.
  useEffect(() => {
    const need = renderedKey ? renderedKey.split(',').filter((id) => !requestedRef.current.has(id)) : [];
    if (!need.length) return;
    need.forEach((id) => requestedRef.current.add(id));
    (async () => {
      for (let i = 0; i < need.length; i += POSTER_BATCH) {
        const ids = need.slice(i, i + POSTER_BATCH);
        let urls = {};
        try { urls = (await call({ action: 'media-urls', ids, kinds: ['thumb'] })).urls || {}; } catch { /* placeholder tiles */ }
        if (!mountedRef.current) return;
        setPosters((cur) => { const next = { ...cur }; for (const id of ids) next[id] = urls[id]?.thumbUrl || null; return next; });
      }
    })();
  }, [renderedKey, call]);

  const counts = useMemo(() => recount(items || []), [items]);

  const decide = useCallback(async (id, state) => {
    const before = itemsRef.current?.find((i) => i.id === id);
    if (!before || stateOf(before) === state) return;
    if (!(id in confirmedRef.current)) confirmedRef.current[id] = before.curation || null;
    const seq = (seqRef.current[id] || 0) + 1;
    seqRef.current[id] = seq;
    const apply = (curation) => setItems((cur) => (cur || []).map((i) => (i.id === id ? { ...i, curation } : i)));
    apply(state === 'pending' ? null : { state, at: new Date().toISOString() });
    try {
      const data = await call({ action: 'curation-set', id, state });
      if (data.skipped === 'not-owner') throw new Error('This client does not own rendered videos');
      confirmedRef.current[id] = data.curation || null;
      if (seqRef.current[id] === seq) apply(data.curation || null);
    } catch (err) {
      if (seqRef.current[id] !== seq) return;
      apply(confirmedRef.current[id] || null);
      flash(`Could not save: ${err.message}`);
    }
  }, [call, flash]);

  const play = useCallback(async (id) => {
    setPlaying({ id, loading: true });
    try {
      const data = await call({ action: 'media-urls', ids: [id], kinds: ['video'] });
      const url = data.urls?.[id]?.videoUrl;
      if (!url) throw new Error('No video URL');
      setPlaying((cur) => (cur?.id === id ? { id, url } : cur));
    } catch (err) {
      if (playingRef.current?.id !== id) return;
      setPlaying(null);
      flash(`Could not load video: ${err.message}`);
    }
  }, [call, flash]);

  // Keyboard: j/k move focus, a approve, r reject, u undo, space play. Ignored inside inputs.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' && el?.closest?.('button, [role="tab"], a, video')) return; // let Space activate the focused control
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const list = rendered;
      if (!list.length) return;
      const idx = Math.max(0, list.findIndex((i) => i.id === focusId));
      const cur = list.find((i) => i.id === focusId) || list[0];
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const nextId = list[Math.min(list.length - 1, Math.max(0, idx + (k === 'j' ? 1 : -1)))].id;
        setFocusId(nextId);
        document.getElementById(`remix-review-tile-${nextId}`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      } else if (k === 'a' || k === 'r') {
        e.preventDefault();
        // In Pending the decided tile leaves the list: step focus to the neighbour so a,a,a walks forward.
        if (filter === 'pending') {
          const ci = list.findIndex((i) => i.id === cur.id);
          const nb = list[ci + 1] || list[ci - 1];
          if (nb) { setFocusId(nb.id); document.getElementById(`remix-review-tile-${nb.id}`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' }); }
        }
        decide(cur.id, k === 'a' ? 'approved' : 'rejected');
      }
      else if (k === 'u') { e.preventDefault(); decide(cur.id, 'pending'); }
      else if (k === ' ') { e.preventDefault(); setFocusId(cur.id); if (playing?.id === cur.id) setPlaying(null); else play(cur.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rendered, filter, focusId, decide, play, playing, reducedMotion]);

  const approvedTotal = approvedOutside + counts.approved;
  const alertMessage = notOwner ? 'This client does not own rendered videos' : error?.message;
  const trans = reducedMotion ? 'none' : 'background 0.18s ease, box-shadow 0.18s ease';
  const small = { ...ui.btn(false), height: 28, padding: '0 12px', fontSize: 11 };

  return (
    <div
      id="remix-review-shell"
      style={{
        display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', background: GLASS.bg, fontFamily: GLASS.sans, color: GLASS.ink,
        ...(isNarrow ? { position: 'relative', width: '100%', flex: 1, paddingTop: 100 } : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW, paddingTop: 100 }),
      }}
    >
      <div id="remix-review-header" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px' }}>
        <div id="remix-review-filter-row" role="tablist" aria-label="Review filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} style={{ ...ui.btn(filter === key), height: 30, padding: '0 14px', fontSize: 11 }}>
              {label}{key !== 'all' ? ` ${counts[key]}` : ` ${(items || []).length}`}
            </button>
          ))}
        </div>
        <div id="remix-review-bucket-counter" aria-live="polite" style={{ ...ui.label, fontSize: 11 }}>
          Approved: {approvedTotal} / target {TARGET}
        </div>
      </div>

      {truncated ? <div id="remix-review-truncated-note" style={{ ...ui.label, padding: '0 20px 8px' }}>Showing newest 200 in this window</div> : null}

      {alertMessage ? <div id="remix-review-error" role="alert" style={{ margin: '8px 20px', padding: 14, border: `1px solid ${GLASS.hair}`, borderRadius: 12, fontSize: 13 }}>{alertMessage}</div> : null}

      {items === null ? (
        <div id="remix-review-grid" aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, padding: '8px 20px' }}>
          {Array.from({ length: 8 }, (_, i) => <div key={i} style={{ aspectRatio: '16 / 9', borderRadius: 12, background: 'rgba(0,0,0,0.05)' }} />)}
        </div>
      ) : (!alertMessage && !visible.length) ? (
        <div id="remix-review-empty" style={{ padding: '32px 20px', fontSize: 13, color: GLASS.inkSoft }}>
          {(items || []).length ? `No ${filter} renders in the last ${days} days.` : `No renders in the last ${days} days.`}
        </div>
      ) : (
        <div id="remix-review-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, padding: '8px 20px' }}>
          {rendered.map((item) => {
            const st = stateOf(item);
            const isPlaying = playing?.id === item.id;
            const poster = posters[item.id];
            return (
              <div
                key={item.id}
                id={`remix-review-tile-${item.id}`}
                tabIndex={0}
                onFocus={() => setFocusId(item.id)}
                onClick={() => setFocusId(item.id)}
                data-state={st}
                style={{
                  borderRadius: 12, overflow: 'hidden', background: '#fff', transition: trans, outline: 'none',
                  border: `2px solid ${st === 'approved' ? '#2f9e5f' : st === 'rejected' ? '#c0392b' : GLASS.hair}`,
                  boxShadow: focusId === item.id ? '0 0 0 2px rgba(120,70,255,0.45)' : '0 1px 2px rgba(0,0,0,0.04)',
                  opacity: st === 'rejected' ? 0.6 : 1,
                }}
              >
                <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#eee' }}>
                  {isPlaying && playing.url ? (
                    <video src={playing.url} controls autoPlay playsInline preload="none" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
                  ) : (
                    <button type="button" aria-label={`Play ${item.title || item.id}`} onClick={(e) => { e.stopPropagation(); play(item.id); }} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', height: '100%', position: 'relative' }}>
                      {poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poster} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%', height: '100%', padding: 10, boxSizing: 'border-box', textAlign: 'center', fontSize: 12, color: GLASS.inkSoft }}>
                          <span>{item.title || item.id}</span>
                          <span style={ui.label}>{fmtDate(item.renderedAt)}</span>
                        </span>
                      )}
                      <span style={{ position: 'absolute', right: 8, bottom: 8, ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '2px 6px' }}>
                        {isPlaying ? 'Loading…' : (fmtDur(item.durationSec) || 'Play')}
                      </span>
                    </button>
                  )}
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title || item.id}>{item.title || item.id}</div>
                  {item.feedsCalendar === false ? (
                    <div id={`remix-review-tile-badge-${item.id}`} style={{ ...ui.label, fontSize: 10, color: '#a15c00' }}>Won&apos;t feed calendar — not BAI-EE</div>
                  ) : null}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={ui.label}>{fmtDate(item.renderedAt)}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {st === 'pending' ? (
                        <>
                          <button type="button" onClick={(e) => { e.stopPropagation(); decide(item.id, 'approved'); }} style={{ ...small, background: GLASS.ink, color: '#fff' }}>Approve</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); decide(item.id, 'rejected'); }} style={small}>Reject</button>
                        </>
                      ) : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); decide(item.id, 'pending'); }} style={small}>Undo</button>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div id="remix-review-footer" style={{ padding: '16px 20px 40px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {visible.length > limit ? (
          <button id="remix-review-show-more" type="button" onClick={() => setLimit((n) => n + PAGE)} style={ui.btn(false)}>
            Show more ({visible.length - limit} left)
          </button>
        ) : null}
        {days < 90 && !alertMessage && items !== null ? (
          <button id="remix-review-load-older" type="button" disabled={loading} aria-busy={loading} onClick={() => setDays((d) => Math.min(90, d + 10))} style={{ ...ui.btn(false), opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : `Load older (last ${Math.min(90, days + 10)} days)`}
          </button>
        ) : null}
      </div>

      {toast ? (
        <div id="remix-review-toast" role="status" style={{ position: 'fixed', left: 20, bottom: 20, zIndex: 60, background: GLASS.ink, color: '#fff', borderRadius: 12, padding: '10px 14px', fontSize: 12, maxWidth: 360 }}>{toast.message}</div>
      ) : null}
    </div>
  );
}
