// instagram-caption.js — pure caption builder for Instagram. No I/O.
// IG differs from X: long captions are fine (<=2200), links are not clickable
// (so credits/links become "link in bio" text), and the owner rule is no emoji.

export const IG_CAPTION_MAX = 2200;
export const DEFAULT_HASHTAG_POLICY = { min: 3, max: 5 };

const PLACEHOLDER_RE = /\bTODO\b|\bTBD\b|\[[^\]]*(add|your|memory|story|fill)[^\]]*\]|lorem ipsum/i;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;

export function stripEmoji(s) {
  return String(s || '').replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

export function isPlaceholderStory(s) {
  const t = String(s || '').trim();
  return t.length === 0 || PLACEHOLDER_RE.test(t);
}

function normTag(t) {
  const core = String(t || '').replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
  return core ? `#${core}` : '';
}

// hashtagPolicy: { min, max, tags? }. max:0 disables hashtags. Tags come from
// the variant, then pkg.tags; deduped case-insensitively, capped at max. If
// fewer than min exist we do NOT invent any (no fabricated tags).
export function pickHashtags(pkg, policy = DEFAULT_HASHTAG_POLICY) {
  const max = Math.max(0, Number(policy.max ?? DEFAULT_HASHTAG_POLICY.max));
  if (max === 0) return [];
  const raw = [...(policy.tags || []), ...(pkg?.variants?.instagram?.hashtags || []), ...(pkg?.tags || [])];
  const seen = new Set();
  const out = [];
  for (const t of raw.map(normTag)) {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// Returns { ok:true, caption } or { ok:false, reason }. Never throws.
export function buildInstagramCaption(pkg, { hashtagPolicy = DEFAULT_HASHTAG_POLICY, linkInBio = true } = {}) {
  const v = pkg?.variants?.instagram || {};
  const body = stripEmoji(v.caption || v.text || pkg?.story || '');
  if (isPlaceholderStory(body) || isPlaceholderStory(pkg?.story) && !v.caption && !v.text) {
    return { ok: false, reason: 'placeholder-story' };
  }

  const parts = [body];
  const credit = stripEmoji(v.credit || pkg?.credit || '');
  const hasLink = !!(v.link || pkg?.link || pkg?.url);
  if (credit) parts.push(credit);
  if (hasLink && linkInBio) parts.push('Link in bio.');
  const tags = pickHashtags(pkg, hashtagPolicy);
  const tail = tags.join(' ');

  const head = parts.join('\n\n');
  const full = tail ? `${head}\n\n${tail}` : head;
  if (full.length <= IG_CAPTION_MAX) return { ok: true, caption: full, hashtags: tags };

  // Over limit: keep tags and trailer, trim the body at a word boundary.
  const trailer = [...parts.slice(1), tail].filter(Boolean).join('\n\n');
  const room = IG_CAPTION_MAX - (trailer ? trailer.length + 2 : 0) - 1;
  if (room < 100) return { ok: false, reason: 'caption-too-long' };
  const cut = body.slice(0, room).replace(/\s+\S*$/, '').trimEnd();
  return { ok: true, caption: `${cut}…\n\n${trailer}`.slice(0, IG_CAPTION_MAX), hashtags: tags, truncated: true };
}
