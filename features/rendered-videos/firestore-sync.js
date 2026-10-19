// Firestore + EditVideos wiring for syncRenderedVideos (sync.js), shared by the Content Engine's
// `sync-rendered-videos` action (app/api/dashboard/quote-targets/route.js) and the daily-loop cron, so a finished
// render (the 06:00 daily email video included) lands in the Dj Mix Videos bucket without anyone opening the dashboard.
//
// Rendered videos come from ONE shared EditVideos feed, owned by the NAS/archive client (NAS_INVENTORY_CLIENT_ID).
// Any other client's sync is a no-op (it would otherwise create home's renders under that client).

import { syncRenderedVideos } from './sync.js';

const PKG_COLLECTION = 'x_content_packages';

export const mediaOwnerClientId = () => process.env.NAS_INVENTORY_CLIENT_ID || null;

/**
 * @param {{ db, bridge, upsert: (pkg) => Promise<unknown>, clientId: string, force?: boolean }} opts
 *   db = Hitloop adminDb; bridge = api/_lib/editvideos-bridge.cjs (load it after touching adminDb, so the default app
 *   initializes first); upsert = that client's package upsert.
 */
export async function syncRenderedVideosForClient({ db, bridge, upsert, clientId, force = false }) {
  if (!clientId || clientId !== mediaOwnerClientId()) {
    return { ok: true, skipped: 'not-owner', created: 0, updated: 0, unchanged: 0, total: 0, lastSyncAt: null };
  }
  const metaRef = db.collection('content_buckets').doc(clientId).collection('meta').doc('rendered-videos');
  return syncRenderedVideos({
    async listVideos() {
      const videos = [];
      let cursor = null;
      let complete = false;
      for (let i = 0; i < 50; i += 1) {
        const page = await bridge.listRenderedVideos({ limit: 200, startAfter: cursor });
        videos.push(...page.videos);
        cursor = page.nextCursor;
        if (!cursor) { complete = true; break; }
      }
      return { videos, complete }; // complete only when the cursor ran out (enables retire-on-missing)
    },
    async listStored() {
      const snap = await db.collection(PKG_COLLECTION).where('clientId', '==', clientId).where('source.kind', '==', 'rendered-video').get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    },
    async listMediaJobs(jobIds) {
      const map = new Map();
      for (let i = 0; i < jobIds.length; i += 30) {
        const snap = await db.collection('media_jobs').where('editJobId', 'in', jobIds.slice(i, i + 30)).get();
        for (const d of snap.docs) { const j = d.data(); if (j.editJobId) map.set(String(j.editJobId), j); }
      }
      return map;
    },
    async readExisting(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map((id) => db.collection(PKG_COLLECTION).doc(id));
        const snaps = refs.length ? await db.getAll(...refs) : [];
        for (const snap of snaps) if (snap.exists) out.set(snap.id, { id: snap.id, ...(snap.data() || {}) });
      }
      return out;
    },
    upsert,
    async readMeta() { const s = await metaRef.get(); return s.exists ? s.data() : null; },
    async writeMeta(m) { await metaRef.set(m, { merge: true }); },
    now: () => Date.now(),
    ueArtists: [], // artists.json is a local file; sync keeps stored genres/era (see sync.js)
  }, { force });
}
