// Life Timeline schema helpers (pure). Contract: ./CONTRACT.md (FROZEN v1).

export const MONTH_PART_MAX = 1500;
export const MEDIA_SCHEMA = 'life.media/1';

const SHA_RE = /^[0-9a-f]{64}$/;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const TZ_RE = /^[+-]\d{2}:\d{2}$/;
const KINDS = ['image', 'video'];
const TS_SOURCES = ['library-db', 'exif', 'quicktime'];
const TS_KINDS = ['exact', 'local-only', 'unknown'];
const CANON_PREFIX = 'HITLOOP-ARCHIVE/timeline/';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v, maxItems, maxLen) => (Array.isArray(v)
  ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems)
  : []);

export function badRelPath(p) {
  return typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..') || /(^|\/)Volumes(\/|$)/.test(p);
}

export function monthKey(takenLocal) {
  return typeof takenLocal === 'string' && LOCAL_RE.test(takenLocal) ? takenLocal.slice(0, 7) : 'unknown';
}

export function dayKey(takenLocal) {
  return typeof takenLocal === 'string' && LOCAL_RE.test(takenLocal) ? takenLocal.slice(0, 10) : null;
}

const fail = (reason) => ({ ok: false, reason });

export function sanitizeLifeItem(raw) {
  if (!raw || typeof raw !== 'object') return fail('not-an-object');
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256 : '';
  if (!SHA_RE.test(sha256)) return fail('bad-sha256');
  const id = sha256.slice(0, 16);
  if (raw.id !== id) return fail('id-mismatch');
  if (!KINDS.includes(raw.kind)) return fail('bad-kind');

  let takenLocal = null;
  if (raw.takenLocal != null) {
    if (typeof raw.takenLocal !== 'string' || !LOCAL_RE.test(raw.takenLocal)) return fail('bad-takenLocal');
    takenLocal = raw.takenLocal;
  }
  let tz = null;
  if (raw.tz != null) {
    if (typeof raw.tz !== 'string' || !TZ_RE.test(raw.tz)) return fail('bad-tz');
    tz = raw.tz;
  }
  let gps = null;
  if (raw.gps != null) {
    const lat = num(raw.gps?.lat);
    const lon = num(raw.gps?.lon);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return fail('bad-gps');
    gps = { lat, lon };
  }
  let thumbs = null;
  if (raw.thumbs != null) {
    if (raw.thumbs.s !== `life-thumbs/${id}_s.jpg` || raw.thumbs.m !== `life-thumbs/${id}_m.jpg`) return fail('thumbs-path-mismatch');
    thumbs = { s: raw.thumbs.s, m: raw.thumbs.m };
  }
  const canonicalPath = typeof raw.canonicalPath === 'string' ? raw.canonicalPath.trim() : '';
  if (!canonicalPath.startsWith(CANON_PREFIX) || canonicalPath.includes('..')) return fail('bad-canonicalPath');

  const locRaw = Array.isArray(raw.locations) ? raw.locations : [];
  if (locRaw.length > 50) return fail('too-many-locations');
  const locations = [];
  for (const l of locRaw) {
    const relativePath = typeof l?.relativePath === 'string' ? l.relativePath : '';
    if (badRelPath(relativePath)) return fail('bad-relativePath');
    locations.push({
      sourceId: str(l.sourceId, 80),
      relativePath,
      originalFileName: str(l.originalFileName, 300),
    });
  }
  if (Array.isArray(raw.albums) && raw.albums.length > 100) return fail('too-many-albums');
  if (Array.isArray(raw.keywords) && raw.keywords.length > 200) return fail('too-many-keywords');

  const item = {
    id,
    sha256,
    kind: raw.kind,
    ext: str(raw.ext, 12).toLowerCase(),
    width: num(raw.width) ?? 0,
    height: num(raw.height) ?? 0,
    durationSec: num(raw.durationSec),
    takenLocal,
    tz,
    tsUtc: typeof raw.tsUtc === 'string' && !Number.isNaN(Date.parse(raw.tsUtc)) ? raw.tsUtc : null,
    tsSource: TS_SOURCES.includes(raw.tsSource) ? raw.tsSource : null,
    tsKind: TS_KINDS.includes(raw.tsKind) ? raw.tsKind : 'unknown',
    gps,
    albums: strList(raw.albums, 100, 200),
    favorite: raw.favorite === true,
    hidden: raw.hidden === true,
    title: str(raw.title, 300),
    description: str(raw.description, 2000),
    keywords: strList(raw.keywords, 200, 200),
    camera: raw.camera && typeof raw.camera === 'object'
      ? { make: str(raw.camera.make, 100), model: str(raw.camera.model, 100) } : null,
    motion: raw.motion && SHA_RE.test(raw.motion.sha256 || '')
      ? { sha256: raw.motion.sha256, durationSec: num(raw.motion.durationSec) } : null,
    edited: raw.edited && SHA_RE.test(raw.edited.sha256 || '') ? { sha256: raw.edited.sha256 } : null,
    thumbs,
    canonicalPath,
    locations,
  };
  return { ok: true, item };
}

/** Merge a sanitized item into a stored doc (or null). Merges locations/sourceIds/albums; rest = latest push. */
export function toMediaDoc(item, existing, nowIso, sourceId) {
  const prev = existing || null;
  const locations = [];
  const seen = new Set();
  const pushLoc = (l) => {
    const key = `${l.sourceId}\u0000${l.relativePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    locations.push(l);
  };
  (prev?.locations || []).forEach(pushLoc);
  (item.locations || []).forEach((l) => pushLoc({ ...l, sourceId: l.sourceId || sourceId || '' }));
  const sourceIds = [...new Set([...(prev?.sourceIds || []), ...(sourceId ? [sourceId] : [])])];
  const albums = [...new Set([...(prev?.albums || []), ...(item.albums || [])])];
  return {
    ...item,
    schema: MEDIA_SCHEMA,
    albums,
    locations,
    sourceIds,
    ym: monthKey(item.takenLocal),
    day: dayKey(item.takenLocal),
    createdAt: prev?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function monthEntry(doc) {
  return {
    id: doc.id,
    t: doc.takenLocal || null,
    k: doc.kind === 'video' ? 'v' : 'i',
    w: doc.width || 0,
    h: doc.height || 0,
    m: !!doc.motion,
    d: doc.durationSec ?? null,
  };
}

const cmp = (a, b) => {
  const ta = a.t ?? '';
  const tb = b.t ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function buildMonthPacks(ym, mediaDocs, nowIso = new Date().toISOString()) {
  const entries = (mediaDocs || []).map(monthEntry).sort(cmp);
  const chunks = [];
  for (let i = 0; i < entries.length; i += MONTH_PART_MAX) chunks.push(entries.slice(i, i + MONTH_PART_MAX));
  if (!chunks.length) chunks.push([]);
  const monthDoc = { ym, count: entries.length, partCount: chunks.length, items: chunks[0], updatedAt: nowIso };
  const partDocs = chunks.slice(1).map((items, i) => ({ ym, part: i + 1, items }));
  return { monthDoc, partDocs };
}
