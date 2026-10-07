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

// ---- Event dates (printed on the flyer) -----------------------------------
// OWNER RULE: event dates come only from the flyer's printed text. Nothing
// here ever reads capturedAt, file dates or folder names. All fields are
// optional; invalid values are dropped, never coerced.
export const EVENT_YEAR_SOURCES = ['printed', 'weekday'];
const MAX_EVENT_DATES = 5;
const MAX_EVENT_CANDIDATES = 10;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb 29 is a valid printed date
const MD_RE = /^(\d{2})-(\d{2})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validMonthDay(v) {
  const m = MD_RE.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  const mo = Number(m[1]); const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS_IN_MONTH[mo - 1] ? v : null;
}
export function validEventYear(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}
export function validIsoDate(v) {
  const m = ISO_RE.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  const y = validEventYear(m[1]);
  if (y == null || !validMonthDay(`${m[2]}-${m[3]}`)) return null;
  const dt = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]) ? v : null; // rejects Feb 29 in non-leap years
}
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Strictly sanitize the event-date facets. Returns only the valid keys. */
export function sanitizeEventFacets(raw = {}) {
  const out = {};
  const eventMonthDay = validMonthDay(raw?.eventMonthDay);
  const eventDate = validIsoDate(raw?.eventDate);
  if (eventMonthDay) out.eventMonthDay = eventMonthDay;
  // An ISO date that contradicts the month-day is dropped; a lone ISO date implies its month-day.
  if (eventDate && (!eventMonthDay || eventDate.slice(5) === eventMonthDay)) {
    out.eventDate = eventDate;
    out.eventMonthDay = eventDate.slice(5);
  }
  const eventYear = validEventYear(raw?.eventYear);
  if (eventYear != null) out.eventYear = eventYear;
  if (EVENT_YEAR_SOURCES.includes(raw?.eventYearSource)) out.eventYearSource = raw.eventYearSource;
  if (Array.isArray(raw?.eventYearCandidates)) {
    const c = [...new Set(raw.eventYearCandidates.map(validEventYear).filter((y) => y != null))].sort((a, b) => a - b);
    if (c.length) out.eventYearCandidates = c.slice(0, MAX_EVENT_CANDIDATES);
  }
  const rawText = cleanText(raw?.eventDateRaw, 120);
  if (rawText) out.eventDateRaw = rawText;
  if (Array.isArray(raw?.eventDates)) {
    const list = [];
    for (const e of raw.eventDates) {
      const monthDay = validMonthDay(e?.monthDay);
      if (!monthDay) continue;
      const year = validEventYear(e?.year);
      const weekday = cleanText(e?.weekday, 12);
      list.push({
        monthDay, year,
        yearSource: year != null && EVENT_YEAR_SOURCES.includes(e?.yearSource) ? e.yearSource : null,
        raw: cleanText(e?.raw, 120),
        weekday: /^[A-Za-z.]+$/.test(weekday) ? weekday : null,
      });
      if (list.length >= MAX_EVENT_DATES) break;
    }
    if (list.length) out.eventDates = list;
  }
  return out;
}

/** Every printed event (monthDay + year|null) a facets object carries. Pure. */
export function eventPairs(f = {}) {
  const e = sanitizeEventFacets(f);
  const pairs = [];
  if (e.eventMonthDay) pairs.push({ monthDay: e.eventMonthDay, year: e.eventYear ?? (e.eventDate ? Number(e.eventDate.slice(0, 4)) : null) });
  for (const d of e.eventDates || []) pairs.push({ monthDay: d.monthDay, year: d.year });
  return pairs;
}


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
  // eventDate stays a plain string above (owner-editable); the rest are strictly validated.
  const { eventDate: _ignored, ...ev } = sanitizeEventFacets(raw);
  Object.assign(out, ev);
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
    ...eventPairs(f).flatMap((p) => [p.monthDay, p.year != null ? `${p.year}-${p.monthDay}` : null]), f.eventDate,
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
