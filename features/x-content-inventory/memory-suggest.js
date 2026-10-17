// memory-suggest.js - suggested "memory" lines for drafts that still carry a blocking placeholder
// ("[add your memory]" / "[add your take]", self-reply.js BLOCKING_PLACEHOLDERS). Those drafts cannot be approved,
// scheduled or published until the placeholder is replaced.
//
// Pure: no I/O, no clock, no model. A suggestion is ONLY a proposal for the owner to edit or skip; the deterministic
// fallback is built from the library item's own facts (title, year) and claims no personal experience. A model-written
// line (the agent supplies `suggestions`) replaces it when given.

import { findPlaceholder, BLOCKING_PLACEHOLDERS } from '../social-posting/self-reply.js';

export const MAX_MEMORY_SUGGESTIONS = 30;
export const MEMORY_LINE_MAX = 200;
export const POST_MAX = 280;

const flat = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Draft rows that still need a memory line: an unapproved draft whose text contains a blocking placeholder. */
export function postNeedsMemory(post) {
  return !!post && post.status === 'draft' && findPlaceholder(post.content ?? post.text) !== null;
}

/** Facts-only fallback line for a library item (or null when it has no title). Never an invented personal memory. */
export function fallbackMemoryLine(pkg) {
  const facets = pkg?.humanEdits || pkg?.facets || {};
  const label = flat(pkg?.title || (Array.isArray(pkg?.facets?.partyNames) ? pkg.facets.partyNames[0] : ''), 90);
  if (!label) return null;
  const year = /^(\d{4})/.exec(String(facets.eventDate ?? pkg?.facets?.eventDate ?? pkg?.eventDate ?? ''))?.[1];
  return `Still one I come back to: ${label}${year ? `, ${year}` : ''}.`;
}

/** Validate one memory line (suggested or edited). @returns {{ok:true,line:string}|{ok:false,error:string}} */
export function normalizeMemoryLine(raw) {
  const line = flat(raw, MEMORY_LINE_MAX + 1);
  if (!line) return { ok: false, error: 'the line is empty' };
  if (line.length > MEMORY_LINE_MAX) return { ok: false, error: `the line is over ${MEMORY_LINE_MAX} characters` };
  if (findPlaceholder(line)) return { ok: false, error: 'the line still contains a placeholder' };
  return { ok: true, line };
}

/** Replace the first blocking placeholder in `content` with `line`. @returns {{ok:true,content:string}|{ok:false,error:string}} */
export function applyMemoryLine(content, line) {
  const text = String(content ?? '');
  const low = text.toLowerCase();
  const ph = BLOCKING_PLACEHOLDERS.find((p) => low.includes(p));
  if (!ph) return { ok: false, error: 'the draft no longer has a placeholder' };
  const l = normalizeMemoryLine(line);
  if (!l.ok) return l;
  const at = low.indexOf(ph);
  const next = `${text.slice(0, at)}${l.line}${text.slice(at + ph.length)}`;
  if (findPlaceholder(next)) return { ok: false, error: 'the draft has another placeholder to fill first' };
  if (next.length > POST_MAX) return { ok: false, error: `the post would be ${next.length} characters (max ${POST_MAX}); shorten the line` };
  return { ok: true, content: next };
}

/**
 * Plan suggestion rows for the given posts.
 * @param {{posts:object[], packages?:object[], suggestions?:Record<string,string>}} input
 * @returns {{rows:object[], problems:string[]}} row = {postId, expectedUpdatedAt, title, currentText, suggestion, source:'agent'|'facts'}
 */
export function planMemorySuggestions({ posts = [], packages = [], suggestions = {} } = {}) {
  const byId = new Map((packages || []).map((p) => [p.id, p]));
  const rows = [];
  const problems = [];
  for (const post of posts) {
    const postId = post?.id;
    if (!postNeedsMemory(post)) { problems.push(`${postId ?? '?'}: not a draft with a placeholder`); continue; }
    const pkg = byId.get(post.packageId) || null;
    const given = suggestions && typeof suggestions === 'object' ? suggestions[postId] : undefined;
    const raw = given !== undefined ? given : fallbackMemoryLine(pkg);
    if (raw === null || raw === undefined) { problems.push(`${postId}: no facts to build a line from; supply one in suggestions`); continue; }
    const l = normalizeMemoryLine(raw);
    if (!l.ok) { problems.push(`${postId}: ${l.error}`); continue; }
    const applied = applyMemoryLine(post.content ?? post.text, l.line);
    if (!applied.ok) { problems.push(`${postId}: ${applied.error}`); continue; }
    rows.push({
      postId, expectedUpdatedAt: String(post.updatedAt || ''), title: flat(pkg?.title || post.title, 90) || null,
      currentText: String(post.content ?? post.text ?? '').slice(0, POST_MAX * 2), suggestion: l.line, source: given !== undefined ? 'agent' : 'facts',
    });
  }
  return { rows, problems };
}
