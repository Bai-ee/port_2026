// thumb-capture.js — session-level thumbnail loading for the Buckets grid.
//
// 1. requestThumb(call, item): visible tiles register here; ids are batched
//    (debounce 150ms, <=60 per request) into ONE 'media-urls' {kinds:['thumb']}.
// 2. Video items the server has no thumb for are captured client-side (one
//    frame at ~1s, 320px JPEG q0.7) and stored via 'save-thumb'. At most 2
//    captures run at once. Failures are remembered so a tile shows "needs thumb".
//
// State per id: {url?, status:'ready'|'missing'|'failed'}. Subscribers are
// notified on change. Nothing autoplays; videos are loaded muted, metadata only.

const BATCH_MAX = 60;
const DEBOUNCE_MS = 150;
const MAX_CAPTURES = 2;

const state = new Map();      // id -> {url, status}
const listeners = new Map();  // id -> Set<fn>
let pending = new Map();      // id -> {call, item}
let timer = null;
const captureQueue = [];
let captureActive = 0;
const stats = { batchRequests: 0, captures: 0 };

export function getThumbState(id) { return state.get(id) || null; }
export function thumbStats() { return { ...stats }; }

export function subscribeThumb(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  return () => { const s = listeners.get(id); if (s) { s.delete(fn); if (!s.size) listeners.delete(id); } };
}

function setState(id, next) {
  state.set(id, next);
  const s = listeners.get(id);
  if (s) s.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}

/** Capture a ~1s frame from a video URL -> {dataUrl}. Rejects on CORS/decoder failure. */
export function captureThumbFromVideo(url, { edge = 320, quality = 0.7, at = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore */ }
      if (err) reject(err); else resolve(val);
    };
    const to = setTimeout(() => finish(new Error('thumb capture timed out')), 15000);
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.onerror = () => finish(new Error('video could not be decoded'));
    video.onloadedmetadata = () => {
      const t = Math.min(at, Math.max(0, (video.duration || at) / 2));
      video.currentTime = t;
    };
    video.onseeked = () => {
      try {
        const w = video.videoWidth || 0;
        const h = video.videoHeight || 0;
        if (!w || !h) return finish(new Error('video has no frame size'));
        const scale = edge / Math.max(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) return finish(new Error('frame could not be encoded'));
          const fr = new FileReader();
          fr.onload = () => finish(null, { dataUrl: String(fr.result), size: blob.size });
          fr.onerror = () => finish(new Error('frame could not be read'));
          fr.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      } catch (err) { finish(err); }
    };
    video.src = url;
  });
}

async function runCapture(job) {
  const { call, item } = job;
  try {
    const r = await call('media-urls', { ids: [item.id], kinds: ['video'] });
    const videoUrl = r?.urls?.[item.id]?.videoUrl;
    if (!videoUrl) throw new Error('no video url');
    const { dataUrl } = await captureThumbFromVideo(videoUrl);
    stats.captures += 1;
    // Show it immediately; persist best-effort.
    setState(item.id, { url: dataUrl, status: 'ready' });
    call('save-thumb', { id: item.id, dataUrl }).catch(() => {});
  } catch {
    setState(item.id, { status: 'failed' });
  }
}

function pumpCaptures() {
  while (captureActive < MAX_CAPTURES && captureQueue.length) {
    const job = captureQueue.shift();
    if (job.cancelled?.()) { state.delete(job.item.id); continue; }
    captureActive += 1;
    runCapture(job).finally(() => { captureActive -= 1; pumpCaptures(); });
  }
}

function enqueueCapture(call, item) {
  if (captureQueue.some((j) => j.item.id === item.id)) return;
  // Skip the job if the tile left the screen (unmounted) before its turn.
  captureQueue.push({ call, item, cancelled: () => !listeners.has(item.id) });
  pumpCaptures();
}

async function flush() {
  timer = null;
  const batch = [...pending.values()];
  pending = new Map();
  for (let i = 0; i < batch.length; i += BATCH_MAX) {
    const chunk = batch.slice(i, i + BATCH_MAX);
    const call = chunk[0].call;
    stats.batchRequests += 1;
    let urls = {};
    try {
      const r = await call('media-urls', { ids: chunk.map((c) => c.item.id), kinds: ['thumb'] });
      urls = r?.urls || {};
    } catch { /* fall through: treated as missing */ }
    for (const { item } of chunk) {
      const u = urls[item.id]?.thumbUrl;
      if (u) setState(item.id, { url: u, status: 'ready' });
      else if (isVideo(item)) { setState(item.id, { status: 'capturing' }); enqueueCapture(call, item); }
      else setState(item.id, { status: 'missing' });
    }
  }
}

function isVideo(item) {
  return item?.mediaState === 'video' || item?.format === 'video' || item?.source?.kind === 'rendered-video' || item?._bucketId === 'ue';
}

/** Ask for a tile's thumb. Safe to call repeatedly; each id is fetched once per session. */
export function requestThumb(call, item) {
  if (!item?.id || state.has(item.id) || pending.has(item.id)) return;
  if (!item.thumbRef) {
    // Nothing stored server-side: capture a frame (video) or flag it (image).
    if (isVideo(item)) { setState(item.id, { status: 'capturing' }); enqueueCapture(call, item); }
    else setState(item.id, { status: 'missing' });
    return;
  }
  pending.set(item.id, { call, item });
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
}

/** Retry a failed/missing tile (e.g. when the user clicks it into view again). */
export function resetThumb(id) { state.delete(id); }
