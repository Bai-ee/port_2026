// post-format.js — the live post format per client: formatters every generator uses, the rule text the chat agent
// follows, and checkLiveReady (is this copy postable as written?). Pure.
//
// Owner rules (2026-11-16): every post on the calendar should be postable as is.
//   - no em or en dashes (the "·" separator stays)
//   - no placeholders ("[add your memory]", "[add your take]"), no "…" truncation, no links in the body
//     (links go in the self-reply), at most 280 characters
//   - per-client formats, one data field per line, ending with the client's hashtag:
//       Discogs record   [optional memory line, blank line]
//                        Artist
//                        Title
//                        Label
//                        Catno · Year
//                        #baieesdiscogs
//       UE mix video     Artist
//                        Mix title
//                        [venue / circa line]
//                        #mixtapesfromchicago
//   - record and mix posts carry their video/image
// A client without an entry gets the generic rules only. Birthday posts (one sentence) skip the field layout.

export const POST_MAX = 280;

export const CLIENT_POST_FORMATS = {
  'bai-ees-discogs-TP37NQG0': { kind: 'record', hashtag: '#baieesdiscogs' },
  'undergroundexistence-0CsKkpaq': { kind: 'mix', hashtag: '#mixtapesfromchicago' },
};

export const formatFor = (clientId) => CLIENT_POST_FORMATS[clientId] || null;

// ---- Formatters: the ONE place generated post copy for these clients is shaped. -------------------------------

const DASHES_RE = /\s*[\u2013\u2014]\s*/g;
/** One clean data line: no dashes (a spaced en/em dash becomes ", "), collapsed spaces, no line breaks. */
export function cleanLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(DASHES_RE, ', ').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
}
/** Owner memory/story text above the data block: keeps its own line breaks, dashes become ", ". */
const cleanMemory = (value) => String(value ?? '').split('\n').map((l) => l.replace(DASHES_RE, ', ').replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
const joinNames = (v) => (Array.isArray(v) ? v.map(cleanLine).filter(Boolean).join(', ') : cleanLine(v));
const withMemory = (memory, block) => {
  const m = cleanMemory(memory);
  return m ? `${m}\n\n${block}` : block;
};

/**
 * Discogs record post. Missing fields are left out (never invented); the live-ready check then flags it.
 *   [memory, blank line] Artist / Title / Label / Catno · Year / #baieesdiscogs
 */
export function formatRecordPost({ artists, artist, title, label, catno, year, memory } = {}, { hashtag = CLIENT_POST_FORMATS['bai-ees-discogs-TP37NQG0'].hashtag } = {}) {
  const last = [cleanLine(catno), cleanLine(year)].filter(Boolean).join(' · ');
  const lines = [joinNames(artists?.length ? artists : artist), cleanLine(title), cleanLine(label), last].filter(Boolean);
  return withMemory(memory, [...lines, hashtag].join('\n'));
}

/** UE mix video post: [memory, blank line] Artist / Mix title / [venue or circa line] / #mixtapesfromchicago. */
export function formatMixPost({ artist, title, detail, memory } = {}, { hashtag = CLIENT_POST_FORMATS['undergroundexistence-0CsKkpaq'].hashtag } = {}) {
  const lines = [cleanLine(artist), cleanLine(title), cleanLine(detail)].filter(Boolean);
  return withMemory(memory, [...lines, hashtag].join('\n'));
}

/** "Artist – Title" (library package titles) -> { artist, title }; no separator -> { title }. */
export function splitArtistTitle(value) {
  const t = String(value ?? '');
  const m = /^(.*?)\s+[\u2013\u2014-]\s+(.*)$/.exec(t);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: t.trim() };
}

const ownerMemory = (pkg) => {
  const s = String(pkg?.humanEdits?.story ?? '').trim();
  return s && !PLACEHOLDER_RE.test(s) ? s : '';
};

/**
 * Post text for a library package in its client's format, or null when the client has no format or the package is
 * not the client's post kind (callers keep their generic text). Discogs: discogsSummary is the full release
 * (artists, title, labels, catalogNumbers, year); without it only the title/year are known and the post is incomplete.
 */
