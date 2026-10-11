// Text primitives: tokenizing, stopwords, weak/common word lists, and the
// term/phrase fingerprints of a content package.
// Decides what words and phrases identify an owned item; never decides fit or eligibility.
// Imports no sibling module. (isRealStory lives here, not in content-basis — see report.)

// --- text ------------------------------------------------------------------

const STOPWORDS = new Set(`
a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having
he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on
once only or other our ours out over own same she should so some such than that the their theirs them then
there these they this those through to too under until up very was we were what when where which while who
whom why will with would you your yours yet via per amp
new one two get got make made making thing things people time today day days week year years good great
best love like really much many way still even back first last next see look looks looking need want
know think post posts thread tweet x twitter lol omg wow yes yeah ever every something anything nothing
`.split(/\s+/).filter(Boolean));

export function tokenize(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .split(/[^a-z0-9]+/)
    // Light plural folding ("records" = "record"), applied to both sides of every match.
    .map((t) => (t.length > 4 && /[^siu]s$/.test(t) ? t.slice(0, -1) : t))
    .filter((t) => (t.length >= 3 || /^\d{4}$/.test(t)) && !STOPWORDS.has(t) && !/^\d{1,3}$/.test(t));
}

export const arrayValues = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
export const FACET_ARRAYS = ['people', 'crews', 'labels', 'venues', 'cities', 'partyNames', 'gear', 'genres', 'credits'];

/** term -> weight. What the package IS (title, tags, entities, facets) weighs
 * 2; the story is material, weight 1. */
export function packageTerms(pkg = {}) {
  const terms = new Map();
  const add = (text, w) => { for (const t of tokenize(text)) terms.set(t, Math.max(terms.get(t) || 0, w)); };
  add(pkg.title, 2);
  for (const s of [...ownerTags(pkg), ...arrayValues(pkg.entities)]) add(s, 2);
  const f = pkg.facets && typeof pkg.facets === 'object' ? pkg.facets : {};
  for (const key of FACET_ARRAYS) for (const s of arrayValues(f[key])) add(s, 2);
  if (isRealStory(pkg.story)) add(pkg.story, 1);
  return terms;
}

/** Tags written by sync/ingest code ("rendered", "origin", …) describe the
 * pipeline, not the content; only hand-made packages' tags count. */
export function ownerTags(pkg) {
  const kind = pkg.source?.kind;
  return !kind || kind === 'manual' ? arrayValues(pkg.tags) : [];
}

/** Words too broad to show a conversation is about something the owner holds.
 * They still count inside a phrase ("deep house", "cajual records"). */
export const WEAK_TERMS = new Set(['music', 'video', 'mix', 'record', 'track', 'song', 'sound', 'beat', 'live', 'house', 'deep',
  'electronic', 'acid', 'disco', 'dub', 'jazz', 'dance', 'art', 'design', 'work', 'vinyl', 'release', 'label', 'artist', 'club',
  'night', 'party', 'remix', 'edit', 'original', 'vol', 'volume', 'part', 'unknown', 'various']);

