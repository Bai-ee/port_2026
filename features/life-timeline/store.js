// Firestore access for the Life Timeline. db is injectable (default = Admin SDK, loaded lazily).
import { createRequire } from 'node:module';

const BATCH = 400;
let defaultDb = null;
function getDb(db) {
  if (db) return db;
  if (!defaultDb) {
    const require = createRequire(import.meta.url);
    defaultDb = require('../../api/_lib/firebase-admin.cjs').adminDb;
  }
  return defaultDb;
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function getMedia(ids, db) {
  const d = getDb(db);
  const out = new Map();
  for (const part of chunk([...new Set(ids)], 300)) {
    const snaps = await d.getAll(...part.map((id) => d.collection('life_media').doc(id)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.data());
  }
  return out;
}

export async function putMedia(docs, db) {
  const d = getDb(db);
  for (const part of chunk(docs, BATCH)) {
    const batch = d.batch();
    for (const doc of part) batch.set(d.collection('life_media').doc(doc.id), doc);
    await batch.commit();
  }
}

export async function listMediaByMonth(ym, db) {
  const snap = await getDb(db).collection('life_media').where('ym', '==', ym).get();
  return snap.docs.map((s) => s.data());
}

export async function writeMonth(ym, monthDoc, partDocs, db) {
  const d = getDb(db);
  const batch = d.batch();
  batch.set(d.collection('life_months').doc(ym), monthDoc);
  for (const p of partDocs) batch.set(d.collection('life_month_parts').doc(`${ym}_${p.part}`), p);
  // Drop stale parts left over from a previously larger month.
  for (let n = monthDoc.partCount; n < monthDoc.partCount + 50; n += 1) {
    const ref = d.collection('life_month_parts').doc(`${ym}_${n}`);
    const s = await ref.get();
    if (!s.exists) break;
    batch.delete(ref);
  }
  await batch.commit();
}

export async function readMonth(ym, db) {
  const d = getDb(db);
  const s = await d.collection('life_months').doc(ym).get();
  if (!s.exists) return null;
  const month = s.data();
  const items = [...(month.items || [])];
  for (let n = 1; n < (month.partCount || 1); n += 1) {
    const p = await d.collection('life_month_parts').doc(`${ym}_${n}`).get();
    if (p.exists) items.push(...(p.data().items || []));
  }
  return { ...month, items };
}

export async function listMonths(db) {
  const snap = await getDb(db).collection('life_months').select('ym', 'count', 'partCount').get();
  return snap.docs.map((s) => s.data());
}

export async function getItem(id, db) {
  const s = await getDb(db).collection('life_media').doc(id).get();
  return s.exists ? s.data() : null;
}

export async function countBySource(sourceId, db) {
  const q = getDb(db).collection('life_media').where('sourceIds', 'array-contains', sourceId).count();
  const snap = await q.get();
  return snap.data().count;
}

export async function upsertSource(src, itemCount, db, nowIso = new Date().toISOString()) {
  await getDb(db).collection('life_sources').doc(src.id).set({
    id: src.id, kind: src.kind, label: src.label, libraryPath: src.libraryPath, itemCount, lastPushAt: nowIso,
  }, { merge: true });
}

// Heartbeat status doc (public read; see CONTRACT.md "Status").
export async function writeStatus(status, db, receivedAt = new Date().toISOString()) {
  await getDb(db).collection('life_status').doc('current').set({ ...status, receivedAt });
}

export async function readStatus(db) {
  const s = await getDb(db).collection('life_status').doc('current').get();
  return s.exists ? s.data() : null;
}
