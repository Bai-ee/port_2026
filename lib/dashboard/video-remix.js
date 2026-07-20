// Video Remix card — recipe builder, folder/file formatting, pending-job
// localStorage cache, and signed-upload helper. Extracted from DashboardPage.jsx
// module scope (Phase 2 decomposition) — move-only, no behavior change.

export const VIDEO_REMIX_FOLDER_FILE_CACHE_TTL_MS = 5 * 60 * 1000;
// Folder previews page in small batches — a full folder (up to 120 files) as
// mounted <video> thumbs is the main source of modal jank. "Load more" grows
// the request limit; the server caps at 120 per listFolderMedia.
export const VIDEO_REMIX_FOLDER_PAGE_SIZE = 12;
export const VIDEO_REMIX_FOLDER_PAGE_STEP = 24;
export const VIDEO_REMIX_FOLDER_PAGE_MAX = 120;
// SAVED ASSETS renders this many remix players initially (history holds 40).
export const SAVED_REMIX_PAGE_SIZE = 8;
export const VIDEO_REMIX_PENDING_STORAGE_PREFIX = 'video-remix-pending-job';
// Max remixes a single Generate can fan out into (the multiplier control).
export const VIDEO_REMIX_MAX_COUNT = 5;
// House defaults, kept in lockstep with the daily-email production recipe
// (DAILY_EMAIL_VIDEO_PRODUCTION in app/api/worker/pre-digest-video/route.js):
// hard B&W look @0.8, no overlay texture, UE barcode white logo on top,
// mixtapes white square on the end card (no artist-image end card). Shared by
// the params-tab draft AND the one-click RUN REMIX path so both render the
// same branded baseline the email pipeline uses.
export const STANDARD_REMIX_DEFAULTS = {
  artist: 'random',
  mixTitle: '',
  useTrax: false,
  selectedFolders: [],
  videoFilter: 'look_hard_bw_street_doc',
  filterIntensity: 0.8,
  enableOverlay: false,
  overlayEffect: '',
  topLogo: 'ue_barcode_white.png',
  endLogo: 'mixtapes_white_square.png',
  useArtistImage: false,
  endTextOverlay: '',
  count: 1,
};
// Build a render recipe from a draft-shaped settings object (or the house
// defaults). Single source of truth for recipe construction.
export function buildRemixRecipe(settings = STANDARD_REMIX_DEFAULTS, sourceFolders) {
  const s = { ...STANDARD_REMIX_DEFAULTS, ...settings };
  const folders = Array.isArray(sourceFolders) ? sourceFolders : s.selectedFolders;
  return {
    sourceFolders: folders,
    output: { width: 720, height: 720, fps: 30, format: 'mp4', durationSeconds: 30 },
    artist: s.artist === 'random' ? null : s.artist,
    mixTitle: s.mixTitle || null,
    useTrax: s.useTrax,
    filter: s.videoFilter && s.videoFilter !== 'random'
      ? { key: s.videoFilter, intensity: s.filterIntensity }
      : { intensity: s.filterIntensity },
    overlay: s.enableOverlay && s.overlayEffect
      ? { enabled: true, effect: s.overlayEffect }
      : { enabled: false },
    logos: { top: s.topLogo || null, end: s.endLogo || null },
    useArtistImage: s.useArtistImage,
    endCard: s.endTextOverlay ? { text: s.endTextOverlay } : null,
  };
}
export function sanitizeVideoRemixFolderPreview(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
export function formatVideoRemixBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}
// Render a video's first frame as a cheap thumbnail without generating a poster
// image: the `#t=0.1` media fragment tells the browser to paint ~0.1s in (the
// first real frame) instead of a black frame, using only a metadata range
// request. Fragment sits after any query string, so signed URLs are fine.
export function firstFrameThumbSrc(url) {
  if (!url) return undefined;
  return /#t=/.test(url) ? url : `${url}#t=0.1`;
}
export function videoRemixPendingStorageKey(clientId) {
  return `${VIDEO_REMIX_PENDING_STORAGE_PREFIX}:${clientId || 'self'}`;
}
export function readVideoRemixPendingJob(clientId) {
  if (typeof window === 'undefined' || !clientId) return null;
  try {
    const raw = window.localStorage.getItem(videoRemixPendingStorageKey(clientId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function writeVideoRemixPendingJob(clientId, value) {
  if (typeof window === 'undefined' || !clientId) return;
  try {
    if (value) window.localStorage.setItem(videoRemixPendingStorageKey(clientId), JSON.stringify(value));
    else window.localStorage.removeItem(videoRemixPendingStorageKey(clientId));
  } catch {
    /* localStorage is an optimization only */
  }
}
export function normalizeVideoRemixFolderDetails(rawFolders) {
  return (Array.isArray(rawFolders) ? rawFolders : [])
    .map((item) => {
      if (typeof item === 'string') return { name: item, displayName: item, count: null, type: 'root' };
      return {
        name: String(item?.name || ''),
        displayName: String(item?.displayName || item?.name || ''),
        count: Number.isFinite(Number(item?.count)) ? Number(item.count) : null,
        type: item?.type || 'root',
      };
    })
    .filter((item) => item.name);
}
export function uploadVideoRemixFileToSignedUrl({ file, upload, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || 'PUT', upload.uploadUrl);
    xhr.setRequestHeader('Content-Type', upload.contentType || file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed before storage accepted the file.'));
    xhr.send(file);
  });
}
