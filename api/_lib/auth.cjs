const fb = require('./firebase-admin.cjs');

async function verifyRequestUser(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ')) {
    throw new Error('Unauthorized: missing bearer token.');
  }

  const token = String(authHeader).slice(7);
  const decoded = await fb.adminAuth.verifyIdToken(token);

  if (!decoded.uid) {
    throw new Error('Unauthorized: invalid token.');
  }

  return decoded;
}

function hasValidWorkerSecret(req) {
  const configured = process.env.WORKER_SECRET;
  if (!configured) return false;
  const provided = req?.headers?.['x-worker-secret'] || req?.headers?.['X-Worker-Secret'] || null;
  return typeof provided === 'string' && provided.length > 0 && provided === configured;
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
  verifyAdminRequest,
  verifyRequestUser,
};
