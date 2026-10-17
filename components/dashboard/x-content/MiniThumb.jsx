'use client';

import React, { useEffect, useState } from 'react';
import { Film, ImageIcon } from 'lucide-react';
import { getThumbState, requestThumb, subscribeThumb } from './thumb-capture.js';

// MiniThumb — a small square preview of any library item, by id, wherever only the id is known (chat proposal cards).
// Same session loader as the Buckets grid (thumb-capture.js: server thumb / item image, else a captured video frame).
// A NAS item (nasSha) shows the local worker's thumb while the worker is online (one `nas-status` per session).

// Inline so it renders the same inside and outside .xce-scope (chat cards are outside it).
const BOX = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', borderRadius: 6, overflow: 'hidden', background: 'color-mix(in srgb, var(--t-text) 6%, transparent)', color: 'var(--t-text-muted)' };
const IMG = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

let nasBase = null; // Promise<string|null>
function nasThumbBase(call) {
  if (!nasBase) nasBase = Promise.resolve(call('nas-status')).then((r) => (r?.online && r.localThumbBase ? r.localThumbBase : null)).catch(() => null);
  return nasBase;
}

export default function MiniThumb({ id, call, kind = null, nasSha = null, size = 40, label = '' }) {
  const [thumb, setThumb] = useState(() => (id ? getThumbState(id) : null));
  const [nasUrl, setNasUrl] = useState(null);
  useEffect(() => {
    if (!id || typeof call !== 'function') return undefined;
    if (nasSha) {
      let live = true;
      nasThumbBase(call).then((base) => { if (live && base) setNasUrl(`${base}/thumbs/${nasSha}.jpg`); });
      return () => { live = false; };
    }
    setThumb(getThumbState(id));
    const off = subscribeThumb(id, setThumb);
    requestThumb(call, { id, serverThumb: true, ...(kind === 'video' ? { mediaState: 'video' } : {}) });
    return off;
  }, [id, call, kind, nasSha]);
  const url = nasUrl || thumb?.url || null;
  const Icon = kind === 'video' ? Film : ImageIcon;
  return (
    <span className="xce-mini-thumb" style={{ ...BOX, width: size, height: size }} title={label || undefined} data-media-state={url ? 'ready' : thumb?.status || 'idle'}>
      {url ? <img src={url} alt="" loading="lazy" style={IMG} onError={() => setNasUrl(null)} /> : <Icon size={Math.round(size * 0.45)} aria-hidden="true" />}
    </span>
  );
}
