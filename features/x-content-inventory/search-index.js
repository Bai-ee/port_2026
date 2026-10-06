// Search index — compact, serializable, client-filterable
// (Content Engine v2 master plan §4 "Search").
//
// index = { v, docs: [{ id, bucketId, title, thumb?, tokens, facets }] }
// The postings maps are derived lazily and cached in a WeakMap, so the index
// itself stays plain JSON. Pure: no fs, no network, no clock.
//
// Query syntax:
//   free words           house 1997      AND, prefix match on tokens
//   people:ron trent     multi-word fields (people crew label venue city party genre)
//                        take following words until the next field:
//   gear:909             single word (use quotes for more: gear:"roland 909"), canonicalized
//   year:1997  decade:1990s  vibe:night  bucket:record

import { resolveBucket, DEFAULT_BUCKETS, bucketIdFromName } from './buckets.js';
import { effectiveFacets, buildSearchTokens, canonicalGear, normalizeTerm } from './facets.js';

export const INDEX_VERSION = 1;

const FIELD_ALIASES = {
  people: 'people', person: 'people', artist: 'people', dj: 'people',
  crew: 'crews', crews: 'crews', label: 'labels', labels: 'labels',
  venue: 'venues', venues: 'venues', city: 'cities', cities: 'cities',
  party: 'partyNames', parties: 'partyNames', genre: 'genres', genres: 'genres',
  gear: 'gear', year: 'year', decade: 'decade', vibe: 'vibe', bucket: 'bucket',
};
const MULTI_WORD = new Set(['people', 'crews', 'labels', 'venues', 'cities', 'partyNames', 'genres']);
const FACET_ARRAYS = ['people', 'crews', 'labels', 'venues', 'cities', 'partyNames', 'gear', 'genres'];

/** Facets as search sees them: credited people count as people (people:glenn
 * underground finds a remix credit too), and legacy `entities` fill in
 * people/labels on rows written before facets existed. */
function searchFacets(item) {
  const f = { ...effectiveFacets(item) };
  const ents = (Array.isArray(item.entities) ? item.entities : []).map(normalizeTerm).filter(Boolean);
  const merge = (a = [], b = []) => [...new Set([...a, ...b])];
  f.people = merge(f.people, f.credits);
  if (ents.length && !f.people.length) f.people = merge(f.people, ents.slice(0, 1));
  if (ents.length > 1 && !(f.labels || []).length) f.labels = ents.slice(1, 2);
  if (!f.people.length) delete f.people;
  return f;
}

export function buildIndex(items = [], opts = {}) {
  const buckets = opts.buckets || DEFAULT_BUCKETS;
  const docs = items.map((item) => {
    const doc = {
      id: item.id,
      bucketId: resolveBucket(item, buckets),
      title: String(item.title ?? ''),
      tokens: buildSearchTokens(item),
      facets: searchFacets(item),
    };
    const thumb = item.thumb || item.thumbUrl || item.thumbnail;
    if (thumb) doc.thumb = thumb;
    return doc;
  });
  return { v: INDEX_VERSION, docs };
}

