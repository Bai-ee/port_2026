'use strict';

// media-recipe.cjs — pure, firebase-free recipe validation for the dashboard
// media pipeline. Lives separate from media-jobs.cjs so these security-critical
// helpers are unit-testable without a Firestore fake.
//
// Threat model (see docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md pitfalls #3/#4):
// folder names become storage path segments under clients/{clientId}/media/...,
// so any traversal, absolute path, or stray separator could read/write outside a
// client's prefix. We reject everything that is not a strict allowlist segment.
//
// v1 also LOCKS output to 720x720 / 30fps / 30s — clients cannot request larger
// or longer renders that would blow worker time/cost budgets.

// A folder name is a strict allowlist path with at most one slash. New uploads
// are still created as a single flat segment, but the live EditVideos bucket
// already exposes a few safe nested source folders such as assets/retro_dust.
// Traversal, backslashes, empty segments, and arbitrary deep paths stay rejected.
const FOLDER_NAME_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const KEY_RE = /^[a-zA-Z0-9_]{1,80}$/;
const ARTIST_RE = /^[A-Za-z0-9 _.\-]{1,60}$/;
const OVERLAY_EFFECT_RE = /^[a-z0-9_]{1,40}$/;
const LOGO_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const VIDEO_ORDER_NAME_RE = /^[A-Za-z0-9._ ()-]{1,180}$/;

// Strip ASCII/Unicode control chars so a free-text label can never carry hidden
// terminators into a downstream filename or render arg.
function stripControlChars(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/[\x00-\x1f\x7f]/g, '').trim();
}

const V1_OUTPUT = Object.freeze({
  width: 720,
  height: 720,
  fps: 30,
  format: 'mp4',
  durationSeconds: 30,
});

const ALLOWED_AUDIO_HOSTS = [
  'arweave.net',
  'firebasestorage.googleapis.com',
  'firebasestorage.app',
  'storage.googleapis.com',
];

/**
 * Validate a source folder name. Returns the safe name, or throws on anything
 * that could escape the allowed EditVideos source-folder shape.
 */
function sanitizeFolderName(name) {
  if (typeof name !== 'string') {
    throw new Error('Folder name must be a string.');
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Folder name must not be empty.');
  }
  // Explicit traversal/separator guards before the allowlist, for clear errors.
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('\\')) {
    throw new Error(`Folder name has invalid path separators: ${name}`);
  }
  if (trimmed.includes('..')) {
    throw new Error(`Folder name must not contain path traversal: ${name}`);
  }
  const parts = trimmed.split('/');
  if (parts.length > 2 || parts.some((part) => !FOLDER_NAME_RE.test(part))) {
    throw new Error(`Folder name has invalid characters: ${name}`);
  }
  return trimmed;
}

function validateAudioUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('arweaveAudioUrl must be a non-empty string when provided.');
  }
  const value = raw.trim().slice(0, 400);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('arweaveAudioUrl must be a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('arweaveAudioUrl must use https.');
  }
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_AUDIO_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`)
  );
  if (!allowed) {
    throw new Error(`arweaveAudioUrl host is not allowed: ${host}`);
  }
  return value;
}

/**
 * Validate + normalize a client-supplied video-remix recipe.
 * Returns ONLY the normalized shape (everything else stripped). Throws Error with
 * a clear message on any violation. v1 output is forced to the locked defaults.
 */
function validateRemixRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Recipe must be an object.');
  }

  const { sourceFolders } = input;
  if (!Array.isArray(sourceFolders) || sourceFolders.length === 0) {
    throw new Error('sourceFolders must be a non-empty array.');
  }
  if (sourceFolders.length > 25) {
    throw new Error('sourceFolders must have at most 25 entries.');
  }
  const normalizedFolders = sourceFolders.map((f) => sanitizeFolderName(f));

  const recipe = {
    type: 'video-remix',
    sourceFolders: normalizedFolders,
    // v1 locks output regardless of client-supplied values.
    output: { ...V1_OUTPUT },
  };

  if (input.arweaveAudioUrl !== undefined && input.arweaveAudioUrl !== null) {
    recipe.arweaveAudioUrl = validateAudioUrl(input.arweaveAudioUrl);
  }

  // Audio source: artist + mix selection + tracks toggle.
  if (input.artist !== undefined && input.artist !== null && input.artist !== '') {
    if (typeof input.artist !== 'string' || !ARTIST_RE.test(input.artist.trim())) {
      throw new Error('artist has invalid characters.');
    }
    recipe.artist = input.artist.trim();
  }
  if (input.mixTitle !== undefined && input.mixTitle !== null && input.mixTitle !== '') {
    const mix = stripControlChars(input.mixTitle).slice(0, 120);
    if (mix) recipe.mixTitle = mix;
  }
  if (input.useTrax !== undefined) {
    recipe.useTrax = !!input.useTrax;
  }

  if (input.filter !== undefined && input.filter !== null) {
    const key = input.filter?.key;
    const hasIntensity = input.filter?.intensity !== undefined && input.filter?.intensity !== null;
    const next = {};
    if (key !== undefined && key !== null) {
      if (typeof key !== 'string' || !KEY_RE.test(key)) {
        throw new Error('filter.key has invalid characters.');
      }
      next.key = key;
    }
    if (hasIntensity) {
      const intensity = Number(input.filter.intensity);
      if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
        throw new Error('filter.intensity must be a number between 0 and 1.');
      }
      next.intensity = intensity;
    }
    if (Object.keys(next).length) recipe.filter = next;
  }

  if (input.overlay !== undefined && input.overlay !== null) {
    const enabled = !!input.overlay?.enabled;
    if (enabled) {
      const effect = input.overlay?.effect;
      if (typeof effect !== 'string' || (effect !== 'random' && !OVERLAY_EFFECT_RE.test(effect))) {
        throw new Error('overlay.effect has invalid characters.');
      }
      recipe.overlay = { enabled: true, effect };
    }
  }

  if (input.logos !== undefined && input.logos !== null && typeof input.logos === 'object') {
    const logos = {};
    for (const slot of ['top', 'end']) {
      const val = input.logos[slot];
      if (val === undefined || val === null || val === '') continue;
      if (typeof val !== 'string' || !LOGO_NAME_RE.test(val)) {
        throw new Error(`logos.${slot} has invalid characters.`);
      }
      logos[slot] = val;
    }
    if (Object.keys(logos).length) recipe.logos = logos;
  }

  if (input.useArtistImage !== undefined) {
    recipe.useArtistImage = !!input.useArtistImage;
  }

  if (input.endCard !== undefined && input.endCard !== null && typeof input.endCard === 'object') {
    if (input.endCard.text !== undefined && input.endCard.text !== null && input.endCard.text !== '') {
      const text = stripControlChars(input.endCard.text).slice(0, 80);
      if (text) recipe.endCard = { text };
    }
  }

  if (input.videoOrder !== undefined && input.videoOrder !== null) {
    if (normalizedFolders.length !== 1) {
      throw new Error('videoOrder requires exactly one source folder.');
    }
    if (!Array.isArray(input.videoOrder) || input.videoOrder.length !== 6) {
      throw new Error('videoOrder must contain exactly 6 segments.');
    }
    recipe.videoOrder = input.videoOrder.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('videoOrder items must be objects.');
      }
      if (Number(item.segmentIndex) !== index) {
        throw new Error('videoOrder segmentIndex must match its row index.');
      }
      const videoName = stripControlChars(item.videoName || '').slice(0, 180);
      if (!videoName || videoName.includes('/') || videoName.includes('\\') || videoName.includes('..') || !VIDEO_ORDER_NAME_RE.test(videoName)) {
        throw new Error('videoOrder.videoName has invalid characters.');
      }
      return { segmentIndex: index, videoName };
    });
  }

  return recipe;
}

/** Whether an artist name would pass validateRemixRecipe's ARTIST_RE gate. */
function isValidArtistName(name) {
  return typeof name === 'string' && ARTIST_RE.test(name.trim());
}

module.exports = {
  sanitizeFolderName,
  validateRemixRecipe,
  isValidArtistName,
  V1_OUTPUT,
};
