// Shared client-side video poster capture (extracted unchanged from
// components/dashboard/MediaLibraryCard.jsx; also used by the Buckets upload).
// First-frame JPEG poster, captured client-side at upload time (no server
// transcode). objectURL → hidden <video> → seek ~0.1s → canvas → JPEG blob,
// scaled to a max width of 480px. Resolves null (never rejects) on a decode
// error or if nothing happens within 3s — legacy/undecodable codecs (older
// .mov/HEVC) just get the icon fallback tile in MediaThumb, never a black
// square. Deferred: a server-side FFmpeg backfill for existing files
// (docs/plans/VIDEO-REMIX-MEDIA-PERF-PLAN.md Phase 3).
export function captureVideoPoster(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('video/') || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    const timer = setTimeout(() => finish(null), 3000);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      URL.revokeObjectURL(objectUrl);
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }
    function onError() { finish(null); }
    function onLoadedData() {
      try {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
        video.currentTime = Math.min(0.1, duration / 2);
      } catch {
        finish(null);
      }
    }
    function onSeeked() {
      try {
        const maxWidth = 480;
        const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob || null), 'image/jpeg', 0.7);
      } catch {
        finish(null);
      }
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.src = objectUrl;
  });
}
