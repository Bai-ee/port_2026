// Facets v1 — the metadata every content item carries so the daily scan can
// match it to what is happening on X (Content Engine v2 master plan §4).
//
// WHY THIS EXISTS: matching a viral post to "something I own" only works if
// every item — a record, a rendered mix, a 1997 flyer — describes itself in
// one shared vocabulary: who, where, when, what gear, what sound, what vibe.
// Extraction happens once per item (cached); the owner's edits always win.
//
// Pure data + pure helpers. No fs, no network, no clock.

export const FACET_FIELDS = {
  // arrays of lowercase strings
  people: 'array', crews: 'array', labels: 'array', venues: 'array', cities: 'array',
  partyNames: 'array', gear: 'array', genres: 'array',
  // everyone credited on the item beyond the headline people (remixers,
  // producers, featured artists — Discogs extraartists / tracklist credits)
  credits: 'array', catalogNumbers: 'array',
  // scalars
  dateText: 'string', eventDate: 'string', eraYear: 'number', decade: 'string',
  ocrText: 'string', storySuggestion: 'string',
  vibe: 'object',
};

export const VIBE = {
  light: ['dark', 'light'],
  time: ['night', 'day'],
  kind: ['flyer', 'party-photo', 'performance', 'gear', 'portrait', 'crowd', 'record', 'video', 'screenshot', 'other'],
};

export const FACET_VERSION = 1;

/** Canonical gear spellings — the alias table seeds from this. */
export const GEAR_ALIASES = {
  'tr-909': ['909', 'tr909', 'tr 909', 'roland 909', 'roland tr-909'],
  'tr-808': ['808', 'tr808', 'tr 808', 'roland 808', 'roland tr-808'],
  'tb-303': ['303', 'tb303', 'tb 303', 'roland 303', 'roland tb-303'],
  'tr-707': ['707', 'tr707', 'roland 707'],
  'sp-1200': ['sp1200', 'sp 1200', 'emu sp-1200'],
  'mpc': ['akai mpc', 'mpc60', 'mpc 60', 'mpc2000'],
};

export function normalizeTerm(v) {
  return String(v ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const GEAR_LOOKUP = (() => {
  const m = new Map();
  for (const [canon, aliases] of Object.entries(GEAR_ALIASES)) {
    m.set(canon, canon);
    for (const a of aliases) m.set(normalizeTerm(a), canon);
  }
  return m;
})();

export function canonicalGear(v) {
  const t = normalizeTerm(v);
  return GEAR_LOOKUP.get(t) || t;
}

/** Normalize a raw facets object: lowercase/dedupe arrays, canonical gear,
 * drop unknown fields, validate vibe enums. Never throws. */
export function normalizeFacets(raw = {}) {
  const out = {};
  for (const [field, type] of Object.entries(FACET_FIELDS)) {
    const v = raw?.[field];
    if (v == null) continue;
    if (type === 'array' && Array.isArray(v)) {
      const list = [];
      for (const x of v) {
        const t = field === 'gear' ? canonicalGear(x) : normalizeTerm(x);
        if (t && !list.includes(t)) list.push(t);
      }
      if (list.length) out[field] = list;
    } else if (type === 'string' && typeof v === 'string' && v.trim()) {
      out[field] = v.trim();
    } else if (type === 'number' && Number.isFinite(Number(v))) {
      out[field] = Number(v);
    } else if (type === 'object' && field === 'vibe' && typeof v === 'object') {
      const vibe = {};
      for (const [k, allowed] of Object.entries(VIBE)) if (allowed.includes(v[k])) vibe[k] = v[k];
      if (Array.isArray(v.mood)) vibe.mood = [...new Set(v.mood.map(normalizeTerm).filter(Boolean))];
      if (Object.keys(vibe).length) out.vibe = vibe;
    }
  }
  if (out.eraYear && !out.decade) out.decade = `${Math.floor(out.eraYear / 10) * 10}s`;
  return out;
}

/** Owner edits win field-by-field over extracted facets. */
export function effectiveFacets(item = {}) {
  return normalizeFacets({ ...(item.facets || {}), ...(item.humanEdits || {}) });
}

/** Lowercase search tokens from title, story and every facet value. */
export function buildSearchTokens(item = {}) {
  const f = effectiveFacets(item);
  const parts = [item.title, item.story, f.ocrText, f.dateText, f.decade, f.eraYear,
    ...['people', 'credits', 'crews', 'labels', 'catalogNumbers', 'venues', 'cities', 'partyNames', 'gear', 'genres'].flatMap((k) => f[k] || []),
    // Legacy rows (pre-facets) still carry artist/label in `entities` — search them too.
    ...(Array.isArray(item.entities) ? item.entities : []),
    f.vibe?.light, f.vibe?.time, f.vibe?.kind, ...(f.vibe?.mood || []), ...(item.tags || [])];
  const tokens = new Set();
  for (const p of parts) {
    for (const w of normalizeTerm(p).split(/[^\p{L}\p{N}-]+/u)) if (w.length >= 2) tokens.add(w);
  }
  return [...tokens];
}
