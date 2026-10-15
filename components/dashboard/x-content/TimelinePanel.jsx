'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, RefreshCw, Search } from 'lucide-react';
import { Skeleton, RetryError } from '../content-ui/Feedback.jsx';
import { isCompleteDay, latestDayFor, dayCountLabel } from '../../../features/social-archive/timeline-view.js';

// TimelinePanel — the living archive: imported Facebook / X / Instagram entries
// by day. PURE PRESENTATION plus the four timeline calls (`call` is the card's
// authenticated helper). No writes happen here. Import is a CLI job:
// scripts/social-archive/ingest.mjs.
// STYLING: classNames only (`xce-timeline-*`); the card owns the style block.

const WINDOW_DAYS = 400;
const THUMBS_PER_ENTRY = 4;
const THUMB_IDS_MAX = 48;
const PLATFORM_META = {
  facebook: { label: 'FB', name: 'Facebook', color: 'var(--t-info)' },
  x: { label: 'X', name: 'X', color: 'var(--t-text)' },
  instagram: { label: 'IG', name: 'Instagram', color: '#c026d3' },
};
const KINDS = ['post', 'media', 'event', 'story', 'reel', 'comment'];

const dayShift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isoDay = (iso) => (iso ? String(iso).slice(0, 10) : '');
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const timeOf = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16); };
const meta = (p) => PLATFORM_META[p] || { label: String(p || '?').slice(0, 2).toUpperCase(), name: String(p || ''), color: 'var(--t-text-muted)' };

function PlatformDot({ platform, count }) {
  const m = meta(platform);
  return (
    <span className="xce-timeline-pdot" title={`${m.name}${count != null ? `: ${count}` : ''}`}>
      <span className="xce-timeline-pdot-mark" style={{ background: m.color }} aria-hidden="true" />
      {count != null ? <span>{count}</span> : null}
    </span>
  );
}

function EntryRow({ entry, thumbs, showDay = false }) {
  const m = meta(entry.platform);
  const mediaCount = Array.isArray(entry.media) ? entry.media.length : 0;
  const linked = (Array.isArray(entry.linked) ? entry.linked : []).slice(0, THUMBS_PER_ENTRY);
  const urls = linked.map((id) => ({ id, url: thumbs?.[id] })).filter((t) => t.url);
  return (
    <li id={`x-content-timeline-entry-${entry.id}`} className="xce-timeline-entry">
      <div className="xce-timeline-entry-meta">
        <span className="xce-timeline-badge" style={{ background: m.color }} title={`${m.name}${entry.account ? ` · ${entry.account}` : ''}`}>{m.label}</span>
        <span className="xce-timeline-kind">{entry.kind}</span>
        <span className="xce-timeline-time">{showDay ? `${isoDay(entry.ts)} ` : ''}{timeOf(entry.ts)}{entry.tsKind && entry.tsKind !== 'posted' ? ` (${entry.tsKind})` : ''}</span>
        {mediaCount ? <span className="xce-timeline-media">{mediaCount} media</span> : null}
        {entry.place ? <span className="xce-timeline-media">At {entry.place}</span> : null}
      </div>
      {entry.text ? <p className="xce-timeline-text">{clip(entry.text, 180)}</p> : null}
      {urls.length ? (
        <div className="xce-timeline-thumbs">
          {urls.map((t) => <img key={t.id} className="xce-timeline-thumb" src={t.url} alt="" loading="lazy" />)}
        </div>
      ) : null}
    </li>
  );
}