/** Parse a query string into { words, filters: [{field, value}] }. */
export function parseQuery(q) {
  const words = [];
  const filters = [];
  const re = /(?:([A-Za-z]+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  let current = null; // multi-word filter still accepting words
  while ((m = re.exec(String(q ?? '')))) {
    const key = m[1] ? FIELD_ALIASES[m[1].toLowerCase()] : null;
    const text = m[2] ?? m[3];
    const quoted = m[2] != null;
    if (key) {
      current = null;
      const f = { field: key, value: text };
      filters.push(f);
      if (MULTI_WORD.has(key) && !quoted) current = f;
    } else if (m[1]) {
      current = null;
      words.push(normalizeTerm(`${m[1]}:${text}`));
    } else if (current) {
      current.value += ` ${text}`;
    } else {
      words.push(normalizeTerm(text));
    }
  }
  return {
    words: words.flatMap((w) => w.split(/[^\p{L}\p{N}-]+/u)).filter(Boolean),
    filters: filters.map((f) => ({ field: f.field, value: normalizeTerm(f.value) })).filter((f) => f.value),
  };
}

const cache = new WeakMap();
function derived(index) {
  let d = cache.get(index);
  if (d) return d;
  const postings = new Map();
  index.docs.forEach((doc, i) => {
    for (const t of doc.tokens) {
      const l = postings.get(t);
      if (l) l.push(i); else postings.set(t, [i]);
    }
  });
  d = { postings, sorted: [...postings.keys()].sort() };
  cache.set(index, d);
  return d;
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

function docsForPrefix(d, prefix) {
  const out = new Set();
  for (let i = lowerBound(d.sorted, prefix); i < d.sorted.length && d.sorted[i].startsWith(prefix); i++) {
    for (const di of d.postings.get(d.sorted[i])) out.add(di);
  }
  return out;
}

function decadeOf(v) {
  const s = normalizeTerm(v);
  let m = /^(\d{4})s?$/.exec(s);
  if (m) return `${Math.floor(Number(m[1]) / 10) * 10}s`;
  m = /^(\d{2})s$/.exec(s);
  if (m) { const n = Number(m[1]); return `${(n < 30 ? 2000 : 1900) + n}s`; }
  return s;
}

/** Score a field filter against a doc: 0 = no match, else points. */
function filterScore(doc, { field, value }) {
  const f = doc.facets;
  switch (field) {
    case 'gear': return (f.gear || []).includes(canonicalGear(value)) ? 100 : 0;
    case 'year': return String(f.eraYear ?? '') === value || String(f.eventDate ?? '').startsWith(value) ? 100 : 0;
    case 'decade': return f.decade === decadeOf(value) ? 100 : 0;
    case 'vibe': {
      const v = f.vibe || {};
      return [v.light, v.time, v.kind, ...(v.mood || [])].includes(value) ? 100 : 0;
    }
    case 'bucket': return doc.bucketId === value || doc.bucketId === bucketIdFromName(value) ? 100 : 0;
    default: {
      let best = 0;
      const vw = value.split(' ');
      for (const e of f[field] || []) {
        if (e === value) return 100;
        if (e.startsWith(value) || vw.every((w) => e.split(' ').some((x) => x.startsWith(w)))) best = 60;
      }
      return best;
    }
  }
}

function freeWordScore(doc, word, alts, matched) {
  let score = 0;
  const f = doc.facets;
  for (const a of alts) {
    for (const k of FACET_ARRAYS) {
      for (const e of f[k] || []) {
        if (e === a) { score = Math.max(score, 30); matched.add(k); }
        else if (e.split(/[^\p{L}\p{N}-]+/u).some((x) => x.startsWith(a))) { score = Math.max(score, 8); matched.add(k); }
      }
    }
    if (f.decade === a || String(f.eraYear ?? '') === a) { score = Math.max(score, 30); matched.add('year'); }
    const v = f.vibe || {};
    if ([v.light, v.time, v.kind, ...(v.mood || [])].includes(a)) { score = Math.max(score, 30); matched.add('vibe'); }
  }
  const title = normalizeTerm(doc.title);
  if (title.split(/[^\p{L}\p{N}-]+/u).some((x) => alts.some((a) => x.startsWith(a)))) { score += 5; matched.add('title'); }
  if (!score) { score = 3; matched.add('text'); }
  return score;
}

/**
 * search(index, query, { bucketId?, filters?, limit = 50 })
 * filters = same fields as the query syntax, e.g. { gear: '909', people: 'ron trent' }.
 * Returns [{id, bucketId, title, thumb?, score, matched: [field…]}].
 */
export function search(index, query = '', { bucketId = null, filters = {}, limit = 50 } = {}) {
  if (!index?.docs) return [];
  const parsed = parseQuery(query);
  for (const [k, v] of Object.entries(filters || {})) {
    const field = FIELD_ALIASES[String(k).toLowerCase()];
    for (const val of [].concat(v)) if (field && normalizeTerm(val)) parsed.filters.push({ field, value: normalizeTerm(val) });
  }
  const bucketFilter = bucketId || null;
  const d = derived(index);

  // free words → candidate set (AND of per-word unions)
  const wordAlts = parsed.words.map((w) => {
    const c = canonicalGear(w);
    return c !== w ? [w, c] : [w];
  });
  let cand = null;
  const sets = wordAlts.map((alts) => {
    const s = new Set();
    for (const a of alts) for (const di of docsForPrefix(d, a)) s.add(di);
    return s;
  }).sort((a, b) => a.size - b.size);
  for (const s of sets) {
    if (!cand) cand = s;
    else { const n = new Set(); for (const di of cand) if (s.has(di)) n.add(di); cand = n; }
    if (!cand.size) return [];
  }
  const ids = cand ? [...cand] : index.docs.map((_, i) => i);

  const hits = [];
  for (const di of ids) {
    const doc = index.docs[di];
    if (bucketFilter && doc.bucketId !== bucketFilter) continue;
    let score = 0;
    const matched = new Set();
    let ok = true;
    for (const flt of parsed.filters) {
      const s = filterScore(doc, flt);
      if (!s) { ok = false; break; }
      score += s;
      matched.add(flt.field);
    }
    if (!ok) continue;
    wordAlts.forEach((alts, i) => { score += freeWordScore(doc, parsed.words[i], alts, matched); });
    const hit = { id: doc.id, bucketId: doc.bucketId, title: doc.title, score, matched: [...matched] };
    if (doc.thumb) hit.thumb = doc.thumb;
    hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || String(a.id).localeCompare(String(b.id)));
  return hits.slice(0, limit);
}
