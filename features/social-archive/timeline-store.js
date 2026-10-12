// Firestore store for the social archive timeline. `db` is Firestore-like; only
// collection().doc().get/set, where('f','==',v) chains, limit, get and batch are used
// (no range queries, no arrayUnion, no orderBy).
import { slug, dayOf, isIsoDay } from './schema.js';

export const ENTRIES = 'timeline_entries';
export const DAYS = 'timeline_days';
export const ARCHIVES = 'social_archives';
const PACKAGES = 'x_content_packages';
const BATCH_MAX = 400;
const KINDS = ['post', 'media', 'event', 'story', 'reel', 'comment'];
const SNIPPET_KINDS = new Set(['post', 'story', 'reel']);

const entryDocId = (clientId, id) => `${clientId}__${id}`;
const dayDocId = (clientId, day) => `${clientId}__${day}`;
const byTs = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function commitSets(db, sets) {
  for (let i = 0; i < sets.length; i += BATCH_MAX) {
    const batch = db.batch();
    for (const [ref, data] of sets.slice(i, i + BATCH_MAX)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
}

export async function upsertEntries(db, clientId, entries) {
  const list = (entries || []).filter((e) => e?.id);
  const sets = [];
  for (let i = 0; i < list.length; i += BATCH_MAX) {
    const chunk = list.slice(i, i + BATCH_MAX);
    const snaps = await Promise.all(chunk.map((e) => db.collection(ENTRIES).doc(entryDocId(clientId, e.id)).get()));
    chunk.forEach((e, k) => {
      const prev = snaps[k].exists ? snaps[k].data() : null;
      const linked = prev?.linked?.length ? prev.linked : (e.linked || []);
      sets.push([db.collection(ENTRIES).doc(entryDocId(clientId, e.id)), { ...e, clientId, linked }]);
    });
  }
  await commitSets(db, sets);
  return { written: sets.length };
}

async function entriesForDay(db, clientId, day) {
  const snap = await db.collection(ENTRIES).where('clientId', '==', clientId).where('day', '==', day).get();
  return snap.docs.map((d) => d.data()).sort(byTs);
}

function summarizeDay(clientId, day, entries) {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const platforms = {};
  for (const e of entries) {
    if (e.kind in counts) counts[e.kind] += 1;
    platforms[e.platform] = (platforms[e.platform] || 0) + 1;
  }
  const withText = entries.filter((e) => e.text);
  const pool = [...withText.filter((e) => SNIPPET_KINDS.has(e.kind)), ...withText.filter((e) => !SNIPPET_KINDS.has(e.kind))];
  return {
    clientId, day, counts, platforms, total: entries.length,
    snippets: pool.slice(0, 5).map((e) => ({ id: e.id, platform: e.platform, kind: e.kind, text: e.text.slice(0, 90) })),
    entryIds: entries.slice(0, 200).map((e) => e.id),
  };
}

/** Recomputed from stored entries. `opts.now` (ms|Date|ISO) stamps updatedAt; an unchanged day keeps its old stamp. */
export async function rebuildDays(db, clientId, days, opts = {}) {
  const nowIso = new Date(opts.now ?? Date.now()).toISOString();
  const sets = [];
  for (const day of [...new Set(days || [])].filter(isIsoDay)) {
    const doc = summarizeDay(clientId, day, await entriesForDay(db, clientId, day));
    const ref = db.collection(DAYS).doc(dayDocId(clientId, day));
    const prev = await ref.get();
    if (prev.exists) {
      const { updatedAt, ...rest } = prev.data();
      if (JSON.stringify(rest) === JSON.stringify(doc)) continue;
    }
    sets.push([ref, { ...doc, updatedAt: nowIso }]);
  }
  await commitSets(db, sets);
  return { rebuilt: sets.length };
}

export async function getDay(db, clientId, day) {
  const entries = await entriesForDay(db, clientId, day);
  const { counts, platforms, total } = summarizeDay(clientId, day, entries);
  return { day, counts, platforms, total, entries };
}

const MAX_SPAN_DAYS = 800;
const shape = (d) => ({ day: d.day, counts: d.counts, platforms: d.platforms, total: d.total, snippets: d.snippets || [] });

export async function listDays(db, clientId, { from, to, limit = 400 } = {}) {
  if (isIsoDay(from) && isIsoDay(to)) {
    const out = [];
    const start = Date.parse(`${from}T00:00:00Z`); const end = Date.parse(`${to}T00:00:00Z`);
    const span = Math.min(Math.floor((end - start) / 86_400_000) + 1, MAX_SPAN_DAYS);
    const days = [];
    for (let i = 0; i < span; i += 1) days.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
    for (let i = 0; i < days.length && out.length < limit; i += 50) {
      const snaps = await Promise.all(days.slice(i, i + 50).map((d) => db.collection(DAYS).doc(dayDocId(clientId, d)).get()));
      for (const s of snaps) if (s.exists && s.data().total > 0 && out.length < limit) out.push(shape(s.data()));
    }
    return out;
  }
  // Open-ended: equality query on clientId, bounds applied in memory.
  const snap = await db.collection(DAYS).where('clientId', '==', clientId).get();
  return snap.docs.map((d) => d.data())
    .filter((d) => d.total > 0 && (!from || d.day >= from) && (!to || d.day <= to))
    .sort((a, b) => (a.day < b.day ? -1 : 1)).slice(0, limit).map(shape);
}

export async function searchEntries(db, clientId, { q = '', platform, account, from, to, limit = 100 } = {}) {
  const snap = await db.collection(ENTRIES).where('clientId', '==', clientId).get();
  const needle = String(q).trim().toLowerCase();
  const hay = (e) => [e.text, e.album, ...(e.hashtags || []), ...(e.mentions || [])].filter(Boolean).join('\n').toLowerCase();
  return snap.docs.map((d) => d.data())
    .filter((e) => (!platform || e.platform === platform) && (!account || e.account === account)
      && (!from || e.day >= from) && (!to || e.day <= to) && (!needle || hay(e).includes(needle)))
    .sort((a, b) => -byTs(a, b)).slice(0, limit);
}

const archiveDocId = (clientId, a) => `${clientId}__${a.platform}__${slug(a.account)}__${slug(a.archiveName)}`;

export async function saveArchive(db, clientId, archive) {
  await db.collection(ARCHIVES).doc(archiveDocId(clientId, archive)).set({ ...archive, clientId }, { merge: true });
}

export async function listArchives(db, clientId) {
  const snap = await db.collection(ARCHIVES).where('clientId', '==', clientId).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => String(b.ingestedAt || '').localeCompare(String(a.ingestedAt || '')));
}

const dateKind = (e) => (e.tsKind === 'created' ? 'posted' : e.tsKind);
const dateKey = (d) => `${d.kind}|${d.date}|${d.platform}|${d.source}`;

export async function linkEntriesToPackages(db, clientId, links, entriesById) {
  const byPkg = new Map();
  const byEntry = new Map();
  for (const l of links || []) {
    const e = entriesById?.[l.entryId] ?? (entriesById instanceof Map ? entriesById.get(l.entryId) : null);
    if (!e) continue;
    if (!byPkg.has(l.packageId)) byPkg.set(l.packageId, new Map());
    byPkg.get(l.packageId).set(e.id, e);
    if (!byEntry.has(e.id)) byEntry.set(e.id, { e, pkgs: new Set() });
    byEntry.get(e.id).pkgs.add(l.packageId);
  }
  const sets = []; let packagesUpdated = 0;
  const existing = new Set();
  for (const [packageId, emap] of [...byPkg.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const ref = db.collection(PACKAGES).doc(packageId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    existing.add(packageId);
    const prev = snap.data();
    const es = [...emap.values()].sort(byTs);
    const first = es.find((e) => e.tsKind === 'posted' || e.tsKind === 'created');
    const postIds = [...(prev.postIds || [])];
    for (const e of es) if (!postIds.includes(e.id)) postIds.push(e.id);
    const dates = [...(prev.dates || [])];
    const seen = new Set(dates.map(dateKey));
    for (const e of es) {
      const d = { kind: dateKind(e), date: e.day || dayOf(e.ts), source: e.tsSource, platform: e.platform };
      if (!seen.has(dateKey(d))) { seen.add(dateKey(d)); dates.push(d); }
    }
    const patch = { postIds: postIds.slice(0, 20), dates };
    if (first) {
      patch.post = { platform: first.platform, account: first.account, entryId: first.id, postedAt: first.ts, day: first.day, text: String(first.text || '').slice(0, 300), ...(first.album ? { album: first.album } : {}), ...(first.place ? { place: first.place } : {}) };
    }
    const changed = Object.entries(patch).some(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v));
    if (changed) { sets.push([ref, patch]); packagesUpdated += 1; }
  }
  for (const { e, pkgs } of byEntry.values()) {
    const linked = [...new Set([...(e.linked || []), ...[...pkgs].filter((p) => existing.has(p))])].sort();
    if (JSON.stringify(linked) === JSON.stringify(e.linked || [])) continue;
    sets.push([db.collection(ENTRIES).doc(entryDocId(clientId, e.id)), { linked }]);
  }
  await commitSets(db, sets);
  return { packagesUpdated };
}
