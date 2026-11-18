import { createHash } from 'node:crypto';

// A draft's `content` may carry an internal brief after the public copy:
//   "<public X copy>\n\nINTERNAL VIDEO BRIEF: <instructions>"
// The brief must never be published. These helpers are pure; the publish guard lives in twitter-service.js.

export const BRIEF_MARKER_RE = /INTERNAL VIDEO BRIEF/i;
const STRIP_RE = /\s*INTERNAL VIDEO BRIEF:[\s\S]*$/i;
const BRIEF_RE = /INTERNAL VIDEO BRIEF:([\s\S]*)$/i;
const HOOK_MAX = 280;

export const hasInternalBrief = (content) => BRIEF_MARKER_RE.test(String(content ?? ''));

/** The public copy only: everything before the brief marker. Also removes a marker without a colon. */
export function stripBrief(content) {
  const text = String(content ?? '');
  return text.replace(STRIP_RE, '').replace(/\s*INTERNAL VIDEO BRIEF[\s\S]*$/i, '').trim();
}

export const briefHash = (brief) => createHash('sha256').update(String(brief ?? '').trim()).digest('hex').slice(0, 16);

/** First sentence of the public copy (first line, cut at the first sentence end). */
export function firstSentence(publicCopy) {
  const line = String(publicCopy ?? '').trim().split(/\n/)[0].trim();
  const m = /^(.+?[.!?])(?=\s|$)/.exec(line);
  return (m ? m[1] : line).slice(0, HOOK_MAX).trim();
}

/** { brief, briefHash, hook, publicCopy } for a row's content, or null when it has no brief text. */
export function parseBrief(content) {
  const m = BRIEF_RE.exec(String(content ?? ''));
  const brief = m ? m[1].trim() : '';
  if (!brief) return null;
  const publicCopy = stripBrief(content);
  return { brief, briefHash: briefHash(brief), hook: firstSentence(publicCopy), publicCopy };
}

/** Brief for a stored row: parsed from content, else the already-moved videoBrief (after attach). */
export function briefOfPost(post) {
  const parsed = parseBrief(post?.content);
  if (parsed) return parsed;
  const brief = typeof post?.videoBrief === 'string' ? post.videoBrief.trim() : '';
  if (!brief) return null;
  return { brief, briefHash: post.videoBriefHash || briefHash(brief), hook: firstSentence(post.content), publicCopy: String(post.content ?? '').trim() };
}
