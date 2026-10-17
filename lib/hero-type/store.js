'use client';

// Hero typography settings: the committed defaults plus, in development only, a
// browser-local draft written by the Type panel (components/home/HeroTypePanel.jsx).
// Production always renders DEFAULT_HERO_TYPE — a tuned look ships by pasting the
// panel's "Copy JSON" output over the defaults below.

export const HERO_FONTS = {
  doto: { label: 'Doto', stack: "'Doto', 'Space Mono', monospace" },
  grotesk: { label: 'Space Grotesk', stack: "'Space Grotesk', system-ui, sans-serif" },
  mono: { label: 'Space Mono', stack: "'Space Mono', monospace" },
};

// Ink choices are theme tokens, so a tuned look keeps following the active theme.
// 'white' + the difference blend is the inverting look the hero shipped with.
// 'page' resolves to the textColor prop HomePage passes in.
export const HERO_INKS = [
  { value: 'white', label: 'White (for blend)' },
  { value: 'page', label: 'Page text' },
  { value: 'var(--t-text)', label: 'Text' },
  { value: 'var(--t-text-strong)', label: 'Text strong' },
  { value: 'var(--t-text-muted)', label: 'Text muted' },
  { value: 'var(--t-accent)', label: 'Accent' },
  { value: 'var(--t-accent-bright)', label: 'Accent bright' },
  { value: 'var(--t-support-1)', label: 'Support 1' },
  { value: 'var(--t-support-2)', label: 'Support 2' },
  { value: 'var(--t-deco-1)', label: 'Deco 1' },
  { value: 'var(--t-deco-2)', label: 'Deco 2' },
  { value: 'var(--t-deco-3)', label: 'Deco 3' },
  { value: 'var(--t-deco-4)', label: 'Deco 4' },
];

export const HERO_BLENDS = ['difference', 'normal', 'exclusion', 'multiply', 'screen', 'overlay'];

export const HERO_MAX_LINES = 4;

export const DEFAULT_HERO_TYPE = {
  headlineLines: ['HUMAN', 'IN THE', 'LOOP'],
  headlineFont: 'doto',
  headlineWeight: 900,
  headlineStrokeEm: 0.03,
  headlineTrackingEm: -0.02,
  headlineLineHeight: 0.8,
  headlineBlend: 'difference',
  headlineInk: 'white',
  accentInk: '', // '' = same as headlineInk; colours the last headline line
  subPhrases: ['BRYAN BALLI', 'DIGITAL MEDIA CONSULTANT'],
  subFont: 'doto',
  subWeight: 700,
  subScale: 1,
  subOpacity: 0.85,
  subTrackingEm: -0.02,
  subInk: '', // '' = same as headlineInk
};

const DRAFT_KEY = 'hero-type:draft:v1';
const CHANGE_EVENT = 'hero-type:change';
const IS_DEV = process.env.NODE_ENV === 'development';

const cleanList = (list, max) => (Array.isArray(list)
  ? list.filter((s) => typeof s === 'string' && s.trim()).slice(0, max)
  : []);

// Merge over the defaults so a draft saved before a new key existed still applies.
export function normalizeHeroType(raw) {
  const next = { ...DEFAULT_HERO_TYPE, ...(raw && typeof raw === 'object' ? raw : {}) };
  const lines = cleanList(next.headlineLines, HERO_MAX_LINES);
  const phrases = cleanList(next.subPhrases, 12);
  next.headlineLines = lines.length ? lines : DEFAULT_HERO_TYPE.headlineLines;
  next.subPhrases = phrases.length ? phrases : DEFAULT_HERO_TYPE.subPhrases;
  if (!HERO_FONTS[next.headlineFont]) next.headlineFont = DEFAULT_HERO_TYPE.headlineFont;
  if (!HERO_FONTS[next.subFont]) next.subFont = DEFAULT_HERO_TYPE.subFont;
  return next;
}

let current = null;

export function getHeroType() {
  if (current) return current;
  let draft = null;
  if (IS_DEV && typeof window !== 'undefined') {
    try { draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  }
  current = normalizeHeroType(draft);
  return current;
}

const publish = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: current }));
};

export function setHeroType(next) {
  current = normalizeHeroType(next);
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(current)); } catch { /* storage blocked: live only */ }
  publish();
}

export function resetHeroType() {
  current = normalizeHeroType(null);
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  publish();
}

export function subscribeHeroType(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => fn(e.detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export const fontStackFor = (key) => (HERO_FONTS[key] || HERO_FONTS.doto).stack;