export default function TimelinePanel({ call }) {
  const [archives, setArchives] = useState(null);
  const [days, setDays] = useState(null);
  const [windowTo, setWindowTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const [platform, setPlatform] = useState('');
  const [dayInput, setDayInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [openDay, setOpenDay] = useState(null); // { day, entries, total } | { day, loading } | { day, error }
  const [results, setResults] = useState(null); // search entries | null
  const [resultsTo, setResultsTo] = useState(''); // date anchor the last search was bounded by
  const dayReq = useRef(''); // latest requested day; older responses are dropped
  const [thumbs, setThumbs] = useState({});

  const loadThumbs = useCallback(async (entries) => {
    const ids = [...new Set(entries.flatMap((e) => (Array.isArray(e.linked) ? e.linked.slice(0, THUMBS_PER_ENTRY) : [])))].slice(0, THUMB_IDS_MAX);
    if (!ids.length) return;
    try {
      const r = await call('media-urls', { ids, kinds: ['thumb'] });
      const next = {};
      for (const id of ids) if (r?.urls?.[id]?.thumbUrl) next[id] = r.urls[id].thumbUrl;
      setThumbs((t) => ({ ...t, ...next }));
    } catch { /* thumbnails are optional */ }
  }, [call]);

  const loadDays = useCallback(async (to) => {
    const r = await call('timeline-days', { from: dayShift(to, -(WINDOW_DAYS - 1)), to });
    setDays(Array.isArray(r?.days) ? r.days : []);
    setWindowTo(to);
  }, [call]);

  const init = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const a = await call('timeline-archives');
      const list = Array.isArray(a?.archives) ? a.archives : [];
      setArchives(list);
      const last = latestDayFor(list, platform);
      if (last) await loadDays(last); else setDays([]);
    } catch (err) {
      setError(err.message || 'Could not load the timeline.');
    } finally {
      setLoading(false);
    }
  }, [call, loadDays, platform]);

  useEffect(() => { init(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openDayEntries = useCallback(async (day) => {
    dayReq.current = day;
    setResults(null);
    setOpenDay({ day, loading: true });
    try {
      const r = await call('timeline-day', { day });
      if (dayReq.current !== day) return;
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      setOpenDay({ day, entries, total: r?.total ?? entries.length });
      loadThumbs(entries);
    } catch (err) {
      if (dayReq.current !== day) return;
      setOpenDay({ day, error: err.message || 'Could not load that day.' });
    }
  }, [call, loadThumbs]);

  const runSearch = useCallback(async () => {
    const q = textInput.trim();
    const to = isCompleteDay(dayInput) ? dayInput : '';
    // Date alone = open that day; date + text/platform = search up to that day.
    if (!q && !platform) { if (to) openDayEntries(to); else setResults(null); return; }
    dayReq.current = '';
    setOpenDay(null);
    setResults([]);
    setResultsTo(to);
    try {
      const r = await call('timeline-search', { q, platform: platform || undefined, to: to || undefined, limit: 100 });
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      setResults(entries);
      loadThumbs(entries);
    } catch (err) {
      setError(err.message || 'Search failed.');
    }
  }, [call, textInput, platform, dayInput, openDayEntries, loadThumbs]);

  // Switching platform jumps the day window to that platform's newest day, so
  // an archive that ended years ago is not hidden behind many "Older" clicks.
  const changePlatform = (value) => {
    setPlatform(value);
    const last = latestDayFor(archives, value);
    if (last && last !== windowTo) loadDays(last).catch((e) => setError(e.message || 'Could not load days.'));
  };

  const shiftWindow = (dir) => { if (windowTo) loadDays(dayShift(windowTo, dir * WINDOW_DAYS)).catch((e) => setError(e.message || 'Could not load days.')); };

  const visibleDays = useMemo(() => {
    const list = (days || []).filter((d) => d.total > 0 && (!platform || d.platforms?.[platform] > 0));
    return newestFirst ? [...list].reverse() : list;
  }, [days, platform, newestFirst]);

  const dayEntries = openDay?.entries ? openDay.entries.filter((e) => !platform || e.platform === platform) : [];

  return (
    <div id="x-content-timeline-panel" className="xce-panel">
      <div id="x-content-timeline-header" className="xce-head">
        <span className="xce-head-date">Timeline · imported archive entries by day</span>
        <button type="button" id="x-content-timeline-refresh" className="xce-btn-ghost" onClick={init} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <RetryError id="x-content-timeline-error" message={error} onRetry={init} busy={loading} />

      <div id="x-content-timeline-search-row" className="xce-timeline-search">
        <input id="x-content-timeline-day-input" className="xce-input" type="date" aria-label="Jump to a day" value={dayInput}
          onChange={(e) => { setDayInput(e.target.value); if (isCompleteDay(e.target.value)) openDayEntries(e.target.value); }} />
        <input id="x-content-timeline-text-input" className="xce-input" type="search" aria-label="Search archive text" placeholder="Search captions, albums, hashtags" value={textInput}
          onChange={(e) => setTextInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} />
        <select id="x-content-timeline-platform-select" className="xce-input xce-select" aria-label="Platform" value={platform} onChange={(e) => changePlatform(e.target.value)}>
          <option value="">All platforms</option>
          {Object.entries(PLATFORM_META).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
        <button type="button" id="x-content-timeline-search-button" className="xce-btn xce-btn-primary" onClick={runSearch}>
          <Search size={13} /> Search
        </button>
      </div>

      {loading && !days ? <Skeleton id="x-content-timeline-loading" rows={6} /> : null}

      {!loading && days && !days.length && !(archives && archives.length) ? (
        <div id="x-content-timeline-empty" className="xce-empty">
          <p>No archive imported yet.</p>
          <p className="xce-empty-note">Import an archive with scripts/social-archive/ingest.mjs</p>
        </div>
      ) : null}

      {results ? (
        <section id="x-content-timeline-results" className="xce-timeline-section" aria-label="Search results">
          <p className="xce-kicker">{results.length} result{results.length === 1 ? '' : 's'}{resultsTo ? ` up to ${resultsTo}` : ''}</p>
          {results.length ? (
            <ul className="xce-timeline-entries">{results.map((e) => <EntryRow key={e.id} entry={e} thumbs={thumbs} showDay />)}</ul>
          ) : <p className="xce-empty-note">Nothing matches that search.</p>}
          <button type="button" id="x-content-timeline-results-clear" className="xce-btn-ghost" onClick={() => { setResults(null); setTextInput(''); }}>Clear search</button>
        </section>
      ) : null}

      {openDay ? (
        <section id="x-content-timeline-day-detail" className="xce-timeline-section" aria-label={`Entries for ${openDay.day}`}>
          <div className="xce-timeline-day-head">
            <p className="xce-kicker">{openDay.day}{openDay.entries ? ` · ${dayCountLabel(dayEntries.length, openDay.total, platform ? meta(platform).name : '')}` : ''}</p>
            <button type="button" id="x-content-timeline-day-close" className="xce-btn-ghost" onClick={() => setOpenDay(null)}>Close</button>
          </div>
          {openDay.loading ? <Skeleton id="x-content-timeline-day-loading" rows={3} /> : null}
          {openDay.error ? <RetryError id="x-content-timeline-day-error" message={openDay.error} onRetry={() => openDayEntries(openDay.day)} /> : null}
          {openDay.entries && !dayEntries.length ? <p className="xce-empty-note">No entries on this day.</p> : null}
          {dayEntries.length ? <ul id="x-content-timeline-day-entries" className="xce-timeline-entries">{dayEntries.map((e) => <EntryRow key={e.id} entry={e} thumbs={thumbs} />)}</ul> : null}
        </section>
      ) : null}

      {days && days.length ? (
        <section id="x-content-timeline-days-section" className="xce-timeline-section" aria-label="Days">
          <div id="x-content-timeline-days-controls" className="xce-timeline-controls">
            <button type="button" id="x-content-timeline-order-toggle" className="xce-btn-ghost" onClick={() => setNewestFirst((v) => !v)}>
              <ArrowDownUp size={13} /> {newestFirst ? 'Newest first' : 'Oldest first'}
            </button>
            <button type="button" id="x-content-timeline-window-older" className="xce-btn-ghost" onClick={() => shiftWindow(-1)}>Older</button>
            <button type="button" id="x-content-timeline-window-newer" className="xce-btn-ghost" onClick={() => shiftWindow(1)}>Newer</button>
            <span className="xce-timeline-window">{dayShift(windowTo, -(WINDOW_DAYS - 1))} → {windowTo}</span>
          </div>
          {visibleDays.length ? (
            <ul id="x-content-timeline-day-list" className="xce-timeline-days">
              {visibleDays.map((d) => (
                <li key={d.day} id={`x-content-timeline-day-${d.day}`} className="xce-timeline-day">
                  <button type="button" className="xce-timeline-day-button" onClick={() => { setDayInput(d.day); openDayEntries(d.day); }}>
                    <span className="xce-timeline-day-top">
                      <span className="xce-timeline-day-date">{d.day}</span>
                      <span className="xce-timeline-day-total">{d.total}</span>
                      <span className="xce-timeline-day-platforms">
                        {Object.entries(d.platforms || {}).filter(([, n]) => n > 0).map(([p, n]) => <PlatformDot key={p} platform={p} count={n} />)}
                      </span>
                    </span>
                    <span className="xce-timeline-day-kinds">
                      {KINDS.filter((k) => d.counts?.[k] > 0).map((k) => `${d.counts[k]} ${k}`).join(' · ')}
                    </span>
                    {(d.snippets || []).slice(0, 3).map((s) => (
                      <span key={s.id} className="xce-timeline-snippet">{clip(s.text, 90)}</span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="xce-empty-note">No days in this window{platform ? ` for ${meta(platform).name}` : ''}. Try Older.</p>}
        </section>
      ) : null}

      <details id="x-content-timeline-archives" className="xce-more">
        <summary className="xce-more-summary">Imported archives{archives ? ` (${archives.length})` : ''}</summary>
        <div id="x-content-timeline-archives-body" className="xce-more-body">
          {archives && archives.length ? (
            <ul className="xce-timeline-archives">
              {archives.map((a, i) => (
                <li key={`${a.platform}-${a.account}-${a.archiveName}-${i}`} className="xce-timeline-archive">
                  <span className="xce-timeline-archive-title"><PlatformDot platform={a.platform} /> {meta(a.platform).name} · {a.account}</span>
                  <span className="xce-timeline-archive-line">
                    {Array.isArray(a.entries) ? a.entries.length : (a.entries ?? 0)} entries · {isoDay(a.firstTs) || '—'} → {isoDay(a.lastTs) || '—'} · {a.matched ?? 0} matched / {a.unmatched ?? 0} unmatched
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="xce-empty-note">None yet. Import an archive with scripts/social-archive/ingest.mjs</p>}
        </div>
      </details>
    </div>
  );
}
