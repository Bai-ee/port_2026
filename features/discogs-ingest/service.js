// Server-side plumbing for the assetManager Discogs pipeline (worker-token routes).
// Never posts to X: it only creates drafts and stages media.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSocialPost } from '../social-posting/twitter-service.js';
import { readInventory, upsertPackage } from '../x-content-inventory/store.js';
import {
  DISCOGS_SOURCE, buildContentPackage, buildDraftMediaPatch, buildDraftPayload, buildMediaVariants, buildPostText, isBuilderContent, packageId, variantPaths,
} from './draft-builder.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const { buildDownloadUrl } = require('../../api/_lib/storage-artifacts.cjs');

export const SIGNED_UPLOAD_TTL_MS = 30 * 60 * 1000;

// Owner's own dashboard client (users/<owner uid>.clientId, the one that holds
// the @bai_ee Copywriter queue). Override with DISCOGS_X_CLIENT_ID.
export const DEFAULT_DISCOGS_CLIENT_ID = 'bryan-balli-WUoltG84';

export function discogsClientId() {
  return process.env.DISCOGS_X_CLIENT_ID || DEFAULT_DISCOGS_CLIENT_ID;
}

/** Returns a NextResponse-ish status: 200 ok, 503 token unset, 401 wrong. */
export function workerAuthStatus(request) {
  const expected = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;
  if (!expected) return 503;
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return supplied && supplied === expected ? 200 : 401;
}

export async function signedUploadUrl({ storagePath, contentType }) {
  const [uploadUrl] = await fb.adminStorage.bucket().file(storagePath).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + SIGNED_UPLOAD_TTL_MS,
    contentType,
  });
  return uploadUrl;
}

/** Ensure the object exists and carries a download token; returns its token URL. */
export async function ensureDownloadUrl(storagePath) {
  const bucket = fb.adminStorage.bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw Object.assign(new Error(`Storage object not found: ${storagePath}`), { status: 404 });
  const [meta] = await file.getMetadata();
  let token = String(meta?.metadata?.firebaseStorageDownloadTokens || '').split(',')[0].trim();
  if (!token) {
    token = randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }
  return buildDownloadUrl(bucket.name, storagePath, token);
}

export async function findExistingDraft(releaseId) {
  const snap = await fb.adminDb.collection('social_posts')
    .where('source', '==', DISCOGS_SOURCE)
    .where('sourceRef.releaseId', '==', releaseId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

export async function ingestDiscogsDraft(req) {
  const vPaths = variantPaths(req.variants);
  // One token per object: the post media is usually also a variant, and minting tokens for the
  // same path in parallel lets the last write win and leaves the other URL with a dead token.
  const unique = [...new Set([req.videoStoragePath, req.imageStoragePath, ...vPaths])];
  const urls = await Promise.all(unique.map(ensureDownloadUrl));
  const urlByPath = Object.fromEntries(unique.map((p, i) => [p, urls[i]]));
  const videoUrl = urlByPath[req.videoStoragePath];
  const imageUrl = urlByPath[req.imageStoragePath];
  const mediaVariants = buildMediaVariants(req.variants, urlByPath);

  let post = await findExistingDraft(req.releaseId);
  let created = false;
  if (post) {
    if (post.status !== 'posted' && post.status !== 'posting') {
      const patch = { ...buildDraftMediaPatch(req, { videoUrl, imageUrl, mediaVariants }), updatedAt: new Date().toISOString() };
      // Refresh text only while it is still the untouched builder output; never overwrite human edits.
      if (isBuilderContent(post.content)) patch.content = buildPostText(req);
      await fb.adminDb.collection('social_posts').doc(post.id).set(patch, { merge: true });
      post = { ...post, ...patch };
    }
  } else {
    post = await createSocialPost(discogsClientId(), buildDraftPayload(req, { videoUrl, imageUrl, mediaVariants }));
    created = true;
  }

  // Keep any story/status/effort/rights a human already set on an existing row.
  const inventory = await readInventory();
  const existingPkg = inventory.packages.find((p) => p?.id === packageId(req.releaseId)) || null;
  await upsertPackage(buildContentPackage(req, existingPkg));

  return {
    postId: post.id,
    packageId: packageId(req.releaseId),
    created,
    mediaUrl: post.mediaUrl || videoUrl,
    replyMediaUrl: post.selfReply?.mediaUrl || imageUrl,
  };
}
