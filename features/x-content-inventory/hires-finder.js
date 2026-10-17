// STUB — replaced by FINDER at merge. Same exports and return shape as the real hires-finder.js
// (findHiresCandidates, isThumbnailPath); only the exact Facebook photo-id signal is implemented here.
// Pure ESM, no I/O.

const THUMB_PATH = /(^|\/)thumbnails?\//i;
const THUMB_NAME = /_[ns]\.(jpe?g|png|webp)$/i;
const FB_ID = /_(\d{12,})_/;

export function isThumbnailPath(relativePath, width = null) {
  const p = String(relativePath || '');
  return THUMB_PATH.test(p) || THUMB_NAME.test(p) || (Number.isFinite(Number(width)) && Number(width) > 0 && Number(width) <= 720);
}

const dims = (p) => {
  const w = Number(p?.nas?.width) || 0;
  const h = Number(p?.nas?.height) || 0;
  return { width: w, height: h, pixels: w * h };
};
const photoId = (p) => FB_ID.exec(String(p?.nas?.relativePath || '').split('/').pop())?.[1] || null;

export function findHiresCandidates(target, packages, { limit = 5 } = {}) {
  const t = dims(target);
  const isThumbnail = isThumbnailPath(target?.nas?.relativePath, t.width);
  const tid = photoId(target);
  const candidates = [];
  for (const p of packages || []) {
    if (!p?.id || p.id === target?.id || p.clientId !== target?.clientId || !p.nas?.relativePath) continue;
    if (p.rights === 'never-public' || p.mediaState !== 'still') continue;
    const d = dims(p);
    if (!(d.pixels > t.pixels || (d.pixels === t.pixels && isThumbnail))) continue;
    if (!tid || photoId(p) !== tid) continue;
    candidates.push({ id: p.id, ...d, score: 100, reasons: [`same Facebook photo id ${tid}`], relativePath: p.nas.relativePath, mediaState: p.mediaState, rights: p.rights });
  }
  candidates.sort((a, b) => b.pixels - a.pixels || String(a.id).localeCompare(String(b.id)));
  const out = candidates.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
  return { target: { id: target?.id ?? null, width: t.width, height: t.height, isThumbnail }, candidates: out, best: out[0] ?? null };
}
