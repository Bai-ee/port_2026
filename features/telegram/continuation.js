// continuation.js — signed web-upload continuation for Telegram intake (files over Telegram's 20 MB bot limit).
//
// A short-lived HMAC token scopes ONE intake item (intakeId + fileUniqueId + clientId + telegramUserId). The
// public page /telegram-upload/<token> needs no login: the token is the scope. Secret env: TELEGRAM_UPLOAD_SECRET;
// unset => feature disabled (null link, every verify fails). No default secret is ever invented.
//
// Pure of globals: db, bucket, clock, secret, pilot gate and attachWebUpload are injected, so the route binds real
// deps and tests bind fakes.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { STORAGE_PREFIX, sniffContentType } from './intake-storage.js';
import { checkBindingAccess } from './access.js';
import { getBinding } from './store.js';

export const UPLOAD_SECRET_ENV = 'TELEGRAM_UPLOAD_SECRET';
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const SIGNED_PUT_TTL_MS = 30 * 60 * 1000;
export const INTAKES_COLLECTION = 'telegram_intakes';
export const ALLOWED_TYPES = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
});

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (payload, secret) => createHmac('sha256', secret).update(payload).digest();
const safeId = (v) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/** @returns {string|null} token, or null when no secret is configured. */
export function signContinuationToken({ intakeId, fileUniqueId, clientId, telegramUserId, expiresAt }, secret, { now = Date.now() } = {}) {
  if (!secret) return null;
  const claims = { i: intakeId, f: fileUniqueId, c: clientId, u: String(telegramUserId), e: expiresAt ?? now + TOKEN_TTL_MS };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(mac(payload, secret))}`;
}

/** @returns {{ok:true, claims:{intakeId,fileUniqueId,clientId,telegramUserId,expiresAt}}|{ok:false, reason:string}} */
export function verifyContinuationToken(token, secret, { now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: 'disabled' };
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const given = Buffer.from(parts[1], 'base64url');
  const expected = mac(parts[0], secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };
  let c;
  try { c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!c || !c.i || !c.f || !c.c || !c.u || !Number.isFinite(c.e)) return { ok: false, reason: 'malformed' };
  if (now > c.e) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { intakeId: c.i, fileUniqueId: c.f, clientId: c.c, telegramUserId: c.u, expiresAt: c.e } };
}

export function continuationUrlFor(baseUrl, token) {
  if (!baseUrl || !token) return null;
  return `${String(baseUrl).replace(/\/+$/, '')}/telegram-upload/${token}`;
}

/** Deterministic: a retried upload overwrites the same object. */
export function storagePathFor({ clientId, intakeId, fileUniqueId, ext }) {
  return `${STORAGE_PREFIX}/${safeId(clientId)}/${safeId(intakeId)}/web-${safeId(fileUniqueId).slice(0, 40)}.${String(ext || 'bin').replace(/[^a-z0-9]/gi, '')}`;
}

const fail = (status, error) => ({ status, body: { error } });
const TOKEN_MSG = { expired: 'This upload link has expired. Send the file to the bot again for a new link.' };

/** Shared gate for start + complete. Returns {claims, intake, item} or a {status, body} failure. */
async function authorize(deps, token) {
  const { db, secret, now = Date.now } = deps;
  const v = verifyContinuationToken(token, secret, { now: now() });
  if (!v.ok) {
    if (v.reason === 'disabled') return { failure: fail(503, 'Web upload is not available.') };
    return { failure: fail(v.reason === 'expired' ? 410 : 400, TOKEN_MSG[v.reason] || 'This upload link is not valid.') };
  }
  const { claims } = v;
  const binding = await getBinding(db, claims.telegramUserId);
  const access = binding && binding.clientId === claims.clientId
    ? checkBindingAccess(binding, deps.env || process.env, deps.requirePilotOwner ? { requirePilotOwner: deps.requirePilotOwner } : {})
    : { ok: false };
  if (!access.ok) return { failure: fail(403, 'This upload link is no longer active.') };
  const snap = await db.collection(INTAKES_COLLECTION).doc(claims.intakeId).get();
  const intake = snap.exists ? snap.data() : null;
  if (!intake || intake.clientId !== claims.clientId || String(intake.telegramUserId) !== String(claims.telegramUserId)) {
    return { failure: fail(404, 'This upload link is not valid.') };
  }
  const item = (intake.items || []).find((i) => i.fileUniqueId === claims.fileUniqueId);
  if (!item) return { failure: fail(404, 'This upload link is not valid.') };
  return { claims, intake, item };
}

function checkFile(contentType, bytes) {
  if (!ALLOWED_TYPES[contentType]) return 'That file type is not supported (JPEG, PNG, WebP, HEIC, MP4, MOV).';
  if (!Number.isFinite(bytes) || bytes <= 0) return 'That file is empty.';
  if (bytes > MAX_UPLOAD_BYTES) return 'That file is over the 2 GB limit.';
  return null;
}

/**
 * @param {{db, bucket, secret:string|undefined, now?:()=>number, env?:object, requirePilotOwner?:Function,
 *          attachWebUpload:(intakeId:string,fileUniqueId:string,file:object)=>Promise<any>}} deps
 * @param {{token:string, action:'start'|'complete', contentType:string, bytes:number}} req
 * @returns {Promise<{status:number, body:object}>}
 */
export async function completeContinuation(deps, { token, action, contentType, bytes } = {}) {
  if (action !== 'start' && action !== 'complete') return fail(400, 'Unknown action.');
  const auth = await authorize(deps, token);
  if (auth.failure) return auth.failure;
  const { claims, item } = auth;
  const type = String(contentType || '').toLowerCase();
  const size = Number(bytes);
  const storagePath = storagePathFor({ ...claims, ext: ALLOWED_TYPES[type] });

  if (action === 'start') {
    if (item.status === 'stored') return { status: 200, body: { ok: true, status: 'already-uploaded' } };
    if (item.status !== 'needs-web-upload') return fail(409, 'This file does not need a web upload.');
    const bad = checkFile(type, size);
    if (bad) return fail(400, bad);
    const now = (deps.now || Date.now)();
    const [uploadUrl] = await deps.bucket.file(storagePath).getSignedUrl({
      version: 'v4', action: 'write', expires: now + SIGNED_PUT_TTL_MS, contentType: type,
    });
    return { status: 200, body: { ok: true, uploadUrl, contentType: type, method: 'PUT' } };
  }

  // complete
  if (item.status === 'stored') return { status: 200, body: { ok: true, status: 'already-uploaded' } }; // idempotent repeat
  if (item.status !== 'needs-web-upload') return fail(409, 'This file does not need a web upload.');
  const bad = checkFile(type, size);
  if (bad) return fail(400, bad);
  const file = deps.bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return fail(404, 'The upload did not arrive. Please try again.');
  const [meta] = await file.getMetadata();
  if (Number(meta?.size) !== size) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    return fail(400, 'The uploaded file size did not match. Please try again.');
  }
  const [head] = await file.download({ start: 0, end: 63 });
  if (sniffContentType(Buffer.from(head)) !== type) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    return fail(400, 'That file is not a valid photo or video.');
  }
  const res = await deps.attachWebUpload(claims.intakeId, claims.fileUniqueId, { storagePath, contentType: type, bytes: size });
  if (res && res.ok === false) return fail(409, 'This upload could not be attached.');
  return { status: 200, body: { ok: true, status: res?.status || 'stored' } };
}
