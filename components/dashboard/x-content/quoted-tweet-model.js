// Pure model for the quoted-tweet card in the post editor. No React, no I/O.
//
// Where the quoted tweet comes from (all Firestore, never X):
//   requote suggestion row  -> carried inline on the calendar row (quotedUrl/quotedHandle/quotedText/quotedAuthorName/createdAt)
//   saved quote post        -> URL from the post (sourceRef / trailing status URL, quotedUrlOf), text + author from the
//                              client's stored quote-target scan via the `quoted-post-preview` action
//   neither                 -> URL only, honest "Open on X" fallback
import { quotedUrlOf } from '../../../features/x-strategy/post-query.js';
import { parseStatusUrl, buildQuotedPreview } from '../../../features/x-quote-targets/quoted-preview.js';

export const isRequoteRow = (row) => row?.kind === 'requote';

/** { url, id, handle } of the tweet this row quotes, or null when it quotes nothing. Reposts and replies never quote. */
export function quotedRefOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (isRequoteRow(row)) return parseStatusUrl(row.quotedUrl || row.url);
  if (row.kind === 'suggestion' || row.kind === 'repost' || row.replyTo) return null;
  return parseStatusUrl(row.quotedUrl || quotedUrlOf(row));
}

/** What the row itself already knows about the quoted tweet (requote rows only), as a preview object, or null. */
export function localQuotedPreview(row) {
  const ref = quotedRefOf(row);
  if (!ref) return null;
  if (!isRequoteRow(row)) return buildQuotedPreview({ url: ref.url });
  return buildQuotedPreview({
    url: ref.url,
    candidate: {
      id: row.quoteTargetId ?? ref.id, author: row.quotedHandle || row.handle || ref.handle, authorName: row.quotedAuthorName,
      text: row.quotedText ?? row.text, createdAt: row.createdAt, hasMedia: row.quotedHasMedia, mediaUrl: row.quotedMediaUrl,
    },
  });
}

/** The server must be asked only when the row cannot already show the quoted text. */
export function needsQuotedLookup(row) {
  const ref = quotedRefOf(row);
  return !!ref && !localQuotedPreview(row)?.found;
}

/** Request body for `quoted-post-preview`: a saved post goes by id (the server re-derives the URL), a requote by url. */
export function quotedLookupBody(row) {
  const ref = quotedRefOf(row);
  if (!ref) return null;
  return isRequoteRow(row) || !row.id ? { url: ref.url } : { postId: row.id };
}

export function quotedDateLabel(iso, timeZone = 'UTC') {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(ms));
  } catch { return ''; }
}

/** Everything the card renders, with the fallbacks decided here so the JSX stays dumb. */
export function quotedCardView(preview, { timeZone } = {}) {
  if (!preview) return null;
  const handle = preview.handle ? `@${preview.handle}` : '';
  return {
    displayName: preview.authorName || handle || 'Quoted post',
    handleLabel: preview.authorName ? handle : '',
    text: preview.text || '',
    hasText: !!preview.text,
    dateLabel: quotedDateLabel(preview.createdAt, timeZone),
    mediaUrl: preview.mediaUrl || null,
    mediaNote: !preview.mediaUrl && preview.hasMedia ? 'Has an image or video. Open it on X to see it.' : '',
    openUrl: preview.url,
    missingNote: preview.text ? '' : 'The text of this post is not stored. Open it on X to read it.',
    summaryLabel: handle ? `Quoting ${handle}` : 'Quoting',
  };
}
