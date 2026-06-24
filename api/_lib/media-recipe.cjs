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

// A folder name is exactly one path segment from a strict allowlist. No slashes,
// no dots-as-traversal, no backslashes, no leading separators — those can never
// appear in a valid value, so we reject the whole input rather than sanitize it.
const FOLDER_NAME_RE = /^[a-zA-Z0-9_-]{1,120}$/;
const KEY_RE = /^[a-zA-Z0-9_]{1,80}$/;

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
 * Validate a single client-scoped folder segment.
 * Returns the safe segment, or throws on anything that could escape the prefix.
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
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Folder name must not contain path separators: ${name}`);
  }
  if (trimmed.includes('..')) {
    throw new Error(`Folder name must not contain path traversal: ${name}`);
  }
  if (!FOLDER_NAME_RE.test(trimmed)) {
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

  if (input.filter !== undefined && input.filter !== null) {
    const key = input.filter?.key;
    if (key !== undefined && key !== null) {
      if (typeof key !== 'string' || !KEY_RE.test(key)) {
        throw new Error('filter.key has invalid characters.');
      }
      recipe.filter = { key };
    }
  }

  if (input.overlay !== undefined && input.overlay !== null) {
    const enabled = !!input.overlay?.enabled;
    if (enabled) {
      const effect = input.overlay?.effect;
      if (typeof effect !== 'string' || !KEY_RE.test(effect)) {
        throw new Error('overlay.effect has invalid characters.');
      }
      recipe.overlay = { enabled: true, effect };
    }
  }

  return recipe;
}

module.exports = {
  sanitizeFolderName,
  validateRemixRecipe,
  V1_OUTPUT,
};
