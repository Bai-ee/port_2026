// Firestore reads for the public /records endpoints (server only).
import { createRequire } from 'module';
import { PACKAGE_PREFIX, DISCOGS_SOURCE } from './records-helpers.js';
import { discogsClientId } from '../discogs-ingest/service.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

const CACHE_MS = 5 * 60 * 1000;
let cache = null;

/** Discogs packages + discogs-ingest posts, cached ~5 min per server instance. */
export async function loadRecordsSource() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const db = fb.adminDb;
  const [pkgSnap, postSnap] = await Promise.all([
    db.collection('x_content_packages')
      .where('__name__', '>=', PACKAGE_PREFIX)
      .where('__name__', '<', `${PACKAGE_PREFIX}`)
      .limit(2000).get(),
    db.collection('social_posts').where('source', '==', DISCOGS_SOURCE).limit(2000).get(),
  ]);
  // The public records page is the Discogs client's catalog only (filtered in memory: no extra index).
  const owner = discogsClientId();
  const data = {
    packages: pkgSnap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((p) => p.clientId === owner),
    posts: postSnap.docs.map((d) => d.data()).filter((p) => p.clientId === owner),
  };
  cache = { at: Date.now(), data };
  return data;
}
