// Lane graph: the accounts the hot quote scan watches, raised automatically per lane (design | music).
// Stored at client_configs/{clientId}.marketingBriefConfig.xGrowth.laneGraph = { builtAt, design, music, meta }.
//   design: authors the design-track models quote (their corpora rows carry `quotedAuthor`).
//   music:  accounts the music-track models (and the throwback model, and the owner) FOLLOW, kept when the bio
//           looks like Chicago house / rave / DJ culture. Music models almost never quote, so following lists work.
// Pure: no I/O, no clock unless `now` is passed. The Mac script (scripts/x-content/build-lane-graph.mjs) does the fetching.

export const LANES = Object.freeze(['design', 'music']);
export const LANE_GRAPH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ACCOUNTS_PER_LANE = 300;

// Bio filter for the music lane (owner decision 2026-10-19).
export const MUSIC_BIO_RE = /(house|rave|\bdj\b|techno|records|vinyl|jungle|garage|acid|oldskool|hardcore|breakbeat|label|chicago|mixes|selector)/gi;

// A content track is a music track when its id, label or topics say so; every other track is design.
const MUSIC_TRACK_RE = /\b(music|dj|mix(?:es)?|records?|vinyl|throwback|house|rave|techno|jungle|flyers?|archive sets?)\b/i;

// Models that are not a track benchmark in the plan but belong to a lane (owner decision: DorkSirjur = throwback; 0xDesigner = design).
export const DEFAULT_EXTRA_MODELS = Object.freeze({ design: ['0xdesigner'], music: ['dorksirjur'] });

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const cleanHandle = (v) => String(v ?? '').trim().replace(/^@+/, '');
const keyOf = (v) => cleanHandle(v).toLowerCase();

/** 'music' | 'design' for one content track. */
export function laneOfTrack(track) {
  const text = [track?.id, track?.label, ...(Array.isArray(track?.topics) ? track.topics : [])].join(' ');
  return MUSIC_TRACK_RE.test(text) ? 'music' : 'design';
}

/**
 * Which model handles feed each lane (lowercase, de-duplicated). A handle that is a benchmark of a music track is
 * music even when also listed elsewhere; `benchmarkPrimary` (the overall pace model) is design unless a music track owns it.
 * @returns {{design:string[], music:string[]}}
 */
export function laneModels({ tracks = [], benchmarkPrimary = '', extraModels = DEFAULT_EXTRA_MODELS } = {}) {
  const music = new Set();
  const design = new Set();
  for (const t of Array.isArray(tracks) ? tracks : []) {
    const target = laneOfTrack(t) === 'music' ? music : design;
    for (const h of Array.isArray(t?.benchmarks) ? t.benchmarks : []) if (keyOf(h)) target.add(keyOf(h));
  }
  if (keyOf(benchmarkPrimary)) design.add(keyOf(benchmarkPrimary));
  for (const h of extraModels?.music || []) if (keyOf(h)) music.add(keyOf(h));
  for (const h of extraModels?.design || []) if (keyOf(h)) design.add(keyOf(h));
  for (const h of music) design.delete(h);
  return { design: [...design].sort(), music: [...music].sort() };
}

/**
 * Authors a model quoted, from its corpus rows. Self quotes (quotedAuthor = the model) are dropped by the caller's exclusion set.
 * @param {object[]} rows corpus rows ({quotedAuthor, engagement})
 * @returns {Map<string,{handle:string,quotes:number,engagement:number}>} keyed by lowercase handle
 */
export function quotedAuthors(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const handle = cleanHandle(r?.quotedAuthor);
    if (!HANDLE_RE.test(handle)) continue;
    const cur = out.get(handle.toLowerCase()) || { handle, quotes: 0, engagement: 0 };
    cur.quotes += 1;
    cur.engagement += Number.isFinite(r?.engagement) ? r.engagement : 0;
    out.set(handle.toLowerCase(), cur);
  }
  return out;
}

/** Number of distinct music-bio keywords in a profile (name + description). 0 = does not look like the music scene. */
export function musicBioHits(user) {
  const text = `${user?.name || ''} ${user?.description || ''}`;
  const hits = new Set((text.match(MUSIC_BIO_RE) || []).map((m) => m.toLowerCase()));
  return hits.size;
}

/**
 * Bio-disqualifying words from the Brain's avoid topics: the first word (5+ letters) of each avoid phrase
 * ("Crypto price and speculation talk" -> crypto), minus words that name the lanes themselves or are too broad
 * ("Politics not associated with design or music" must never turn "music" into a disqualifier).
 */
const AVOID_TERM_SKIP = new Set(['music', 'design', 'creative', 'house', 'dance', 'records', 'vinyl', 'rave', 'techno', 'jungle', 'agency', 'promo']);
export function avoidTermsFromTopics(topics) {
  const terms = new Set();
  for (const t of Array.isArray(topics) ? topics : []) {
    const first = String(t || '').toLowerCase().match(/[a-z]+/);
    if (first && first[0].length >= 5 && !AVOID_TERM_SKIP.has(first[0])) terms.add(first[0]);
  }
  return [...terms].sort();
}

const round2 = (n) => Math.round(n * 100) / 100;
const byWeight = (a, b) => b.weight - a.weight || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());

