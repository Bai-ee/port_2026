import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const _fb = require('../../../../api/_lib/firebase-admin.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function serializeTimestamps(data) {
  if (!data) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v.toDate === 'function') {
      out[k] = v.toDate().toISOString();
    } else if (v && typeof v === 'object' && typeof v._seconds === 'number') {
      out[k] = new Date(v._seconds * 1000).toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function GET(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      { status: 403 }
    );
  }

  const snapshot = await _fb.adminDb
    .collection('clients')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const clients = snapshot.docs.map((doc) => {
    const data = doc.data();
    return serializeTimestamps({
      clientId: data.clientId || doc.id,
      companyName: data.companyName || '',
      websiteUrl: data.websiteUrl || '',
      normalizedHost: data.normalizedHost || '',
      status: data.status || 'provisioning',
      onboardingStatus: data.onboardingStatus || '',
      latestRunId: data.latestRunId || null,
      latestRunStatus: data.latestRunStatus || null,
      ownerEmail: data.ownerEmail || '',
      pricingTier: data.pricingTier || '',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  });

  return NextResponse.json({ clients });
}
