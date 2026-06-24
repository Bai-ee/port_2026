import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const auth = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

const { buildAuthRequestShim, verifyRequestUser } = auth;

// Diagnostic: returns the decoded token's email and whether an admins doc
// exists for it. Used to debug "Forbidden: admin access required" errors.

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function checkAdminEmail(rawEmail) {
  if (typeof auth.isAdminEmail === 'function') {
    return auth.isAdminEmail(rawEmail);
  }
  if (!rawEmail) return false;
  const email = String(rawEmail).trim().toLowerCase();
  if (!email) return false;
  const snap = await fb.adminDb.collection('admins').doc(email).get();
  return snap.exists;
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const tokenEmail = decoded.email ? String(decoded.email).trim().toLowerCase() : null;
  const adminDocExists = await checkAdminEmail(tokenEmail);

  return json({
    uid: decoded.uid,
    email: tokenEmail,
    emailVerified: decoded.email_verified ?? null,
    provider: decoded.firebase?.sign_in_provider ?? null,
    admin: {
      lookupDocId: tokenEmail,
      docExists: adminDocExists,
    },
  });
}
