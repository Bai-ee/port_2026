// Pure logic for the Calendar Stage: level transitions, back/close semantics,
// URL param parse/serialize, client-timezone "today". No DOM, no React.

export const STAGE_LEVELS = ['month', 'day', 'post'];
export const DEFAULT_TIME_ZONE = 'America/Chicago';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function safeTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

// YYYY-MM-DD for "now" in the client's time zone (Central fallback).
export function todayInZone(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Normalise any partial state to a consistent one (never an impossible level).
export function normalizeState(input) {
  const s = input || {};
  const date = isValidDateKey(s.date) ? s.date : null;
  const postId = typeof s.postId === 'string' && s.postId ? s.postId : null;
  if (s.level === 'post' && postId) return { level: 'post', date, postId };
  if ((s.level === 'post' || s.level === 'day') && date) return { level: 'day', date, postId: null };
  return { level: 'month', date, postId: null };
}

export function stateKey(state) {
  const s = normalizeState(state);
  return `${s.level}|${s.date || ''}|${s.postId || ''}`;
}

export function sameState(a, b) {
  return stateKey(a) === stateKey(b);
}

// Query string (with leading ?) -> state, or null when no ?cal= param.
export function parseStageParams(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const cal = params.get('cal');
  if (!STAGE_LEVELS.includes(cal)) return null;
  return normalizeState({ level: cal, date: params.get('d'), postId: params.get('p') });
}

// Merge stage state into an existing query string, keeping unrelated params.
// state === null removes the stage params. Returns a string with leading ? (or '').
export function serializeStageParams(search, state) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  params.delete('cal');
  params.delete('d');
  params.delete('p');
  if (state) {
    const s = normalizeState(state);
    params.set('cal', s.level);
    if (s.date) params.set('d', s.date);
    if (s.level === 'post' && s.postId) params.set('p', s.postId);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

// Where does Back go? null means "leave the stage" (only from month).
export function backTarget(state) {
  const s = normalizeState(state);
  if (s.level === 'post') {
    return s.date
      ? { level: 'day', date: s.date, postId: null }
      : { level: 'month', date: null, postId: null };
  }
  if (s.level === 'day') return { level: 'month', date: s.date, postId: null };
  return null;
}

// Pure transition. action: {type:'openDay',date} | {type:'openPost',postId} | {type:'back'} | {type:'close'}
// Returns { state, exit }. exit=true means the stage should close.
export function transition(state, action) {
  const s = normalizeState(state);
  switch (action && action.type) {
    case 'openDay':
      if (!isValidDateKey(action.date)) return { state: s, exit: false };
      return { state: { level: 'day', date: action.date, postId: null }, exit: false };
    case 'openPost':
      if (!action.postId) return { state: s, exit: false };
      return { state: { level: 'post', date: s.date, postId: String(action.postId) }, exit: false };
    case 'back': {
      const t = backTarget(s);
      return t ? { state: t, exit: false } : { state: s, exit: true };
    }
    case 'close':
      return { state: s, exit: true };
    default:
      return { state: s, exit: false };
  }
}

const fmt = (opts, d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(d);
const dateKeyToUtc = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// Top-bar title: "October 2026" | "Today · Sat Oct 18" / "Sat Oct 18" | "Edit post".
export function levelTitle(state, { timeZone, now } = {}) {
  const s = normalizeState(state);
  if (s.level === 'post') return 'Edit post';
  const base = s.date || todayInZone(timeZone, now);
  const dt = dateKeyToUtc(base);
  if (s.level === 'month') return fmt({ month: 'long', year: 'numeric' }, dt);
  const label = fmt({ weekday: 'short', month: 'short', day: 'numeric' }, dt).replace(',', '');
  return s.date === todayInZone(timeZone, now) ? `Today · ${label}` : label;
}
