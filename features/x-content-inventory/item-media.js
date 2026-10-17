// item-media.js — give any library item the media of another item (docs/source-of-truth/CONTENT-TRACKS.md § Item media).
// Example: a birthday package (facts only, "needs-shoot") takes the rendered record video of the same Discogs release.
// findMediaCandidates ranks which items could lend their media; linkMediaPatch is the change one link makes.
// Only refs the publisher already accepts (pickMediaRef: `publish-staging/…` or `ev:…`) are copied; nothing is uploaded.
//
// Pure: no I/O, no clock (`now` is passed in).

import { pickMediaRef } from './item-actions.js';

export const MAX_LINKS = 50;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'me', 'my', 'all', 'just', 'love', 'want', 'get', 'got', 'gonna',
  'birthday', 'born', 'shelf', 'source', 'wikipedia', 'mix', 'feat', 'remix', 'edit', 'version', 'original', 'vocal', 'dub', 'club', 'house', 'music', 'records', 'record']);
const TITLE_HIT = 15;
const STORY_HIT = 5;
const MIN_SCORE = 15; // one title word, or three story words

const usable = (ref) => pickMediaRef({ assetRefs: [ref] }) !== null;

/** The usable media an item can lend: its first video and first image ref (either may be null). */
export function mediaOf(pkg) {
  const refs = (Array.isArray(pkg?.assetRefs) ? pkg.assetRefs : []).map(String).filter(usable);
  const video = refs.find((r) => VIDEO_EXT.test(r)) || null;
  const image = refs.find((r) => IMAGE_EXT.test(r)) || null;
  return { video, image, kind: video ? 'video' : image ? 'image' : null };
}

const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/https?:\/\/\S+/g, ' ').replace(/[^\w\s]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const discogsId = (pkg) => (pkg?.source?.kind === 'discogs' && /^\d+$/.test(String(pkg?.source?.externalId ?? '')) ? String(pkg.source.externalId) : null);

/**
 * Items that could lend media to `target`, best first: the same Discogs release (exact), then word overlap with the
 * target's title (weighted; for a birthday that is the artist name) and story, among items that have media. Never the target itself; never an item without usable media.
 * @returns {{id:string,title:string|null,kind:'video'|'image',why:string,score:number}[]}
 */
export function findMediaCandidates(target, packages, { limit = 5 } = {}) {
  if (!target?.id) return [];
  const release = discogsId(target);
  const titleWords = new Set(words(target.title));
  const storyWords = new Set(words(String(target.story ?? '').replace(/source:.*$/is, '').slice(0, 200)).filter((w) => !titleWords.has(w)));
  const out = [];
  for (const p of packages || []) {
    if (!p?.id || p.id === target.id) continue;
    const m = mediaOf(p);
    if (!m.kind) continue;
    let score = 0;
    let why = '';
    if (release && discogsId(p) === release) { score = 100; why = `same Discogs release ${release}`; } else {
      const theirs = [...new Set(words(p.title))];
      const tHit = theirs.filter((w) => titleWords.has(w));
      const sHit = theirs.filter((w) => storyWords.has(w));
      const s = tHit.length * TITLE_HIT + sHit.length * STORY_HIT;
      if (s >= MIN_SCORE) { score = s + (m.kind === 'video' ? 1 : 0); why = `shares words: ${[...tHit, ...sHit].slice(0, 4).join(', ')}`; }
    }
    if (score > 0) out.push({ id: p.id, title: p.title ?? null, kind: m.kind, why, score });
  }
  out.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return out.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
}

/**
 * The change one link makes to `target`: the source's video/image refs go first in assetRefs (so the publisher picks
 * them), the target's own refs are kept after them, mediaState becomes video/still, effort ready, and the source's
 * thumb/poster are reused. `mediaFrom` records where the media came from. Returns {patch} or {error}.
 */
export function linkMediaPatch(target, source, { now = Date.now() } = {}) {
  if (!target?.id || !source?.id) return { error: 'both items are required' };
  if (target.id === source.id) return { error: 'an item cannot take media from itself' };
  if (target.clientId && source.clientId && target.clientId !== source.clientId) return { error: 'items belong to different clients' };
  const m = mediaOf(source);
  if (!m.kind) return { error: `${source.id} has no usable video or image` };
  const lent = [m.video, m.image].filter(Boolean);
  const own = (Array.isArray(target.assetRefs) ? target.assetRefs : []).map(String).filter((r) => !lent.includes(r));
  return {
    patch: {
      assetRefs: [...lent, ...own],
      mediaState: m.kind === 'video' ? 'video' : 'still',
      effort: 'ready',
      ...(source.thumbRef ? { thumbRef: source.thumbRef } : {}),
      ...(source.posterRef ? { posterRef: source.posterRef } : {}),
      mediaFrom: { id: source.id, kind: m.kind, at: now },
    },
  };
}

/** Validate a list of {targetId, sourceId}. One link per target; at most MAX_LINKS. */
export function normalizeLinks(raw) {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, errors: ['links must be a non-empty array'] };
  if (raw.length > MAX_LINKS) return { ok: false, errors: [`at most ${MAX_LINKS} links`] };
  const errors = [];
  const seen = new Set();
  const links = [];
  for (const l of raw) {
    const targetId = String(l?.targetId ?? '').trim();
    const sourceId = String(l?.sourceId ?? '').trim();
    if (!targetId || !sourceId) { errors.push('each link needs targetId and sourceId'); continue; }
    if (targetId === sourceId) { errors.push(`${targetId}: cannot take media from itself`); continue; }
    if (seen.has(targetId)) { errors.push(`${targetId} is linked twice`); continue; }
    seen.add(targetId);
    links.push({ targetId, sourceId });
  }
  return errors.length ? { ok: false, errors } : { ok: true, links };
}
