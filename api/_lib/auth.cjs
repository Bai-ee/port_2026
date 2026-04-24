const { timingSafeEqual } = require('crypto');
const fb = require('./firebase-admin.cjs');

function getHeaderValue(headers, name) {
  if (!headers || !name) return null;

  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue;
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
}

function safeSecretEquals(provided, configured) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (typeof configured !== 'string' || configured.length === 0) return false;

  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  if (providedBuffer.length !== configuredBuffer.length) return false;

  return timingSafeEqual(providedBuffer, configuredBuffer);
}

function buildAuthRequestShim(request) {
  return { headers: request?.headers || {} };
}

function getBearerToken(req) {
  const authHeader = getHeaderValue(req?.headers, 'authorization');
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    return null;
  }

  const token = String(authHeader).slice(7).trim();
  return token || null;
}

async function verifyRequestUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error('Unauthorized: missing bearer token.');
  }

  const decoded = await fb.adminAuth.verifyIdToken(token);

  if (!decoded.uid) {
    throw new Error('Unauthorized: invalid token.');
  }

  return decoded;
}

function hasValidWorkerSecret(req) {
  const configured = process.env.WORKER_SECRET;
  if (!configured) return false;
  const provided = getHeaderValue(req?.headers, 'x-worker-secret');
  return safeSecretEquals(provided, configured);
}

async function verifyAdminRequest(req) {
  if (hasValidWorkerSecret(req)) {
    return {
      uid: 'worker-secret',
      email: null,
      isWorkerSecret: true,
      authType: 'worker-secret',
    };
  }

  const decoded = await verifyRequestUser(req);
  const email = decoded.email;

  if (!email) {
    throw new Error('Forbidden: token has no email claim.');
  }

  const adminSnapshot = await fb.adminDb.collection('admins').doc(email).get();
  if (!adminSnapshot.exists) {
    throw new Error('Forbidden: admin access required.');
  }

  return decoded;
}

module.exports = {
  buildAuthRequestShim,
  getHeaderValue,
  hasValidWorkerSecret,
  safeSecretEquals,
  verifyAdminRequest,
  verifyRequestUser,
};
