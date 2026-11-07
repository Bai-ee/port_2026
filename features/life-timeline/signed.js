// Signed URL helpers. firebase-admin is imported lazily so unit tests never load it.
import { createRequire } from 'node:module';

export const READ_TTL_MS = 60 * 60 * 1000;
export const UPLOAD_TTL_MS = 15 * 60 * 1000;

let bucketFn = null;
function bucket() {
  if (!bucketFn) {
    const require = createRequire(import.meta.url);
    const fb = require('../../api/_lib/firebase-admin.cjs');
    bucketFn = () => fb.adminStorage.bucket();
  }
  return bucketFn();
}

export async function signReadUrl(storagePath, ttlMs = READ_TTL_MS, deps = {}) {
  const b = deps.bucket ? deps.bucket() : bucket();
  const [url] = await b.file(storagePath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs });
  return url;
}

export async function signUploadUrl({ storagePath, contentType }, deps = {}) {
  const b = deps.bucket ? deps.bucket() : bucket();
  const [url] = await b.file(storagePath).getSignedUrl({
    version: 'v4', action: 'write', expires: Date.now() + UPLOAD_TTL_MS, contentType,
  });
  return url;
}
