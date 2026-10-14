// Test fixture: a valid two-track list (design + music) covering every engine. This is the shape the home client
// stores in its own plan doc (scripts/x-content/seed-home-priors.mjs HOME_CONTENT_TRACKS). Code has NO default tracks;
// tests that need tracks pass this explicitly.

export const TWO_TRACKS = Object.freeze([
  Object.freeze({
    id: 'design', label: 'Design & client work', engines: Object.freeze(['client', 'identity']),
    benchmarks: Object.freeze(['seb__design']), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([Object.freeze({ id: 'client', label: 'Client work', engine: 'client', url: null, weeklyTarget: 2 })]),
  }),
  Object.freeze({
    id: 'music', label: 'Music (UE mixes, Discogs)', engines: Object.freeze(['ue', 'record']),
    benchmarks: Object.freeze([]), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([
      Object.freeze({ id: 'ue', label: 'Underground Existence', engine: 'ue', url: null, weeklyTarget: 3 }),
      Object.freeze({ id: 'discogs', label: 'Discogs store', engine: 'record', url: null, weeklyTarget: 3 }),
    ]),
  }),
]);

/** Mutable deep copy. */
export const twoTracks = () => JSON.parse(JSON.stringify(TWO_TRACKS));

/** A plan doc carrying the two tracks. */
export const twoTrackPlan = (extra = {}) => ({ plan: { contentTracks: twoTracks(), ...extra } });
