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

const HOWTO_ID_RE = /^howto=([a-z0-9-]{3,48})$/;

const MD = '[*_#>\\s-]*'; // markdown bullets / bold / headings before and around a field name
const HOWTO_TYPE_LINE_RE = new RegExp(`^${MD}type${MD}:${MD}.*\\b(how-?to|gameplay)\\b`, 'im');
const HOWTO_FIELD_LINE_RE = new RegExp(`^${MD}(hook|banner|host|format|arrival|payoff|cta|steps?|goal|audience|restrictions|shots|captions)${MD}:`, 'i');

/** Structured how-to prose: a `Type: ...how-to/gameplay` line plus at least 2 other field lines (Hook:, Banner:, CTA: ...). */
function isHowtoProse(text) {
  if (!HOWTO_TYPE_LINE_RE.test(text)) return false;
  const others = text.split('\n').filter((l) => !new RegExp(`^${MD}type${MD}:`, 'i').test(l) && HOWTO_FIELD_LINE_RE.test(l));
  return others.length >= 2;
}

/** Warnings for a saved row whose brief classifies invalid (the save is never rejected). */
export function briefWarnings(post) {
  const b = briefOfPost(post);
  if (!b || b.briefKind !== 'invalid') return [];
  return [`video brief invalid: ${b.invalidReason} \u2014 gameplay/how-to videos need video.howto.request.submit (v3.2), then the brief must be exactly howto=<id>; it will not render.`];
}

/**
 * Classify the brief text (after the marker). `howto=<id>` -> CQ-HowTo; anything that starts with "howto" or carries
 * a YAML `request_version:` is invalid and must never reach BriefCut; everything else is free text.
 */
export function classifyBrief(brief) {
  const text = String(brief ?? '').trim();
  const m = HOWTO_ID_RE.exec(text);
  if (m) return { kind: 'howto', howtoId: m[1] };
  if (/request_version:/i.test(text)) return { kind: 'invalid', reason: 'yaml-in-brief' };
  if (/^howto/i.test(text)) return { kind: 'invalid', reason: 'malformed-howto-line' };
  if (isHowtoProse(text)) return { kind: 'invalid', reason: 'howto-prose-needs-request' };
  return { kind: 'freetext' };
}

/** { brief, briefHash, hook, publicCopy, briefKind, howtoId?, invalidReason? } for a row's content, or null when it has no brief text. */
export function parseBrief(content) {
  const m = BRIEF_RE.exec(String(content ?? ''));
  const brief = m ? m[1].trim() : '';
  if (!brief) return null;
  const publicCopy = stripBrief(content);
  return { brief, briefHash: briefHash(brief), hook: firstSentence(publicCopy), publicCopy, ...kindFields(brief) };
}

function kindFields(brief) {
  const c = classifyBrief(brief);
  return { briefKind: c.kind, ...(c.howtoId ? { howtoId: c.howtoId } : {}), ...(c.reason ? { invalidReason: c.reason } : {}) };
}

/** Brief for a stored row: parsed from content, else the already-moved videoBrief (after attach). */
export function briefOfPost(post) {
  const parsed = parseBrief(post?.content);
  if (parsed) return parsed;
  const brief = typeof post?.videoBrief === 'string' ? post.videoBrief.trim() : '';
  if (!brief) return null;
  return { brief, briefHash: post.videoBriefHash || briefHash(brief), hook: firstSentence(post.content), publicCopy: String(post.content ?? '').trim(), ...kindFields(brief) };
}
