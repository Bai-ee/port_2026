'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { ImageIcon, Film, Disc3, FileText } from 'lucide-react';
import { NasContext, isNasItem } from './nas-context.js';
import { requestThumb, getThumbState, subscribeThumb } from './thumb-capture.js';

// ItemGrid — thumbnail grid of content items. Presentational.

const IMG_RE = /^(https?:\/\/|\/).+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i;
const VID_RE = /\.(mp4|mov|webm)(\?.*)?$/i;

export function thumbUrl(item) {
  const direct = item?.posterUrl || item?.poster || item?.thumbUrl;
  if (typeof direct === 'string' && /^(https?:\/\/|\/)/.test(direct)) return direct;
  const ref = (item?.assetRefs || []).find((r) => typeof r === 'string' && IMG_RE.test(r));
  return ref || null;
}

export function storyMissing(item) {
  const s = String(item?.story ?? '').trim();
  return !s || /^todo\b/i.test(s) || /\[add your memory\]/i.test(s);
}

// Status dots — one color per state, explained in the grid legend and on hover.
const STATUS_DOT = {
  idea: { color: '#a8a29e', label: 'Idea' },
  drafted: { color: '#2563eb', label: 'Drafted' },
  scheduled: { color: '#d97706', label: 'Scheduled' },
  posted: { color: '#16a34a', label: 'Posted' },
};
const OK = '#16a34a';
const WARN = '#d97706';
const BLOCK = '#dc2626';

// ---- signed media (rendered videos live behind 'ev:' refs) ----------------
// Resolved lazily through the card's authenticated `call('media-url', {id})`
// -> {videoUrl, posterUrl?}. Cached per item id for the session (promises are
// cached too, so a tile and the drawer never double-fetch).
const mediaCache = new Map();

export function isVideoItem(item) {
  const refs = item?.assetRefs || [];
  return item?.mediaState === 'video' || item?.format === 'video' || refs.some((r) => VID_RE.test(String(r)));
}

export function needsSignedMedia(item) {
  const refs = [item?.posterRef, ...(item?.assetRefs || [])].filter((r) => typeof r === 'string');
  return refs.some((r) => r.startsWith('ev:')) || (isVideoItem(item) && !thumbUrl(item) && refs.length > 0);
}

export function fetchMediaUrl(call, id) {
  if (!call || !id) return Promise.resolve(null);
  if (!mediaCache.has(id)) {
    const p = call('media-url', { id })
      .then((r) => (r && r.ok !== false && (r.videoUrl || r.posterUrl) ? { videoUrl: r.videoUrl || null, posterUrl: r.posterUrl || null } : null))
      .catch(() => null);
    mediaCache.set(id, p);
    p.then((v) => { if (!v) mediaCache.delete(id); }); // failures may retry later
  }
  return mediaCache.get(id);
}

/** Resolve signed media once `enabled` flips true. Returns {media, loading}. */
export function useSignedMedia(call, item, enabled) {
  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(false);
  const id = item?.id;
  const wanted = enabled && needsSignedMedia(item);
  useEffect(() => {
    setMedia(null);
    if (!wanted) return undefined;
    let live = true;
    setLoading(true);
    fetchMediaUrl(call, id).then((v) => { if (live) { setMedia(v); setLoading(false); } });
    return () => { live = false; };
  }, [id, wanted, call]); // eslint-disable-line react-hooks/exhaustive-deps
  return { media, loading };
}

export function isRenderedVideo(item) {
  return item?.source?.kind === 'rendered-video' || item?._bucketId === 'ue';
}
export function isAutoDaily(item) {
  const tags = item?.tags || [];
  return !!(item?.autoDaily || item?.source?.auto || item?.source?.origin === 'auto-daily' || tags.includes('auto-daily'));
}
// Owned = yours to post; cleared = third party you cleared; anything else on a
// rendered video needs clearance before it can be drafted.
export function rightsBadge(item) {
  if (!isRenderedVideo(item)) return null;
  const r = item?.rights;
  if (r === 'owned') return { label: 'Yours', cls: 'xce-chip-ok' };
  if (r === 'cleared') return { label: 'Cleared', cls: 'xce-chip-ok' };
  if (r === 'never-public') return { label: 'Never public', cls: 'xce-chip-warn' };
  return { label: 'Needs clearance', cls: 'xce-chip-warn' };
}

// NAS tile: local thumb only while the laptop is online; otherwise (or on image
// error) a placeholder showing the summary text.
function NasThumb({ item }) {
  const { online, base } = useContext(NasContext);
  const [failed, setFailed] = useState(false);
  const sha = item?.nas?.sha256;
  useEffect(() => { setFailed(false); }, [sha, online]);
  const show = online && base && sha && !failed;
  return (
    <span className="xce-bk-thumb" data-media-state={show ? 'ready' : 'offline'}>
      {show ? <img src={`${base}/thumbs/${sha}.jpg`} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span className="xce-bk-thumb-ph xce-bk-thumb-summary">{item?.summary || item?.title || 'No summary yet'}</span>}
    </span>
  );
}

