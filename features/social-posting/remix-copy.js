import { formatFor, formatMixPost } from './post-format.js';

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * Daily-video (remix) post copy from the render's title-block metadata: artist, then mix title, one per line.
 * A client with the mix post format (features/social-posting/post-format.js, e.g. UE) gets that exact format,
 * closing hashtag included.
 */
export function canonicalRemixCopy(metadata = {}, { clientId = null } = {}) {
  const artist = firstString(metadata.artist, metadata.dj, metadata.name);
  const mix = firstString(metadata.mix, metadata.mixTitle, metadata.title);
  const fmt = formatFor(clientId);
  if (fmt?.kind === 'mix' && (artist || mix)) return formatMixPost({ artist, title: mix }, { hashtag: fmt.hashtag });
  return [artist, mix].filter(Boolean).join('\n') || 'Video Remix';
}
