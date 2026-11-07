// Owner gate for /api/life/*: Firebase ID token AND uid in LIFE_OWNER_UIDS. Never falls back to admins.
import { createRequire } from 'node:module';

function ownerUids(env) {
  return String(env?.LIFE_OWNER_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const err = (status, message) => Object.assign(new Error(message), { status });

export async function requireLifeOwner(request, deps = {}) {
  const env = deps.env || process.env;
  const uids = ownerUids(env);
  if (!uids.length) throw err(503, 'Life timeline not configured');
  let verify = deps.verifyRequestUser;
  if (!verify) {
    const require = createRequire(import.meta.url);
    verify = require('../../api/_lib/auth.cjs').verifyRequestUser;
  }
  let decoded;
  try {
    const authz = request.headers.get('authorization');
    decoded = await verify({ headers: { authorization: authz, Authorization: authz } });
  } catch {
    throw err(401, 'Unauthorized');
  }
  if (!decoded?.uid) throw err(401, 'Unauthorized');
  if (!uids.includes(decoded.uid)) throw err(403, 'Owner only');
  return decoded;
}