export function postTextForPackage(pkg, clientId = pkg?.clientId) {
  const fmt = formatFor(clientId);
  if (!fmt || !pkg) return null;
  const memory = ownerMemory(pkg);
  if (fmt.kind === 'record' && pkg.source?.kind === 'discogs') {
    const sum = pkg.discogsSummary || {};
    const split = splitArtistTitle(pkg.title);
    return formatRecordPost({
      artists: Array.isArray(sum.artists) && sum.artists.length ? sum.artists : null,
      artist: split.artist,
      title: sum.title || split.title,
      label: Array.isArray(sum.labels) ? sum.labels[0] : '',
      catno: Array.isArray(sum.catalogNumbers) ? sum.catalogNumbers[0] : '',
      year: sum.year || pkg.eraYear || '',
      memory,
    }, { hashtag: fmt.hashtag });
  }
  if (fmt.kind === 'mix' && (pkg.source?.kind === 'rendered-video' || pkg.facets?.vibe?.kind === 'video')) {
    const split = splitArtistTitle(pkg.title);
    const year = Number(pkg.eraYear) || (/^\d{4}/.test(String(pkg.eventDate || '')) ? Number(String(pkg.eventDate).slice(0, 4)) : null);
    return formatMixPost({
      artist: split.artist,
      title: split.title,
      detail: year ? `Circa '${String(year).slice(2)}` : '',
      memory,
    }, { hashtag: fmt.hashtag });
  }
  return null;
}

/** The format rule as plain text for the chat agent's prompt ('' when the client has no format). */
export function formatRuleText(clientId) {
  const fmt = formatFor(clientId);
  if (!fmt) return '';
  const shape = fmt.kind === 'record'
    ? 'optional memory line(s), a blank line, then Artist / Title / Label / Catno · Year, one per line'
    : 'optional memory line(s), a blank line, then Artist / Mix title / optional venue or circa line, one per line';
  return [
    'POST FORMAT (hard, this client)',
    `- Every post you draft, edit or suggest uses this exact format: ${shape}, and the last line is ${fmt.hashtag}.`,
    '- No em or en dashes, no placeholders, no links in the post body (links go in the self-reply), no cut-off text, at most 280 characters. Never invent a missing field: say which one is missing.',
    '- Change this format ONLY when the owner specifically asks to change it for that post. Otherwise keep it, even when rewriting the memory line.',
  ].join('\n');
}

const PLACEHOLDER_RE = /\[add your [a-z ]+\]/i;
const CATNO_YEAR_RE = /^\S.* · (\d{4}|'\d{2})$/;
const SENTENCE_SOURCES = new Set(['artist-birthday']);

/** The data block: the lines after the last blank line, without the closing hashtag line. */
function dataLines(lines, hashtag) {
  const body = hashtag && lines[lines.length - 1] === hashtag ? lines.slice(0, -1) : lines;
  const lastBlank = body.lastIndexOf('');
  return body.slice(lastBlank + 1);
}

/**
 * @param {object} post   a social_posts row or calendar row ({ content, mediaUrl, source })
 * @param {object} opts   { clientId } — the client whose account would post it
 * @returns {{ ready: boolean, issues: { code: string, message: string }[] }}
 */
export function checkLiveReady(post, { clientId } = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const content = typeof post?.content === 'string' ? post.content : '';
  const text = content.replace(/\r\n/g, '\n').trim();
  if (!text) return { ready: false, issues: [{ code: 'empty', message: 'No text.' }] };

  if (PLACEHOLDER_RE.test(text)) add('placeholder', 'Still has a placeholder.');
  if (text.includes('—')) add('em-dash', 'Has an em dash.');
  if (text.includes('–')) add('en-dash', 'Has an en dash.');
  if (text.includes('…')) add('truncated', 'Text is cut off (…).');
  if (/https?:\/\//i.test(text)) add('link-in-body', 'Link in the post body (put it in the self-reply).');
  if ([...text].length > POST_MAX) add('too-long', `Over ${POST_MAX} characters.`);

  const fmt = formatFor(clientId);
  if (fmt) {
    const lines = text.split('\n').map((l) => l.trim());
    if (lines[lines.length - 1] !== fmt.hashtag) add('hashtag', `Must end with ${fmt.hashtag}.`);
    if (!SENTENCE_SOURCES.has(post?.source)) {
      const data = dataLines(lines, fmt.hashtag);
      const joined = data.some((l) => / [–—-] /.test(l));
      if (fmt.kind === 'record' && (data.length < 4 || !CATNO_YEAR_RE.test(data[data.length - 1]) || joined)) {
        add('record-fields', 'Needs Artist / Title / Label / Catno · Year, one per line.');
      }
      if (fmt.kind === 'mix' && (data.length < 2 || joined)) {
        add('mix-fields', 'Needs Artist / Mix title, one per line.');
      }
      if (!post?.mediaUrl) add('no-media', 'No video or image attached.');
    }
  }
  return { ready: issues.length === 0, issues };
}
