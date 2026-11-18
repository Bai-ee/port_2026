// Pure mapper for the public Tape Deck endpoint: Firestore `mixtape_reviews`
// docs in, whitelisted public records out. No I/O, no Firebase imports.

export const TAPE_DECK_LIMIT = 50;
export const TAPE_DECK_FETCH_LIMIT = 200;

// Audio is only ever served from Firebase Storage token URLs.
const AUDIO_HOSTS = /^(firebasestorage\.googleapis\.com|storage\.googleapis\.com|[a-z0-9-]+\.firebasestorage\.app)$/;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v, max = 160) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Firestore Timestamp | Date | ISO string | epoch ms -> ISO string, or null. */
export function toIso(value) {
  let d = null;
  if (value && typeof value.toDate === 'function') d = value.toDate();
  else if (value instanceof Date) d = value;
  else if (typeof value === 'string' || typeof value === 'number') d = new Date(value);
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Returns the URL when it is an https Firebase Storage URL, otherwise ''. */
export function safeAudioUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && AUDIO_HOSTS.test(u.hostname) ? u.toString() : '';
  } catch {
    return '';
  }
}

/** One doc -> public record, or null when it is not published or lacks playable audio. */
export function mapReviewDoc(id, data) {
  if (!id || !isPlainObject(data) || data.status !== 'published') return null;
  const original = safeAudioUrl(data.urls?.original);
  const restored = safeAudioUrl(data.urls?.restored);
  if (!original || !restored) return null;
  const clip = isPlainObject(data.clip) ? data.clip : {};
  const lengthS = finite(clip.lengthS);
  const cuts = isPlainObject(data.cuts) ? data.cuts : {};
  const diag = isPlainObject(data.diag) ? data.diag : {};
  const durations = isPlainObject(data.durations) ? data.durations : {};
  return {
    id: String(id),
    title: text(data.title) || text(data.tapeStem) || 'Untitled tape',
    tapeStem: text(data.tapeStem),
    publishedAt: toIso(data.publishedAt) || toIso(data.createdAt),
    durations: { originalS: finite(durations.originalS), trimmedS: finite(durations.trimmedS) },
    cuts: {
      count: finite(cuts.count),
      kinds: Array.isArray(cuts.kinds) ? cuts.kinds.map((k) => text(k, 40)).filter(Boolean).slice(0, 8) : [],
      removedS: finite(cuts.removedS),
    },
    chainLabel: text(data.chainLabel, 80),
    diag: {
      balanceDb: finite(diag.balanceDb),
      humHz: Array.isArray(diag.humHz) ? diag.humHz.map(finite).filter((n) => n !== null).slice(0, 6) : (finite(diag.humHz) !== null ? [finite(diag.humHz)] : []),
      rolloffHz: finite(diag.rolloffHz),
      lufs: finite(diag.lufs),
    },
    clip: { startS: finite(clip.startS), lengthS: lengthS && lengthS > 0 ? Math.min(lengthS, 300) : 60 },
    urls: { original, restored },
  };
}

/** Published docs -> newest first, capped. `docs` = [{ id, data }]. */
export function buildTapeDeckPayload(docs, limit = TAPE_DECK_LIMIT) {
  const reviews = (Array.isArray(docs) ? docs : [])
    .map((d) => mapReviewDoc(d?.id, d?.data))
    .filter(Boolean)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, limit);
  return { reviews };
}
