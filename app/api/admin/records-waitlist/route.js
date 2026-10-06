import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { waitlistToCsv } from '../../../../features/records-page/records-helpers.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: waitlist rows (newest first). ?format=csv returns a CSV download.
export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const snap = await fb.adminDb.collection('records_waitlist').orderBy('createdAt', 'desc').limit(5000).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (new URL(request.url).searchParams.get('format') === 'csv') {
    return new Response(waitlistToCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="records-waitlist.csv"',
        'cache-control': 'no-store',
      },
    });
  }
  return NextResponse.json({ count: rows.length, rows }, { headers: { 'cache-control': 'no-store' } });
}
