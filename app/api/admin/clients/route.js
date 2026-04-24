import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const _fb = require('../../../../api/_lib/firebase-admin.cjs');

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

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      403
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

  return json({ clients });
}