function GridThumb({ item, call }) {
  if (isNasItem(item)) return <NasThumb item={item} />;
  return <GridThumbMedia item={item} call={call} />;
}

function GridThumbMedia({ item, call }) {
  const ref = useRef(null);
  const direct = thumbUrl(item);
  const [thumb, setThumb] = useState(() => (direct ? { url: direct, status: 'ready' } : getThumbState(item.id)));
  useEffect(() => {
    if (direct) { setThumb({ url: direct, status: 'ready' }); return undefined; }
    setThumb(getThumbState(item.id));
    return subscribeThumb(item.id, setThumb);
  }, [item.id, direct]);
  useEffect(() => {
    const el = ref.current;
    if (!el || direct || getThumbState(item.id)) return undefined;
    const go = () => requestThumb(call, item);
    if (typeof IntersectionObserver === 'undefined') { go(); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { go(); io.disconnect(); }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [item.id, direct]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = thumb?.url;
  const status = url ? 'ready' : thumb?.status || 'idle';
  return (
    <span ref={ref} className="xce-bk-thumb" data-media-state={status}>
      {url ? <img src={url} alt="" loading="lazy" /> : <Placeholder item={item} />}
      {!url && status !== 'idle' && status !== 'capturing' ? <span className="xce-bk-thumb-flag" title="Needs thumbnail" aria-label="Needs thumbnail" /> : null}
    </span>
  );
}

function Placeholder({ item }) {
  const refs = item?.assetRefs || [];
  const Icon = isVideoItem(item) ? Film : item?.series === 'C1' ? Disc3 : refs.length ? ImageIcon : FileText;
  return <span className="xce-bk-thumb-ph"><Icon size={22} /><span className="xce-thumb-code">{item?.series || '·'}</span></span>;
}

function Dot({ color, label, hollow = false }) {
  return (
    <span className="xce-bk-dotmark" title={label} aria-label={label} role="img"
      style={hollow ? { borderColor: color } : { background: color, borderColor: color }} />
  );
}

/** One line of dots per tile: bucket · status · story · rights (videos) · daily-auto. */
function ItemDots({ item, bucket }) {
  const status = STATUS_DOT[item.status] || STATUS_DOT.idea;
  const rights = rightsBadge(item);
  const missing = storyMissing(item);
  return (
    <span className="xce-bk-card-dots">
      {bucket ? <Dot color={bucket.color || '#475569'} label={`Bucket: ${bucket.name}`} /> : null}
      <Dot color={status.color} label={`Status: ${status.label}`} />
      <Dot color={missing ? WARN : OK} hollow={missing} label={missing ? 'Story missing' : 'Story written'} />
      {rights ? <Dot color={rights.cls === 'xce-chip-ok' ? OK : BLOCK} label={`Rights: ${rights.label}`} /> : null}
      {isAutoDaily(item) ? <Dot color="#7c3aed" hollow label="Daily auto render" /> : null}
    </span>
  );
}

export function Legend() {
  const items = [
    { color: STATUS_DOT.idea.color, label: 'Idea' },
    { color: STATUS_DOT.drafted.color, label: 'Drafted' },
    { color: STATUS_DOT.scheduled.color, label: 'Scheduled' },
    { color: STATUS_DOT.posted.color, label: 'Posted' },
    { color: WARN, label: 'Story missing', hollow: true },
    { color: BLOCK, label: 'Needs clearance' },
    { color: '#7c3aed', label: 'Daily auto', hollow: true },
  ];
  return (
    <div id="x-content-item-legend" className="xce-bk-legend">
      {items.map((x) => (
        <span key={x.label} className="xce-bk-legend-item"><Dot color={x.color} hollow={x.hollow} label={x.label} />{x.label}</span>
      ))}
    </div>
  );
}

export default function ItemGrid({ items, bucketById, selectedItemId, onOpen, call }) {
  return (
    <>
      <ul id="x-content-item-grid" className="xce-bk-grid">
        {items.map((item) => {
          const bucket = bucketById[item._bucketId];
          return (
            <li key={item.id} className="xce-bk-card-li">
              <button type="button" className={`xce-bk-card${selectedItemId === item.id ? ' is-active' : ''}`} onClick={() => onOpen(item.id)}
                title={item.title || item.id}>
                <GridThumb item={item} call={call} />
                <span className="xce-bk-card-title">{item.title || item.id}</span>
                <ItemDots item={item} bucket={bucket} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
