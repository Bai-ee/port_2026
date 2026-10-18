// Pure helpers for the "quoted post" card in the post editor: turn a quoted status URL plus (optionally) the matching
// stored quote-target candidate into one preview object. No I/O, no X API: the only data source is what the scan already
// saved in dashboard_state.marketingBrief.quoteTargets.candidates (author, authorName, text, createdAt, hasMedia).

const STATUS_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** { handle|null, id, url } from an x.com / twitter.com status URL (an `/i/status/` URL has no handle), else null. */
export function parseStatusUrl(value) {
  const m = STATUS_URL.exec(String(value ?? '').trim());
  if (!m) return null;
  const handle = m[1].toLowerCase() === 'i' ? null : m[1];
  return { handle, id: m[2], url: handle ? `https://x.com/${handle}/status/${m[2]}` : `https://x.com/i/status/${m[2]}` };
}

/** The stored candidate whose status id matches (dismissed ones included: dismissing hides a target, it does not delete the text). */
export function findQuotedCandidate(candidates, id) {
  const want = String(id ?? '');
  if (!want || !Array.isArray(candidates)) return null;
  return candidates.find((c) => c && (String(c.id ?? '') === want || parseStatusUrl(c.url)?.id === want)) || null;
}

/**
 * @returns {{ url, id, handle, authorName, text, createdAt, hasMedia, mediaUrl, found }}
 * `found:false` means only the URL is known (honest fallback: the card shows the link and "Open on X").
 */
export function buildQuotedPreview({ url, candidate = null } = {}) {
  const parsed = parseStatusUrl(url);
  if (!parsed) return null;
  const c = candidate && typeof candidate === 'object' ? candidate : null;
  const authorObj = c && typeof c.author === 'object' && c.author ? c.author : null;
  const handle = String(authorObj?.username || (typeof c?.author === 'string' ? c.author : '') || c?.handle || parsed.handle || '').replace(/^@/, '') || null;
  return {
    url: parsed.url,
    id: parsed.id,
    handle,
    authorName: str(authorObj?.name) || str(c?.authorName),
    text: c ? str(c.text) : null,
    createdAt: c ? str(c.createdAt) : null,
    hasMedia: c ? c.hasMedia === true : false,
    mediaUrl: c ? str(c.mediaUrl) : null, // the scan does not store a media URL today; honoured if a future scan does
    found: !!(c && str(c.text)),
  };
}
