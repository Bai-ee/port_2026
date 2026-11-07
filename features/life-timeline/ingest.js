// Worker -> HITLOOP ingest for the Life Timeline. deps are injected (see http.js for the real wiring).
import { badRelPath, buildMonthPacks, sanitizeLifeItem, toMediaDoc } from './schema.js';

export const MAX_ITEMS = 100;
export const MAX_UPLOAD_ITEMS = 200;
export const MAX_THUMB_BYTES = 10 * 1024 * 1024;
const SRC_ID_RE = /^[a-z0-9-]{1,80}$/;
const SRC_KINDS = ['photos', 'iphoto'];
const SHA_RE = /^[0-9a-f]{64}$/;

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const s = (v) => (typeof v === 'string' ? v.trim() : '');

export function validateSource(src) {
  const id = s(src?.id);
  const kind = s(src?.kind);
  const label = s(src?.label).slice(0, 200);
  const libraryPath = s(src?.libraryPath);
  if (!SRC_ID_RE.test(id)) throw bad('source.id must match ^[a-z0-9-]{1,80}$.');
  if (!SRC_KINDS.includes(kind)) throw bad(`source.kind must be one of ${SRC_KINDS.join(', ')}.`);
  if (!label) throw bad('source.label is required.');
  if (badRelPath(libraryPath)) throw bad('source.libraryPath must be share-relative (no leading /, no .., no Volumes).');
  return { id, kind, label, libraryPath };
}

export async function ingestLifeResults(deps, body) {
  const source = validateSource(body?.source);
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw bad(`items must be an array of 1..${MAX_ITEMS}.`);
  const nowIso = new Date((deps.now ? deps.now() : Date.now())).toISOString();

  const skipped = [];
  const clean = new Map(); // dedupe by id inside the push; last wins
  for (const raw of items) {
    const r = sanitizeLifeItem(raw);
    if (!r.ok) skipped.push({ id: typeof raw?.id === 'string' ? raw.id : null, reason: r.reason });
    else clean.set(r.item.id, r.item);
  }

  const existing = await deps.getMedia([...clean.keys()]);
  const touched = new Set();
  const docs = [];
  for (const item of clean.values()) {
    const prev = existing.get(item.id) || null;
    const doc = toMediaDoc(item, prev, nowIso, source.id);
    if (prev?.ym && prev.ym !== doc.ym) touched.add(prev.ym);
    touched.add(doc.ym);
    docs.push(doc);
  }
  if (docs.length) await deps.putMedia(docs);

  for (const ym of touched) {
    const all = await deps.listMediaByMonth(ym);
    const { monthDoc, partDocs } = buildMonthPacks(ym, all, nowIso);
    await deps.writeMonth(ym, monthDoc, partDocs);
  }
  const itemCount = await deps.countBySource(source.id);
  await deps.upsertSource(source, itemCount);
  return { ok: true, upserted: docs.length, skipped, months: [...touched].sort() };
}

export async function lifeUploadUrls(deps, body) {
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_UPLOAD_ITEMS) throw bad(`items must be an array of 1..${MAX_UPLOAD_ITEMS}.`);
  for (const it of items) {
    if (!SHA_RE.test(s(it?.sha256))) throw bad('sha256 must be 64 lowercase hex chars.');
    if (it.variant !== 's' && it.variant !== 'm') throw bad("variant must be 's' or 'm'.");
    if (s(it.contentType).toLowerCase() !== 'image/jpeg') throw bad('contentType must be image/jpeg.');
    const size = Number(it.sizeBytes);
    if (!Number.isFinite(size) || size < 1 || size > MAX_THUMB_BYTES) throw bad(`sizeBytes must be 1..${MAX_THUMB_BYTES}.`);
  }
  const urls = [];
  for (const it of items) {
    const sha256 = s(it.sha256);
    const storagePath = `life-thumbs/${sha256.slice(0, 16)}_${it.variant}.jpg`;
    const uploadUrl = await deps.signUpload({ storagePath, contentType: 'image/jpeg' });
    // Lowercase header key on purpose (see x-content-inventory/nas.js).
    urls.push({ sha256, variant: it.variant, storagePath, uploadUrl, headers: { 'content-type': 'image/jpeg' } });
  }
  return { urls };
}
