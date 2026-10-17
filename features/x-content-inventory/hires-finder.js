// High-res finder: given a NAS package that is only a thumbnail / small copy, find a larger copy of the
// SAME picture elsewhere on the drive. Pure ESM, no I/O. Conservative by design: a wrong flyer is worse
// than none, so a candidate must clear an evidence gate AND a minimum score, and two flyers of the same
// series on a different date can never win.
//
// Score (0-100):
//   photo id   same Facebook photo id (a >=12-digit token in the filename)        -> 100 (exact, wins alone)
//   OCR        token Jaccard of facets.ocrText x 55          (j 0.5 = 28, 0.9 = 50)
//   date       same facets.eventDate, or an eventDates entry with the same month-day AND year   +20
//   venue      shared facets.venues entry                                          +8
//   party      shared facets.partyNames entry                                      +7
//   title      title token Jaccard x 8                                             +0..8
//   captured   capturedAt within 1 day                                             +2
// Gate (all must hold unless the photo id matches): OCR Jaccard >= 0.6, no date conflict
// (both sides carry an eventDate and they differ => rejected), and score >= MIN_SCORE.
// Candidates must also share the target's aspect ratio (within 6%) unless the photo id matches.
// Date + venue + party + title alone tops out at 43, so metadata without matching OCR text never wins.

export const MIN_SCORE = 50;
export const MIN_OCR_JACCARD = 0.6;
export const THUMB_MAX_DIM = 720;
export const MAX_ASPECT_DRIFT = 0.06; // 6% — rejects banner/square crops of the same artwork

const PHOTO_ID_RE = /\d{12,}/g;
const norm = (s) => String(s || '').toLowerCase();

/** Thumbnail-ish source: thumbnails/ dir, FB `_n.jpg` / `_s.jpg` size suffix, or <=720px. */
export function isThumbnailPath(relativePath, width) {
  const p = norm(relativePath);
  if (/(^|\/)thumbnails?\//.test(p)) return true;
  if (/_[ns]\.(jpe?g|png|webp)$/.test(p)) return true;
  const w = Number(width);
  return Number.isFinite(w) && w > 0 && w <= THUMB_MAX_DIM;
}

const basename = (p) => String(p || '').split('/').pop();
export const photoIds = (relativePath) => new Set(basename(relativePath).match(PHOTO_ID_RE) || []);

const tokenCache = new Map(); // text -> Set; bounded, keeps large-library scans linear in tokenizing work
const tokens = (s) => {
  const key = String(s || '');
  let v = tokenCache.get(key);
  if (!v) {
    if (tokenCache.size > 20000) tokenCache.clear();
    v = new Set(norm(key).split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
    tokenCache.set(key, v);
  }
  return v;
};
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
const lowerSet = (arr) => new Set((Array.isArray(arr) ? arr : []).map(norm).filter(Boolean));
const overlaps = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const dims = (p) => ({ w: Number(p?.nas?.width) || 0, h: Number(p?.nas?.height) || 0 });
const kindOf = (p) => p?.mediaState || p?.format || 'still';

function dateKeys(p) {
  const f = p?.facets || {};
  const keys = new Set();
  if (typeof f.eventDate === 'string' && f.eventDate) keys.add(f.eventDate);
  for (const d of Array.isArray(f.eventDates) ? f.eventDates : []) {
    if (d?.monthDay && d?.year) keys.add(`${d.year}-${d.monthDay}`);
  }
  return keys;
}

function dayDiff(a, b) {
  const x = Date.parse(a); const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity;
}

function scoreOne(target, cand) {
  const reasons = [];
  const tIds = photoIds(target?.nas?.relativePath);
  const cIds = photoIds(cand?.nas?.relativePath);
  if (tIds.size && overlaps(tIds, cIds)) {
    return { score: 100, reasons: ['same Facebook photo id in filename (exact)'], gate: true };
  }
  const tKeys = dateKeys(target); const cKeys = dateKeys(cand);
  const dateMatch = tKeys.size > 0 && cKeys.size > 0 && overlaps(tKeys, cKeys);
  const dateConflict = tKeys.size > 0 && cKeys.size > 0 && !dateMatch;
  const j = jaccard(tokens(target?.facets?.ocrText), tokens(cand?.facets?.ocrText));
  let score = 55 * j;
  if (j > 0) reasons.push(`OCR text overlap ${Math.round(j * 100)}%`);
  if (dateMatch) { score += 20; reasons.push('same event date'); }
  if (overlaps(lowerSet(target?.facets?.venues), lowerSet(cand?.facets?.venues))) { score += 8; reasons.push('same venue'); }
  if (overlaps(lowerSet(target?.facets?.partyNames), lowerSet(cand?.facets?.partyNames))) { score += 7; reasons.push('same party name'); }
  const tj = jaccard(tokens(target?.title), tokens(cand?.title));
  if (tj > 0) { score += 8 * tj; reasons.push(`title similarity ${Math.round(tj * 100)}%`); }
  if (dayDiff(target?.nas?.capturedAt, cand?.nas?.capturedAt) <= 1) { score += 2; reasons.push('captured within a day'); }
  const gate = j >= MIN_OCR_JACCARD && !dateConflict;
  if (dateConflict) reasons.push('different event date (rejected)');
  return { score: Math.min(99, Math.round(score)), reasons, gate };
}


/**
 * @returns {{ target:{id,width,height,isThumbnail}, candidates:Array, best:object|null }}
 */
export function findHiresCandidates(target, packages, { limit = 5 } = {}) {
  const t = dims(target);
  const tPixels = t.w * t.h;
  const isThumbnail = isThumbnailPath(target?.nas?.relativePath, t.w);
  const targetPathThumb = isThumbnailPath(target?.nas?.relativePath, 0);
  const out = { target: { id: target?.id || null, width: t.w, height: t.h, isThumbnail }, candidates: [], best: null };
  if (!target?.id || !tPixels) return out;
  const tSha = target?.nas?.sha256;
  const tKind = kindOf(target);
  const list = [];
  for (const p of Array.isArray(packages) ? packages : []) {
    if (!p || p.id === target.id || !p.nas) continue;
    if (p.clientId && target.clientId && p.clientId !== target.clientId) continue;
    if (kindOf(p) !== tKind) continue;
    if (p.rights === 'never-public') continue;
    if (tSha && p.nas.sha256 === tSha) continue; // same bytes, nothing bigger to gain
    const { w, h } = dims(p);
    const pixels = w * h;
    // Strictly larger, or (same pixels, but the target sits in a thumbnails/ path and the candidate does not).
    const sameSizeUpgrade = pixels === tPixels && targetPathThumb && !isThumbnailPath(p.nas.relativePath, 0);
    if (!(pixels > tPixels || sameSizeUpgrade)) continue;
    const s = scoreOne(target, p);
    // A different crop (cover banner, square vs portrait) is not the same file at higher resolution.
    // Only an exact photo-id match may differ in aspect ratio.
    if (s.score < 100 && Math.abs(w / h - t.w / t.h) / (t.w / t.h) > MAX_ASPECT_DRIFT) continue;
    if (!s.gate || s.score < MIN_SCORE) continue;
    list.push({
      id: p.id, width: w, height: h, pixels, score: s.score, reasons: s.reasons,
      relativePath: p.nas.relativePath || null, mediaState: p.mediaState || p.format || null, rights: p.rights || null,
    });
  }
  list.sort((a, b) => b.score - a.score || b.pixels - a.pixels || (a.id < b.id ? -1 : 1));
  out.candidates = list.slice(0, Math.max(1, limit));
  out.best = out.candidates[0] || null;
  return out;
}