/**
 * Build the two lane account sets.
 * @param {object} p
 * @param {object[]} p.tracks               normalized content tracks (tracksOf(plan))
 * @param {string}   p.benchmarkPrimary     plan.benchmarkPrimary
 * @param {string}   p.ownHandle            the owner (excluded everywhere; their following list feeds the music lane)
 * @param {Record<string,object[]>} p.corpora    lowercase model handle -> corpus rows
 * @param {Record<string,object[]>} p.following  lowercase source handle -> bird `following` users ({username,name,description})
 * @param {string[]} [p.avoidHandles]       Brain handles-to-avoid
 * @param {string[]} [p.avoidTerms]         words that disqualify an account whose bio carries them (music lane; design has no bios)
 * @param {{design:string[],music:string[]}} [p.extraModels]
 * @param {number}   [p.maxPerLane]
 * @returns {{design:{handle:string,source:string,weight:number}[], music:{handle:string,source:string,weight:number}[], meta:object}}
 */
export function buildLaneGraph({
  tracks = [], benchmarkPrimary = '', ownHandle = '', corpora = {}, following = {},
  avoidHandles = [], avoidTerms = [], extraModels = DEFAULT_EXTRA_MODELS, maxPerLane = MAX_ACCOUNTS_PER_LANE,
} = {}) {
  const models = laneModels({ tracks, benchmarkPrimary, extraModels });
  const own = keyOf(ownHandle);
  const excluded = new Set([own, ...models.design, ...models.music, ...(avoidHandles || []).map(keyOf)].filter(Boolean));
  const avoid = (avoidTerms || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  const dropped = { owner: 0, model: 0, avoidHandle: 0, avoidBio: 0, notMusicBio: 0 };
  const noteExcluded = (k) => {
    if (k === own) dropped.owner += 1;
    else if (models.design.includes(k) || models.music.includes(k)) dropped.model += 1;
    else dropped.avoidHandle += 1;
  };

  // Design: authors quoted by design models.
  const design = new Map();
  for (const model of models.design) {
    for (const [k, q] of quotedAuthors(corpora[model])) {
      if (excluded.has(k)) { noteExcluded(k); continue; }
      const cur = design.get(k) || { handle: q.handle, quotes: 0, by: new Map() };
      cur.quotes += q.quotes;
      cur.by.set(model, (cur.by.get(model) || 0) + q.quotes);
      design.set(k, cur);
    }
  }
  const designOut = [...design.values()]
    .map((d) => ({
      handle: d.handle,
      source: `quoted-by:${[...d.by].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}(${n})`).join(',')}`,
      weight: d.quotes,
    }))
    .sort(byWeight);

  // Music: accounts followed by music models / the owner whose bio looks like the scene.
  const music = new Map();
  const sources = [...models.music, ...(own ? [own] : [])];
  for (const src of sources) {
    for (const u of Array.isArray(following[src]) ? following[src] : []) {
      const handle = cleanHandle(u?.username);
      if (!HANDLE_RE.test(handle)) continue;
      const k = handle.toLowerCase();
      if (excluded.has(k)) { noteExcluded(k); continue; }
      const hits = musicBioHits(u);
      if (!hits) { dropped.notMusicBio += 1; continue; }
      const bio = `${u?.name || ''} ${u?.description || ''}`.toLowerCase();
      if (avoid.some((t) => bio.includes(t))) { dropped.avoidBio += 1; continue; }
      const cur = music.get(k) || { handle, by: new Set(), hits: 0 };
      cur.by.add(src);
      cur.hits = Math.max(cur.hits, hits);
      music.set(k, cur);
    }
  }
  const musicOut = [...music.values()]
    .map((m) => ({
      handle: m.handle,
      source: `following:${[...m.by].sort().join(',')}`,
      // lists that follow the account dominate; bio keyword hits (capped) break ties
      weight: round2(m.by.size + 0.1 * Math.min(m.hits, 5)),
    }))
    .sort(byWeight);

  return {
    design: designOut.slice(0, maxPerLane),
    music: musicOut.slice(0, maxPerLane),
    meta: {
      models,
      owner: own || null,
      found: { design: designOut.length, music: musicOut.length },
      dropped,
    },
  };
}

/** True when the stored graph is missing or older than `maxAgeMs` (default 7 days). `builtAt` is an ISO string. */
export function isLaneGraphStale(laneGraph, now = Date.now(), maxAgeMs = LANE_GRAPH_MAX_AGE_MS) {
  const t = Date.parse(laneGraph?.builtAt || '');
  return !Number.isFinite(t) || now - t >= maxAgeMs;
}

/** Stored shape for xGrowth.laneGraph (design/music trimmed to {handle,source,weight}). */
export function toStoredLaneGraph(graph, { builtAt }) {
  const trim = (list) => (list || []).map(({ handle, source, weight }) => ({ handle, source, weight }));
  return { builtAt, design: trim(graph.design), music: trim(graph.music), meta: graph.meta };
}

/** Read a stored lane graph back from raw xGrowth; absent / malformed => null. */
export function laneGraphFromXGrowth(xGrowth) {
  const g = xGrowth?.laneGraph;
  if (!g || typeof g !== 'object' || !Array.isArray(g.design) || !Array.isArray(g.music)) return null;
  return g;
}
