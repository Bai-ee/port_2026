// Pure port of generate() in hitloop-video-showcase/bin/showcase.mjs: seeded (FNV-1a32 -> mulberry32) pick of three
// focuses, skipping the most recent renders. No I/O: the caller supplies the focus file, the date and the recent ids.

export const SHOWCASE_OPTION_COUNT = 3;
export const SHOWCASE_RECENT_WINDOW = 3;
export const SHOWCASE_SHUFFLE_MAX = 20;

export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `shuffle` counts only as an integer 1-20; anything else is "no shuffle". */
export function normalizeShuffle(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= SHOWCASE_SHUFFLE_MAX ? n : 0;
}

export function utcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * @param {{focusFile:{focuses:Array}, videoClient:string, date:string, shuffle?:number, recentFocusIds?:string[]}} input
 *   recentFocusIds is newest first (the focuses of the last 3 'done' jobs).
 * @returns {Array<{n:number, focusId:string, title:string, caption:string, format:string, kinds:string[]}>}
 */
export function generateOptions({ focusFile, videoClient, date, shuffle = 0, recentFocusIds = [] }) {
  const recent = [];
  for (const id of recentFocusIds) {
    if (id && !recent.includes(id)) recent.push(id);
    if (recent.length >= SHOWCASE_RECENT_WINDOW) break;
  }
  let eligible = focusFile.focuses.filter((f) => !recent.includes(f.id));
  const excluded = [...recent];
  while (eligible.length < SHOWCASE_OPTION_COUNT && excluded.length) {
    const back = excluded.pop(); // oldest excluded is re-admitted first
    const f = focusFile.focuses.find((x) => x.id === back);
    if (f) eligible.push(f);
  }
  eligible = [...eligible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = normalizeShuffle(shuffle);
  const rng = mulberry32(fnv1a32(`${videoClient}:${date}${n ? `#${n}` : ''}`));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, SHOWCASE_OPTION_COUNT).map((f, i) => ({
    n: i + 1,
    focusId: f.id,
    title: f.title,
    caption: f.caption,
    format: f.formats[Math.floor(rng() * f.formats.length)],
    kinds: f.scenes.map((s) => s.kind),
  }));
}
