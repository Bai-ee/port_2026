// The owner's brand vocabulary and fit: profile built from eligible library items,
// discovery queries, and the four-check brand fit of a narrative.
// Decides "is this conversation about things the owner holds"; never picks content or copy.
// Depends on text.js only (plus the pillar list and content guard lane).

import { resolveEngine } from '../engines.js';
import { tracksOf, trackForEngine } from '../../x-strategy/content-tracks.js';
import { PILLARS } from '../categories.js';
import { classifyLane } from '../../x-content-guard/index.js';
import { tokenize, arrayValues, FACET_ARRAYS, ownerTags, packagePhrases, phraseHits, WEAK_TERMS, GENERIC_PHRASES } from './text.js';

// --- where brand fit applies ---------------------------------------------------

/**
 * Library-vocabulary fit asks "is this conversation about things the owner holds",
 * which only matters when the post JOINS a conversation: replies, and originals
 * that are linked to one. Quote-react (vein/lane fit), showcase/text (owned
 * content) and self-quote (own corpus) are never gated by it.
 */
export function brandFitApplies(slotType, { conversationLinked = false } = {}) {
  if (slotType === 'reply') return true;
  return conversationLinked && (slotType === 'original-showcase' || slotType === 'original-text');
}

// --- brand profile -------------------------------------------------------------

/**
 * The owner's topical vocabulary, derived from what they actually hold (eligible
 * library facets) plus their own pillar descriptions, plus the approved Brain's
 * words when there is one. Weighted by how much of the library speaks to a term,
 * so one stray record cannot make a whole genre "on brand".
 */
export function buildBrandProfile({ packages = [], brain = null } = {}) {
  const counts = new Map();
  const phrases = new Map();
  for (const pkg of packages) {
    const seen = new Set();
    const f = pkg.facets && typeof pkg.facets === 'object' ? pkg.facets : {};
    for (const s of [...ownerTags(pkg), ...arrayValues(pkg.entities), ...FACET_ARRAYS.flatMap((k) => arrayValues(f[k]))]) {
      for (const t of tokenize(s)) seen.add(t);
    }
    for (const t of seen) counts.set(t, (counts.get(t) || 0) + 1);
    for (const [ph, meta] of packagePhrases(pkg)) {
      const prev = phrases.get(ph);
      phrases.set(ph, { ...meta, weight: Math.max(prev?.weight || 0, meta.weight), items: (prev?.items || 0) + 1 });
    }
  }
  const terms = new Map();
  for (const [t, n] of counts) terms.set(t, Math.min(3, 1 + Math.log10(n)));
  const pillarTerms = new Set(Object.values(PILLARS).flatMap(tokenize));
  for (const t of pillarTerms) if (!terms.has(t)) terms.set(t, 0.5);
  if (brain?.status === 'approved') {
    for (const t of tokenize(brain.context || '')) if (!terms.has(t)) terms.set(t, 1);
  }
  return {
    terms,
    phrases,
    sources: {
      library: `${packages.length} eligible item(s), ${phrases.size} distinctive phrases`,
      pillars: 'features/x-content-inventory/categories.js PILLARS',
      brain: brain?.status === 'approved' ? 'approved Client Brain' : `not used (Brain is ${brain?.status || 'missing'})`,
    },
  };
}

/**
 * Free, local search queries for the owner's most distinctive library topics:
 * whole phrases (labels, artists, multi-word genres, cities), ranked by how
 * many owned items carry them. Not single tokens.
 */
export function discoveryQueries(packages = [], { limit = 6, minFaves = 20, sinceDate = null, contentTracks = null } = {}) {
  // The owner-artist name ("bai-ee") is blanket-excluded from discovery, except for items inside the music track.
  const musicEngines = new Set(trackForEngine(contentTracks || tracksOf(null), 'ue')?.engines || []);
  const ownerMusicTrack = (pkg) => musicEngines.has(resolveEngine(pkg));
  const counts = new Map();
  for (const pkg of packages) {
    const f = pkg.facets && typeof pkg.facets === 'object' ? pkg.facets : {};
    const phrases = new Set([
      ...arrayValues(f.labels), ...arrayValues(f.people), ...arrayValues(f.cities), ...arrayValues(f.partyNames),
      ...arrayValues(f.genres).filter((g) => /\s/.test(g)),
    ].map((s) => s.toLowerCase().replace(/\s+records?$|\s+recordings$|\s+music$/, '').trim())
      .filter((s) => s.length >= 4 && !GENERIC_PHRASES.has(s) && !(/^bai-?ee$/.test(s) && !ownerMusicTrack(pkg))));
    for (const p of phrases) counts.set(p, (counts.get(p) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, n]) => ({ term, items: n, query: `"${term}" min_faves:${minFaves} -filter:replies${sinceDate ? ` since:${sinceDate}` : ''}` }));
}

/**
 * Brand fit of a narrative. Needs a library PHRASE (artist, label, title,
 * multi-word genre, …) or at least two distinctive library terms — a broad
 * word like "music" or "house" alone never qualifies — and a lane outside
 * casino/politics.
 */
export function brandFit(narrative, profile) {
  const lane = classifyLane(narrative.text);
  const phrases = phraseHits(narrative.text, profile.phrases || new Map());
  const terms = [];
  let tokenWeight = 0;
  for (const t of new Set(tokenize(narrative.text))) {
    const w = profile.terms.get(t);
    if (w && w >= 1.5 && !WEAK_TERMS.has(t)) { terms.push(t); tokenWeight += w; }
  }
  // A held genre weighs by how much of the library backs it (9 deep-house records > 1).
  const phraseWeight = phrases.reduce((n, p) => n + (p.kind === 'genre' && (p.items || 0) >= 3 ? 1.5 * Math.min(2, p.items / 3) : p.weight), 0);
  // An anchor phrase (a specific artist/label/name) qualifies on its own; a
  // genre or common-word phrase needs two distinctive library terms with it.
  const anchored = phrases.some((p) => p.anchor);
  // A genre the owner demonstrably holds (≥3 eligible items) is on-brand.
  const heldGenre = phrases.some((p) => p.kind === 'genre' && (p.items || 0) >= 3);
  const qualifies = anchored || heldGenre || (phrases.length > 0 && terms.length >= 2) || terms.length >= 3;
  const blockedLane = lane.lane === 'casino' || lane.lane === 'politics';
  // Image-only posts (just a t.co link) have nothing to judge; say so instead
  // of the misleading "only broad words".
  const noText = tokenize(narrative.text).length === 0 && !phrases.length;
  const score = blockedLane || !qualifies ? 0 : Math.min(1, (phraseWeight + 0.5 * tokenWeight) / 6);
  return {
    score: Number(score.toFixed(3)),
    phrases: phrases.map((p) => `${p.phrase} (${p.kind}${p.anchor ? '' : ', supporting'})`),
    terms: terms.sort(),
    lane: lane.lane,
    laneConfidence: lane.confidence,
    blockedLane,
    anchored,
    reason: blockedLane ? `${lane.lane} lane` : noText ? 'no text to assess' : !qualifies ? (phrases.length ? `only ambiguous phrases (${phrases.map((p) => p.phrase).join(', ')})` : 'no library phrase, only broad words') : null,
  };
}
