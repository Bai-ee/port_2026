import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Diagnostic: returns the decoded token's email and whether an admins doc
// exists for it. Used to debug "Forbidden: admin access required" errors.

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const tokenEmail = decoded.email || null;
  let adminDocExists = false;
  let adminDocId = null;
  if (tokenEmail) {
    const snap = await fb.adminDb.collection('admins').doc(tokenEmail).get();
    adminDocExists = snap.exists;
    adminDocId = tokenEmail;
  }

  return json({
    uid: decoded.uid,
    email: tokenEmail,
    emailVerified: decoded.email_verified ?? null,
    provider: decoded.firebase?.sign_in_provider ?? null,
    admin: {
      lookupDocId: adminDocId,
      docExists: adminDocExists,
    },
  });
}
