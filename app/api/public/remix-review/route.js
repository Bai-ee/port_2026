// PUBLIC Remix review API (owner decision 2026-11-18): anyone may list rendered videos and approve/reject them.
// Backs /dashboard/studio?tool=remix&view=review, which must work signed out.
//
// SCOPE: acts ONLY on the media-owner client's rendered-video (rv-) packages (mediaOwnerClientId()). Writable:
// `curation` + `updatedAt` of one rv- doc, nothing else (setCuration). Media: signed thumb/video URLs for rv- ids owned
// by the media owner. `by` = the signed-in email when a valid Bearer token is sent, else 'public'.
//
//   POST {action:'list', days?}            -> curation-list result
//   POST {action:'set', id, state}         -> {ok, id, curation}
//   POST {action:'media', ids[], kinds[]}  -> {ok, urls}
// Not configured (no media owner) -> {ok:true, skipped:'not-configured'}.
import { createRequire } from 'module';
import { listCurationCandidates, setCuration } from '../../../../features/rendered-videos/curation.js';
import { mediaOwnerClientId } from '../../../../features/rendered-videos/firestore-sync.js';
import { parseReviewRequest, ownedReviewPackages, publicizeReviewResult, REVIEW_PUBLIC_BY } from '../../../../features/rendered-videos/public-review.js';
import { resolveMediaUrlsBatch } from '../../../../features/x-content-inventory/thumbs.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PKG_COLLECTION = 'x_content_packages';
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const LIMITS = { list: 60, set: 600, media: 600 }; // per IP per hour

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/** Signed-in email when a valid Bearer token is present; anything else is a public visitor. */
async function voterOf(request) {
  const auth = request.headers.get('authorization');
  if (!auth) return REVIEW_PUBLIC_BY;
  try {
    const decoded = await verifyRequestUser({ headers: { authorization: auth, Authorization: auth } });
    return decoded?.email || decoded?.uid || REVIEW_PUBLIC_BY;
  } catch {
    return REVIEW_PUBLIC_BY;
  }
}

async function listFor(ownerId, { days }) {
  const snap = await fb.adminDb.collection(PKG_COLLECTION).where('clientId', '==', ownerId).where('source.kind', '==', 'rendered-video').get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return { ok: true, ...listCurationCandidates(rows, { days, now: Date.now() }) };
}

async function setFor(ownerId, request, { id, state }) {
  const ref = (docId) => fb.adminDb.collection(PKG_COLLECTION).doc(docId);
  return setCuration({
    getDoc: async (docId) => { const s = await ref(docId).get(); return s.exists ? (s.data() || {}) : null; },
    mergeDoc: (docId, patch) => ref(docId).set(patch, { merge: true }),
    deleteField: () => fb.FieldValue.delete(),
  }, { clientId: ownerId, id, state, by: await voterOf(request), now: Date.now() });
}

async function mediaFor(ownerId, { ids, kinds }) {
  void fb.adminDb; // initialize the default app before the EditVideos bridge app
  const bridge = require('../../../../api/_lib/editvideos-bridge.cjs');
  const snaps = await fb.adminDb.getAll(...ids.map((id) => fb.adminDb.collection(PKG_COLLECTION).doc(id)));
  const stored = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...(s.data() || {}) }));
  const urls = await resolveMediaUrlsBatch(ownedReviewPackages(stored, ownerId), kinds, {
    hitloopBucket: fb.adminStorage.bucket(),
    signEv: (p) => bridge.signReadUrl(p),
  });
  return { ok: true, urls };
}


export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  let req;
  try {
    req = parseReviewRequest(body);
  } catch (err) {
    return json({ error: err.message }, err.status || 400);
  }
  try {
    const ownerId = mediaOwnerClientId();
    if (!ownerId) return json({ ok: true, skipped: 'not-configured' });
    const limit = await checkRateLimit({ key: `remix-review:${req.action}:ip:${getClientIp(request)}`, limit: LIMITS[req.action], windowSeconds: 3600, failOpen: true });
    if (!limit.allowed) return json({ error: 'Too many requests. Try again later.' }, 429);
    if (req.action === 'list') return json(publicizeReviewResult(await listFor(ownerId, req)));
    if (req.action === 'set') return json(publicizeReviewResult(await setFor(ownerId, request, req)));
    return json(await mediaFor(ownerId, req));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) {
      console.error('[remix-review]', err);
      return json({ error: 'Something went wrong.' }, status);
    }
    return json({ error: err?.message || 'Request failed.', ...(err?.code ? { code: err.code } : {}) }, status);
  }
}
