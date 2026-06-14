import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 30;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

const DISCOVERY_DOC = ['leadgen_configs', 'discovery'];
const SCORING_DOC   = ['leadgen_configs', 'scoring'];

async function authedUid(request) {
  try {
    const decoded = await verifyAdminRequest(makeReqShim(request));
    return decoded?.uid || null;
  } catch {
    return null;
  }
}

// GET /api/leadgen/configs — returns { discovery, scoring }
export async function GET(request) {
  const uid = await authedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const [discoverySnap, scoringSnap] = await Promise.all([
    fb.adminDb.collection(DISCOVERY_DOC[0]).doc(DISCOVERY_DOC[1]).get(),
    fb.adminDb.collection(SCORING_DOC[0]).doc(SCORING_DOC[1]).get(),
  ]);

  return NextResponse.json({
    ok: true,
    discovery: discoverySnap.exists ? discoverySnap.data() : { campaigns: [] },
    scoring:   scoringSnap.exists   ? scoringSnap.data()   : null,
  });
}

// PUT /api/leadgen/configs
//   body: { discovery?: {...}, scoring?: {...} }  // partial — only the keys provided are written
export async function PUT(request) {
  const uid = await authedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const writes = [];
  if (body.discovery && typeof body.discovery === 'object') {
    writes.push(
      fb.adminDb.collection(DISCOVERY_DOC[0]).doc(DISCOVERY_DOC[1])
        .set({ ...body.discovery, updatedAt: new Date().toISOString(), updatedBy: uid }, { merge: true }),
    );
  }
  if (body.scoring && typeof body.scoring === 'object') {
    writes.push(
      fb.adminDb.collection(SCORING_DOC[0]).doc(SCORING_DOC[1])
        .set({ ...body.scoring, updatedAt: new Date().toISOString(), updatedBy: uid }, { merge: true }),
    );
  }
  if (!writes.length) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  await Promise.all(writes);
  return NextResponse.json({ ok: true });
}
