// Pure helpers for the optional first self-reply, sourceRef and placeholder
// guard carried on a social_posts doc. No firebase, no network.

export const MEMORY_PLACEHOLDER = '[add your memory]';

/** True while a draft still contains the unfilled memory placeholder. */
export function hasMemoryPlaceholder(content) {
  return String(content || '').toLowerCase().includes(MEMORY_PLACEHOLDER);
}

/** Throws a 409 when a post still carries the placeholder (schedule / post-now). */
export function assertNoMemoryPlaceholder(content) {
  if (hasMemoryPlaceholder(content)) {
    const err = new Error(`This post still contains "${MEMORY_PLACEHOLDER}". Write your memory before scheduling or posting.`);
    err.status = 409;
    throw err;
  }
}

/** Normalise a self-reply payload; null when absent/empty. Media fields mirror extractMedia. */
export function sanitizeSelfReply(input) {
  if (!input || typeof input !== 'object') return null;
  const text = String(input.text || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > 280) {
    const err = new Error('Self-reply must be 280 characters or fewer.');
    err.status = 400;
    throw err;
  }
  const mediaUrl = input.mediaUrl ? String(input.mediaUrl).slice(0, 2000) : null;
  if (!text && !mediaUrl) return null;
  const contentType = input.mediaContentType ? String(input.mediaContentType).slice(0, 80) : null;
  const inferred = contentType
    ? (contentType.startsWith('video/') ? 'video' : contentType.startsWith('image/') ? 'image' : null)
    : null;
  return {
    text,
    mediaUrl,
    mediaType: mediaUrl ? (input.mediaType ? String(input.mediaType).slice(0, 20) : (inferred || 'image')) : null,
    mediaContentType: mediaUrl ? contentType : null,
    mediaStoragePath: mediaUrl && input.mediaStoragePath ? String(input.mediaStoragePath).slice(0, 500) : null,
  };
}

/** sourceRef is a small JSON-safe object, or null. */
export function sanitizeSourceRef(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return JSON.parse(JSON.stringify(input));
}

/** mediaVariants: { video|image: { '9x16'|'1x1': { storagePath, url } } }, or null. */
export function sanitizeMediaVariants(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const kind of ['video', 'image']) {
    const group = input[kind];
    if (!group || typeof group !== 'object') continue;
    for (const variant of ['9x16', '1x1']) {
      const v = group[variant];
      if (!v || typeof v.url !== 'string' || !v.url) continue;
      (out[kind] ||= {})[variant] = {
        storagePath: v.storagePath ? String(v.storagePath).slice(0, 500) : null,
        url: v.url.slice(0, 2000),
      };
    }
  }
  return Object.keys(out).length ? out : null;
}
