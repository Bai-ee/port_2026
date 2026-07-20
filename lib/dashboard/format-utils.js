// Generic formatting/download/terminal-item helpers shared across the
// dashboard. Extracted from DashboardPage.jsx module scope (Phase 2
// decomposition) — move-only, no behavior change.

export function safeDownloadName(value, fallback = 'download') {
  return String(value || fallback)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}
export async function downloadBrowserAsset(href, filename = 'download', { preferNativeShare = false, mimeType = '', fetchHeaders = null } = {}) {
  if (!href || typeof window === 'undefined') return;
  const cleanFilename = safeDownloadName(filename);
  let blobUrl = null;
  try {
    // fetchHeaders carries auth for same-origin proxy endpoints (e.g. the
    // remix-download stream). Same-origin requests ignore `mode:cors` harmlessly.
    const res = await fetch(href, { mode: 'cors', cache: 'force-cache', ...(fetchHeaders ? { headers: fetchHeaders } : {}) });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const typedBlob = mimeType && blob.type !== mimeType ? new Blob([blob], { type: mimeType }) : blob;

    if (preferNativeShare && typeof File === 'function' && navigator?.share && navigator?.canShare) {
      const file = new File([typedBlob], cleanFilename, { type: typedBlob.type || mimeType || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: cleanFilename });
          return;
        } catch (shareErr) {
          if (shareErr?.name === 'AbortError') return;
        }
      }
    }

    blobUrl = URL.createObjectURL(typedBlob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = cleanFilename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    const a = document.createElement('a');
    a.href = href;
    a.download = cleanFilename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  }
}
// Shared terminal item formatting — turns a signal/result object into a short
// one-line label, and a list of array items into terminal detail lines. Used by
// the single-terminal flows (Generate Report / Update Report).
export function termArrCount(a) { return Array.isArray(a) ? a.length : 0; }
export function termItemText(it) {
  return String(
    (it && (it.title || it.headline || it.topic || it.theme || it.summary || it.text || it.name || it.signal || it.quote)) ||
    (typeof it === 'string' ? it : '')
  ).replace(/\s+/g, ' ').trim().slice(0, 70);
}
export function termItemLines(arr, pfx, max = 4) {
  return (Array.isArray(arr) ? arr : [])
    .slice(0, max)
    .map((it) => ({ type: 'dim', prefix: pfx, text: termItemText(it) }))
    .filter((d) => d.text);
}
export function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value || null)); } catch { return value || null; }
}
export function appendCacheBust(url, key) {
  if (!url) return null;
  if (!key) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}v=${encodeURIComponent(String(key))}`;
}
// Firestore timestamps reach the client in three shapes: a live Timestamp
// (has toDate), a client-SDK plain object ({seconds}), or an admin-SDK
// JSON-serialized object ({_seconds} — what /api/dashboard/bootstrap returns).
// Returns a valid Date or null.
export function fsTimestampToDate(raw) {
  if (!raw) return null;
  try {
    if (typeof raw.toDate === 'function') {
      const d = raw.toDate();
      return d && !isNaN(d.getTime()) ? d : null;
    }
    const secs = raw.seconds ?? raw._seconds;
    const d = secs != null ? new Date(secs * 1000) : new Date(raw);
    return d && !isNaN(d.getTime()) ? d : null;
  } catch { return null; }
}