function phraseNorm(s) {
  return ` ${String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

const PHRASE_WEIGHT = { artist: 3, title: 3, label: 3, entity: 3, person: 3, party: 2, venue: 2, genre: 1.5, city: 1 };

/** Everyday English words. A phrase made only of these ("black vinyl",
 * "big beat", "3 play") collides with ordinary posts, so it can support a
 * match but never anchor one. General vocabulary, not tuned to one library. */
const COMMON_WORDS = new Set(`black white red blue green gold silver big small little night day club play beat love soul deep state
real moon air sky sun star west east north south boy boys girl girls man men woman women king queen time times step live sound
sounds house music vinyl record records jazz groove dance party life world city street road home heart mind dream dreams free
good bad high low hot cold new old first last one two three four five six seven eight nine ten hold me you your my want got get
jump skip volume loop mood large touch story fire water light dark people family friends rough performance mix father mother
birthday underground edition limited season`.split(/\s+/).filter(Boolean));

function isAnchorPhrase(phrase, kind) {
  if (!['artist', 'person', 'label', 'entity', 'party', 'venue', 'title'].includes(kind)) return false;
  const words = phrase.split(' ').filter(Boolean);
  // "dj sneak", "mc lyte": the prefix makes an otherwise ordinary word a name.
  if (words.length === 2 && /^(dj|mc)$/.test(words[0]) && words[1].length >= 3) return true;
  const distinctive = words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !COMMON_WORDS.has(w));
  if (words.length === 1) return distinctive.length === 1 && words[0].length >= 5;
  return distinctive.length >= 1;
}

/** Distinctive phrases a package is recognised by — artist and title from
 * "Artist – Title", labels, people, venues, party names, entities, multi-word
 * genres, cities. Each is marked `anchor` when it is specific enough to show
 * a conversation is about THIS item rather than an ordinary phrase. */
export function packagePhrases(pkg = {}) {
  const out = new Map();
  const add = (raw, kind, { keepSuffix = false } = {}) => {
    const base = keepSuffix ? String(raw) : String(raw).replace(/\s+(records?|recordings|music)$/i, '');
    const p = phraseNorm(base).trim();
    if (p.length < 4 || WEAK_TERMS.has(p) || GENERIC_PHRASES.has(p) || /^\d+$/.test(p)) return;
    const anchor = keepSuffix ? /\s(records?|recordings)$/.test(p) : isAnchorPhrase(p, kind);
    const prev = out.get(p);
    if (!prev || (anchor && !prev.anchor)) out.set(p, { kind, weight: PHRASE_WEIGHT[kind] * (anchor ? 1 : 0.5), anchor });
  };
  const [artists, title] = String(pkg.title || '').split(/\s+[–—-]\s+/);
  if (title) {
    for (const a of artists.split(/,|&| feat\.? /i)) add(a, 'artist');
    add(title.replace(/\b(e\.?p\.?|lp|mix)\b\.?$/i, ''), 'title');
  }
  const f = pkg.facets && typeof pkg.facets === 'object' ? pkg.facets : {};
  for (const s of arrayValues(f.labels)) { add(s, 'label'); add(s, 'label', { keepSuffix: true }); }
  for (const s of arrayValues(f.people)) add(s, 'person');
  for (const s of arrayValues(f.partyNames)) add(s, 'party');
  for (const s of arrayValues(f.venues)) add(s, 'venue');
  for (const s of arrayValues(f.cities)) add(s, 'city');
  for (const s of arrayValues(f.genres).filter((g) => /\s/.test(g))) add(s, 'genre');
  for (const s of arrayValues(pkg.entities)) add(s, 'entity');
  return out;
}

export function phraseHits(text, phrases) {
  const hay = phraseNorm(text);
  // Domain context: the broad music/media words. A one-word name ("cajual")
  // only counts when the post is plainly about that domain.
  const context = tokenize(text).some((t) => WEAK_TERMS.has(t));
  const hits = [];
  for (const [p, meta] of phrases) {
    if (!hay.includes(` ${p} `)) continue;
    if (meta.anchor && !p.includes(' ') && !context) continue;
    hits.push({ phrase: p, ...meta });
  }
  return hits;
}

// One-word genres and media words match half of X; a search for them finds
// noise, not a conversation the owner belongs in.
export const GENERIC_PHRASES = new Set(['electronic', 'house', 'acid', 'disco', 'dub', 'jazz', 'video', 'record', 'mix', 'music', 'various', 'unknown artist']);

const PLACEHOLDER_STORY_RE = /^\[[^\]]*\]$/;
export function isRealStory(story) {
  const s = String(story ?? '').trim();
  return s.length >= 40 && !PLACEHOLDER_STORY_RE.test(s);
}
